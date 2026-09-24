/**
 * emlParser.js — dependency-free RFC 5322 / RFC 2045-2047 email parser.
 *
 * Works unmodified in the main thread, in a Web Worker, or in any JS engine
 * that provides TextDecoder + atob + Uint8Array (feature-detected by callers).
 *
 * All byte-level work happens through a "binary string" (one JS UTF-16 code
 * unit per input byte, via bytesToBinaryString/binaryStringToBytes) so raw
 * MIME structure (headers, boundaries, transfer encodings) can be parsed
 * with plain string operations without ever corrupting the underlying bytes.
 * Only leaf text parts are finally decoded to real Unicode text, using the
 * charset declared on that part (via TextDecoder).
 */
(function (g) {
  'use strict';
  var EV = g.EV || (g.EV = {});

  // ---------- byte <-> binary-string helpers ----------

  function bytesToBinaryString(bytes) {
    var CHUNK = 0x8000;
    var result = '';
    for (var i = 0; i < bytes.length; i += CHUNK) {
      result += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
    }
    return result;
  }

  function binaryStringToBytes(str) {
    var bytes = new Uint8Array(str.length);
    for (var i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i) & 0xff;
    return bytes;
  }

  EV.bytesToBinaryString = bytesToBinaryString;
  EV.binaryStringToBytes = binaryStringToBytes;

  // ---------- charset decoding ----------

  var decoderCache = {};
  function normalizeCharsetLabel(label) {
    if (!label) return 'utf-8';
    var l = label.trim().toLowerCase().replace(/^["']|["']$/g, '');
    if (l === 'ascii' || l === 'us-ascii' || l === 'ansi_x3.4-1968') return 'windows-1252';
    if (l === 'utf8') return 'utf-8';
    if (l === 'unicode-1-1-utf-7') return 'utf-8';
    return l;
  }

  function decodeTextBytes(bytes, charsetLabel) {
    var label = normalizeCharsetLabel(charsetLabel);
    var order = [label, 'utf-8', 'windows-1252'];
    for (var i = 0; i < order.length; i++) {
      var name = order[i];
      try {
        var dec = decoderCache[name];
        if (!dec) {
          dec = new TextDecoder(name, { fatal: false });
          decoderCache[name] = dec;
        }
        return dec.decode(bytes);
      } catch (e) {
        continue;
      }
    }
    // last resort: latin1 passthrough
    return bytesToBinaryString(bytes);
  }

  EV.decodeTextBytes = decodeTextBytes;

  // ---------- RFC 2047 encoded-word decoding (headers) ----------

  var ENC_WORD_RE = /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g;

  function decodeEncodedWords(str) {
    if (!str || str.indexOf('=?') === -1) return str;
    // collapse whitespace that sits *only* between two adjacent encoded-words
    var collapsed = str.replace(/\?=[ \t\r\n]+=\?/g, '?==?');
    return collapsed.replace(ENC_WORD_RE, function (m, charset, enc, data) {
      try {
        var bytes;
        if (enc.toLowerCase() === 'b') {
          bytes = binaryStringToBytes(atob(data.replace(/\s+/g, '')));
        } else {
          bytes = qpDecodeToBytes(data.replace(/_/g, ' '), true);
        }
        return decodeTextBytes(bytes, charset);
      } catch (e) {
        return m;
      }
    });
  }

  EV.decodeEncodedWords = decodeEncodedWords;

  /**
   * RFC 5322 technically requires header values to be 7-bit ASCII (non-ASCII
   * text must be RFC 2047 encoded-word wrapped), but plenty of real-world
   * senders — including phishing kits deliberately trying to slip
   * invisible/homoglyph characters past scanners that only decode proper
   * encoded-words — just emit raw UTF-8 bytes directly. If a header has no
   * encoded-word markers at all but does have high-bit bytes, try decoding
   * the whole thing as UTF-8 before giving up and leaving it as raw latin1.
   */
  function decodeHeaderText(str) {
    if (!str) return str;
    if (str.indexOf('=?') !== -1) return decodeEncodedWords(str);
    var hasHighBit = false;
    for (var i = 0; i < str.length; i++) {
      if (str.charCodeAt(i) > 127) { hasHighBit = true; break; }
    }
    if (!hasHighBit) return str;
    try {
      var bytes = binaryStringToBytes(str);
      var dec = new TextDecoder('utf-8', { fatal: true });
      return dec.decode(bytes);
    } catch (e) {
      return str; // not valid UTF-8 either — leave as-is rather than guess
    }
  }

  EV.decodeHeaderText = decodeHeaderText;

  // ---------- quoted-printable ----------

  function qpDecodeToBytes(str, isHeaderWord) {
    var joined = isHeaderWord ? str : str.replace(/=\n/g, '').replace(/=$/, '');
    var bytes = [];
    for (var i = 0; i < joined.length; i++) {
      var c = joined[i];
      if (c === '=' && i + 2 < joined.length) {
        var hex = joined.substr(i + 1, 2);
        if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
          bytes.push(parseInt(hex, 16));
          i += 2;
          continue;
        }
      }
      bytes.push(c.charCodeAt(0) & 0xff);
    }
    return new Uint8Array(bytes);
  }

  // ---------- header parsing ----------

  function parseHeaderLines(headerLines) {
    var headers = [];
    for (var i = 0; i < headerLines.length; i++) {
      var line = headerLines[i];
      if (/^[ \t]/.test(line)) {
        if (headers.length) {
          headers[headers.length - 1].value += ' ' + line.replace(/^[ \t]+/, '').trimEnd();
        }
        continue;
      }
      var idx = line.indexOf(':');
      if (idx === -1) continue;
      headers.push({
        name: line.slice(0, idx).trim(),
        lower: line.slice(0, idx).trim().toLowerCase(),
        value: line.slice(idx + 1).replace(/^[ \t]+/, '').trimEnd()
      });
    }
    return headers;
  }

  function getHeader(headers, lowerName) {
    for (var i = 0; i < headers.length; i++) {
      if (headers[i].lower === lowerName) return headers[i].value;
    }
    return null;
  }

  function getHeaderAll(headers, lowerName) {
    var out = [];
    for (var i = 0; i < headers.length; i++) {
      if (headers[i].lower === lowerName) out.push(headers[i].value);
    }
    return out;
  }

  EV.getHeader = getHeader;
  EV.getHeaderAll = getHeaderAll;

  // ---------- Content-Type / Content-Disposition parameter parsing ----------

  // RFC 2231 §3: a long parameter value (typically filename*) can be split
  // across several params — filename*0, filename*1, filename*2, ... — each
  // independently marked as extended-encoded (a trailing '*') or plain.
  // Reassembling these in order is what extractFilename() needs to recover
  // the real filename instead of falling back to a synthesized "attachment-N"
  // name for any message whose filename needed continuation (long/non-ASCII
  // names commonly do).
  function parseParams(rest) {
    var params = {};
    var decodedKeys = {};
    if (!rest) { markDecodedKeys(params, decodedKeys); return params; }
    var re = /;\s*([a-zA-Z0-9\-]+)(\*[0-9]+)?(\*)?\s*=\s*("([^"]*)"|[^;]+)/g;
    var m;
    var continuations = {};
    while ((m = re.exec(rest))) {
      var baseKey = m[1].toLowerCase();
      var contIdx = m[2] ? parseInt(m[2].slice(1), 10) : null;
      var isExtended = !!m[3];
      var rawVal = m[5] !== undefined ? m[5] : m[4].trim();
      if (contIdx !== null) {
        if (!continuations[baseKey]) continuations[baseKey] = {};
        continuations[baseKey][contIdx] = { encoded: isExtended, raw: rawVal };
        continue;
      }
      var val = rawVal;
      if (isExtended) {
        var parts = rawVal.split("'");
        if (parts.length === 3) {
          try { val = decodeURIComponent(parts[2]); decodedKeys[baseKey] = true; } catch (e) { val = rawVal; }
        }
      }
      if (!(baseKey in params)) params[baseKey] = val;
    }
    Object.keys(continuations).forEach(function (baseKey) {
      if (baseKey in params) return; // a plain/single-extended value already claimed this key
      var segs = continuations[baseKey];
      var indices = Object.keys(segs).map(Number).sort(function (a, b) { return a - b; });
      var out = '';
      var anyDecoded = false;
      indices.forEach(function (idx) {
        var seg = segs[idx];
        var val = seg.raw;
        if (seg.encoded) {
          // Only the first encoded segment carries the charset'lang' prefix;
          // later segments are pure percent-encoded continuations of it.
          var parts = val.split("'");
          if (idx === indices[0] && parts.length === 3) val = parts[2];
          try { val = decodeURIComponent(val); anyDecoded = true; } catch (e) { /* keep this segment raw on decode failure */ }
        }
        out += val;
      });
      params[baseKey] = out;
      if (anyDecoded) decodedKeys[baseKey] = true;
    });
    markDecodedKeys(params, decodedKeys);
    return params;
  }

  // Params whose value already went through decodeURIComponent (RFC 2231
  // extended/continuation encoding) are already a proper Unicode string —
  // running them through decodeHeaderText()'s "guess it's raw UTF-8 bytes"
  // fallback a second time would corrupt any non-ASCII character in them.
  // Stashed as non-enumerable so it never shows up as a fake header param.
  function markDecodedKeys(params, decodedKeys) {
    Object.defineProperty(params, '__rfc2231Decoded', { value: decodedKeys, enumerable: false });
  }

  function parseContentType(raw) {
    if (!raw) return { type: 'text/plain', params: {} };
    var semi = raw.indexOf(';');
    var typePart = (semi === -1 ? raw : raw.slice(0, semi)).trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9.\-]*\/[a-z0-9][a-z0-9.\-+]*$/.test(typePart)) typePart = 'text/plain';
    var params = parseParams(semi === -1 ? '' : raw.slice(semi));
    return { type: typePart, params: params };
  }

  function parseDisposition(raw) {
    if (!raw) return null;
    var semi = raw.indexOf(';');
    var type = (semi === -1 ? raw : raw.slice(0, semi)).trim().toLowerCase();
    var params = parseParams(semi === -1 ? '' : raw.slice(semi));
    return { type: type, params: params };
  }

  function decodeParamText(v) {
    if (!v) return v;
    return decodeHeaderText(v);
  }

  function extractFilename(ctypeParams, disp) {
    var dispParams = disp && disp.params;
    var name, alreadyDecoded;
    if (dispParams && dispParams.filename) {
      name = dispParams.filename; alreadyDecoded = dispParams.__rfc2231Decoded && dispParams.__rfc2231Decoded.filename;
    } else if (dispParams && dispParams.name) {
      name = dispParams.name; alreadyDecoded = dispParams.__rfc2231Decoded && dispParams.__rfc2231Decoded.name;
    } else if (ctypeParams && ctypeParams.name) {
      name = ctypeParams.name; alreadyDecoded = ctypeParams.__rfc2231Decoded && ctypeParams.__rfc2231Decoded.name;
    } else {
      return null;
    }
    return alreadyDecoded ? name : decodeParamText(name);
  }

  // ---------- multipart boundary splitting (line-based) ----------

  function splitMultipartLines(bodyLines, boundary) {
    var open = '--' + boundary;
    var close = open + '--';
    var marks = [];
    var lastCloseIdx = -1;
    for (var i = 0; i < bodyLines.length; i++) {
      var l = bodyLines[i].replace(/[ \t]+$/, '');
      if (l === close) { lastCloseIdx = i; continue; }
      if (l === open) marks.push({ i: i });
    }
    // A nested part that (invalidly, but possibly adversarially) reuses this
    // same boundary string can produce its OWN close-looking line before the
    // true top-level close — stopping at the *first* such line (as this used
    // to) would silently discard every real part after it. Using the *last*
    // close line instead, and only counting open markers strictly before it,
    // keeps the rest of the message visible even when boundaries collide
    // across nesting levels.
    if (lastCloseIdx !== -1) marks = marks.filter(function (m) { return m.i < lastCloseIdx; });
    var parts = [];
    for (var k = 0; k < marks.length; k++) {
      var partStart = marks[k].i + 1;
      var partEnd = (k + 1 < marks.length) ? marks[k + 1].i : (lastCloseIdx !== -1 ? lastCloseIdx : bodyLines.length);
      var partLines = bodyLines.slice(partStart, partEnd);
      var blank = partLines.indexOf('');
      if (blank === -1) blank = partLines.length;
      parts.push({ headerLines: partLines.slice(0, blank), bodyLines: partLines.slice(blank + 1) });
    }
    return parts;
  }

  // ---------- MIME entity tree ----------

  var MAX_DEPTH = 20;

  function parseEntity(headerLines, bodyLines, depth) {
    var headers = parseHeaderLines(headerLines);
    var ctypeRaw = getHeader(headers, 'content-type');
    var ct = parseContentType(ctypeRaw);
    var cte = (getHeader(headers, 'content-transfer-encoding') || '7bit').trim().toLowerCase();
    var disp = parseDisposition(getHeader(headers, 'content-disposition'));
    var cidRaw = getHeader(headers, 'content-id');
    var contentId = cidRaw ? cidRaw.replace(/^<|>$/g, '').trim() : null;

    if (ct.type.indexOf('multipart/') === 0 && ct.params.boundary && depth < MAX_DEPTH) {
      var rawParts = splitMultipartLines(bodyLines, ct.params.boundary);
      if (rawParts.length === 0) {
        // malformed/no boundary matches found — treat as opaque leaf so we don't lose the content
      } else {
        var children = [];
        for (var i = 0; i < rawParts.length; i++) {
          children.push(parseEntity(rawParts[i].headerLines, rawParts[i].bodyLines, depth + 1));
        }
        return { type: ct.type, params: ct.params, headers: headers, multipart: true, children: children };
      }
    }

    var bodyStr = bodyLines.join('\n');
    var bytes;
    var decodeFailed = false;
    if (cte === 'base64') {
      var cleaned = bodyStr.replace(/[^A-Za-z0-9+/=]/g, '');
      var bin = '';
      try {
        bin = atob(cleaned);
      } catch (e) {
        bin = '';
        // A corrupt or deliberately-malformed base64 part must not silently
        // look like an empty, uninteresting part — surface it (see
        // decodeWarnings on the parsed result) so it reads as "couldn't be
        // decoded" rather than "there was nothing here."
        decodeFailed = !!cleaned;
      }
      bytes = binaryStringToBytes(bin);
    } else if (cte === 'quoted-printable') {
      bytes = qpDecodeToBytes(bodyStr, false);
    } else {
      bytes = binaryStringToBytes(bodyStr);
    }

    return {
      type: ct.type,
      params: ct.params,
      headers: headers,
      multipart: false,
      disp: disp,
      contentId: contentId,
      filename: extractFilename(ct.params, disp),
      bytes: bytes,
      decodeFailed: decodeFailed
    };
  }

  function flattenLeaves(entity, out) {
    if (entity.multipart) {
      for (var i = 0; i < entity.children.length; i++) flattenLeaves(entity.children[i], out);
    } else {
      out.push(entity);
    }
  }

  function deriveParts(flat) {
    var textParts = [], htmlParts = [];
    var attachments = [];
    var decodeWarnings = [];
    var counter = 0;
    for (var i = 0; i < flat.length; i++) {
      var leaf = flat[i];
      var isAttachmentDisposition = !!(leaf.disp && leaf.disp.type === 'attachment');
      var hasFilename = !!leaf.filename;
      if (leaf.decodeFailed) {
        decodeWarnings.push({ filename: leaf.filename || null, mimeType: leaf.type });
      }
      if (!isAttachmentDisposition && !hasFilename && leaf.type === 'text/plain') {
        textParts.push(decodeTextBytes(leaf.bytes, leaf.params.charset));
        continue;
      }
      if (!isAttachmentDisposition && !hasFilename && leaf.type === 'text/html') {
        htmlParts.push(decodeTextBytes(leaf.bytes, leaf.params.charset));
        continue;
      }
      counter++;
      attachments.push({
        filename: leaf.filename || ('attachment-' + counter + guessExtension(leaf.type)),
        mimeType: leaf.type,
        contentId: leaf.contentId,
        isInline: !!(leaf.disp && leaf.disp.type === 'inline') || (!!leaf.contentId && !isAttachmentDisposition),
        size: leaf.bytes.length,
        bytes: leaf.bytes
      });
    }
    return {
      textBody: textParts.length ? textParts.join('\n\n') : null,
      htmlBody: htmlParts.length ? htmlParts.join('<hr>') : null,
      attachments: attachments,
      decodeWarnings: decodeWarnings
    };
  }

  function guessExtension(mime) {
    var map = {
      'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp',
      'application/pdf': '.pdf', 'text/plain': '.txt', 'text/html': '.html',
      'application/zip': '.zip', 'application/octet-stream': '.bin', 'message/rfc822': '.eml'
    };
    return map[mime] || '.bin';
  }

  // ---------- address list parsing ----------

  // Real "name <addr>" segments are far shorter than this. If an unmatched
  // '<' stays open longer than this many characters, it's almost certainly
  // a stray character in a malformed (or adversarial) header rather than a
  // real delimiter — force a resync so it can only swallow roughly one
  // bogus segment instead of every recipient after it.
  var MAX_UNCLOSED_ANGLE_SPAN = 320;

  function parseAddressList(raw) {
    if (!raw) return [];
    var decoded = decodeHeaderText(raw);
    var addrs = [];
    var inQuotes = false, angle = 0, cur = '', openIdx = -1;
    for (var i = 0; i < decoded.length; i++) {
      if (angle > 0 && (i - openIdx) > MAX_UNCLOSED_ANGLE_SPAN) {
        addrs.push(cur);
        cur = '';
        angle = 0;
        inQuotes = false;
      }
      var c = decoded[i];
      if (c === '"') {
        inQuotes = !inQuotes;
        cur += c;
        continue;
      }
      if (!inQuotes && c === '<') { if (angle === 0) openIdx = i; angle++; }
      if (!inQuotes && c === '>') angle = Math.max(0, angle - 1);
      if (!inQuotes && angle === 0 && c === ',') {
        addrs.push(cur);
        cur = '';
        continue;
      }
      cur += c;
    }
    if (cur.trim()) addrs.push(cur);
    var out = [];
    for (var j = 0; j < addrs.length; j++) {
      var one = parseOneAddress(addrs[j]);
      if (one) out.push(one);
    }
    return out;
  }

  function parseOneAddress(str) {
    str = str.trim();
    if (!str) return null;
    var m = str.match(/^(.*)<([^<>]+)>\s*$/);
    if (m) {
      var name = m[1].trim().replace(/^"|"$/g, '').trim();
      return { name: name, address: m[2].trim() };
    }
    var bare = str.replace(/\([^)]*\)/g, '').trim();
    if (!bare) return null;
    return { name: '', address: bare };
  }

  EV.parseAddressList = parseAddressList;

  function fnv1a(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    return h.toString(16);
  }

  /** Stable id for a parsed email: prefer Message-ID, else a fast content hash. */
  EV.emailId = function (parsed) {
    if (parsed.messageId) return 'mid:' + parsed.messageId;
    var raw = parsed.raw || '';
    var sample = raw.length > 20000 ? raw.slice(0, 10000) + raw.slice(-10000) : raw;
    return 'hash:' + fnv1a(sample) + ':' + parsed.byteLength;
  };

  // ---------- Authentication-Results summary ----------

  function summarizeAuth(headers) {
    var authHeaders = getHeaderAll(headers, 'authentication-results');
    var combined = authHeaders.join(' ; ');
    var summary = { spf: null, dkim: null, dmarc: null, raw: authHeaders };
    var re = /\b(spf|dkim|dmarc)\s*=\s*([a-zA-Z]+)/gi;
    var m;
    while ((m = re.exec(combined))) {
      var key = m[1].toLowerCase();
      if (summary[key] === null) summary[key] = m[2].toLowerCase();
    }
    return summary;
  }

  // ---------- public entry point ----------

  /**
   * @param {ArrayBuffer|Uint8Array} data
   * @returns {object} parsed email
   */
  EV.parseEml = function (data) {
    var bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    var raw = bytesToBinaryString(bytes);
    var norm = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    var allLines = norm.split('\n');
    var blank = allLines.indexOf('');
    if (blank === -1) blank = allLines.length;
    var headerLines = allLines.slice(0, blank);
    var bodyLines = allLines.slice(blank + 1);

    var entity = parseEntity(headerLines, bodyLines, 0);
    var flat = [];
    flattenLeaves(entity, flat);
    var parts = deriveParts(flat);

    var headers = entity.headers;
    var subject = decodeHeaderText(getHeader(headers, 'subject') || '');
    var dateRaw = getHeader(headers, 'date');
    var date = null;
    if (dateRaw) {
      var d = new Date(dateRaw);
      if (!isNaN(d.getTime())) date = d;
    }
    var messageId = (getHeader(headers, 'message-id') || '').replace(/^<|>$/g, '').trim() || null;

    return {
      headers: headers,
      subject: subject,
      from: parseAddressList(getHeader(headers, 'from')),
      to: parseAddressList(getHeaderAll(headers, 'to').join(',')),
      cc: parseAddressList(getHeaderAll(headers, 'cc').join(',')),
      bcc: parseAddressList(getHeaderAll(headers, 'bcc').join(',')),
      replyTo: parseAddressList(getHeader(headers, 'reply-to')),
      date: date,
      dateRaw: dateRaw,
      messageId: messageId,
      inReplyTo: (getHeader(headers, 'in-reply-to') || '').trim() || null,
      references: (getHeader(headers, 'references') || '').trim() || null,
      textBody: parts.textBody,
      htmlBody: parts.htmlBody,
      attachments: parts.attachments,
      decodeWarnings: parts.decodeWarnings || [],
      authSummary: summarizeAuth(headers),
      raw: raw,
      byteLength: bytes.length
    };
  };
})(typeof self !== 'undefined' ? self : this);
