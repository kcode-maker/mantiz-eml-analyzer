/**
 * ruleSuggest.js — autocomplete for the rule expression editor (the textarea in the rule modal).
 *
 * A rule is a JavaScript expression over two objects: `f` (the email's facts) and `h` (helper
 * functions). Both have a fixed, documented shape, so the editor can offer them as you type:
 *   - `f.`            → every fact, with its type
 *   - `f.from.`       → name / address / domain (member lists follow the fact's type)
 *   - `h.`            → every helper, with its signature
 *   - `f.getHeader('` → the header names actually present in the open folder
 *   - a bare word of 2+ letters finds facts/helpers by name ("cont" → h.contains)
 * Accepting a function inserts `name(` with the caret inside the parentheses.
 *
 * Same two-halves split as searchSuggest.js: pure `compute`/`apply` (tested under jsc, no DOM) plus
 * `attach`, which reuses searchSuggest's dropdown. The helper catalogue is checked against the real
 * `EV.ruleHelpers` and the fact catalogue against a real `EV.buildRuleFacts` result in
 * tests/ruleSuggest.test.js, so neither can silently drift from the engine.
 */
(function (g) {
  'use strict';
  var EV = g.EV || (g.EV = {});

  var MAX_ITEMS = 40;

  // ---- facts (`f.<name>`): type drives what `f.<name>.` offers ----
  var FACTS = [
    { name: 'subject', type: 'string', detail: 'subject line' },
    { name: 'from', type: 'addr', detail: '{name, address, domain} or null' },
    { name: 'to', type: 'addrList', detail: 'array of {name, address, domain}' },
    { name: 'cc', type: 'addrList', detail: 'array of {name, address, domain}' },
    { name: 'bcc', type: 'addrList', detail: 'array of {name, address, domain}' },
    { name: 'recipientCount', type: 'number', detail: 'unique To+Cc+Bcc recipients' },
    { name: 'replyTo', type: 'addr', detail: '{name, address, domain} or null' },
    { name: 'returnPath', type: 'addr', detail: '{name, address, domain} or null' },
    { name: 'date', type: 'date', detail: 'Date or null' },
    { name: 'spf', type: 'string', detail: 'pass / fail / softfail / none / null' },
    { name: 'dkim', type: 'string', detail: 'pass / fail / none / null' },
    { name: 'dmarc', type: 'string', detail: 'pass / fail / none / null' },
    { name: 'bodyText', type: 'string', detail: 'decoded plain-text body' },
    { name: 'urls', type: 'array', detail: 'URLs found in the body' },
    { name: 'urlDomains', type: 'array', detail: 'unique hostnames of those URLs' },
    { name: 'attachments', type: 'array', detail: 'array of {filename, mimeType, size, isInline, ext}' },
    { name: 'attachmentCount', type: 'number', detail: 'number of attachments' },
    { name: 'size', type: 'number', detail: 'raw size in bytes' },
    { name: 'messageId', type: 'string', detail: 'Message-ID' },
    { name: 'trustedDomains', type: 'array', detail: 'your Settings trusted-domains list' },
    { name: 'domainIsTrusted', type: 'boolean', detail: 'sender domain is in your trusted list' },
    { name: 'nameMismatch', type: 'boolean', detail: 'display name claims a brand the domain is not' },
    { name: 'lookalikeDomain', type: 'boolean', detail: 'sender domain is a typosquat of a trusted one' },
    { name: 'punycodeSender', type: 'boolean', detail: 'sender domain uses xn-- (IDN) encoding' },
    { name: 'urgencyScore', type: 'number', detail: 'distinct urgency phrases in the body' },
    { name: 'financialIndicators', type: 'array', detail: "e.g. ['iban', 'gift_card_request']" },
    { name: 'originIp', type: 'string', detail: 'earliest public IP in the Received chain, or null (can be forged by the sender)' },
    { name: 'connectingIp', type: 'string', detail: 'newest public IP: who connected to the receiving side, or null (cannot be forged by the sender)' },
    { name: 'domainCategories', type: 'array', detail: 'Settings category names matched by any domain' },
    { name: 'anomalies', type: 'array', detail: "Security-card flag ids, e.g. ['fake-reply','homoglyph-body']" },
    { name: 'subjectScripts', type: 'array', detail: "scripts in the subject, e.g. ['latin']" },
    { name: 'bodyScripts', type: 'array', detail: "scripts in the body, e.g. ['cyrillic','latin']" },
    { name: 'getHeader', type: 'fn', sig: "(name)", detail: 'raw value of a header (case-insensitive)', header: true },
    { name: 'getHeaderAll', type: 'fn', sig: "(name)", detail: 'array of values, for repeated headers', header: true }
  ];

  // ---- helpers (`h.<name>`) ----
  var HELPERS = [
    { name: 'equals', sig: '(a, b, caseSensitive?)', detail: 'exact match, case-insensitive by default' },
    { name: 'contains', sig: '(a, b, caseSensitive?)', detail: 'substring match' },
    { name: 'startsWith', sig: '(a, b, caseSensitive?)', detail: 'prefix match' },
    { name: 'endsWith', sig: '(a, b, caseSensitive?)', detail: 'suffix match' },
    { name: 'matches', sig: '(value, pattern, flags?)', detail: 'regex match; /literal/ or string, never throws' },
    { name: 'includesAny', sig: '(str, words)', detail: 'contains any word of a list' },
    { name: 'domainsMatch', sig: '(a, b)', detail: 'case-insensitive domain equality' },
    { name: 'domainsAlign', sig: '(a, b)', detail: 'same organizational domain (DMARC relaxed)' },
    { name: 'registrableDomain', sig: '(hostname)', detail: 'mail.example.co.uk → example.co.uk' },
    { name: 'looksLikeDomain', sig: '(a, b, maxDist?)', detail: 'typosquat check (edit distance, default ≤2)' },
    { name: 'looksLikeAnyDomain', sig: '(a, list, maxDist?)', detail: 'typosquat check against a list' },
    { name: 'levenshtein', sig: '(a, b)', detail: 'edit distance between two strings' },
    { name: 'isDomainTrusted', sig: '(domain, list)', detail: 'exact / subdomain / regex match against a trusted list' },
    { name: 'isRegexTrustedEntry', sig: '(entry)', detail: 'true if a trusted-list entry is written /regex/' },
    { name: 'isPunycodeDomain', sig: '(domain)', detail: 'true if any label is xn-- encoded' },
    { name: 'displayNameBrandMismatch', sig: '(name, domain, brandKeywords?)', detail: 'display name claims a brand the domain is not' },
    { name: 'domainCategoriesFor', sig: '(domain, categories)', detail: 'category names whose keywords match a domain' },
    { name: 'matchesCategoryKeyword', sig: '(domain, keyword)', detail: 'one domain-category keyword test' },
    { name: 'attachmentExtIn', sig: '(attachments, extList)', detail: "any attachment extension in a list, e.g. ['.exe']" },
    { name: 'anyAttachment', sig: '(attachments, predicate)', detail: 'any attachment satisfies a(a)=>bool' },
    { name: 'countAttachments', sig: '(attachments, predicate?)', detail: 'count matching attachments' },
    { name: 'hasDualExtension', sig: '(filename)', detail: 'invoice.pdf.exe-style double extension' },
    { name: 'countHiddenUnicode', sig: '(str)', detail: 'number of zero-width / invisible characters' },
    { name: 'hasHiddenUnicode', sig: '(str, threshold?)', detail: 'more than threshold (default 0) invisible characters' },
    { name: 'shannonEntropy', sig: '(str)', detail: 'bits per character; higher = more random' },
    { name: 'looksRandom', sig: '(str, minLen?, entropy?)', detail: 'long + high-entropy (generated ID / token)' },
    { name: 'COMMON_BRANDS', constant: true, detail: 'built-in list of common brand domains' },
    { name: 'BRAND_KEYWORDS', constant: true, detail: 'brand keyword → domains map used by nameMismatch' },
    { name: 'TWO_LABEL_PUBLIC_SUFFIXES', constant: true, detail: 'two-label suffixes registrableDomain knows (co.uk …)' },
    { name: 'DOCUMENT_LIKE_EXTENSIONS', constant: true, detail: 'extensions hasDualExtension treats as documents' },
    { name: 'HIDDEN_UNICODE_CHARS', constant: true, detail: 'invisible characters countHiddenUnicode looks for' }
  ];

  // ---- members of the value types, for `f.subject.` / `f.from.` / `f.urls.` ----
  var STRING_MEMBERS = [
    { name: 'length', detail: 'number of characters' },
    { name: 'includes', sig: '(text)', detail: 'case-sensitive substring test' },
    { name: 'startsWith', sig: '(text)', detail: 'prefix test' },
    { name: 'endsWith', sig: '(text)', detail: 'suffix test' },
    { name: 'indexOf', sig: '(text)', detail: 'position of text, or -1' },
    { name: 'toLowerCase', sig: '()', detail: 'lowercased copy' },
    { name: 'trim', sig: '()', detail: 'without surrounding whitespace' },
    { name: 'split', sig: '(separator)', detail: 'array of parts' },
    { name: 'slice', sig: '(from, to?)', detail: 'part of the string' },
    { name: 'replace', sig: '(find, with)', detail: 'copy with a replacement' },
    { name: 'match', sig: '(regex)', detail: 'regex match result, or null' }
  ];
  var ARRAY_MEMBERS = [
    { name: 'length', detail: 'number of items' },
    { name: 'some', sig: '(x => …)', detail: 'true if any item satisfies the test' },
    { name: 'every', sig: '(x => …)', detail: 'true if all items satisfy the test' },
    { name: 'filter', sig: '(x => …)', detail: 'items satisfying the test' },
    { name: 'map', sig: '(x => …)', detail: 'transformed items' },
    { name: 'find', sig: '(x => …)', detail: 'first item satisfying the test' },
    { name: 'includes', sig: '(value)', detail: 'true if the array contains value' },
    { name: 'indexOf', sig: '(value)', detail: 'position of value, or -1' },
    { name: 'join', sig: '(separator)', detail: 'items joined into a string' }
  ];
  var ADDR_MEMBERS = [
    { name: 'name', detail: 'display name' },
    { name: 'address', detail: 'full address' },
    { name: 'domain', detail: 'domain part, lowercased' }
  ];
  var DATE_MEMBERS = [
    { name: 'getTime', sig: '()', detail: 'milliseconds since 1970' },
    { name: 'getFullYear', sig: '()', detail: 'year' },
    { name: 'getMonth', sig: '()', detail: 'month, 0–11' },
    { name: 'getDate', sig: '()', detail: 'day of month' },
    { name: 'getDay', sig: '()', detail: 'weekday, 0 = Sunday' },
    { name: 'getHours', sig: '()', detail: 'hour (local time)' },
    { name: 'toISOString', sig: '()', detail: 'ISO 8601 text' }
  ];
  var MEMBERS_BY_TYPE = { string: STRING_MEMBERS, array: ARRAY_MEMBERS, addrList: ARRAY_MEMBERS, addr: ADDR_MEMBERS, date: DATE_MEMBERS };
  var FACT_BY_NAME = {};
  FACTS.forEach(function (f) { FACT_BY_NAME[f.name] = f; });

  function isWordChar(c) { return /[\w$]/.test(c); }

  /** True when `caret` sits inside an open ', " or ` string literal (a simple left-to-right scan;
   * a regex literal containing quotes can fool it, in which case it just stays quiet). */
  function openQuoteAt(text, caret) {
    var q = null;
    for (var i = 0; i < caret; i++) {
      var c = text.charAt(i);
      if (q) {
        if (c === '\\') i++;
        else if (c === q) q = null;
      } else if (c === "'" || c === '"' || c === '`') {
        q = c;
      }
    }
    return q ? { quote: q } : null;
  }

  function rank(name, needle) {
    if (!needle) return 0;
    var at = name.toLowerCase().indexOf(needle.toLowerCase());
    return at === -1 ? -1 : (at === 0 ? 0 : 1);
  }

  /** One dropdown row for catalogue entry `m`. `prefix` is shown before its name ("f.", "h.", "f.from.");
   * `needle` is what's been typed of the name, for highlighting. */
  function memberItem(prefix, m, needle) {
    var at = needle ? m.name.toLowerCase().indexOf(needle.toLowerCase()) : -1;
    var isFn = !!m.sig && !m.constant;
    var lead = m.type && m.type !== 'fn' ? m.type + ' · ' : (m.sig ? m.sig + ' ' : '');
    return {
      kind: 'member', label: prefix + m.name, insert: m.name, fn: isFn, // insert: just the segment being completed
      detail: lead + (m.detail || ''),
      matchStart: prefix.length + (at > 0 ? at : 0), matchLen: at >= 0 ? needle.length : 0
    };
  }

  /** Entries of `list` whose name matches `needle` (prefix matches first, then substring), as rows.
   * An exact, complete non-function name is left out (typing "." is what continues it). */
  function filterRank(list, needle, prefix) {
    var out = [];
    list.forEach(function (m, i) {
      var r = rank(m.name, needle);
      if (r === -1) return;
      if (needle && m.name.toLowerCase() === needle.toLowerCase() && !m.sig) return;
      out.push({ r: r, i: i, it: memberItem(prefix, m, needle) });
    });
    out.sort(function (a, b) { return a.r - b.r || a.i - b.i; });
    return out.map(function (x) { return x.it; });
  }

  /**
   * Pure: what to suggest for `text` with the caret at `caret`.
   * @param {{headerNames?: Array<{name:string,count:number}>}} ctx
   * @returns {?{from:number,to:number,mode:string,items:Array}}
   */
  function compute(text, caret, ctx, force) {
    ctx = ctx || {};
    text = String(text || '');
    var open = openQuoteAt(text, caret);

    // Inside a quote: only the f.getHeader('…') / f.getHeaderAll('…') argument is completed.
    if (open) {
      var before = text.slice(0, caret);
      var m = /\bf\.getHeader(?:All)?\(\s*(['"])([^'"\\]*)$/.exec(before);
      if (!m || m[1] !== open.quote) return null;
      var typed = m[2];
      var from = caret - typed.length;
      var to = caret;
      while (to < text.length && /[\w\-.]/.test(text.charAt(to))) to++; // replace the rest of the word too
      var needle = typed.toLowerCase();
      var names = (ctx.headerNames || []).filter(function (h) { return !needle || h.name.indexOf(needle) !== -1; });
      names.sort(function (a, b) {
        var ra = a.name.indexOf(needle) === 0 ? 0 : 1, rb = b.name.indexOf(needle) === 0 ? 0 : 1;
        return ra - rb || b.count - a.count;
      });
      names = names.filter(function (h) { return h.name !== needle; });
      if (!names.length) return null;
      return {
        from: from, to: to, mode: 'header', quote: m[1],
        items: names.slice(0, MAX_ITEMS).map(function (h) {
          var at = h.name.indexOf(needle);
          return { kind: 'header', label: h.name, insert: h.name, quote: m[1],
            detail: (h.count || 0).toLocaleString() + ' email' + (h.count === 1 ? '' : 's'),
            matchStart: at < 0 ? 0 : at, matchLen: needle.length };
        })
      };
    }

    // The identifier/dotted path ending at the caret: e.g. "f.from.do"
    var start = caret;
    while (start > 0 && (isWordChar(text.charAt(start - 1)) || text.charAt(start - 1) === '.')) start--;
    var word = text.slice(start, caret);
    // A member access written after a closing bracket/quote ("x).fo") is not a path we understand.
    if (start > 0 && /[)\]}'"`]/.test(text.charAt(start - 1)) && word.charAt(0) === '.') return null;
    if (!word) {
      if (!force) return null;
      return { from: caret, to: caret, mode: 'root', items: rootItems('') };
    }
    // Replace the rest of the word after the caret too (caret in the middle of an identifier).
    var end = caret;
    while (end < text.length && isWordChar(text.charAt(end))) end++;

    var parts = word.split('.');
    if (parts.length === 1) {
      // bare word: namespaces and name search across everything
      var w = parts[0];
      if (/^\d/.test(w)) return null;
      if (!force && w.length < 2 && w !== 'f' && w !== 'h') return null;
      var items = rootItems(w);
      if (!items.length) return null;
      return { from: start, to: end, mode: 'root', items: items };
    }

    var rootName = parts[0];
    if (rootName !== 'f' && rootName !== 'h') return null;
    var last = parts[parts.length - 1];
    var lastStart = caret - last.length;
    var itemsOut;
    if (parts.length === 2) {
      itemsOut = filterRank(rootName === 'f' ? FACTS : HELPERS, last, rootName + '.');
    } else if (rootName === 'f' && parts.length === 3 && FACT_BY_NAME[parts[1]]) {
      var members = MEMBERS_BY_TYPE[FACT_BY_NAME[parts[1]].type];
      if (!members) return null;
      itemsOut = filterRank(members, last, 'f.' + parts[1] + '.');
    } else {
      return null;
    }
    if (!itemsOut.length) return null;
    return { from: lastStart, to: lastStart + last.length + (end - caret), mode: 'member', items: itemsOut.slice(0, MAX_ITEMS) };
  }

  /** Suggestions for a word with no dot yet: `f.`/`h.` first, then any fact/helper whose name matches. */
  function rootItems(w) {
    var out = [];
    var lw = w.toLowerCase();
    if (!lw || 'f'.indexOf(lw) === 0) out.push({ kind: 'namespace', label: 'f', insert: 'f.', chain: true, detail: 'the email: subject, from, to, urls, …', matchStart: 0, matchLen: lw.length });
    if (!lw || 'h'.indexOf(lw) === 0) out.push({ kind: 'namespace', label: 'h', insert: 'h.', chain: true, detail: 'helper functions: contains, equals, matches, …', matchStart: 0, matchLen: lw.length });
    if (lw.length >= 2) {
      var named = [];
      [['f.', FACTS, 0], ['h.', HELPERS, 100]].forEach(function (g2) {
        g2[1].forEach(function (m, i) {
          var r = rank(m.name, lw);
          if (r === -1) return;
          var it = memberItem(g2[0], m, lw);
          it.insert = g2[0] + m.name; // a bare word is replaced by the full dotted name
          named.push({ r: r, o: g2[2] + i, it: it });
        });
      });
      named.sort(function (a, b) { return a.r - b.r || a.o - b.o; });
      named.forEach(function (n) { out.push(n.it); });
    }
    return out.slice(0, MAX_ITEMS);
  }

  /** Pure: apply a chosen item. Functions get "(" with the caret inside it, unless one already follows. */
  function apply(text, range, item) {
    var ins = item.insert;
    var after = text.slice(range.to);
    if (item.kind === 'header') {
      var closing = after.charAt(0) === item.quote ? '' : item.quote;
      var t = text.slice(0, range.from) + ins + closing + after;
      return { text: t, caret: range.from + ins.length + 1 }; // step over the closing quote
    }
    if (item.fn && after.charAt(0) !== '(') ins += '(';
    return { text: text.slice(0, range.from) + ins + after, caret: range.from + ins.length };
  }

  /**
   * Attach to the rule expression textarea.
   * @param {HTMLTextAreaElement} textarea
   * @param {function(): Array<{name:string,count:number}>} getHeaderNames  headers present in the open folder
   */
  function attachRuleEditor(textarea, getHeaderNames) {
    return EV.searchSuggest.attach(textarea, {
      compute: compute, apply: apply, multiline: true,
      isEnabled: function () { return true; },
      getContext: function () { return { headerNames: getHeaderNames ? getHeaderNames() : [] }; }
    });
  }

  EV.ruleSuggest = {
    compute: compute, apply: apply, attach: attachRuleEditor,
    FACTS: FACTS, HELPERS: HELPERS
  };
})(typeof self !== 'undefined' ? self : this);
