/**
 * anomalies.js — the Security card's checklist, as pure logic (no DOM, no network, no dependencies).
 *
 * `EV.analyzeAnomalies(parsed)` inspects one parsed email (the output of EV.parseEml) and returns a fixed
 * checklist — Header, Body and Language rows — each with a status:
 *    ok    checked, nothing wrong
 *    flag  a strong signal worth a look
 *    note  informational or a weak signal (many legitimate emails trip these)
 *    na    not applicable (e.g. no DKIM signature to check)
 * plus `flags` (the machine ids of every flag/note, which become searchable as `meta.flag:<id>`) and the
 * scripts found in the subject and body (searchable as `script.subject:` / `script.body:`).
 *
 * One definition used everywhere, so the Preview card, the search index (indexLogic.js) and rule facts can
 * never disagree. It runs for every email at indexing time, so everything is bounded: bodies are scanned
 * up to BODY_SCAN_CHARS, HTML up to HTML_SCAN_CHARS, Received headers up to 100 hops (see headerTables.js).
 *
 * Deliberate limits (documented in HELP.md): language is reported as SCRIPT only (LATIN, CYRILLIC, GREEK,
 * ARMENIAN, HAN...), never a language guess; homoglyph detection is the standard mixed-script test — a word that
 * mixes Latin with Cyrillic/Greek/Armenian letters — and does not try to spot an all-Cyrillic word that merely
 * looks Latin (that would flag ordinary Russian words).
 */
(function (g) {
  'use strict';
  var EV = g.EV || (g.EV = {});

  var BODY_SCAN_CHARS = 20000;
  var HTML_SCAN_CHARS = 200000;
  var LONG_CHAIN_HOPS = 15;
    var TOKEN_CAP = 1500;
  var INVISIBLE_FLAG_THRESHOLD = 3; // a few stray zero-width characters in running text happen; three or more is evasion
  var ZERO_WIDTH_RE = /[​⁠-⁤﻿]/g;      // zero-width space, word joiner, invisible math operators, BOM
  var BIDI_OVERRIDE_RE = /[‭‮]/g;                // left-to-right / right-to-left OVERRIDE (the "RTLO" trick)
  var BIDI_OTHER_RE = /[‪-‬⁦-⁩]/g;     // embeddings and isolates (rare in real mail)
  var HIDDEN_CHAR_TEST = /[​-‍⁠-⁤﻿‪-‮⁦-⁩]/;

  /**
   * Hidden / direction-control characters in a string, by kind. Deliberately NOT counted, because ordinary mail is full
   * of them: soft hyphens, LRM/RLM marks (every Arabic/Hebrew message), a leading byte-order mark, and the zero-width
   * (non-)joiners that emoji sequences and Persian/Indic text need -- those joiners only count when squeezed between
   * plain Latin letters or digits, where they have no legitimate use.
   * @returns {{zeroWidth: number, bidi: number, override: number}}
   */
  EV.hiddenCharStats = function (text) {
    var s = String(text == null ? '' : text);
    var out = { zeroWidth: 0, bidi: 0, override: 0 };
    if (!HIDDEN_CHAR_TEST.test(s)) return out;
    if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
    out.zeroWidth = (s.match(ZERO_WIDTH_RE) || []).length;
    var m, joiners = /[‌‍]/g;
    while ((m = joiners.exec(s))) {
      if (/[A-Za-z0-9]/.test(s.charAt(m.index - 1)) && /[A-Za-z0-9]/.test(s.charAt(m.index + 1))) out.zeroWidth++;
    }
    out.override = (s.match(BIDI_OVERRIDE_RE) || []).length;
    out.bidi = out.override + (s.match(BIDI_OTHER_RE) || []).length;
    return out;
  };

  // ---- look-alike letters: a "skeleton" with the visually identical foreign letters folded to Latin ----
  var CONFUSABLE_MAP = {
    // Cyrillic
    'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x', 'і': 'i', 'ј': 'j',
    'ѕ': 's', 'ԁ': 'd', 'ԛ': 'q', 'ԝ': 'w', 'һ': 'h', 'ӏ': 'l', 'ѵ': 'v', 'в': 'b', 'к': 'k',
    'м': 'm', 'н': 'h', 'т': 't', 'г': 'r', 'Ӏ': 'l', 'ɢ': 'g',
    // Greek
    'ο': 'o', 'α': 'a', 'ρ': 'p', 'ν': 'v', 'ι': 'i', 'υ': 'u', 'χ': 'x', 'κ': 'k', 'τ': 't', 'ϲ': 'c',
    'ε': 'e', 'η': 'n', 'ω': 'w',
    // Armenian
    'ց': 'g', 'օ': 'o', 'ս': 'u', 'ո': 'n', 'հ': 'h', 'զ': 'q',
    // Latin-script lookalikes
    'ı': 'i', 'ɑ': 'a', 'ⅼ': 'l', 'ℓ': 'l', 'ᴏ': 'o', 'ᴄ': 'c', 'ɡ': 'g'
  };
  /** Lower-cases, folds compatibility forms (full-width letters), drops accents and maps look-alike letters to Latin. */
  EV.confusableSkeleton = function (text) {
    var s = String(text == null ? '' : text).toLowerCase();
    if (ASCII_RE.test(s)) return s;
    try { s = s.normalize('NFKC').normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) { /* very old engines: keep the lower-cased text */ }
    var out = '';
    for (var i = 0; i < s.length; i++) out += CONFUSABLE_MAP[s.charAt(i)] || s.charAt(i);
    return out;
  };

  /** A domain's readable form: every xn-- label decoded from punycode (labels that do not decode stay as written). */
  function unicodeDomain(domain) {
    return String(domain || '').split('.').map(function (label) {
      if (label.slice(0, 4).toLowerCase() !== 'xn--' || !EV.punycodeDecodeLabel) return label;
      var d = EV.punycodeDecodeLabel(label.slice(4).toLowerCase());
      return d || label;
    }).join('.');
  }

  // ---------------------------------------------------------------- scripts

  var SCRIPTS = ['latin', 'cyrillic', 'greek', 'armenian', 'hebrew', 'arabic', 'devanagari', 'thai', 'hangul', 'han', 'hiragana', 'katakana'];
  // Scripts whose letters are routinely confused with Latin ones -- the "mixed-script word" test only looks at these.
  var CONFUSABLE = { latin: 1, cyrillic: 1, greek: 1, armenian: 1 };

  /** The script of a code point, or null for digits/punctuation/symbols/anything we don't classify. */
  function scriptOf(cp) {
    if (cp < 0x41) return null;
    if (cp <= 0x5A || (cp >= 0x61 && cp <= 0x7A)) return 'latin';
    if (cp < 0xC0) return null;
    if (cp <= 0x2AF) return (cp === 0xD7 || cp === 0xF7) ? null : 'latin';
    if (cp >= 0x370 && cp <= 0x3FF) return (cp === 0x375 || cp === 0x37E || cp === 0x384 || cp === 0x385 || cp === 0x387) ? null : 'greek';
    if (cp >= 0x400 && cp <= 0x52F) return (cp >= 0x482 && cp <= 0x489) ? null : 'cyrillic';
    if (cp >= 0x530 && cp <= 0x58F) return (cp === 0x55A || cp === 0x55B || cp === 0x55C || cp === 0x55D || cp === 0x55E || cp === 0x55F || cp === 0x589 || cp === 0x58A) ? null : 'armenian';
    if (cp >= 0x590 && cp <= 0x5FF) return 'hebrew';
    if ((cp >= 0x600 && cp <= 0x6FF) || (cp >= 0x750 && cp <= 0x77F) || (cp >= 0xFB50 && cp <= 0xFDFF) || (cp >= 0xFE70 && cp <= 0xFEFF)) return 'arabic';
    if (cp >= 0x900 && cp <= 0x97F) return 'devanagari';
    if (cp >= 0xE00 && cp <= 0xE7F) return 'thai';
    if (cp >= 0x1E00 && cp <= 0x1EFF) return 'latin';
    if (cp >= 0x1F00 && cp <= 0x1FFF) return 'greek';
    if (cp >= 0x1C80 && cp <= 0x1C8F) return 'cyrillic';
    if ((cp >= 0xAC00 && cp <= 0xD7AF) || (cp >= 0x1100 && cp <= 0x11FF) || (cp >= 0x3130 && cp <= 0x318F)) return 'hangul';
    if (cp >= 0x3040 && cp <= 0x309F) return 'hiragana';
    if (cp >= 0x30A0 && cp <= 0x30FF) return 'katakana';
    if ((cp >= 0x4E00 && cp <= 0x9FFF) || (cp >= 0x3400 && cp <= 0x4DBF) || (cp >= 0xF900 && cp <= 0xFAFF) || (cp >= 0x20000 && cp <= 0x2FA1F)) return 'han';
    if (cp >= 0x2C60 && cp <= 0x2C7F) return 'latin';
    if (cp >= 0x2DE0 && cp <= 0x2DFF) return 'cyrillic';
    if (cp >= 0xA640 && cp <= 0xA69F) return 'cyrillic';
    if (cp >= 0xA720 && cp <= 0xA7FF) return 'latin';
    if (cp >= 0xFF21 && cp <= 0xFF3A) return 'latin';
    if (cp >= 0xFF41 && cp <= 0xFF5A) return 'latin';
    return null;
  }

  /** Combining marks and joiners stay inside the current word instead of ending it. */
  function isContinuation(cp) { return (cp >= 0x300 && cp <= 0x36F) || cp === 0x200C || cp === 0x200D || (cp >= 0xFE00 && cp <= 0xFE0F); }

  /**
   * Which scripts a text is written in. A script counts when it makes up at least 5% of the letters (and at
   * least 3 letters), so one stray Greek "μ" in an English sentence doesn't relabel it. Ordered most-used first.
   * @returns {{scripts: string[], counts: Object, letters: number}}
   */
  var ASCII_RE = /^[\x00-\x7F]*$/;

  EV.scriptProfile = function (text, limit) {
    var s = String(text == null ? '' : text);
    if (limit && s.length > limit) s = s.slice(0, limit);
    var counts = {}, letters = 0;
    if (ASCII_RE.test(s)) { // plain ASCII (most mail): every letter is Latin, no per-character script lookup needed
      for (var j = 0; j < s.length; j++) { var c = s.charCodeAt(j) | 32; if (c >= 97 && c <= 122) letters++; }
      if (letters) counts.latin = letters;
      return { scripts: letters ? ['latin'] : [], counts: counts, letters: letters };
    }
    for (var i = 0; i < s.length; i++) {
      var cp = s.codePointAt(i);
      if (cp > 0xFFFF) i++;
      var sc = scriptOf(cp);
      if (sc) { counts[sc] = (counts[sc] || 0) + 1; letters++; }
    }
    var scripts = Object.keys(counts).filter(function (k) { return counts[k] >= 3 && counts[k] / letters >= 0.05; })
      .sort(function (a, b) { return counts[b] - counts[a]; });
    if (!scripts.length && letters) scripts = [Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; })[0]]; // very short text
    return { scripts: scripts, counts: counts, letters: letters };
  };

  /**
   * Words that mix letters of two or more CONFUSABLE scripts (Latin/Cyrillic/Greek/Armenian) -- e.g. a Cyrillic
   * "а" inside "pаypal". Han + Hiragana + Katakana in one word is normal Japanese and is not looked at.
   * @returns {{count: number, examples: Array<{word: string, scripts: string[]}>}}
   */
  EV.mixedScriptWords = function (text, limit) {
    var s = String(text == null ? '' : text);
    if (limit && s.length > limit) s = s.slice(0, limit);
    if (ASCII_RE.test(s)) return { count: 0, examples: [] }; // one script only -- nothing can be mixed
    var count = 0, examples = [];
    var word = '', seen = null, nSeen = 0, charsBy = null;
    function endWord() {
      if (word && nSeen >= 2) {
        count++;
        if (examples.length < 3) {
          // The odd letter is usually visually identical to the expected one, so name it: the code point(s) of the
          // letters that are NOT in the word's dominant script (e.g. U+0430 = Cyrillic "а" inside a Latin word).
          var dominant = null;
          Object.keys(charsBy).forEach(function (k) { if (!dominant || charsBy[k].length > charsBy[dominant].length) dominant = k; });
          var odd = [];
          Object.keys(charsBy).forEach(function (k) { if (k !== dominant) charsBy[k].forEach(function (cp) { if (odd.length < 3) odd.push('U+' + ('0000' + cp.toString(16).toUpperCase()).slice(-4)); }); });
          examples.push({ word: word, scripts: Object.keys(seen), odd: odd });
        }
      }
      word = ''; seen = null; nSeen = 0; charsBy = null;
    }
    for (var i = 0; i < s.length; i++) {
      var cp = s.codePointAt(i);
      var ch = cp > 0xFFFF ? s.slice(i, i + 2) : s.charAt(i);
      if (cp > 0xFFFF) i++;
      var sc = scriptOf(cp);
      if (sc) {
        if (CONFUSABLE[sc]) {
          if (!seen) { seen = {}; charsBy = {}; }
          if (!seen[sc]) { seen[sc] = 1; nSeen++; charsBy[sc] = []; }
          charsBy[sc].push(cp);
        }
        word += ch;
      } else if (word && isContinuation(cp)) {
        word += ch;
      } else {
        endWord();
      }
    }
    endWord();
    return { count: count, examples: examples };
  };

  var SCRIPT_LABEL = function (list) { return list.map(function (x) { return x.toUpperCase(); }).join(' + '); };

  // ---------------------------------------------------------------- small helpers

  function domainOf(address) {
    if (!address) return '';
    var at = String(address).lastIndexOf('@');
    return at === -1 ? '' : String(address).slice(at + 1).toLowerCase().replace(/[>\s]+$/, '');
  }

  /** Same organisation (mail.example.com ~ example.com)? Uses the rule helper when available, else a suffix test. */
  function aligned(a, b) {
    a = String(a || '').toLowerCase(); b = String(b || '').toLowerCase();
    if (!a || !b) return false;
    if (a === b || a.slice(-(b.length + 1)) === '.' + b || b.slice(-(a.length + 1)) === '.' + a) return true;
    return !!(EV.ruleHelpers && EV.ruleHelpers.domainsAlign && EV.ruleHelpers.domainsAlign(a, b));
  }

  function tokenSet(text) {
    var set = {}, n = 0, m;
    var re = /[\p{L}\p{N}]{3,}/gu;
    var s = String(text || '').toLowerCase();
    if (s.length > BODY_SCAN_CHARS) s = s.slice(0, BODY_SCAN_CHARS);
    while ((m = re.exec(s)) && n < TOKEN_CAP) { if (!set[m[0]]) { set[m[0]] = 1; n++; } }
    return { set: set, size: n };
  }

  function visibleText(html) {
    if (!html) return '';
    return EV.htmlToText ? EV.htmlToText(html) : String(html).replace(/<[^>]*>/g, ' ');
  }

  var HIDDEN_CSS_RE = /display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0(?:px|pt|em|rem|%)?\s*(?:;|$)|opacity\s*:\s*0(?:\.0+)?\s*(?:;|$)|mso-hide\s*:\s*all/i;

  var OFFSCREEN_RE = /(?:^|;)\s*(?:left|top|right|bottom|text-indent|margin-left)\s*:\s*-\s*\d{3,}(?:px|em|pt|cm)/i;
  var TINY_FONT_RE = /font-size\s*:\s*1(?:\.0+)?px/i;
  var WHITE = '(?:#fff(?:fff)?|white|rgb\\(\\s*255\\s*,\\s*255\\s*,\\s*255\\s*\\))';
  var WHITE_TEXT_RE = new RegExp('(?:^|;)\\s*color\\s*:\\s*' + WHITE + '\\s*(?:;|$|!)', 'i');
  var WHITE_BG_RE = new RegExp('(?:^|;)\\s*background(?:-color)?\\s*:\\s*' + WHITE + '\\s*(?:;|$|!)', 'i');
  /** Does this inline style make its text invisible? Hidden by display/size/opacity, pushed off-screen, or white text on a
   * white background declared on the SAME element (so a white heading on a dark banner is never misread). */
  function cssHidesText(css) {
    return HIDDEN_CSS_RE.test(css) || OFFSCREEN_RE.test(css) || TINY_FONT_RE.test(css) || (WHITE_TEXT_RE.test(css) && WHITE_BG_RE.test(css));
  }

  /** Number of elements with CSS-hidden styling that still contain some text (linear scan, bounded). */
  function hiddenTextBlocks(html) {
    var h = String(html || '');
    if (h.length > HTML_SCAN_CHARS) h = h.slice(0, HTML_SCAN_CHARS);
    var re = /\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi, m, n = 0;
    while ((m = re.exec(h))) {
      var css = m[1] != null ? m[1] : m[2];
      if (!cssHidesText(css)) continue;
      var close = h.indexOf('>', re.lastIndex);
      if (close === -1) continue;
      var lt = h.indexOf('<', close + 1);
      var inner = h.slice(close + 1, lt === -1 ? close + 200 : lt);
      if (inner.replace(/\s|&nbsp;|&#160;/gi, '').length >= 3) n++;
    }
    return n;
  }

  // ---------------------------------------------------------------- attachments

  var MAX_ATTACHMENTS_CHECKED = 50;
  var EXEC_EXT = /^(?:exe|scr|com|pif|bat|cmd|js|jse|vbs|vbe|wsf|wsh|ps1|psm1|hta|msi|msp|jar|lnk|dll|cpl|reg|chm|scf|inf|ocx|sys)$/;
  var DOC_EXT = /^(?:pdf|docx?|xlsx?|pptx?|jpe?g|png|gif|bmp|txt|rtf|csv|zip|html?)$/;
  var MACRO_EXT = /^(?:docm|dotm|xlsm|xltm|xlam|pptm|potm|ppam|ppsm|sldm)$/;
  var CONTAINER_EXT = /^(?:iso|img|vhd|vhdx)$/;

  /** What the first bytes say the file is: 'exe' (Windows PE), 'elf', 'macho', 'lnk', 'script' (#!), or ''. */
  function sniffExecutable(bytes) {
    if (!bytes || bytes.length < 4) return '';
    var b0 = bytes[0], b1 = bytes[1], b2 = bytes[2], b3 = bytes[3];
    if (b0 === 0x4D && b1 === 0x5A) return 'exe';
    if (b0 === 0x7F && b1 === 0x45 && b2 === 0x4C && b3 === 0x46) return 'elf';
    if ((b0 === 0xFE && b1 === 0xED && b2 === 0xFA && (b3 === 0xCE || b3 === 0xCF)) || (b3 === 0xFE && b2 === 0xED && b1 === 0xFA && (b0 === 0xCE || b0 === 0xCF))) return 'macho';
    if (b0 === 0x4C && b1 === 0 && b2 === 0 && b3 === 0 && bytes.length >= 8 && bytes[4] === 0x01 && bytes[5] === 0x14 && bytes[6] === 0x02) return 'lnk';
    if (b0 === 0x23 && b1 === 0x21) return 'script';
    return '';
  }

  /** The Attachments row: executable/script types, "invoice.pdf.exe", a file whose bytes are an executable though it is named
   * like something harmless, macro-enabled Office files, disk images, and names that hide characters. Only the first 8
   * bytes of each file are read, and at most MAX_ATTACHMENTS_CHECKED files. Inline images are ordinary and skipped. */
  function attachmentRisk(attachments, nameHidden) {
    var flags = [], details = [], risky = 0, total = 0;
    function add(id, text) { if (flags.indexOf(id) === -1) flags.push(id); if (details.length < 3) details.push(text); }
    attachments.slice(0, MAX_ATTACHMENTS_CHECKED).forEach(function (a) {
      if (!a || !a.filename) return;
      total++;
      var name = String(a.filename), before = flags.length, beforeDetail = details.length;
      var parts = name.toLowerCase().replace(/[\s.]+$/, '').split('.');
      var ext = parts.length > 1 ? parts[parts.length - 1] : '';
      var prev = parts.length > 2 ? parts[parts.length - 2] : '';
      var hit = false;
      function mark(id, text) { hit = true; add(id, text); }
      if (EXEC_EXT.test(ext)) mark('attachment-executable', name + ' is an executable/script type (.' + ext + ')');
      if (EXEC_EXT.test(ext) && DOC_EXT.test(prev)) mark('attachment-double-ext', name + ' pretends to be a .' + prev + ' file');
      var sniffed = sniffExecutable(a.bytes);
      if (sniffed && !EXEC_EXT.test(ext) && !(sniffed === 'script' && /^(?:sh|bash|command|py|pl|rb|txt|log|conf|cfg)$/.test(ext))) {
        mark('attachment-disguised', name + ' is really ' + ({ exe: 'a Windows program', elf: 'a Linux program', macho: 'a macOS program', lnk: 'a shortcut', script: 'a script' }[sniffed]));
      }
      if (MACRO_EXT.test(ext)) mark('attachment-macro', name + ' can contain macros');
      if (CONTAINER_EXT.test(ext)) mark('attachment-container', name + ' is a disk image');
      var h = EV.hiddenCharStats(name);
      if (h.override || h.zeroWidth || h.bidi || /\s{10,}/.test(name)) mark('attachment-filename-spoof', 'the name of an attachment hides characters or spaces');
      if (hit) risky++;
    });
    var strong = flags.some(function (f) { return f !== 'attachment-macro' && f !== 'attachment-container'; });
    var r = !total ? row('attachment-risk', 'na', 'no attachments')
      : !flags.length ? row('attachment-risk', 'ok', total + ' attachment' + (total === 1 ? '' : 's') + ', nothing risky')
      : row('attachment-risk', strong ? 'flag' : 'note', details.join('; '), flags);
    return { row: r, total: total, risky: risky };
  }

    // ---------------------------------------------------------------- the checklist

  // Every row the card can show, in display order. `flags` lists the search ids a row can produce.
  var CHECKS = [
    { id: 'reply-to', group: 'header', label: 'Reply-To', flags: ['replyto-mismatch'] },
    { id: 'return-path', group: 'header', label: 'Return-Path', flags: ['returnpath-mismatch'] },
    { id: 'received-chain', group: 'header', label: 'Received chain', flags: ['no-received', 'received-broken', 'received-time-travel', 'received-long-chain'] },
    { id: 'message-id', group: 'header', label: 'Message-ID', flags: ['messageid-missing', 'messageid-domain'] },
    { id: 'display-name', group: 'header', label: 'Sender name', flags: ['forged-display-name'] },
    { id: 'duplicate-headers', group: 'header', label: 'Duplicate headers', flags: ['duplicate-headers'] },
    { id: 'dkim-alignment', group: 'header', label: 'DKIM domain', flags: ['dkim-misaligned'] },
    { id: 'header-forgery', group: 'header', label: 'Inserted headers', flags: ['auth-results-conflict', 'auth-results-planted'] },
    { id: 'sender-origin', group: 'header', label: 'Internal sender', flags: ['claims-internal'] },
    { id: 'sender-domain', group: 'header', label: 'Sender domain', flags: ['confusable-domain', 'sender-ip-literal'] },
    { id: 'body-parts', group: 'body', label: 'Body parts', flags: ['no-text-part', 'no-html-part', 'empty-body'] },
    { id: 'image-only', group: 'body', label: 'Image-only body', flags: ['image-only'] },
    { id: 'text-vs-html', group: 'body', label: 'Text vs HTML', flags: ['text-html-mismatch'] },
    { id: 'hidden-content', group: 'body', label: 'Hidden content', flags: ['hidden-css-text', 'invisible-chars', 'bidi-override'] },
    { id: 'threading', group: 'body', label: 'Threading', flags: ['fake-reply', 'threaded'] },
    { id: 'homoglyphs', group: 'body', label: 'Mixed-script words', flags: ['homoglyph-subject', 'homoglyph-name', 'homoglyph-body', 'homoglyph-links'] },
    { id: 'attachment-risk', group: 'attachments', label: 'Attachments', flags: ['attachment-executable', 'attachment-double-ext', 'attachment-disguised', 'attachment-macro', 'attachment-container', 'attachment-filename-spoof'] },
    { id: 'subject-script', group: 'language', label: 'Subject script', flags: [] },
    { id: 'body-script', group: 'language', label: 'Body script', flags: [] },
    { id: 'script-mismatch', group: 'language', label: 'Script match', flags: ['script-mismatch'] }
  ];
  var FLAG_HELP = {
    'replyto-mismatch': 'Reply-To domain differs from the sender\'s', 'returnpath-mismatch': 'Return-Path domain differs from the sender\'s',
    'no-received': 'no Received headers at all', 'received-broken': 'a hop received the message from a host unrelated to the previous receiver (broken chain)', 'received-time-travel': 'Received timestamps go backwards between hops',
    'received-long-chain': 'unusually many Received hops (' + LONG_CHAIN_HOPS + '+)',
    'messageid-missing': 'no Message-ID header', 'messageid-domain': 'Message-ID domain is not the sender\'s',
    'forged-display-name': 'display name shows a different email address than the real sender',
    'duplicate-headers': 'From/Subject/Date/Message-ID/Reply-To appears more than once',
    'dkim-misaligned': 'DKIM signed by a domain other than the sender\'s',
    'auth-results-conflict': 'one server wrote two Authentication-Results that disagree (one was inserted)', 'auth-results-planted': 'an Authentication-Results was already in the message before any server handled it',
    'bidi-override': 'a right-to-left/left-to-right OVERRIDE character (reverses how text is displayed)',
    'confusable-domain': 'sender domain uses look-alike letters to impersonate a trusted domain', 'sender-ip-literal': 'sender address is a bare IP address, not a domain',
    'attachment-executable': 'an attachment is an executable or script type', 'attachment-double-ext': 'an attachment has a document extension followed by an executable one',
    'attachment-disguised': 'an attachment is really an executable but is named like something else', 'attachment-macro': 'a macro-enabled Office attachment',
    'attachment-container': 'a disk-image attachment (a way to slip files past download warnings)', 'attachment-filename-spoof': 'an attachment name hides characters or reverses its extension',
    'claims-internal': 'sender uses one of your domains but the message came from outside and nothing authenticates it',
    'no-text-part': 'HTML only, no plain-text part', 'no-html-part': 'plain text only, no HTML part', 'empty-body': 'no readable body',
    'image-only': 'the visible message is only an image', 'text-html-mismatch': 'plain-text and HTML parts say different things',
    'hidden-css-text': 'text hidden with CSS (display:none, zero size...)', 'invisible-chars': 'zero-width / invisible characters (filter evasion)',
    'fake-reply': 'subject says Re:/Fwd: but there are no reply headers', 'threaded': 'part of a reply thread (In-Reply-To / References)',
    'homoglyph-subject': 'mixed-script word in the subject', 'homoglyph-name': 'mixed-script word in the sender name',
    'homoglyph-body': 'mixed-script word in the body', 'homoglyph-links': 'mixed-script word in a link host',
    'script-mismatch': 'subject and body are written in different scripts'
  };
  // Ids that are informational or weak signals (many legitimate emails raise them); every other id is a strong flag.
  EV.ANOMALY_NOTE_FLAGS = ['no-html-part', 'no-text-part', 'threaded', 'messageid-missing', 'messageid-domain', 'dkim-misaligned', 'received-long-chain',
    'script-mismatch', 'hidden-css-text', 'attachment-macro', 'attachment-container', 'empty-body'];
  EV.ANOMALY_CHECKS = CHECKS;
  EV.ANOMALY_FLAG_HELP = FLAG_HELP;
  EV.ANOMALY_FLAG_IDS = Object.keys(FLAG_HELP);
  EV.SCRIPT_NAMES = SCRIPTS;

  function row(id, status, detail, flags) {
    return { id: id, status: status, detail: detail || '', flags: flags || [] };
  }

  /**
   * @param {object} parsed  output of EV.parseEml
   * @returns {{checks: Array<{id,group,label,status,detail,flags}>, flags: string[], subjectScripts: string[], bodyScripts: string[]}}
   */
  EV.analyzeAnomalies = function (parsed, opts) {
    opts = opts || {};
    var p = parsed || {};
    var headers = p.headers || [];
    var results = {};
    var from = (p.from && p.from[0]) || null;
    var fromAddr = from && from.address ? String(from.address).toLowerCase() : '';
    var fromDomain = domainOf(fromAddr);
    var subject = p.subject || '';
    var text = p.textBody || '';
    var html = p.htmlBody || '';
    // The indexer already converted the HTML to text and extracted the links; reuse them instead of redoing both.
    var htmlText = opts.htmlText != null ? opts.htmlText : visibleText(html.length > HTML_SCAN_CHARS ? html.slice(0, HTML_SCAN_CHARS) : html);
    var bodyText = (text + '\n' + htmlText).slice(0, BODY_SCAN_CHARS);

    // ---- Header ----
    var replyDomain = (p.replyTo && p.replyTo[0]) ? domainOf(p.replyTo[0].address) : '';
    // Compared by ORGANISATION (mail.example.com ~ example.com), so a subdomain bounce or reply address is not an alarm.
    results['reply-to'] = !replyDomain ? row('reply-to', 'ok', 'none set')
      : (fromDomain && !aligned(replyDomain, fromDomain)
        ? row('reply-to', 'flag', replyDomain + ' ≠ sender ' + fromDomain, ['replyto-mismatch'])
        : row('reply-to', 'ok', replyDomain));

    var rpRaw = EV.getHeader ? EV.getHeader(headers, 'return-path') : null;
    var rpAddr = '';
    if (rpRaw) { var rpm = /<([^>]*)>/.exec(rpRaw); rpAddr = (rpm ? rpm[1] : rpRaw).trim(); }
    var rpDomain = domainOf(rpAddr);
    // A bounce address on a mailing service's domain (SendGrid, SES, Mailchimp...) legitimately differs from the sender: a note,
    // not a flag. "Mailing service" = the 'Email Service Provider' domain category in Settings (user-editable).
    var rpEsp = '';
    if (rpDomain && fromDomain && !aligned(rpDomain, fromDomain) && EV.ruleHelpers && EV.ruleHelpers.domainCategoriesFor) {
      EV.ruleHelpers.domainCategoriesFor(rpDomain, opts.domainCategories || []).forEach(function (c) { if (/email service|mailing service|bulk mail/i.test(c)) rpEsp = c; });
    }
    results['return-path'] = !rpDomain ? row('return-path', 'ok', rpRaw && !rpAddr ? 'empty (bounce)' : 'none set')
      : (fromDomain && !aligned(rpDomain, fromDomain)
        ? (rpEsp ? row('return-path', 'note', rpDomain + ' is a mailing service (' + rpEsp + '), not the sender ' + fromDomain, ['returnpath-mismatch'])
                 : row('return-path', 'flag', rpDomain + ' ≠ sender ' + fromDomain, ['returnpath-mismatch']))
        : row('return-path', 'ok', rpDomain));

    // The same chain analysis the Headers tab draws (headerTables.js): one definition of "broken" and "time travel".
    var chain = EV.analyzeChain(EV.receivedChain(headers));
    var hopCount = chain.hops.length;
    if (!hopCount) {
      results['received-chain'] = row('received-chain', 'flag', 'no Received headers \u2014 nothing shows how it travelled', ['no-received']);
    } else {
      var rflags = [], rdetail = [], firstBroken = null;
      chain.links.forEach(function (l) { if (l.handoff === 'broken' && !firstBroken) firstBroken = l; });
      if (chain.broken) { rflags.push('received-broken'); rdetail.push('broken link between hop ' + firstBroken.from + ' and ' + firstBroken.to + (chain.broken > 1 ? ' (+' + (chain.broken - 1) + ' more)' : '')); }
      if (chain.timeTravel) { rflags.push('received-time-travel'); rdetail.push('timestamps go backwards'); }
      if (rflags.length) results['received-chain'] = row('received-chain', 'flag', rdetail.join('; ') + ' (' + hopCount + ' hops)', rflags);
      else if (hopCount >= LONG_CHAIN_HOPS) results['received-chain'] = row('received-chain', 'note', hopCount + ' hops (unusually long)', ['received-long-chain']);
      else results['received-chain'] = row('received-chain', 'ok', hopCount + ' hop' + (hopCount === 1 ? '' : 's') + ', chain intact');
    }

    if (!p.messageId) {
      results['message-id'] = row('message-id', 'note', 'missing', ['messageid-missing']);
    } else {
      var midDomain = domainOf(p.messageId);
      results['message-id'] = (midDomain && fromDomain && !aligned(midDomain, fromDomain))
        ? row('message-id', 'note', midDomain + ' is not the sender\'s domain (' + fromDomain + ')', ['messageid-domain'])
        : row('message-id', 'ok', midDomain || 'present');
    }

    var dn = from && from.name ? String(from.name) : '';
    var dnAddr = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/.exec(dn);
    results['display-name'] = (dnAddr && dnAddr[0].toLowerCase() !== fromAddr)
      ? row('display-name', 'flag', 'name shows ' + dnAddr[0] + ' but the sender is ' + (fromAddr || 'unknown'), ['forged-display-name'])
      : row('display-name', 'ok', dn ? 'no address inside the name' : 'no display name');

    // Sender domain: a look-alike of a trusted domain built from foreign letters (the ASCII look-alikes -- paypa1.com -- are the
    // separate edit-distance 'lookalike' flag), or a bare IP address.
    var senderFlags = [], senderDetail = [];
    if (/^\[?(?:ipv6:)?(?:(?:\d{1,3}\.){3}\d{1,3}|[0-9a-f:]+)\]?$/i.test(fromDomain) && /[.:]/.test(fromDomain)) {
      senderFlags.push('sender-ip-literal'); senderDetail.push('the sender address is a bare IP (' + fromDomain + ')');
    }
    var fromUnicode = unicodeDomain(fromDomain);
    var senderTrusted = !!(EV.ruleHelpers && EV.ruleHelpers.isDomainTrusted && EV.ruleHelpers.isDomainTrusted(fromUnicode, opts.trustedDomains || []));
    if (fromUnicode && !ASCII_RE.test(fromUnicode) && !senderTrusted) { // a domain the user already trusts is never second-guessed
      var skel = EV.confusableSkeleton(fromUnicode), trustedList = (EV.literalTrustedDomains ? EV.literalTrustedDomains(opts.trustedDomains) : (opts.trustedDomains || []));
      for (var ti = 0; ti < trustedList.length; ti++) {
        var tdom = String(trustedList[ti] || '').toLowerCase();
        if (!tdom || tdom.charAt(0) === '/' || tdom === fromUnicode || fromUnicode.slice(-(tdom.length + 1)) === '.' + tdom) continue;
        if (skel === tdom || skel.slice(-(tdom.length + 1)) === '.' + tdom) {
          senderFlags.push('confusable-domain'); senderDetail.push(fromUnicode + ' imitates ' + tdom + ' with look-alike letters');
          break;
        }
      }
    }
    results['sender-domain'] = senderFlags.length ? row('sender-domain', 'flag', senderDetail.join('; '), senderFlags)
      : row('sender-domain', 'ok', fromDomain || 'no sender domain');

    var dupes = [];
    ['from', 'sender', 'subject', 'date', 'message-id', 'reply-to', 'in-reply-to'].forEach(function (name) {
      if ((EV.getHeaderAll ? EV.getHeaderAll(headers, name) : []).length > 1) dupes.push(name);
    });
    results['duplicate-headers'] = dupes.length
      ? row('duplicate-headers', 'flag', dupes.join(', ') + ' appear more than once', ['duplicate-headers'])
      : row('duplicate-headers', 'ok', 'none');

    var dkims = EV.getHeaderAll ? EV.getHeaderAll(headers, 'dkim-signature') : [];
    if (!dkims.length) {
      results['dkim-alignment'] = row('dkim-alignment', 'na', 'no DKIM signature');
    } else {
      var signers = [];
      dkims.forEach(function (v) { var dm = /(?:^|;)\s*d\s*=\s*([^;\s]+)/i.exec(v); if (dm) signers.push(dm[1].toLowerCase()); });
      var anyAligned = signers.some(function (d) { return aligned(d, fromDomain); });
      results['dkim-alignment'] = (!signers.length || !fromDomain || anyAligned)
        ? row('dkim-alignment', 'ok', signers.join(', ') || 'signed')
        : row('dkim-alignment', 'note', 'signed by ' + signers.join(', ') + ', not ' + fromDomain, ['dkim-misaligned']);
    }

    var forgery = EV.analyzeHeaderForgery(headers).findings;
    results['header-forgery'] = forgery.length
      ? row('header-forgery', 'flag', forgery[0].title + (forgery.length > 1 ? ' (+' + (forgery.length - 1) + ' more)' : ''), forgery.map(function (f) { return f.id; }).filter(function (id, i, a) { return a.indexOf(id) === i; }))
      : row('header-forgery', 'ok', 'no sign of inserted trust headers');

    var origin = EV.classifyOrigin(p, opts.internalDomains);
    results['sender-origin'] = origin.state === 'claims-internal' ? row('sender-origin', 'flag', origin.detail, ['claims-internal'])
      : origin.state === 'internal' ? row('sender-origin', 'ok', 'internal \u2014 ' + origin.detail)
      : origin.state === 'unverified' ? row('sender-origin', 'note', origin.detail)
      : row('sender-origin', 'na', origin.state === 'external' ? 'external sender \u2014 ' + origin.detail : origin.detail);

    // ---- Body ----
    var hasText = /\S/.test(text), hasHtml = /\S/.test(html);
    var htmlVisible = hasHtml ? htmlText.replace(/\s+/g, '') : '';
    var parts;
    if (hasText && hasHtml) parts = row('body-parts', 'ok', 'plain text + HTML');
    else if (hasHtml) parts = row('body-parts', 'note', 'HTML only — no plain-text part', ['no-text-part']);
    else if (hasText) parts = row('body-parts', 'note', 'plain text only — no HTML part', ['no-html-part']);
    // No body at all is ordinary when there is something attached (a calendar invite, "see attached"): note it. Nothing at
    // all -- no text, no HTML, no attachment -- is the suspicious case.
    else if ((p.attachments || []).length) parts = row('body-parts', 'note', 'no body text \u2014 attachment only', ['empty-body']);
    else parts = row('body-parts', 'flag', 'no readable body and nothing attached', ['empty-body']);
    results['body-parts'] = parts;

    var hasImg = hasHtml && /<img\b/i.test(html.length > HTML_SCAN_CHARS ? html.slice(0, HTML_SCAN_CHARS) : html);
    var imageAttach = (p.attachments || []).some(function (a) { return /^image\//i.test(a.mimeType || ''); });
    var visibleChars = (hasText ? text.replace(/\s+/g, '').length : 0) + htmlVisible.length;
    results['image-only'] = (visibleChars < 15 && (hasImg || imageAttach) && (hasText || hasHtml || imageAttach))
      ? row('image-only', 'flag', 'almost no text — the message is an image', ['image-only'])
      : row('image-only', 'ok', 'has readable text');

    if (hasText && hasHtml) {
      var a = tokenSet(text), b = tokenSet(htmlText);
      var small = Math.min(a.size, b.size);
      if (small >= 8) {
        var shared = 0, k, smaller = a.size <= b.size ? a.set : b.set, larger = a.size <= b.size ? b.set : a.set;
        for (k in smaller) if (larger[k]) shared++;
        var ratio = shared / small;
        var pct = Math.round(ratio * 100) + '% of the shorter part\'s words appear in the other';
        results['text-vs-html'] = ratio < 0.25 ? row('text-vs-html', 'flag', pct, ['text-html-mismatch'])
          : ratio < 0.5 ? row('text-vs-html', 'note', pct, ['text-html-mismatch'])
          : row('text-vs-html', 'ok', 'parts agree');
      } else results['text-vs-html'] = row('text-vs-html', 'na', 'too little text to compare');
    } else results['text-vs-html'] = row('text-vs-html', 'na', 'needs both a text and an HTML part');

    // Link hosts are needed by both the hidden-character scan and the homoglyph check below.
    var hosts = [];
    try {
      var urls = opts.urls || (EV.extractUrls ? EV.extractUrls(text, html) : []);
      urls.forEach(function (u) { var hm = /^[a-z][a-z0-9+.-]*:\/\/([^\/?#:]+)/i.exec(u) || /^(www\.[^\/?#:]+)/i.exec(u); if (hm) hosts.push(hm[1]); });
      if (EV.unicodeHostsOfUrls) hosts = hosts.concat(EV.unicodeHostsOfUrls(urls));
    } catch (e) { /* link extraction is best effort */ }

    var hiddenBlocks = hasHtml ? hiddenTextBlocks(html) : 0;
    var bodyHidden = EV.hiddenCharStats((text + htmlText).slice(0, BODY_SCAN_CHARS));
    var subjHidden = EV.hiddenCharStats(subject);
    var nameHidden = EV.hiddenCharStats(dn);
    var hostHidden = EV.hiddenCharStats(hosts.join(' '));
    var attHidden = { zeroWidth: 0, bidi: 0, override: 0 };
    (p.attachments || []).slice(0, MAX_ATTACHMENTS_CHECKED).forEach(function (a) {
      var h = EV.hiddenCharStats(a.filename);
      attHidden.zeroWidth += h.zeroWidth; attHidden.bidi += h.bidi; attHidden.override += h.override;
    });
    var runningText = subjHidden.zeroWidth + subjHidden.bidi + bodyHidden.zeroWidth + bodyHidden.bidi; // ordinary prose: a few strays happen
    var identityText = nameHidden.zeroWidth + nameHidden.bidi + hostHidden.zeroWidth + hostHidden.bidi; // a name or host with ANY hidden character is not an accident
    var overrides = subjHidden.override + bodyHidden.override + nameHidden.override + hostHidden.override;
    var hflags = [], hdetail = [];
    if (overrides) { hflags.push('bidi-override'); hdetail.push('a text-direction OVERRIDE character'); }
    if (identityText || runningText >= INVISIBLE_FLAG_THRESHOLD) {
      hflags.push('invisible-chars');
      var where = [];
      if (identityText) where.push(identityText + ' in the sender name or a link');
      if (runningText >= INVISIBLE_FLAG_THRESHOLD) where.push(runningText + ' in the subject/body');
      hdetail.push('hidden characters: ' + where.join(', '));
    }
    var strongHidden = hflags.length > 0;
    if (hiddenBlocks) { hflags.push('hidden-css-text'); hdetail.push(hiddenBlocks + ' CSS-hidden text block' + (hiddenBlocks === 1 ? '' : 's')); }
    var strayHidden = runningText;
    results['hidden-content'] = hflags.length
      ? row('hidden-content', strongHidden ? 'flag' : 'note', hdetail.join('; '), hflags)
      : row('hidden-content', 'ok', strayHidden ? strayHidden + ' stray hidden character' + (strayHidden === 1 ? '' : 's') + ' (normal)' : 'none');

    var replySubject = /^\s*(?:(?:re|fw|fwd|aw|wg|sv|vs|vb|antw|tr|rv|enc|res)\s*(?:\[\d+\])?\s*:\s*)+/i.test(subject);
    var threadHeaders = !!(p.inReplyTo || p.references);
    results['threading'] = (replySubject && !threadHeaders)
      ? row('threading', 'flag', 'subject says Re:/Fwd: but there is no In-Reply-To or References', ['fake-reply'])
      : threadHeaders ? row('threading', 'note', 'part of a thread (' + (p.inReplyTo ? 'In-Reply-To' : 'References') + ' present)', ['threaded'])
      : row('threading', 'ok', 'not a reply');

    var where = [], hflagIds = [];
    function homoglyphIn(label, flagId, str) {
      var r = EV.mixedScriptWords(str, BODY_SCAN_CHARS);
      if (r.count) {
        hflagIds.push(flagId);
        where.push(label + ': "' + r.examples[0].word + '" (' + SCRIPT_LABEL(r.examples[0].scripts) + '; ' + r.examples[0].odd.join(' ') + ')' + (r.count > 1 ? ' +' + (r.count - 1) + ' more' : ''));
      }
    }
    homoglyphIn('subject', 'homoglyph-subject', subject);
    homoglyphIn('sender name', 'homoglyph-name', dn);
    homoglyphIn('body', 'homoglyph-body', bodyText);
    homoglyphIn('link', 'homoglyph-links', hosts.join(' '));
    results['homoglyphs'] = hflagIds.length ? row('homoglyphs', 'flag', where.join('; '), hflagIds) : row('homoglyphs', 'ok', 'none');

    // ---- Attachments ----
    var attRes = attachmentRisk(p.attachments || [], attHidden);
    results['attachment-risk'] = attRes.row;

    // ---- Language (script) ----
    var sp = EV.scriptProfile(subject), bp = EV.scriptProfile(bodyText, BODY_SCAN_CHARS);
    function scriptRow(id, prof, what) {
      if (!prof.scripts.length) return row(id, 'na', 'no letters in the ' + what);
      return row(id, prof.scripts.length === 1 && prof.scripts[0] === 'latin' ? 'ok' : 'note', SCRIPT_LABEL(prof.scripts));
    }
    results['subject-script'] = scriptRow('subject-script', sp, 'subject');
    results['body-script'] = scriptRow('body-script', bp, 'body');
    results['script-mismatch'] = (sp.scripts.length && bp.scripts.length && sp.scripts[0] !== bp.scripts[0])
      ? row('script-mismatch', 'note', 'subject ' + SCRIPT_LABEL([sp.scripts[0]]) + ', body ' + SCRIPT_LABEL([bp.scripts[0]]), ['script-mismatch'])
      : (sp.scripts.length && bp.scripts.length ? row('script-mismatch', 'ok', 'same primary script') : row('script-mismatch', 'na', 'needs both a subject and a body'));

    var checks = CHECKS.map(function (c) {
      var r = results[c.id];
      return { id: c.id, group: c.group, label: c.label, status: r.status, detail: r.detail, flags: r.flags };
    });
    var flags = [];
    checks.forEach(function (c) { c.flags.forEach(function (f) { if (flags.indexOf(f) === -1) flags.push(f); }); });
    var homoglyphWords = 0;
    ['subject', 'name', 'body', 'links'].forEach(function (k) { if (flags.indexOf('homoglyph-' + k) !== -1) homoglyphWords++; });
    var envelope = [['Return-Path', 'return-path'], ['Reply-To', 'reply-to']].map(function (pair) {
      var c = results[pair[1]];
      return { label: pair[0], status: c.status, detail: c.detail };
    });
    var senderIps = EV.originOf(chain.hops);
    var metrics = {
      originIp: senderIps.origin ? senderIps.origin.ip : '', connectingIp: senderIps.connecting ? senderIps.connecting.ip : '',
      hidden: { zeroWidth: bodyHidden.zeroWidth + subjHidden.zeroWidth + nameHidden.zeroWidth + hostHidden.zeroWidth + attHidden.zeroWidth,
                bidi: bodyHidden.bidi + subjHidden.bidi + nameHidden.bidi + hostHidden.bidi + attHidden.bidi, cssBlocks: hiddenBlocks },
      lookalikes: { fields: homoglyphWords, domain: flags.indexOf('confusable-domain') !== -1 },
      envelope: envelope,
      attachments: { total: attRes.total, risky: attRes.risky }
    };
    return { checks: checks, flags: flags, subjectScripts: sp.scripts, bodyScripts: bp.scripts, metrics: metrics };
  };
})(typeof self !== 'undefined' ? self : this);
