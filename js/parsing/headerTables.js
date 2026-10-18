/**
 * headerTables.js — turns the two headers analysts read most, Authentication-Results and Received, from one long
 * string into structured rows for the Headers tab's tables. Pure functions (no DOM, no network), so they are unit
 * tested under jsc. Every parser is tolerant: anything it cannot make sense of falls back to the raw text instead of
 * throwing or dropping data (a table row can always show `raw`).
 *
 *   EV.parseAuthResults(value)  -> {authservId, version, results: [{method, result, comment, props: [{key, value}]}], raw}
 *   EV.authResultClass(result)  -> 'ok' | 'flag' | 'note'    (pass / fail-ish / everything else)
 *   EV.parseReceived(value)     -> {from, fromIp, fromComment, by, with, id, forAddr, dateText, dateMs, raw}
 *   EV.receivedChain(headers)   -> hops oldest-first, each with its parse plus `delayMs` since the hop before it
 *   EV.formatDelay(ms)          -> "+5s", "+2m 3s", "-1h 29m"
 */
(function (g) {
  'use strict';
  var EV = g.EV || (g.EV = {});

  var MAX_SEGMENTS = 64; // a header is attacker-controlled input: bound the work

  /** Splits on `sep` at the top level only -- not inside (parentheses) or "quotes". */
  function splitTopLevel(s, sep) {
    var out = [], depth = 0, inQuote = false, cur = '';
    for (var i = 0; i < s.length && out.length < MAX_SEGMENTS; i++) {
      var c = s.charAt(i);
      if (inQuote) { cur += c; if (c === '\\') { cur += s.charAt(++i); } else if (c === '"') inQuote = false; continue; }
      if (c === '"') { inQuote = true; cur += c; continue; }
      if (c === '(') depth++;
      else if (c === ')' && depth > 0) depth--;
      if (c === sep && depth === 0) { out.push(cur); cur = ''; continue; }
      cur += c;
    }
    out.push(cur);
    return out;
  }

  /** Pulls the (comments) out of a segment: returns {text without comments, comments: [..]}. Handles nesting. */
  function stripComments(s) {
    var text = '', comments = [], depth = 0, cur = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (c === '(') { if (depth === 0) cur = ''; else cur += c; depth++; continue; }
      if (c === ')' && depth > 0) { depth--; if (depth === 0) comments.push(cur.trim()); else cur += c; continue; }
      if (depth > 0) cur += c; else text += c;
    }
    if (depth > 0 && cur.trim()) comments.push(cur.trim()); // unterminated comment: keep what we saw
    return { text: text, comments: comments };
  }

  function unquote(v) { return v.length >= 2 && v.charAt(0) === '"' && v.charAt(v.length - 1) === '"' ? v.slice(1, -1) : v; }

  EV.parseAuthResults = function (value) {
    var raw = String(value == null ? '' : value);
    var out = { authservId: '', version: '', results: [], raw: raw };
    var segs = splitTopLevel(raw, ';');
    var first = segs.shift() || '';
    // ARC-Authentication-Results starts with an instance tag: "i=1; mx.example.com; spf=pass ..."
    var inst = /^\s*i\s*=\s*(\d+)\s*$/i.exec(first);
    if (inst) { out.instance = parseInt(inst[1], 10); first = segs.shift() || ''; }
    var head = stripComments(first).text.trim().split(/\s+/);
    if (/=/.test(head[0] || '')) { // no authserv-id at all ("spf=pass ...; dkim=pass ..."): the first segment is already a result
      segs.unshift(first);
      head = [''];
    }
    out.authservId = head[0] || '';
    if (head[1] && /^\d+$/.test(head[1])) out.version = head[1];
    segs.forEach(function (seg) {
      var sc = stripComments(seg);
      var text = sc.text.trim();
      if (!text) return;
      var m = /^([A-Za-z0-9._+-]+)\s*=\s*([A-Za-z0-9._+-]+)\s*(.*)$/.exec(text);
      if (!m) { // "none", or something we don't recognise: keep it as a single row rather than lose it
        out.results.push({ method: '', result: text, comment: sc.comments.join(' '), props: [] });
        return;
      }
      var props = [], re = /([A-Za-z0-9._+-]+)\s*=\s*("(?:[^"\\]|\\.)*"|[^\s"]+)/g, pm;
      while ((pm = re.exec(m[3]))) props.push({ key: pm[1], value: unquote(pm[2]) });
      out.results.push({ method: m[1].toLowerCase(), result: m[2].toLowerCase(), comment: sc.comments.join(' '), props: props });
    });
    return out;
  };

  /** Colour class for a result word: pass is ok, hard failures are flags, everything else (softfail, neutral, none,
   * policy, temperror, permerror...) is a note. */
  EV.authResultClass = function (result) {
    var r = String(result || '').toLowerCase();
    if (r === 'pass' || r === 'bestguesspass') return 'ok';
    if (r === 'fail' || r === 'hardfail') return 'flag';
    return 'note';
  };

  // ---------------------------------------------------------------- Received

  EV.parseReceived = function (value) {
    var raw = String(value == null ? '' : value);
    var semi = raw.lastIndexOf(';');
    var dateText = semi === -1 ? '' : raw.slice(semi + 1).trim();
    var dateMs = dateText ? Date.parse(dateText) : NaN;
    var body = semi === -1 ? raw : raw.slice(0, semi);
    var out = { from: '', fromIp: '', fromComment: '', by: '', with: '', id: '', forAddr: '', dateText: dateText, dateMs: isNaN(dateMs) ? null : dateMs, raw: raw };
    var fm = /\bfrom\s+(\S+)\s*(\([^)]*(?:\([^)]*\)[^)]*)*\))?/i.exec(body);
    if (fm) {
      out.from = fm[1];
      out.fromComment = fm[2] ? fm[2].slice(1, -1).trim() : '';
      var ip = /\[(?:IPv6:)?([0-9a-fA-F:.]+)\]/.exec(out.fromComment) || /\b((?:\d{1,3}\.){3}\d{1,3})\b/.exec(out.fromComment);
      if (!ip) { // a bare IPv6 address, as Microsoft writes it: it must contain "::" or be a full 8-group address (so 10:30:45 never matches)
        var v6 = /(?:^|[\s(])([0-9a-fA-F]{0,4}(?::[0-9a-fA-F]{0,4}){2,7})(?=$|[\s)])/.exec(out.fromComment);
        if (v6 && (v6[1].indexOf('::') !== -1 || v6[1].split(':').length === 8)) ip = v6;
      }
      if (ip) out.fromIp = ip[1];
    }
    var bm = /\bby\s+(\S+)/i.exec(body); if (bm) out.by = bm[1];
    // "with ESMTPS (version=TLS1_3 ...)" -> ESMTPS ; "with Microsoft SMTP Server (version=...)" -> Microsoft SMTP Server
    var wm = /\bwith\s+(.+?)(?=\s+(?:id|for|by|from|via)\b|\s*\(|\s*;|$)/i.exec(body);
    if (wm) out.with = wm[1].trim();
    var im = /\bid\s+([^\s;]+)/i.exec(body); if (im) out.id = im[1];
    var rm = /\bfor\s+<?([^\s;>]+)>?/i.exec(body); if (rm) out.forAddr = rm[1];
    return out;
  };

  /** "+5s" / "+2m 3s" / "+1h 4m" / "-1h 29m" -- a signed human delay, or '' when unknown. */
  EV.formatDelay = function (ms) {
    if (ms == null || isNaN(ms)) return '';
    var sign = ms < 0 ? '-' : '+', t = Math.abs(Math.round(ms / 1000));
    if (t < 60) return sign + t + 's';
    var h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    if (h >= 24) return sign + Math.floor(h / 24) + 'd ' + (h % 24) + 'h';
    if (h) return sign + h + 'h ' + m + 'm';
    return sign + m + 'm ' + s + 's';
  };

  /**
   * The Received headers as a hop-by-hop chain, ORIGIN FIRST (the headers themselves are newest-first, so this is
   * reversed). `delayMs` is the time since the previous (older) hop, negative when a hop claims to be earlier than the
   * one before it -- "time travel", the same oddity the Security checks card flags.
   */
  EV.receivedChain = function (headers) {
    var values = EV.getHeaderAll ? EV.getHeaderAll(headers || [], 'received') : [];
    var parsed = values.slice(0, 100).map(EV.parseReceived).reverse();
    parsed.forEach(function (hop, i) {
      hop.index = i + 1;
      var prev = i > 0 ? parsed[i - 1] : null;
      hop.delayMs = (prev && prev.dateMs != null && hop.dateMs != null) ? hop.dateMs - prev.dateMs : null;
    });
    return parsed;
  };

  // ---------------------------------------------------------------- chain integrity

  var CLOCK_SKEW_MS = 5 * 60 * 1000; // hops may disagree by a few minutes (clock skew) without being "time travel"
  EV.CLOCK_SKEW_MS = CLOCK_SKEW_MS;

  function normHost(h) { return String(h || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, ''); }
  var LOCAL_RE = /^(localhost|localhost\.localdomain|unknown|127\.\d+\.\d+\.\d+|::1|.*\.local|.*\.localdomain|.*\.internal|.*\.lan)$/;
  function isIp(h) { return /^(\d{1,3}\.){3}\d{1,3}$/.test(h) || (h.indexOf(':') !== -1 && /^[0-9a-f:]+$/.test(h)); }
  function regDomain(h) {
    if (isIp(h)) return h;
    if (EV.ruleHelpers && EV.ruleHelpers.registrableDomain) return EV.ruleHelpers.registrableDomain(h);
    return h.split('.').slice(-2).join('.');
  }

  /**
   * Does the NEXT hop's "from" correspond to the PREVIOUS hop's "by"? 'ok' | 'broken' | 'unknown'.
   * Real chains name hosts inconsistently (HELO names, rDNS names, load balancers), so this is deliberately lenient:
   * same host, same registrable domain, the previous receiver named in the next hop's (comment), or a matching IP all
   * count as a match; localhost / .local / missing names are 'unknown' rather than 'broken'. Only two hosts with
   * nothing in common are 'broken'.
   */
  EV.hopsConnect = function (prev, next) {
    var by = normHost(prev && prev.by), from = normHost(next && next.from);
    var comment = String((next && next.fromComment) || '').toLowerCase();
    if (!by || (!from && !comment)) return 'unknown';
    if (LOCAL_RE.test(by)) return 'unknown';
    // "from unknown (HELO mx.example.org) ([1.2.3.4])": the previous receiver is named in the comment even when `from` is useless
    if (comment.indexOf(by) !== -1 || (regDomain(by) !== by && comment.indexOf(regDomain(by)) !== -1)) return 'ok';
    if (!from || LOCAL_RE.test(from)) return 'unknown';
    if (by === from) return 'ok';
    if (regDomain(by) === regDomain(from)) return 'ok';
    if (isIp(by) && next && next.fromIp === by) return 'ok';
    return 'broken';
  };

  /**
   * The chain's integrity: for each pair of consecutive hops (origin first) whether the hand-off matches
   * ('ok' | 'broken' | 'unknown') and whether the clock went backwards ('timeTravel', beyond clock skew).
   * @returns {{hops: Array, links: Array<{from: number, to: number, handoff: string, timeTravel: boolean, delayMs: ?number, reasons: string[]}>,
   *            broken: number, timeTravel: number, totalMs: ?number}}
   */
  EV.analyzeChain = function (hops) {
    hops = hops || [];
    var links = [], broken = 0, travel = 0;
    for (var i = 1; i < hops.length; i++) {
      var prev = hops[i - 1], next = hops[i];
      var handoff = EV.hopsConnect(prev, next);
      var tt = next.delayMs != null && next.delayMs < -CLOCK_SKEW_MS;
      var reasons = [];
      if (handoff === 'broken') reasons.push('hop ' + prev.index + ' delivered to ' + (prev.by || '?') + ', but hop ' + next.index + ' says it received the message from ' + (next.from || next.fromComment || '?'));
      if (tt) reasons.push('hop ' + next.index + ' is stamped ' + EV.formatDelay(-next.delayMs).replace('+', '') + ' EARLIER than hop ' + prev.index);
      if (handoff === 'broken') broken++;
      if (tt) travel++;
      links.push({ from: prev.index, to: next.index, handoff: handoff, timeTravel: tt, delayMs: next.delayMs, reasons: reasons });
    }
    var first = hops.length ? hops[0].dateMs : null, last = hops.length ? hops[hops.length - 1].dateMs : null;
    return { hops: hops, links: links, broken: broken, timeTravel: travel, totalMs: (first != null && last != null) ? last - first : null };
  };

  // ---------------------------------------------------------------- forged-header evidence (deliberately conservative)

  /** Private / loopback / link-local / unique-local addresses -- never reachable from the public internet. */
  EV.isPrivateIp = function (ip) {
    ip = String(ip || '').toLowerCase();
    var m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
    if (m) {
      var a = +m[1], b = +m[2];
      return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
    }
    if (ip.indexOf(':') !== -1) return ip === '::1' || /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip);
    return false;
  };

  function hostMatches(host, id) {
    host = normHost(host); id = normHost(id);
    if (!host || !id) return false;
    return host === id || regDomain(host) === regDomain(id);
  }

  /**
   * Evidence that a trust header was inserted by someone other than the receiving servers. Only two patterns that
   * essentially never occur in legitimate mail are reported -- everything weaker (HELO/rDNS differences, odd dates,
   * private hops, differing results between different servers) is common in real mail and is NOT reported:
   *   auth-results-conflict  one server (same authserv-id) wrote two Authentication-Results that disagree on a method
   *                          (e.g. spf=fail in one, spf=pass in the other): a real server writes one, and a receiver is
   *                          supposed to strip a pre-existing header carrying its own id (RFC 8601 section 5).
   *   auth-results-planted   an Authentication-Results sits BELOW the oldest Received (so it existed before any server
   *                          touched the message) and names a server that no Received hop was received by.
   * @returns {{findings: Array<{id: string, title: string, detail: string}>}}
   */
  EV.analyzeHeaderForgery = function (headers) {
    headers = headers || [];
    var findings = [], ars = [], lastReceived = -1, byHosts = [];
    for (var i = 0; i < headers.length && i < 400; i++) {
      var h = headers[i];
      if (h.lower === 'received') { lastReceived = i; var rp = EV.parseReceived(h.value); if (rp.by) byHosts.push(rp.by); }
      else if (h.lower === 'authentication-results') ars.push({ index: i, parsed: EV.parseAuthResults(h.value) });
    }
    var byId = {};
    ars.forEach(function (a) {
      var id = normHost(a.parsed.authservId);
      if (id) (byId[id] = byId[id] || []).push(a);
    });
    Object.keys(byId).forEach(function (id) {
      var group = byId[id];
      if (group.length < 2) return;
      var seen = {}, clash = null;
      group.forEach(function (a) {
        a.parsed.results.forEach(function (r) {
          if (!r.method) return;
          if (seen[r.method] && seen[r.method] !== r.result && !clash) clash = r.method + '=' + seen[r.method] + ' vs ' + r.method + '=' + r.result;
          if (!seen[r.method]) seen[r.method] = r.result;
        });
      });
      if (clash) findings.push({ id: 'auth-results-conflict', title: id + ' wrote two Authentication-Results that disagree', detail: clash + ' — a server writes one such header, so one of them was inserted' });
    });
    if (lastReceived !== -1) {
      ars.forEach(function (a) {
        var id = a.parsed.authservId;
        if (a.index < lastReceived || !id || id.indexOf('.') === -1) return;
        var matched = byHosts.some(function (by) { return hostMatches(by, id); });
        if (!matched) findings.push({ id: 'auth-results-planted', title: 'Authentication-Results from ' + id + ' sits below the first Received hop', detail: 'it was already in the message before any server handled it, and no hop in the chain was received by ' + id });
      });
    }
    return { findings: findings };
  };

  // ---------------------------------------------------------------- internal / external

  function domainInList(domain, list) {
    domain = normHost(domain);
    if (!domain) return false;
    return (list || []).some(function (d) { d = String(d || '').trim().toLowerCase(); return d && (domain === d || domain.endsWith('.' + d)); });
  }
  EV.domainInList = domainInList;

  /**
   * Is this an internal email? Needs the organization's own domains (Settings). Verdict:
   *   unconfigured    no organization domains are set, so nothing can be said
   *   external        the sender's domain is not one of yours
   *   internal        sender domain is yours AND the first hop came from a private/own address (or no hop shows an outside
   *                   origin), or the message authenticates as your domain (DMARC pass / Exchange AuthAs=Internal)
   *   unverified      sender domain is yours but there are no Received headers to confirm the path
   *   claims-internal sender domain is yours, the first hop came from a public address that is not yours, and nothing
   *                   authenticates it -- the signature of a spoofed internal sender
   * Authenticated mail that entered from a public IP (cloud mail) stays "internal", so cloud-hosted organizations do
   * not get false alarms.
   * @returns {{state: string, detail: string}}
   */
  EV.classifyOrigin = function (parsed, internalDomains) {
    var list = (internalDomains || []).filter(Boolean);
    if (!list.length) return { state: 'unconfigured', detail: 'set your organization’s domains in Settings to detect internal mail' };
    var p = parsed || {}, headers = p.headers || [];
    var from = p.from && p.from[0], addr = from && from.address ? String(from.address).toLowerCase() : '';
    var domain = addr.indexOf('@') !== -1 ? addr.slice(addr.lastIndexOf('@') + 1) : '';
    if (!domainInList(domain, list)) return { state: 'external', detail: domain ? domain + ' is not one of your domains' : 'no sender domain' };
    var chain = EV.receivedChain(headers);
    if (!chain.length) return { state: 'unverified', detail: domain + ' is yours, but there are no Received headers to confirm where it came from' };
    var first = chain[0];
    var external = first.fromIp && !EV.isPrivateIp(first.fromIp) && !domainInList(first.from, list);
    if (!external) return { state: 'internal', detail: domain + ' is yours and it entered from ' + (first.fromIp ? 'a private address (' + first.fromIp + ')' : 'inside the organization') };
    var authAs = String(EV.getHeader ? EV.getHeader(headers, 'x-ms-exchange-organization-authas') || '' : '').trim().toLowerCase();
    var topAr = EV.getHeader ? EV.getHeader(headers, 'authentication-results') : null;
    var dmarcPass = false;
    if (topAr) EV.parseAuthResults(topAr).results.forEach(function (r) { if (r.method === 'dmarc' && r.result === 'pass') dmarcPass = true; });
    if (authAs === 'internal' || dmarcPass) return { state: 'internal', detail: domain + ' is yours; it entered from public address ' + first.fromIp + ' but authenticates as your domain (' + (dmarcPass ? 'DMARC pass' : 'Exchange AuthAs=Internal') + ')' };
    return { state: 'claims-internal', detail: 'sender uses your domain ' + domain + ' but the first hop came from public address ' + first.fromIp + ' and nothing authenticates it' };
  };

  // ---------------------------------------------------------------- where it came from, and where the time went

  /**
   * The two sender IPs an analyst acts on, from the chain (oldest hop first). Only PUBLIC addresses count (a private or loopback
   * address is somebody's LAN, not an internet host).
   *   origin      the EARLIEST public IP in the chain: where the message claims to have started. Any hop below your first trusted
   *               server was written by whoever sent it, so this can be fabricated -- treat it as evidence, not proof.
   *   connecting  the NEWEST public IP: the machine that connected to the first public-facing server of the recipient's side. That
   *               hop was recorded by the receiver, not the sender, so it cannot be forged by the sender -- the one to block.
   * They are the same address when only one public hop exists. `internalOnly` = hops exist, all on private addresses.
   * @returns {{origin: ?{ip: string, hop: number, host: string}, connecting: ?{ip: string, hop: number, host: string}, internalOnly: boolean}}
   */
  EV.originOf = function (hops) {
    var pub = [], priv = 0;
    (hops || []).forEach(function (h) {
      var ip = h && h.fromIp ? String(h.fromIp).toLowerCase() : '';
      if (!ip || !isIp(ip)) return;
      if (EV.isPrivateIp(ip)) priv++; else pub.push(h);
    });
    function pick(h) { return h ? { ip: h.fromIp, hop: h.index, host: h.from || '' } : null; }
    return { origin: pick(pub[0]), connecting: pick(pub[pub.length - 1]), internalOnly: !pub.length && priv > 0 };
  };

  /**
   * Time spent between hops, from analyzeChain's result: every measurable link plus the slowest one. Unlike a plain subtraction of
   * timestamps it keeps days (a message held for 26 hours is 26 hours, not 2) and keeps negative gaps visible instead of clamping them
   * to zero -- a hop stamped before the one it follows is exactly what the chain check flags.
   * @returns {{links: Array<{from: number, to: number, ms: number}>, slowest: ?{from: number, to: number, ms: number}, maxMs: number, negatives: number}}
   */
  EV.chainTiming = function (analysis) {
    var links = [], slowest = null, maxMs = 0, negatives = 0;
    ((analysis && analysis.links) || []).forEach(function (l) {
      if (l.delayMs == null) return;
      var item = { from: l.from, to: l.to, ms: l.delayMs };
      links.push(item);
      if (l.delayMs < 0) negatives++;
      if (l.delayMs > maxMs) { maxMs = l.delayMs; slowest = item; }
    });
    return { links: links, slowest: slowest, maxMs: maxMs, negatives: negatives };
  };

  /** The hops as tab-separated text (header row first) for pasting into a case note or spreadsheet. */
  EV.hopTableText = function (hops) {
    var rows = [['#', 'From', 'IP', 'By', 'With', 'Time', 'Delay']];
    (hops || []).forEach(function (h) {
      rows.push([String(h.index), h.from || '', h.fromIp || '', h.by || '', h.with || '', h.dateText || '', h.delayMs != null ? EV.formatDelay(h.delayMs) : '']);
    });
    return rows.map(function (r) { return r.map(function (c) { return String(c).replace(/[\t\r\n]+/g, ' '); }).join('\t'); }).join('\n');
  };
})(typeof self !== 'undefined' ? self : this);
