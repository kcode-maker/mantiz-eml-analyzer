/**
 * urlExtract.js — plain-text utilities: pull URLs out of text/HTML bodies,
 * and a small HTML -> text fallback used for search indexing when a message
 * has no text/plain part.
 */
(function (g) {
  'use strict';
  var EV = g.EV || (g.EV = {});

  var URL_RE = /\b((?:https?|hxxps?|ftp):\/\/[^\s"'<>()\[\]]+|www\.[^\s"'<>()\[\]]+)/gi;
  var HREF_RE = /\s(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;

  function stripTrailingPunct(u) {
    return u.replace(/[),.;:!?'"]+$/g, '');
  }

  /**
   * @param {string} text plaintext body
   * @param {string} html html body (raw, unsanitized is fine — read only)
   * @returns {string[]} de-duplicated list of URLs found in either part
   */
  EV.extractUrls = function (text, html) {
    var found = [];
    var seen = {};
    function add(u) {
      u = stripTrailingPunct(u.trim());
      if (!u || seen[u]) return;
      seen[u] = true;
      found.push(u);
    }
    if (text) {
      var m;
      URL_RE.lastIndex = 0;
      while ((m = URL_RE.exec(text))) add(m[1]);
    }
    if (html) {
      HREF_RE.lastIndex = 0;
      var hm;
      while ((hm = HREF_RE.exec(html))) add(hm[1] || hm[2] || hm[3] || '');
      URL_RE.lastIndex = 0;
      var m2;
      while ((m2 = URL_RE.exec(html))) add(m2[1]);
    }
    return found.filter(function (u) {
      return /^(https?|hxxps?|ftp|www\.)/i.test(u);
    });
  };

  /**
   * De-fangs a URL for safe display/copy (hxxp, [.] ) — purely cosmetic, does
   * not change what gets opened since links are never auto-opened by this app.
   */
  EV.defang = function (u) {
    return u.replace(/^https?/i, function (m) { return m.replace(/t/gi, 'x'); }).replace(/\./g, '[.]');
  };

  var BLOCK_TAGS = /<\/?(script|style)[^>]*>[\s\S]*?<\/\1>/gi;
  var TAG_RE = /<[^>]+>/g;
  var ENTITY_MAP = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };

  function decodeEntities(str) {
    return str.replace(/&(#\d+|#x[0-9a-f]+|[a-z0-9]+);/gi, function (m, code) {
      if (code[0] === '#') {
        var cp = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return isNaN(cp) ? m : String.fromCodePoint(cp);
      }
      return ENTITY_MAP.hasOwnProperty(code.toLowerCase()) ? ENTITY_MAP[code.toLowerCase()] : m;
    });
  }

  /**
   * Very small, dependency-free HTML -> plain text conversion for search
   * indexing purposes only (never used for on-screen rendering — DOMPurify +
   * the sandboxed iframe handle that).
   */
  EV.htmlToText = function (html) {
    if (!html) return '';
    var t = html.replace(BLOCK_TAGS, ' ');
    t = t.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n');
    t = t.replace(TAG_RE, ' ');
    t = decodeEntities(t);
    return t.replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
  };

  var TOKEN_RE = /[a-z0-9](?:[a-z0-9._@\-]*[a-z0-9])?/g;
  var MAX_TOKENS_PER_FIELD = 5000;

  /**
   * Shared tokenizer used both when building the search index (in workers)
   * and when parsing a search query (on the main thread) — they MUST match
   * or indexed terms would silently fail to match query terms.
   * @returns {string[]} lowercase tokens, deduplicated, capped for safety.
   */
  EV.tokenize = function (text) {
    if (!text) return [];
    var lower = text.toLowerCase();
    var out = [];
    var seen = {};
    var m;
    TOKEN_RE.lastIndex = 0;
    while ((m = TOKEN_RE.exec(lower))) {
      var tok = m[0];
      if (tok.length < 2) continue;
      if (!seen[tok]) {
        seen[tok] = true;
        out.push(tok);
        if (out.length >= MAX_TOKENS_PER_FIELD) break;
      }
    }
    return out;
  };
})(typeof self !== 'undefined' ? self : this);
