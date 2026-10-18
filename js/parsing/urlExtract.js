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
  // HTML named character references (the HTML 4 set: Latin-1, symbols, Greek, special) -- parsed once.
  // Decoded for search indexing only, so e.g. "caf&eacute;" and "&euro;99" are found as "café" / "€99".
  var NAMED_ENTITIES = (function () {
    var map = { amp: '&', lt: '<', gt: '>', quot: '"', nbsp: ' ', apos: "'" };
    'AElig:198,Aacute:193,Acirc:194,Agrave:192,Alpha:913,Aring:197,Atilde:195,Auml:196,Beta:914,Ccedil:199,Chi:935,Dagger:8225,Delta:916,ETH:208,Eacute:201,Ecirc:202,Egrave:200,Epsilon:917,Eta:919,Euml:203,Gamma:915,Iacute:205,Icirc:206,Igrave:204,Iota:921,Iuml:207,Kappa:922,Lambda:923,Mu:924,Ntilde:209,Nu:925,OElig:338,Oacute:211,Ocirc:212,Ograve:210,Omega:937,Omicron:927,Oslash:216,Otilde:213,Ouml:214,Phi:934,Pi:928,Prime:8243,Psi:936,Rho:929,Scaron:352,Sigma:931,THORN:222,Tau:932,Theta:920,Uacute:218,Ucirc:219,Ugrave:217,Upsilon:933,Uuml:220,Xi:926,Yacute:221,Yuml:376,Zeta:918,aacute:225,acirc:226,acute:180,aelig:230,agrave:224,alefsym:8501,alpha:945,and:8743,ang:8736,aring:229,asymp:8776,atilde:227,auml:228,bdquo:8222,beta:946,brvbar:166,bull:8226,cap:8745,ccedil:231,cedil:184,cent:162,chi:967,circ:710,clubs:9827,cong:8773,copy:169,crarr:8629,cup:8746,curren:164,dArr:8659,dagger:8224,darr:8595,deg:176,delta:948,diams:9830,divide:247,eacute:233,ecirc:234,egrave:232,empty:8709,emsp:8195,ensp:8194,epsilon:949,equiv:8801,eta:951,eth:240,euml:235,euro:8364,exist:8707,fnof:402,forall:8704,frac12:189,frac14:188,frac34:190,frasl:8260,gamma:947,ge:8805,hArr:8660,harr:8596,hearts:9829,hellip:8230,iacute:237,icirc:238,iexcl:161,igrave:236,image:8465,infin:8734,int:8747,iota:953,iquest:191,isin:8712,iuml:239,kappa:954,lArr:8656,lambda:955,lang:9001,laquo:171,larr:8592,lceil:8968,ldquo:8220,le:8804,lfloor:8970,lowast:8727,loz:9674,lrm:8206,lsaquo:8249,lsquo:8216,macr:175,mdash:8212,micro:181,middot:183,minus:8722,mu:956,nabla:8711,ndash:8211,ne:8800,ni:8715,not:172,notin:8713,nsub:8836,ntilde:241,nu:957,oacute:243,ocirc:244,oelig:339,ograve:242,oline:8254,omega:969,omicron:959,oplus:8853,or:8744,ordf:170,ordm:186,oslash:248,otilde:245,otimes:8855,ouml:246,para:182,part:8706,permil:8240,perp:8869,phi:966,pi:960,piv:982,plusmn:177,pound:163,prime:8242,prod:8719,prop:8733,psi:968,rArr:8658,radic:8730,rang:9002,raquo:187,rarr:8594,rceil:8969,rdquo:8221,real:8476,reg:174,rfloor:8971,rho:961,rlm:8207,rsaquo:8250,rsquo:8217,sbquo:8218,scaron:353,sdot:8901,sect:167,shy:173,sigma:963,sigmaf:962,sim:8764,spades:9824,sub:8834,sube:8838,sum:8721,sup:8835,sup1:185,sup2:178,sup3:179,supe:8839,szlig:223,tau:964,there4:8756,theta:952,thetasym:977,thinsp:8201,thorn:254,tilde:732,times:215,trade:8482,uArr:8657,uacute:250,uarr:8593,ucirc:251,ugrave:249,uml:168,upsih:978,upsilon:965,uuml:252,weierp:8472,xi:958,yacute:253,yen:165,yuml:255,zeta:950,zwj:8205,zwnj:8204'.split(',').forEach(function (pair) {
      var i = pair.indexOf(':');
      map[pair.slice(0, i)] = String.fromCharCode(parseInt(pair.slice(i + 1), 10));
    });
    return map;
  })();
  // Numeric references 128-159 mean the Windows-1252 characters in browsers, not C1 controls.
  var CP1252 = [0x20AC, 0x81, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0x8D, 0x017D, 0x8F,
    0x90, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x9D, 0x017E, 0x0178];

  function codePointToString(cp) {
    if (!(cp > 0) || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) return '\uFFFD'; // what a browser shows; never throws
    if (cp >= 128 && cp <= 159) cp = CP1252[cp - 128];
    return String.fromCodePoint(cp);
  }

  function decodeEntities(str) {
    if (str.indexOf('&') === -1) return str;
    return str
      // &#1089; &#x44F; -- the trailing semicolon is optional in browsers, and obfuscators rely on that
      .replace(/&#(\d+|[xX][0-9a-fA-F]+);?/g, function (m, code) {
        return codePointToString(code[0] === 'x' || code[0] === 'X' ? parseInt(code.slice(1), 16) : parseInt(code, 10));
      })
      .replace(/&([A-Za-z][A-Za-z0-9]*);/g, function (m, name) {
        if (NAMED_ENTITIES.hasOwnProperty(name)) return NAMED_ENTITIES[name];
        var lower = name.toLowerCase(); // &AMP; &LT; &GT; &QUOT; are valid too
        return (lower === 'amp' || lower === 'lt' || lower === 'gt' || lower === 'quot') ? NAMED_ENTITIES[lower] : m;
      })
      // The few legacy references browsers also decode without a semicolon
      .replace(/&(amp|lt|gt|quot|nbsp)(?![A-Za-z0-9;])/gi, function (m, name) { return NAMED_ENTITIES[name.toLowerCase()]; });
  }
  EV.decodeEntities = decodeEntities;

  // ---- punycode (RFC 3492), so an internationalized link host is searchable in its readable form ----
  function punyAdapt(delta, numPoints, first) {
    var k = 0;
    delta = first ? Math.floor(delta / 700) : delta >> 1;
    delta += Math.floor(delta / numPoints);
    for (; delta > 455; k += 36) delta = Math.floor(delta / 35);
    return Math.floor(k + 36 * delta / (delta + 38));
  }
  /** Decodes one punycode label WITHOUT its "xn--" prefix; null if it isn't valid punycode. */
  function punycodeDecodeLabel(input) {
    var output = [], i = 0, n = 128, bias = 72;
    var basic = input.lastIndexOf('-');
    if (basic < 0) basic = 0;
    for (var j = 0; j < basic; j++) {
      if (input.charCodeAt(j) >= 0x80) return null;
      output.push(input.charCodeAt(j));
    }
    for (var index = basic > 0 ? basic + 1 : 0; index < input.length;) {
      var oldi = i;
      for (var w = 1, k = 36; ; k += 36) {
        if (index >= input.length) return null;
        var cc = input.charCodeAt(index++);
        var digit = (cc >= 48 && cc < 58) ? cc - 22 : (cc >= 65 && cc < 91) ? cc - 65 : (cc >= 97 && cc < 123) ? cc - 97 : 36;
        if (digit >= 36) return null;
        i += digit * w;
        var t = k <= bias ? 1 : (k >= bias + 26 ? 26 : k - bias);
        if (digit < t) break;
        w *= 36 - t;
      }
      var out = output.length + 1;
      bias = punyAdapt(i - oldi, out, oldi === 0);
      n += Math.floor(i / out);
      i %= out;
      if (n > 0x10FFFF || (n >= 0xD800 && n <= 0xDFFF)) return null;
      output.splice(i++, 0, n);
    }
    return String.fromCodePoint.apply(null, output);
  }
  EV.punycodeDecodeLabel = punycodeDecodeLabel;

  /** The readable (Unicode) form of every internationalized host among `urls` -- e.g.
   * "http://xn--e1afmkfd.xn--p1ai/x" yields "пример.рф". URLs with no punycode label yield nothing. */
  EV.unicodeHostsOfUrls = function (urls) {
    var out = [];
    (urls || []).forEach(function (u) {
      var m = /^[a-z][a-z0-9+.\-]*:\/\/(?:[^\/?#@\s]*@)?([^\/?#:\s]+)/i.exec(u);
      if (!m || m[1].toLowerCase().indexOf('xn--') === -1) return;
      var changed = false;
      var host = m[1].split('.').map(function (label) {
        if (label.slice(0, 4).toLowerCase() !== 'xn--') return label;
        var d = punycodeDecodeLabel(label.slice(4).toLowerCase());
        if (d === null) return label;
        changed = true;
        return d;
      }).join('.');
      if (changed) out.push(host);
    });
    return out;
  };

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

  /**
   * EV.tokenize plus the pieces of any punctuation-glued token, for fields whose full text isn't
   * retained to substring-scan (header values): "mail-ej1.google.com" also indexes "mail-ej1",
   * "mail", "ej1", "google.com" and "google"; "message@adobe.com" also indexes "message", "adobe.com"
   * and "adobe". A strict superset of EV.tokenize's output, so a query term (tokenized with plain
   * EV.tokenize) always finds the whole token too. Same dedupe + per-field cap.
   */
  EV.tokenizeExpanded = function (text) {
    var base = EV.tokenize(text);
    var out = [];
    var seen = {};
    function add(t) {
      if (t.length >= 2 && !seen[t]) { seen[t] = true; out.push(t); }
    }
    for (var i = 0; i < base.length && out.length < MAX_TOKENS_PER_FIELD; i++) {
      var tok = base[i];
      add(tok);
      if (!/[._@\-]/.test(tok)) continue;
      var at = tok.indexOf('@');
      var pieces = at > 0 ? [tok.slice(0, at), tok.slice(at + 1)] : [tok];
      pieces.forEach(function (piece) {
        add(piece);
        var labels = piece.split('.');
        if (labels.length > 2 && /^[a-z]{2,}$/.test(labels[labels.length - 1])) {
          for (var k = 1; k < labels.length - 1; k++) add(labels.slice(k).join('.'));
        }
        piece.split(/[._\-]+/).forEach(add);
      });
    }
    return out.length > MAX_TOKENS_PER_FIELD ? out.slice(0, MAX_TOKENS_PER_FIELD) : out;
  };
})(typeof self !== 'undefined' ? self : this);
