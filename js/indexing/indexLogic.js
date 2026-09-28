/**
 * indexLogic.js — the actual per-file work for indexing and raw search.
 *
 * Written as plain functions on EV so the exact same code runs:
 *   - inside each pool worker (js/indexing/worker.js does importScripts on this file), and
 *   - synchronously on the main thread as a fallback when Workers aren't
 *     available (js/indexing/workerClient.js), guaranteeing identical results either way.
 *
 * Only ever receives one file's Blob/bytes at a time and returns a small
 * plain-data record — never accumulates state across calls — so memory use
 * stays bounded no matter how many files a folder contains.
 */
(function (g) {
  'use strict';
  var EV = g.EV || (g.EV = {});

  var MAX_INDEXABLE_BYTES = 15 * 1024 * 1024; // skip indexing pathologically large messages

  // Deliberately NOT exported as EV.sha256Hex -- js/ui/render.js already exports its own copy of
  // this under that exact name for the main-thread UI (attachment hash display, the bulk OCR
  // action). This file runs inside a Worker too (importScripts'd by worker.js), where render.js is
  // never loaded at all, so it needs its own copy regardless; keeping it unexported avoids the two
  // files silently overwriting each other's EV.sha256Hex depending on script load order on the main
  // thread, where both files DO share one window.EV.
  async function sha256HexBytes(bytes) {
    if (!g.crypto || !g.crypto.subtle || !bytes || !bytes.length) return null;
    try {
      var digest = await g.crypto.subtle.digest('SHA-256', bytes);
      var arr = Array.from(new Uint8Array(digest));
      return arr.map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    } catch (e) {
      return null;
    }
  }

  // Bounds the urgency/financial-indicator scans to a body-length-independent cost: a phishing
  // lure's urgency language and financial-indicator payload are always near the top of the message,
  // so scanning far more than this adds cost without adding signal, regardless of how large the
  // full (already up to 15MB) body is allowed to be for the rest of indexing.
  var SIGNAL_SCAN_CHAR_LIMIT = 20000;

  var URGENCY_KEYWORDS = ['urgent', 'immediately', 'action required', 'account suspended', 'account has been limited',
    'verify your account', 'wire transfer', 'wire funds', 'gift card', 'confidential', 'kindly', 'asap',
    'act now', 'final notice', 'password expires', 'password will expire', 'limited time', 'failure to comply',
    'legal action', 'response is required'];
  EV.URGENCY_KEYWORDS = URGENCY_KEYWORDS;

  /** Count of distinct urgency/pressure phrases found (not total occurrences, so one repeated word
   * can't dominate the score) — a plain scored keyword match, not a grammar/linguistic judgment. */
  EV.urgencyScore = function (text) {
    var scanText = String(text || '').slice(0, SIGNAL_SCAN_CHAR_LIMIT).toLowerCase();
    var count = 0;
    URGENCY_KEYWORDS.forEach(function (kw) { if (scanText.indexOf(kw) !== -1) count++; });
    return count;
  };

  // Each pattern is deliberately anchored to a labeling keyword where a bare pattern alone would be
  // too prone to false positives on ordinary text (routing numbers, SWIFT/BIC codes) — IBAN and
  // crypto-wallet address formats are distinctive enough on their own. These are "possible" signals
  // for a human analyst to review, not a confirmed-fraud verdict, same spirit as the existing
  // "Possible sensitive data (PII) in body" rule template.
  var FINANCIAL_PATTERNS = [
    { type: 'iban', re: /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/ },
    { type: 'swift_bic', re: /\b(?:swift|bic)\b[^\n]{0,20}?\b[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/i },
    { type: 'routing_number', re: /\brouting\b[^\n]{0,20}?\b\d{9}\b/i },
    { type: 'crypto_wallet_btc', re: /\b(?:bc1[a-z0-9]{25,39}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})\b/ },
    { type: 'crypto_wallet_eth', re: /\b0x[a-fA-F0-9]{40}\b/ },
    { type: 'gift_card_request', re: /\b(?:amazon|itunes|apple|google\s*play|steam|visa|target|walmart)\s+gift\s*cards?\b/i }
  ];

  /** Distinct financial-indicator types found in `text` (bounded scan, see SIGNAL_SCAN_CHAR_LIMIT). */
  EV.extractFinancialIndicators = function (text) {
    var scanText = String(text || '').slice(0, SIGNAL_SCAN_CHAR_LIMIT);
    var found = [];
    FINANCIAL_PATTERNS.forEach(function (p) { if (p.re.test(scanText)) found.push(p.type); });
    return found;
  };

  /**
   * @param {number} fileId
   * @param {string} path
   * @param {ArrayBuffer} buffer
   * @param {{trustedDomains?: string[], domainCategories?: Array<{name:string,keywords:string[]}>}} [opts]
   * @returns {Promise<object>} compact index document
   */
  EV.buildIndexDoc = async function (fileId, path, buffer, opts) {
    opts = opts || {};
    if (buffer.byteLength > MAX_INDEXABLE_BYTES) {
      return {
        fileId: fileId, path: path, emailId: 'hash:toolarge:' + fileId, subject: '(too large to index: ' + Math.round(buffer.byteLength / 1e6) + ' MB)',
        fromName: '', fromAddr: '', fromDomain: '', toStr: '', ccStr: '', bccStr: '', replyToStr: '', returnPathStr: '', messageId: null,
        dateMs: null, size: buffer.byteLength, attCount: 0,
        attNames: '', attExts: [], attSha256s: [], urlCount: 0, urlDomains: [], recipientCount: 0, fieldTokens: {}, skipped: true,
        nameMismatch: false, lookalikeDomain: false, punycodeSender: false, urgencyScore: 0, financialIndicators: [],
        domainCategories: []
      };
    }
    var parsed = EV.parseEml(buffer);
    var bodyText = (parsed.textBody || '') + '\n' + EV.htmlToText(parsed.htmlBody || '');
    var urls = EV.extractUrls(parsed.textBody, parsed.htmlBody);
    var fromAddr = parsed.from[0] ? parsed.from[0].address : '';
    var fromName = parsed.from[0] ? parsed.from[0].name : '';
    var toStr = parsed.to.map(function (a) { return a.address; }).join(' ');
    var ccStr = parsed.cc.map(function (a) { return a.address; }).join(' ');
    var bccStr = parsed.bcc.map(function (a) { return a.address; }).join(' ');
    var replyToStr = parsed.replyTo.map(function (a) { return a.address; }).join(' ');
    // Return-Path isn't part of emlParser.js's core parsed shape (it's a raw envelope header, not an
    // address-list field like to/cc/bcc/replyTo) -- same raw-header-lookup buildRuleFacts already uses.
    var returnPathRaw = EV.getHeader(parsed.headers, 'return-path');
    var returnPathAddr = returnPathRaw ? EV.parseAddressList(returnPathRaw)[0] : null;
    var returnPathStr = returnPathAddr ? returnPathAddr.address : '';
    var attNames = parsed.attachments.map(function (a) { return a.filename; }).join(' ');
    var attExts = parsed.attachments.map(function (a) {
      var m = /\.[^.]+$/.exec(a.filename || '');
      return m ? m[0].toLowerCase() : '(none)';
    });
    // Eager, not lazy-per-click like the Attachments-tab hash display: the attachment's raw bytes
    // are already fully decoded in memory at this point (parseEml already did that), and
    // crypto.subtle.digest is fast even for multi-MB buffers, so hashing here adds negligible cost
    // to a pass that's already reading/decoding every byte of every attachment regardless -- unlike
    // OCR (seconds per image, one shared engine instance), there's no scale reason to keep this one
    // lazy/opportunistic. Nulls (crypto.subtle unavailable, e.g. a very old/oddball environment) are
    // filtered out rather than left in the array, so a search never has to special-case them.
    var attSha256s = (await Promise.all(parsed.attachments.map(function (a) { return sha256HexBytes(a.bytes); }))).filter(Boolean);
    var headerBlob = parsed.headers.map(function (h) { return h.value; }).join(' ');
    var uniqueRecipientAddrs = {};
    parsed.to.concat(parsed.cc, parsed.bcc).forEach(function (a) {
      if (a.address) uniqueRecipientAddrs[a.address.toLowerCase()] = true;
    });
    var recipientCount = Object.keys(uniqueRecipientAddrs).length;
    var fromDomainValue = domainOf(fromAddr) || '';
    var brandKeywords = EV.buildBrandKeywords(opts.trustedDomains);
    var domainIsTrusted = EV.ruleHelpers.isDomainTrusted(fromDomainValue, opts.trustedDomains);
    var nameMismatch = EV.ruleHelpers.displayNameBrandMismatch(fromName, fromDomainValue, brandKeywords);
    var lookalikeDomain = !domainIsTrusted && !!fromDomainValue && EV.ruleHelpers.looksLikeAnyDomain(fromDomainValue, EV.literalTrustedDomains(opts.trustedDomains), 2);
    var punycodeSender = EV.ruleHelpers.isPunycodeDomain(fromDomainValue);
    var urlDomainsValue = urlDomainsOf(urls);
    var domainCategories = EV.categorizeEmailDomains(
      [fromDomainValue].concat(urlDomainsValue, EV.extractDomainLikeTokens(headerBlob), EV.extractDomainLikeTokens(attNames)),
      opts.domainCategories
    );

    var fieldTokens = {
      subject: EV.tokenize(parsed.subject),
      from: EV.tokenize(fromAddr + ' ' + fromName),
      to: EV.tokenize(toStr),
      cc: EV.tokenize(ccStr),
      bcc: EV.tokenize(bccStr),
      replyto: EV.tokenize(replyToStr),
      returnpath: EV.tokenize(returnPathStr),
      body: EV.tokenize(bodyText),
      url: EV.tokenize(urls.join(' ')),
      attachment: EV.tokenize(attNames),
      meta: EV.tokenize(headerBlob)
    };

    return {
      fileId: fileId,
      path: path,
      emailId: EV.emailId(parsed),
      subject: parsed.subject || '(no subject)',
      fromName: fromName,
      fromAddr: fromAddr,
      fromDomain: domainOf(fromAddr) || '',
      toStr: toStr,
      ccStr: ccStr,
      bccStr: bccStr,
      replyToStr: replyToStr,
      returnPathStr: returnPathStr,
      messageId: parsed.messageId,
      dateMs: parsed.date ? parsed.date.getTime() : null,
      size: buffer.byteLength,
      attCount: parsed.attachments.length,
      attNames: attNames,
      attExts: attExts,
      attSha256s: attSha256s,
      urlCount: urls.length,
      urlDomains: urlDomainsValue,
      recipientCount: recipientCount,
      spf: parsed.authSummary.spf,
      dkim: parsed.authSummary.dkim,
      dmarc: parsed.authSummary.dmarc,
      fieldTokens: fieldTokens,
      nameMismatch: nameMismatch,
      lookalikeDomain: lookalikeDomain,
      punycodeSender: punycodeSender,
      urgencyScore: EV.urgencyScore(bodyText),
      financialIndicators: EV.extractFinancialIndicators(bodyText),
      domainCategories: domainCategories,
      skipped: false
    };
  };

  var LINE_CONTEXT = 40;

  function findAllMatches(haystackLower, needleLower) {
    var idxs = [];
    if (!needleLower) return idxs;
    var from = 0;
    while (true) {
      var idx = haystackLower.indexOf(needleLower, from);
      if (idx === -1) break;
      idxs.push(idx);
      from = idx + needleLower.length;
      if (idxs.length >= 200) break; // cap matches per file, this is a preview not a full report
    }
    return idxs;
  }

  /**
   * @param {number} fileId
   * @param {string} path
   * @param {ArrayBuffer} buffer   original raw bytes, untouched
   * @param {{query:string, isRegex:boolean, caseSensitive:boolean}} opts
   * @returns {object|null} null when there are no matches
   */
  EV.rawScanFile = function (fileId, path, buffer, opts) {
    // Same cap as buildIndexDoc — an unbounded scan of a pathologically large
    // file (e.g. an .eml with a multi-hundred-MB attachment) would balloon the
    // heap with binary-string copies of it; skip it instead of risking an
    // OOM crash on a folder full of such outliers.
    if (buffer.byteLength > MAX_INDEXABLE_BYTES) return null;
    var bytes = new Uint8Array(buffer);
    var raw = EV.bytesToBinaryString(bytes);
    var matches = [];
    if (opts.isRegex) {
      var flags = 'g' + (opts.caseSensitive ? '' : 'i');
      var re;
      try {
        re = new RegExp(opts.query, flags);
      } catch (e) {
        return { error: 'Invalid regex: ' + e.message };
      }
      var m;
      var guard = 0;
      while ((m = re.exec(raw)) && guard++ < 200) {
        matches.push(m.index);
        if (m[0].length === 0) re.lastIndex++;
      }
    } else {
      var hay = opts.caseSensitive ? raw : raw.toLowerCase();
      var needle = opts.caseSensitive ? opts.query : opts.query.toLowerCase();
      matches = findAllMatches(hay, needle);
    }
    if (matches.length === 0) return null;
    var snippets = matches.slice(0, 20).map(function (idx) {
      var start = Math.max(0, idx - LINE_CONTEXT);
      var end = Math.min(raw.length, idx + LINE_CONTEXT);
      var lineStart = raw.lastIndexOf('\n', idx) + 1;
      var line = raw.slice(0, idx).split('\n').length;
      return { offset: idx, line: line, snippet: raw.slice(start, end).replace(/[\r\n]+/g, ' ⏎ ') };
    });
    return { fileId: fileId, path: path, count: matches.length, snippets: snippets };
  };

  // ---------- tagging-rules engine ----------

  function levenshtein(a, b) {
    a = a || ''; b = b || '';
    var m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    var prev = new Array(n + 1);
    var cur = new Array(n + 1);
    for (var j = 0; j <= n; j++) prev[j] = j;
    for (var i = 1; i <= m; i++) {
      cur[0] = i;
      for (var k = 1; k <= n; k++) {
        var cost = a.charCodeAt(i - 1) === b.charCodeAt(k - 1) ? 0 : 1;
        cur[k] = Math.min(prev[k] + 1, cur[k - 1] + 1, prev[k - 1] + cost);
      }
      var tmp = prev; prev = cur; cur = tmp;
    }
    return prev[n];
  }

  /** Helper functions exposed to rule expressions as the second argument (`h`). */
  EV.ruleHelpers = {
    levenshtein: levenshtein,
    domainsMatch: function (a, b) { return !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase(); },

    // A small, hand-picked set of common two-label public suffixes (not the full IANA Public Suffix
    // List — vendoring/maintaining that would be a real dependency this project deliberately avoids;
    // see registrableDomain's doc comment). Covers the common real-world cases; anything not on this
    // list falls back to the simple last-two-labels heuristic.
    TWO_LABEL_PUBLIC_SUFFIXES: ['co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'co.in', 'net.in', 'org.in',
      'co.jp', 'co.nz', 'co.za', 'com.au', 'net.au', 'org.au', 'com.br', 'com.mx', 'co.kr'],

    /**
     * The "organizational domain" of a hostname — e.g. "mail.example.co.uk" and
     * "support.example.co.uk" both reduce to "example.co.uk", the same concept DMARC's *relaxed*
     * alignment uses (RFC 7489) to treat same-organization subdomains as aligned rather than flagging
     * every internal subdomain difference as a mismatch. This is a heuristic, not a full Public
     * Suffix List implementation (see TWO_LABEL_PUBLIC_SUFFIXES) — good enough for the common case,
     * not a guarantee for every exotic multi-label TLD.
     */
    registrableDomain: function (hostname) {
      if (!hostname) return '';
      var labels = String(hostname).toLowerCase().split('.').filter(Boolean);
      if (labels.length <= 2) return labels.join('.');
      var lastTwo = labels.slice(-2).join('.');
      var take = EV.ruleHelpers.TWO_LABEL_PUBLIC_SUFFIXES.indexOf(lastTwo) !== -1 ? 3 : 2;
      return labels.slice(-take).join('.');
    },
    /** True if `a` and `b` share the same organizational domain (DMARC-style relaxed alignment) —
     * the subdomain-aware sibling of domainsMatch's exact comparison. */
    domainsAlign: function (a, b) {
      if (!a || !b) return false;
      var ra = EV.ruleHelpers.registrableDomain(a);
      var rb = EV.ruleHelpers.registrableDomain(b);
      return !!ra && ra === rb;
    },
    looksLikeDomain: function (target, trusted, maxDist) {
      if (!target || !trusted) return false;
      target = String(target).toLowerCase(); trusted = String(trusted).toLowerCase();
      if (target === trusted) return false; // an exact match is the real domain, not a look-alike
      return levenshtein(target, trusted) <= (maxDist == null ? 2 : maxDist);
    },
    looksLikeAnyDomain: function (target, trustedList, maxDist) {
      var self_ = this;
      return (trustedList || []).some(function (t) { return self_.looksLikeDomain(target, t, maxDist); });
    },
    includesAny: function (str, words) {
      if (!str) return false;
      var s = String(str).toLowerCase();
      return (words || []).some(function (w) { return s.indexOf(String(w).toLowerCase()) !== -1; });
    },

    // ---------- generic match helpers: usable on any field (subject, sender
    // name/domain, header value, attachment filename, ...) so a rule never
    // needs to hand-write regex-literal syntax or worry about case-folding. ----------

    /** Exact match, case-insensitive by default. */
    equals: function (a, b, caseSensitive) {
      if (a == null || b == null) return false;
      a = String(a); b = String(b);
      return caseSensitive ? a === b : a.toLowerCase() === b.toLowerCase();
    },
    /** Substring match, case-insensitive by default. */
    contains: function (a, b, caseSensitive) {
      if (a == null || b == null) return false;
      a = String(a); b = String(b);
      if (!caseSensitive) { a = a.toLowerCase(); b = b.toLowerCase(); }
      return a.indexOf(b) !== -1;
    },
    startsWith: function (a, b, caseSensitive) {
      if (a == null || b == null) return false;
      a = String(a); b = String(b);
      if (!caseSensitive) { a = a.toLowerCase(); b = b.toLowerCase(); }
      return a.indexOf(b) === 0;
    },
    endsWith: function (a, b, caseSensitive) {
      if (a == null || b == null) return false;
      a = String(a); b = String(b);
      if (!caseSensitive) { a = a.toLowerCase(); b = b.toLowerCase(); }
      return a.slice(-b.length) === b;
    },
    /**
     * Regex match — `pattern` can be a real /regex/ literal or a plain
     * string (handy when building the pattern dynamically); defaults to
     * case-insensitive. Never throws: an invalid pattern just returns false.
     */
    matches: function (value, pattern, flags) {
      if (value == null) return false;
      try {
        var re = (pattern instanceof RegExp) ? pattern : new RegExp(pattern, flags === undefined ? 'i' : flags);
        return re.test(String(value));
      } catch (e) { return false; }
    },

    // ---------- attachment convenience helpers ----------

    /** True if any attachment's extension (e.g. ".exe") is in the given list. */
    attachmentExtIn: function (attachments, extList) {
      var set = {};
      (extList || []).forEach(function (e) { set[String(e).toLowerCase()] = true; });
      return (attachments || []).some(function (a) { return set[(a.ext || '').toLowerCase()]; });
    },
    /** True if any attachment satisfies a predicate: h.anyAttachment(f.attachments, a => a.size > 5e6) */
    anyAttachment: function (attachments, predicate) {
      return (attachments || []).some(predicate);
    },
    /** Count of attachments satisfying a predicate (omit predicate to count all). */
    countAttachments: function (attachments, predicate) {
      attachments = attachments || [];
      return predicate ? attachments.filter(predicate).length : attachments.length;
    },

    // ---------- evasion/anomaly detection helpers ----------

    DOCUMENT_LIKE_EXTENSIONS: ['pdf', 'doc', 'docx', 'docm', 'xls', 'xlsx', 'xlsm', 'ppt', 'pptx', 'pptm',
      'odt', 'odp', 'rtf', 'txt', 'jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff', 'tif', 'svg', 'webp', 'zip'],
    /**
     * True for a "double extension" filename like "invoice.pdf.exe" — the
     * classic trick of appending a real extension in front of the actual
     * (often executable) one so a quick glance reads it as a harmless
     * document. Checks whether the second-to-last dot-segment is itself a
     * common document/media extension.
     */
    hasDualExtension: function (filename) {
      if (!filename) return false;
      var parts = String(filename).toLowerCase().split('.');
      if (parts.length < 3) return false;
      var middle = parts[parts.length - 2];
      return EV.ruleHelpers.DOCUMENT_LIKE_EXTENSIONS.indexOf(middle) !== -1;
    },

    // Zero-width/invisible/bidi-control Unicode characters sometimes used to
    // split up text and evade keyword/string filters (a well-documented
    // technique, not specific to any one detector).
    HIDDEN_UNICODE_CHARS: ['­', ' ', '​', '‌', '‍', '‎', '‏',
      '‪', '‫', '‬', '‭', '‮', '﻿', '⁠', '⁡', '؜'],
    /** Count of hidden/zero-width Unicode characters found in a string. */
    countHiddenUnicode: function (str) {
      if (!str) return 0;
      var s = String(str);
      var count = 0;
      EV.ruleHelpers.HIDDEN_UNICODE_CHARS.forEach(function (ch) {
        for (var i = s.indexOf(ch); i !== -1; i = s.indexOf(ch, i + 1)) count++;
      });
      return count;
    },
    /** True if a string contains more than `threshold` hidden/zero-width characters (default 0 = any). */
    hasHiddenUnicode: function (str, threshold) {
      return EV.ruleHelpers.countHiddenUnicode(str) > (threshold == null ? 0 : threshold);
    },

    /** Standard Shannon entropy (bits/char) — higher means more random-looking, e.g. generated IDs. */
    shannonEntropy: function (str) {
      str = String(str || '');
      if (!str.length) return 0;
      var freq = {};
      for (var i = 0; i < str.length; i++) freq[str[i]] = (freq[str[i]] || 0) + 1;
      var entropy = 0;
      Object.keys(freq).forEach(function (ch) {
        var p = freq[ch] / str.length;
        entropy -= p * Math.log2(p);
      });
      return entropy;
    },
    /** True if `str` is long enough and high-entropy enough to look like a random/generated token rather than a word. */
    looksRandom: function (str, minLen, entropyThreshold) {
      str = String(str || '');
      minLen = minLen == null ? 12 : minLen;
      entropyThreshold = entropyThreshold == null ? 3.5 : entropyThreshold;
      return str.length >= minLen && EV.ruleHelpers.shannonEntropy(str) > entropyThreshold;
    },

    COMMON_BRANDS: ['paypal.com', 'microsoft.com', 'docusign.com', 'google.com', 'apple.com', 'amazon.com',
      'dropbox.com', 'office.com', 'bankofamerica.com', 'wellsfargo.com', 'chase.com', 'facebook.com', 'netflix.com'],

    /** True if any dot-label of the domain is IDN/punycode-encoded (xn--...) — a real brand domain
     * essentially never needs this, so its presence on a sender domain is itself a signal, distinct
     * from (and not caught by) a Levenshtein-distance lookalike check on the raw encoded string. */
    isPunycodeDomain: function (domain) {
      if (!domain) return false;
      return String(domain).toLowerCase().split('.').some(function (label) { return label.indexOf('xn--') === 0; });
    },

    /** True if a trusted-domains entry is written as a regex (`/pattern/flags`, same convention as
     * this app's `field:/regex/` search syntax) rather than a plain literal domain. */
    isRegexTrustedEntry: function (entry) {
      return /^\/.*\/[a-z]*$/i.test(String(entry || ''));
    },

    /**
     * True if `domain` is covered by any entry in `trustedList` — an exact match, a subdomain of a
     * literal entry (e.g. "mail.mycompany.com" is covered by "mycompany.com"), or a match against a
     * regex entry (`/\.corp\.mycompany\.com$/`). A regex entry that fails to compile is skipped, not
     * thrown — same never-throw contract as h.matches.
     */
    isDomainTrusted: function (domain, trustedList) {
      if (!domain) return false;
      var domainLower = String(domain).toLowerCase();
      return (trustedList || []).some(function (entry) {
        var m = /^\/(.*)\/([a-z]*)$/i.exec(String(entry || ''));
        if (m) {
          try { return new RegExp(m[1], m[2]).test(domainLower); } catch (e) { return false; }
        }
        var entryLower = String(entry).toLowerCase();
        return domainLower === entryLower || domainLower.slice(-(entryLower.length + 1)) === '.' + entryLower;
      });
    },

    /**
     * True if the display name invokes a known brand (e.g. "PayPal Support") but the sending
     * domain isn't that brand's real domain (or a subdomain of it) — the classic "trusted name,
     * wrong address" spoof. `brandKeywords` defaults to a keyword->domain map derived from
     * COMMON_BRANDS; pass the trusted-domains-derived one to also catch impersonation of your own
     * organization (see EV.buildBrandKeywords).
     */
    displayNameBrandMismatch: function (fromName, fromDomain, brandKeywords) {
      if (!fromName || !fromDomain) return false;
      brandKeywords = brandKeywords || EV.ruleHelpers.BRAND_KEYWORDS;
      var nameLower = String(fromName).toLowerCase();
      var domainLower = String(fromDomain).toLowerCase();
      var matchedDomain = null;
      Object.keys(brandKeywords).some(function (keyword) {
        if (nameLower.indexOf(keyword) !== -1) { matchedDomain = brandKeywords[keyword]; return true; }
        return false;
      });
      if (!matchedDomain) return false;
      if (domainLower === matchedDomain) return false; // the real brand domain, not a mismatch
      if (domainLower.slice(-(matchedDomain.length + 1)) === '.' + matchedDomain) return false; // legit subdomain
      return true;
    }
  };

  // Keyword -> domain map derived from COMMON_BRANDS (e.g. "paypal" -> "paypal.com"), plus a couple
  // of common multi-word aliases a single domain-label split can't produce. Built once at load time,
  // not per-call, since it's pure static data.
  (function () {
    var map = {};
    EV.ruleHelpers.COMMON_BRANDS.forEach(function (domain) { map[domain.split('.')[0]] = domain; });
    map['bank of america'] = 'bankofamerica.com';
    map['wells fargo'] = 'wellsfargo.com';
    EV.ruleHelpers.BRAND_KEYWORDS = map;
  })();

  /** Merges the user-editable trusted-domains list (Settings) with the built-in brand list, for
   * both the lookalike-domain check and displayNameBrandMismatch's keyword map. Regex-shaped entries
   * are skipped here (deriving a "keyword" from a regex pattern string isn't meaningful) — they're
   * still honored separately by isDomainTrusted. */
  EV.buildBrandKeywords = function (trustedDomains) {
    var map = Object.assign({}, EV.ruleHelpers.BRAND_KEYWORDS);
    (trustedDomains || []).forEach(function (domain) {
      if (EV.ruleHelpers.isRegexTrustedEntry(domain)) return;
      var label = String(domain).split('.')[0];
      if (label) map[label] = String(domain).toLowerCase();
    });
    return map;
  };

  /** The literal (non-regex) trusted domains plus the built-in brand list — the list a Levenshtein
   * lookalike comparison can sensibly run against (regex entries are handled separately, exactly, by
   * isDomainTrusted, not fuzzy-matched). */
  EV.literalTrustedDomains = function (trustedDomains) {
    return (trustedDomains || []).filter(function (d) { return !EV.ruleHelpers.isRegexTrustedEntry(d); }).concat(EV.ruleHelpers.COMMON_BRANDS);
  };

  // ---------- domain categories ("what type of domain is this?") ----------
  //
  // A small, independently-curated starter set — deliberately NOT an exhaustive taxonomy. This is
  // meant purely as a demonstration/seed; the real value is the Settings page letting a user build
  // out their own categories (and add to any of these) from their own experience, stored only in
  // their own browser (never in this repo's source).
  var DEFAULT_DOMAIN_CATEGORIES = [
    { name: 'CDN / Cloud Hosting', keywords: ['cloudflare.com', 'cloudfront.net', 'fastly.net', 'akamai.net', 'azureedge.net', 'googleusercontent.com', 'jsdelivr.net'] },
    { name: 'File Sharing / Cloud Storage', keywords: ['dropbox.com', 'drive.google.com', 'onedrive.live.com', 'sharepoint.com', 'box.com', 'wetransfer.com', 'mega.nz'] },
    { name: 'URL Shortener', keywords: ['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'rebrand.ly'] },
    { name: 'Payment Processor', keywords: ['paypal.com', 'stripe.com', 'squareup.com', 'venmo.com', 'payoneer.com'] },
    { name: 'Social Media', keywords: ['facebook.com', 'twitter.com', 'x.com', 'instagram.com', 'linkedin.com', 'tiktok.com', 'reddit.com'] },
    { name: 'Code Repository / Paste Site', keywords: ['github.com', 'gitlab.com', 'bitbucket.org', 'pastebin.com', 'gist.github.com'] },
    { name: 'Email Security Link-Rewrite Service', keywords: ['proofpoint.com', 'safelinks.protection.outlook.com', 'barracudanetworks.com', 'cudasvc.com'] },
    { name: 'Communication / Meeting Platform', keywords: ['zoom.us', 'teams.microsoft.com', 'meet.google.com', 'webex.com', 'slack.com'] },
    { name: 'Suspicious / Free TLD', keywords: ['.xyz', '.top', '.click', '.link', '.zip', '.mov'] }
  ];
  EV.DEFAULT_DOMAIN_CATEGORIES = DEFAULT_DOMAIN_CATEGORIES;

  /** True if `domain` matches a category keyword: a keyword starting with "." is a TLD/suffix check
   * (domain literally ends with it); a keyword that itself looks like a real domain (contains a ".")
   * matches only that exact domain or one of its subdomains -- an unanchored substring check here would
   * false-positive constantly (e.g. a keyword "t.co" would "match" microsoft.com/target.com/walmart.com,
   * since they all happen to contain the four characters "t.co" right before their own ".com" -- this
   * was a real, shipped bug, not a hypothetical one). A keyword with no "." at all (a bare word, e.g. a
   * brand name a user might add) keeps the original plain substring check, which is reasonable and
   * intentional there. */
  function matchesCategoryKeyword(domain, keyword) {
    if (!domain || !keyword) return false;
    domain = String(domain).toLowerCase();
    keyword = String(keyword).toLowerCase();
    if (keyword.charAt(0) === '.') return domain.slice(-keyword.length) === keyword;
    if (keyword.indexOf('.') !== -1) return domain === keyword || domain.slice(-(keyword.length + 1)) === '.' + keyword;
    return domain.indexOf(keyword) !== -1;
  }
  EV.ruleHelpers.matchesCategoryKeyword = matchesCategoryKeyword;

  /** Every category name (from a Settings-shaped `[{name, keywords}]` list) that matches `domain`. */
  EV.ruleHelpers.domainCategoriesFor = function (domain, categories) {
    if (!domain) return [];
    var matched = [];
    (categories || []).forEach(function (cat) {
      if ((cat.keywords || []).some(function (kw) { return matchesCategoryKeyword(domain, kw); })) matched.push(cat.name);
    });
    return matched;
  };

  // A generic domain-like-token matcher, adapted from sanitize.js's EMBEDDED_URL_RE (same shape, made
  // global here) — used to pull candidate domains out of arbitrary text (header values, attachment
  // filenames) rather than just the structured fields (From/Reply-To/URL domains) that already have a
  // real hostname.
  var DOMAIN_TOKEN_RE = /\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}\b/gi;

  /** Every distinct domain-like token found in a blob of free text (bounded to the first 200 matches
   * so a pathological input can't cause unbounded work). */
  EV.extractDomainLikeTokens = function (text) {
    if (!text) return [];
    var seen = {};
    var out = [];
    var m;
    DOMAIN_TOKEN_RE.lastIndex = 0;
    while ((m = DOMAIN_TOKEN_RE.exec(text)) && out.length < 200) {
      var tok = m[0].toLowerCase();
      if (!seen[tok]) { seen[tok] = true; out.push(tok); }
    }
    return out;
  };

  /**
   * Categorizes every domain reachable from an email — sender/reply-to/return-path, every URL domain
   * in the body, and domain-like tokens found in attachment filenames and raw header text — against
   * a Settings-shaped `[{name, keywords}]` category list. Returns a deduped array of matched category
   * names (not a per-domain breakdown, to keep the common case — "does this email touch anything
   * flagged?" — a one-line check: `f.domainCategories.length > 0`).
   */
  EV.categorizeEmailDomains = function (domainSources, categories) {
    if (!categories || !categories.length) return [];
    var matched = {};
    (domainSources || []).forEach(function (domain) {
      EV.ruleHelpers.domainCategoriesFor(domain, categories).forEach(function (name) { matched[name] = true; });
    });
    return Object.keys(matched).sort();
  };

  function domainOf(address) {
    if (!address) return null;
    var at = address.lastIndexOf('@');
    return at === -1 ? null : address.slice(at + 1).toLowerCase();
  }

  function addrFact(a) {
    if (!a || !a.address) return null;
    return { name: a.name || '', address: a.address, domain: domainOf(a.address) };
  }

  /** Deduped, lowercased hostnames referenced by a list of extracted URLs. */
  function urlDomainsOf(urls) {
    var out = [];
    var seen = {};
    urls.forEach(function (u) {
      var withProto = /^[a-z]+:\/\//i.test(u) ? u : 'http://' + u.replace(/^www\./i, '');
      try {
        var host = new URL(withProto).hostname.toLowerCase();
        if (host && !seen[host]) { seen[host] = true; out.push(host); }
      } catch (e) { /* not a parseable URL, skip */ }
    });
    return out;
  }
  EV.urlDomainsOf = urlDomainsOf;

  /**
   * Builds the read-only "facts" object a rule expression is evaluated
   * against (the first argument, `f`). Kept intentionally flat and simple —
   * see README's rules section for the full documented field list.
   * @param {object} parsed
   * @param {{trustedDomains?: string[]}} [opts]
   */
  EV.buildRuleFacts = function (parsed, opts) {
    opts = opts || {};
    var urls = EV.extractUrls(parsed.textBody, parsed.htmlBody);
    var urlDomains = urlDomainsOf(urls);
    var returnPathRaw = EV.getHeader(parsed.headers, 'return-path');
    var returnPathAddr = returnPathRaw ? EV.parseAddressList(returnPathRaw)[0] : null;

    var toFacts = parsed.to.map(addrFact).filter(Boolean);
    var ccFacts = parsed.cc.map(addrFact).filter(Boolean);
    var bccFacts = parsed.bcc.map(addrFact).filter(Boolean);
    var uniqueRecipients = {};
    toFacts.concat(ccFacts, bccFacts).forEach(function (r) { uniqueRecipients[r.address.toLowerCase()] = true; });

    var from = addrFact(parsed.from[0]);
    var trustedDomains = opts.trustedDomains || [];
    var brandKeywords = EV.buildBrandKeywords(trustedDomains);
    var bodyText = (parsed.textBody || '') + '\n' + EV.htmlToText(parsed.htmlBody || '');
    var domainIsTrusted = from ? EV.ruleHelpers.isDomainTrusted(from.domain, trustedDomains) : false;
    var headerBlob = parsed.headers.map(function (h) { return h.value; }).join(' ');
    var attNamesBlob = parsed.attachments.map(function (a) { return a.filename; }).join(' ');
    var domainCategories = EV.categorizeEmailDomains(
      [from ? from.domain : ''].concat(urlDomains, EV.extractDomainLikeTokens(headerBlob), EV.extractDomainLikeTokens(attNamesBlob)),
      opts.domainCategories
    );

    return {
      subject: parsed.subject || '',
      from: from,
      to: toFacts,
      cc: ccFacts,
      bcc: bccFacts,
      recipientCount: Object.keys(uniqueRecipients).length,
      replyTo: addrFact(parsed.replyTo[0]),
      returnPath: addrFact(returnPathAddr),
      date: parsed.date,
      spf: parsed.authSummary.spf,
      dkim: parsed.authSummary.dkim,
      dmarc: parsed.authSummary.dmarc,
      bodyText: bodyText,
      urls: urls,
      urlDomains: urlDomains,
      attachments: parsed.attachments.map(function (a) {
        var m = /\.[^.]+$/.exec(a.filename || '');
        return { filename: a.filename, mimeType: a.mimeType, size: a.size, isInline: a.isInline, ext: m ? m[0].toLowerCase() : '' };
      }),
      attachmentCount: parsed.attachments.length,
      size: parsed.byteLength,
      messageId: parsed.messageId,
      trustedDomains: trustedDomains,
      domainIsTrusted: domainIsTrusted,
      nameMismatch: from ? EV.ruleHelpers.displayNameBrandMismatch(from.name, from.domain, brandKeywords) : false,
      lookalikeDomain: (!domainIsTrusted && from && from.domain) ? EV.ruleHelpers.looksLikeAnyDomain(from.domain, EV.literalTrustedDomains(trustedDomains), 2) : false,
      punycodeSender: from ? EV.ruleHelpers.isPunycodeDomain(from.domain) : false,
      urgencyScore: EV.urgencyScore(bodyText),
      financialIndicators: EV.extractFinancialIndicators(bodyText),
      domainCategories: domainCategories,
      getHeader: function (name) { return EV.getHeader(parsed.headers, String(name).toLowerCase()); },
      getHeaderAll: function (name) { return EV.getHeaderAll(parsed.headers, String(name).toLowerCase()); }
    };
  };

  var compiledRuleCache = {};

  var COMPILED_RULE_CACHE_MAX = 200; // rules are cheap to recompile; this only guards against unbounded growth

  function getCompiledRule(rule) {
    var key = rule.id + '\x01' + rule.expression;
    var fn = compiledRuleCache[key];
    if (!fn) {
      // Every edit to a rule's expression mints a new cache key (the old
      // expression's entry is never reachable again) -- reset instead of
      // growing forever across a long session of repeated rule edits.
      if (Object.keys(compiledRuleCache).length >= COMPILED_RULE_CACHE_MAX) compiledRuleCache = {};
      // eslint-disable-next-line no-new-func
      fn = new Function('f', 'h', 'return Boolean(' + rule.expression + ');');
      compiledRuleCache[key] = fn;
    }
    return fn;
  }

  /**
   * Evaluates every given rule's expression against one email.
   * @param {number} fileId
   * @param {string} path
   * @param {ArrayBuffer} buffer
   * @param {Array<{id:string, expression:string}>} rules
   * @param {{trustedDomains?: string[]}} [opts]
   * @returns {{fileId:number, path:string, emailId:string, matchedRuleIds:string[], errors:Array}}
   */
  EV.evalRulesForFile = function (fileId, path, buffer, rules, opts) {
    var parsed = EV.parseEml(buffer);
    var facts = EV.buildRuleFacts(parsed, opts);
    var emailId = EV.emailId(parsed);
    var matchedRuleIds = [];
    var errors = [];
    rules.forEach(function (rule) {
      try {
        var fn = getCompiledRule(rule);
        if (fn(facts, EV.ruleHelpers)) matchedRuleIds.push(rule.id);
      } catch (e) {
        errors.push({ ruleId: rule.id, message: String(e && e.message || e) });
      }
    });
    return { fileId: fileId, path: path, emailId: emailId, matchedRuleIds: matchedRuleIds, errors: errors };
  };
})(typeof self !== 'undefined' ? self : this);
