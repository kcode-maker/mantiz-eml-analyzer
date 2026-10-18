/**
 * headerDecode.test.js — EV.decodeHeaderForDisplay and the decoders under it (js/parsing/emlParser.js): what the Headers
 * tab's "All headers" table shows must be the decoded text, whatever way the sender encoded it: RFC 2047 encoded words
 * (B/Q, any charset, split across words, language tags, missing padding), RFC 2231 parameters (percent-encoded, with a charset,
 * split into continuations), raw UTF-8 bytes, UTF-7. Also covers the parser paths that share these decoders (attachment
 * filenames) and hostile input. Run via tests/run-all.sh, or directly: jsc tests/headerDecode.test.js (from the repo root).
 */
load('tests/helpers/textdecoder_polyfill.js');
load('js/parsing/emlParser.js');
var EV = this.EV;
var pass = 0, fail = 0;
function assert(cond, label) { if (cond) pass++; else { fail++; print('FAIL: ' + label); } }
function is(actual, expected, label) { assert(actual === expected, label + '  got ' + JSON.stringify(actual) + '  expected ' + JSON.stringify(expected)); }

// ---- helpers: UTF-8 encode a string, base64 it, and percent-encode bytes ----
function utf8(str) {
  var out = [];
  for (var i = 0; i < str.length; i++) {
    var c = str.codePointAt(i);
    if (c > 0xFFFF) i++;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}
var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function b64(bytes, pad) {
  var s = '';
  for (var i = 0; i < bytes.length; i += 3) {
    var n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? B64[n & 63] : '=');
  }
  return pad === false ? s.replace(/=+$/, '') : s;
}
function pct(bytes) { return bytes.map(function (b) { return '%' + (b < 16 ? '0' : '') + b.toString(16).toUpperCase(); }).join(''); }
function binstr(str) { return utf8(str).map(function (b) { return String.fromCharCode(b); }).join(''); } // what the parser holds for raw header bytes
var D = EV.decodeHeaderForDisplay;

// ================= RFC 2047 encoded words =================
is(D('=?UTF-8?B?' + b64(utf8('Счёт на оплату')) + '?='), 'Счёт на оплату', 'B-encoded UTF-8 word');
is(D('=?utf-8?Q?Caf=C3=A9_Cr=C3=A8me?='), 'Café Crème', 'Q-encoded UTF-8 word, underscores are spaces');
is(D('=?iso-8859-1?Q?Andr=E9_Dupont?='), 'André Dupont', 'ISO-8859-1 Q word');
is(D('=?UTF-8?b?' + b64(utf8('hello')) + '?='), 'hello', 'lower-case encoding letter');
is(D('=?UTF-8?B?' + b64(utf8('padding dropped!!'), false) + '?='), 'padding dropped!!', 'base64 without its = padding');
is(D('=?UTF-8?B?' + b64(utf8('Привет')) + '?= <ivan@example.com>'), 'Привет <ivan@example.com>', 'word followed by plain text');
is(D('"=?UTF-8?B?' + b64(utf8('Иван')) + '?=" <i@x.com>'), '"Иван" <i@x.com>', 'word inside quotes (not allowed by the RFC, common in real mail)');
is(D('Re: =?UTF-8?Q?caf=C3=A9?= menu'), 'Re: café menu', 'plain text on both sides of a word');
is(D('=?UTF-8?Q?a?= =?UTF-8?Q?b?='), 'ab', 'whitespace between two encoded words disappears');
is(D('=?UTF-8?Q?a?=\r\n =?UTF-8?Q?b?='), 'ab', 'a folded line between two words disappears too');
is(D('=?UTF-8?Q?a?= x =?UTF-8?Q?b?='), 'a x b', 'text between words is kept');
// a multi-byte character cut in two across words must be decoded as ONE character
var euro = utf8('€'); // E2 82 AC
is(D('=?UTF-8?B?' + b64([0x68, euro[0], euro[1]]) + '?= =?UTF-8?B?' + b64([euro[2], 0x69]) + '?='), 'h€i', 'a character split across two B words');
is(D('=?UTF-8?Q?h=E2=82?= =?UTF-8?Q?=ACi?='), 'h€i', 'a character split across two Q words');
is(D('=?UTF-8?Q?a?= =?ISO-8859-1?Q?=E9?='), 'aé', 'adjacent words with different charsets are decoded separately');
is(D('=?utf-8*en?Q?hello?='), 'hello', 'RFC 2231 language tag on the charset');
is(D('=?UTF-8?B?!!!not-base64!!!?='), '=?UTF-8?B?!!!not-base64!!!?=', 'an undecodable word stays as written');
is(D('=?x-unknown-charset?Q?caf=C3=A9?='), 'café', 'an unknown charset falls back to UTF-8');
is(D('=?UTF-7?Q?Hi_Mom_-+Jjo--!?='), 'Hi Mom -☺-!', 'a UTF-7 word is decoded (a classic filter-evasion trick)');
is(D('=?utf-8?Q??='), '', 'an empty word');
is(D('=? ?= =?broken'), '=? ?= =?broken', 'broken markers are left alone');

// ================= raw bytes in a header =================
is(D(binstr('Привет мир')), 'Привет мир', 'raw UTF-8 bytes (no encoding) are decoded');
is(D(binstr('Zoë') + ' =?UTF-8?Q?=C3=A9?='), 'Zoë é', 'raw UTF-8 next to an encoded word');
is(D('Привет'), 'Привет', 'text that is already real Unicode is not corrupted');
is(D('café'), 'café', 'a Latin-1 character that is not valid UTF-8 as bytes is left as is');
is(D('plain ascii value'), 'plain ascii value', 'plain ASCII is returned unchanged');
is(D(''), '', 'empty'); is(D(null), '', 'null'); is(D(undefined), '', 'undefined');

// ================= RFC 2231 parameters =================
is(D("attachment; filename*=utf-8''" + pct(utf8('€ rates.pdf'))), 'attachment; filename="€ rates.pdf"', 'filename*= percent-encoded UTF-8');
is(D("attachment; filename*=iso-8859-1''%E9t%E9.pdf"), 'attachment; filename="été.pdf"', 'filename*= with an ISO-8859-1 charset');
is(D("attachment; filename*=UTF-8'en'%E2%82%AC.pdf"), 'attachment; filename="€.pdf"', 'with a language tag');
is(D("attachment; filename*0*=utf-8''%E2%82; filename*1*=%AC.pdf"), 'attachment; filename="€.pdf"', 'continuations: a character split across segments');
is(D("attachment; filename*0=\"report-\"; filename*1*=%C3%A9.pdf"), 'attachment; filename="report-é.pdf"', 'plain and extended continuations mixed');
is(D("attachment; filename*1*=%AC.pdf; filename*0*=utf-8''%E2%82"), 'attachment; filename="€.pdf"', 'continuations out of order');
is(D("inline; filename*0*=utf-8''a%20b; filename*1*=%20c; size=12"), 'inline; filename="a b c"; size=12', 'other parameters after the group are kept');
is(D("attachment; filename=\"plain.pdf\"; size=1"), 'attachment; filename="plain.pdf"; size=1', 'ordinary parameters are untouched');
var ct = 'multipart/mixed; boundary="----=_Part_1"; charset=utf-8';
is(D(ct), ct, 'a Content-Type without encoded parameters is returned unchanged');
is(D("text/plain; name*=utf-8''%D0%BF.txt; charset=utf-8"), 'text/plain; name="п.txt"; charset=utf-8', 'name*= in Content-Type');
is(D("a; x*=utf-8''100%25"), 'a; x="100%"', 'an escaped percent sign');
is(D("a; x*=utf-8''bad%ZZescape"), 'a; x="bad%ZZescape"', 'a malformed escape is kept, not thrown on');
is(D('a; k*0="1"; k*1="2"; k*2="3"'), 'a; k="123"', 'plain (not extended) continuations are joined');

// ================= hostile / large input never throws and stays bounded =================
var big = ''; for (var i = 0; i < 3000; i++) big += '=?UTF-8?Q?x?= ';
var t0 = Date.now(); var r = D(big);
assert(typeof r === 'string' && r.trim().length === 3000 && Date.now() - t0 < 1500, 'three thousand encoded words decode quickly (' + (Date.now() - t0) + 'ms)');
var manyParams = 'a'; for (var j = 0; j < 500; j++) manyParams += "; p" + j + "*=utf-8''%41";
assert(typeof D(manyParams) === 'string', 'hundreds of extended parameters do not throw');
['=?', '?=', '=?a?', '=?a?b?c', '=?UTF-8?B?', ';*=', '; *=', "; a*=''", "; a*0*=", '%', '*', '; x*=utf-8\'\'%', '\u0000\u0001'].forEach(function (junk) {
  var ok = true; try { D(junk); D('x; ' + junk); } catch (e) { ok = false; }
  assert(ok, 'junk input does not throw: ' + JSON.stringify(junk));
});

// ================= the parser paths that share these decoders =================
function mail(headerLines, body) { var s = headerLines.join('\r\n') + '\r\n\r\n' + (body || ''); var a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 255; return a.buffer; }
function attachmentName(dispositionLines) {
  var p = EV.parseEml(mail(['From: a@b.com', 'To: c@d.org', 'Subject: x', 'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="B"', '',
    '--B', 'Content-Type: text/plain', '', 'hi', '--B', 'Content-Type: application/pdf'].concat(dispositionLines, ['Content-Transfer-Encoding: base64', '', 'JVBERg==', '--B--'])));
  return p.attachments.length ? p.attachments[0].filename : null;
}
is(attachmentName(["Content-Disposition: attachment; filename*=iso-8859-1''%E9t%E9.pdf"]), 'été.pdf', 'attachment filename in ISO-8859-1 (was shown as garbage / lost)');
is(attachmentName(["Content-Disposition: attachment; filename*0*=utf-8''%E2%82; filename*1*=%AC.pdf"]), '€.pdf', 'attachment filename with a character split across continuations');
is(attachmentName(["Content-Disposition: attachment; filename*=utf-8''" + pct(utf8('Счёт.pdf'))]), 'Счёт.pdf', 'attachment filename percent-encoded UTF-8 still works');
is(attachmentName(['Content-Disposition: attachment; filename="=?UTF-8?B?' + b64(utf8('Счёт.pdf')) + '?="']), 'Счёт.pdf', 'attachment filename as an RFC 2047 word still works');
var parsed = EV.parseEml(mail(['From: =?UTF-8?B?' + b64(utf8('Иван Петров')) + '?= <i@x.com>', 'To: a@b.com', 'Subject: =?UTF-8?B?' + b64([0x68, euro[0], euro[1]]) + '?= =?UTF-8?B?' + b64([euro[2], 0x69]) + '?=', ''], 'body'));
is(parsed.subject, 'h€i', 'the parsed Subject also benefits from joining split words');
is(parsed.from[0].name, 'Иван Петров', 'the parsed From name is decoded');
is(EV.decodeHeaderText('=?UTF-8?Q?a?= =?UTF-8?Q?b?='), 'ab', 'decodeHeaderText still joins adjacent words');
is(EV.decodeTextBytes(new Uint8Array(utf8('Привет')), 'utf-8'), 'Привет', 'decodeTextBytes UTF-8 unchanged');
is(EV.decodeTextBytes(new Uint8Array([0x2b, 0x4a, 0x6a, 0x6f, 0x2d]), 'utf-7'), '☺', 'decodeTextBytes understands UTF-7');
is(EV.decodeTextBytes(new Uint8Array([0x41, 0x2b, 0x2d, 0x42]), 'unicode-1-1-utf-7'), 'A+B', 'UTF-7 "+-" is a literal plus');

print('---');
print('PASS: ' + pass + '  FAIL: ' + fail);
if (fail > 0) throw new Error(fail + ' test(s) failed');
