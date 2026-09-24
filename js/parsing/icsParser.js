/**
 * icsParser.js — dependency-free RFC 5545 (iCalendar) parser, extracting
 * just the handful of VEVENT fields this app needs to show a friendly
 * "Calendar Invite" summary card (see js/render.js's renderPreview).
 *
 * Deliberately narrow in scope — this is NOT a general iCalendar library:
 * no RRULE/recurrence expansion, no real IANA timezone-database conversion
 * for TZID-qualified local times (out of scope by design; we just surface
 * the raw local date/time plus its TZID string), only the first VEVENT in
 * a calendar is parsed. Untrusted input (calendar data can arrive inside
 * any email) so every code path here must degrade to a safe "couldn't
 * parse" result rather than ever throwing — mirrors this project's
 * existing philosophy in js/emlParser.js (e.g. its address-list bound
 * recovery and base64 decode-failure handling).
 *
 * Works in the main thread or any JS engine with plain string support —
 * no TextDecoder/atob/DOM dependency at all, unlike emlParser.js (which
 * needs those for byte-level MIME decoding; this module only ever
 * receives already-decoded text).
 */
(function (g) {
  'use strict';
  var EV = g.EV || (g.EV = {});

  // ---------- RFC 5545 §3.1 line unfolding ----------

  // A line starting with a single space or horizontal tab is a continuation
  // of the previous line — concatenate after stripping that one leading
  // whitespace character. Handle both CRLF and bare-LF input.
  function unfoldLines(text) {
    var norm = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    var physical = norm.split('\n');
    var logical = [];
    for (var i = 0; i < physical.length; i++) {
      var line = physical[i];
      if (logical.length && (line.charAt(0) === ' ' || line.charAt(0) === '\t')) {
        logical[logical.length - 1] += line.slice(1);
      } else {
        logical.push(line);
      }
    }
    return logical;
  }

  // ---------- content-line -> {name, params, value} ----------

  // Split "NAME;PARAM1=VAL1;PARAM2=VAL2:VALUE" into the param-bearing head
  // and the value, splitting on the first colon that isn't inside a
  // double-quoted parameter value (quoted param values may legally contain
  // ':' or ';').
  function splitOnUnquotedColon(line) {
    var inQuotes = false;
    for (var i = 0; i < line.length; i++) {
      var c = line.charAt(i);
      if (c === '"') { inQuotes = !inQuotes; continue; }
      if (c === ':' && !inQuotes) return { head: line.slice(0, i), value: line.slice(i + 1) };
    }
    return null;
  }

  function splitOnUnquotedSemicolons(head) {
    var parts = [];
    var cur = '';
    var inQuotes = false;
    for (var i = 0; i < head.length; i++) {
      var c = head.charAt(i);
      if (c === '"') { inQuotes = !inQuotes; cur += c; continue; }
      if (c === ';' && !inQuotes) { parts.push(cur); cur = ''; continue; }
      cur += c;
    }
    parts.push(cur);
    return parts;
  }

  function stripQuotes(v) {
    if (v.length >= 2 && v.charAt(0) === '"' && v.charAt(v.length - 1) === '"') return v.slice(1, -1);
    return v;
  }

  /** @returns {{name:string, params:Object, value:string}|null} */
  function parsePropertyLine(line) {
    if (!line) return null;
    var split = splitOnUnquotedColon(line);
    if (!split) return null; // no colon at all — not a valid content line
    var headParts = splitOnUnquotedSemicolons(split.head);
    var rawName = (headParts[0] || '').trim();
    if (!rawName) return null;
    // Strip a "group." prefix (RFC 5545 §3.1 groups) — rare, but harmless to drop.
    var dot = rawName.lastIndexOf('.');
    var name = (dot === -1 ? rawName : rawName.slice(dot + 1)).toUpperCase();
    var params = {};
    for (var i = 1; i < headParts.length; i++) {
      var eq = headParts[i].indexOf('=');
      if (eq === -1) continue;
      var pName = headParts[i].slice(0, eq).trim().toUpperCase();
      var pVal = stripQuotes(headParts[i].slice(eq + 1).trim());
      if (pName) params[pName] = pVal;
    }
    return { name: name, params: params, value: split.value };
  }

  // ---------- RFC 5545 §3.3.11 text value un-escaping ----------

  // Manual char-by-char scan (rather than sequential regex replaces) so an
  // already-unescaped backslash from one substitution can never be
  // re-consumed by a later substitution.
  function unescapeText(v) {
    if (v == null) return v;
    var out = '';
    for (var i = 0; i < v.length; i++) {
      var c = v.charAt(i);
      if (c === '\\' && i + 1 < v.length) {
        var n = v.charAt(i + 1);
        if (n === 'n' || n === 'N') { out += '\n'; i++; continue; }
        if (n === ',') { out += ','; i++; continue; }
        if (n === ';') { out += ';'; i++; continue; }
        if (n === '\\') { out += '\\'; i++; continue; }
        out += c; // unrecognized escape — keep the backslash literally
        continue;
      }
      out += c;
    }
    return out;
  }

  // ---------- DTSTART/DTEND ----------

  var UTC_DATETIME_RE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/;
  var LOCAL_DATETIME_RE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/;
  var DATE_ONLY_RE = /^(\d{4})(\d{2})(\d{2})$/;

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /** @returns {{raw:string, tzid:string|null, isUtc:boolean, date:Date|null, display:string}|null} */
  function parseDateProp(prop) {
    if (!prop) return null;
    var raw = (prop.value || '').trim();
    var tzid = prop.params && prop.params.TZID ? prop.params.TZID : null;
    var m = UTC_DATETIME_RE.exec(raw);
    if (m) {
      var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
      var ok = !isNaN(d.getTime());
      return {
        raw: raw, tzid: null, isUtc: true,
        date: ok ? d : null,
        display: ok ? (m[1] + '-' + m[2] + '-' + m[3] + ' ' + m[4] + ':' + m[5] + ':' + m[6] + ' UTC') : raw
      };
    }
    m = LOCAL_DATETIME_RE.exec(raw);
    if (m) {
      return {
        raw: raw, tzid: tzid, isUtc: false, date: null,
        display: m[1] + '-' + m[2] + '-' + m[3] + ' ' + m[4] + ':' + m[5] + ':' + m[6] + (tzid ? ' (' + tzid + ')' : ' (local time)')
      };
    }
    m = DATE_ONLY_RE.exec(raw);
    if (m) {
      return { raw: raw, tzid: tzid, isUtc: false, date: null, display: m[1] + '-' + m[2] + '-' + m[3] + ' (all day)' };
    }
    // Unrecognized shape — never throw, just surface the raw value verbatim.
    return { raw: raw, tzid: tzid, isUtc: false, date: null, display: raw || '(unknown)' };
  }

  // ---------- ORGANIZER / ATTENDEE ----------

  /** @returns {{name:string|null, email:string|null}|null} */
  function parseCalAddress(prop) {
    if (!prop) return null;
    var raw = (prop.value || '').trim();
    var email = null;
    if (/^mailto:/i.test(raw)) email = raw.slice(7).trim();
    else if (raw) email = raw;
    var name = prop.params && prop.params.CN ? prop.params.CN : null;
    if (!name && !email) return null;
    return { name: name || null, email: email || null };
  }

  // ---------- top-level entry point ----------

  /**
   * @param {string} text  Decoded iCalendar text (a text/calendar body part
   *   or the contents of a .ics attachment).
   * @returns {{ok:true, method:string|null, event:object} | {ok:false, reason:string}}
   */
  EV.parseIcs = function (text) {
    try {
      if (typeof text !== 'string' || !text.trim()) {
        return { ok: false, reason: 'empty input' };
      }
      var lines = unfoldLines(text);

      var beginIdx = -1, endIdx = -1;
      for (var i = 0; i < lines.length; i++) {
        var t = lines[i].trim().toUpperCase();
        if (beginIdx === -1 && t === 'BEGIN:VEVENT') { beginIdx = i; continue; }
        if (beginIdx !== -1 && t === 'END:VEVENT') { endIdx = i; break; }
      }
      if (beginIdx === -1) return { ok: false, reason: 'no VEVENT block found' };
      if (endIdx === -1) return { ok: false, reason: 'truncated calendar data (missing END:VEVENT)' };

      // METHOD is a calendar-level (VCALENDAR) property, so look outside the
      // VEVENT block for it — take the first occurrence found anywhere.
      var method = null;
      for (var j = 0; j < lines.length; j++) {
        if (j > beginIdx && j < endIdx) continue;
        var prop = parsePropertyLine(lines[j]);
        if (prop && prop.name === 'METHOD' && prop.value) { method = prop.value.trim().toUpperCase(); break; }
      }

      var summary = null, location = null, description = null, status = null;
      var dtstartProp = null, dtendProp = null, organizerProp = null;
      var attendees = [];

      for (var k = beginIdx + 1; k < endIdx; k++) {
        var p = parsePropertyLine(lines[k]);
        if (!p) continue; // malformed line inside the block — skip, don't abort the whole parse
        switch (p.name) {
          case 'SUMMARY': if (summary === null) summary = unescapeText(p.value); break;
          case 'LOCATION': if (location === null) location = unescapeText(p.value); break;
          case 'DESCRIPTION': if (description === null) description = unescapeText(p.value); break;
          case 'STATUS': if (status === null) status = (p.value || '').trim().toUpperCase(); break;
          case 'DTSTART': if (dtstartProp === null) dtstartProp = p; break;
          case 'DTEND': if (dtendProp === null) dtendProp = p; break;
          case 'ORGANIZER': if (organizerProp === null) organizerProp = p; break;
          case 'ATTENDEE': {
            var att = parseCalAddress(p);
            if (att) attendees.push(att);
            break;
          }
          default: break;
        }
      }

      var event = {
        summary: summary,
        location: location,
        description: description,
        status: status || null,
        dtstart: parseDateProp(dtstartProp),
        dtend: parseDateProp(dtendProp),
        organizer: parseCalAddress(organizerProp),
        attendees: attendees
      };

      return { ok: true, method: method, event: event };
    } catch (e) {
      // Defensive catch-all: untrusted input must never crash the UI.
      return { ok: false, reason: 'unexpected parse error: ' + (e && e.message ? e.message : String(e)) };
    }
  };

  // Exposed for tests / potential reuse — not otherwise used elsewhere.
  EV._icsUnfoldLines = unfoldLines;
  EV._icsUnescapeText = unescapeText;
})(typeof self !== 'undefined' ? self : this);
