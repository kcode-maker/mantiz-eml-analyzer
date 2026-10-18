/**
 * rawScan.test.js — Raw search (js/indexing/indexLogic.js's rawScanFile) searches the file's own bytes: the
 * text exactly as stored, i.e. UTF-8 text as UTF-8, and anything encoded (base64, quoted-printable, an RFC
 * 2047 "=?UTF-8?B?...?=" word, HTML entities) as that encoded text, never decoded. The regression this guards:
 * a query containing non-ASCII characters used to be compared against a one-char-per-byte view of the file,
 * so it could never match UTF-8 text that was plainly in the file. Run via tests/run-all.sh, or directly:
 * jsc tests/rawScan.test.js (from the repo root).
 */
load('tests/helpers/textdecoder_polyfill.js');
load('js/parsing/emlParser.js');
load('js/parsing/urlExtract.js');
load('js/parsing/headerTables.js');
load('js/indexing/anomalies.js');
load('js/indexing/indexLogic.js');
var EV = this.EV;
var pass = 0, fail = 0;
function assert(cond, label) { if (cond) pass++; else { fail++; print('FAIL: ' + label); } }

function utf8Bytes(str) {
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
function buf(bytes) { return new Uint8Array(bytes).buffer; }
function scan(bytes, query, extra) {
  var o = { query: query, caseSensitive: false, isRegex: false };
  for (var k in (extra || {})) o[k] = extra[k];
  return EV.rawScanFile(0, 'x.eml', buf(bytes), o);
}

var utf8Mail = utf8Bytes('Subject: Приглашение\r\nContent-Transfer-Encoding: 8bit\r\n\r\nПожалуйста подтвердите аккаунт 請確認您的帳戶 café\r\n');
assert(scan(utf8Mail, 'подтвердите'), 'Raw: a Cyrillic query finds UTF-8 text stored in the file');
assert(scan(utf8Mail, 'ПОДТВЕРДИТЕ'), 'Raw: ...case-insensitively, for non-ASCII letters too');
assert(!scan(utf8Mail, 'ПОДТВЕРДИТЕ', { caseSensitive: true }), 'Raw: Match Case is exact for non-ASCII letters');
assert(scan(utf8Mail, '帳戶'), 'Raw: a CJK query finds UTF-8 text');
assert(scan(utf8Mail, 'Приглашение'), 'Raw: ...also in a header that is raw UTF-8');
assert(scan(utf8Mail, 'café'), 'Raw: accented Latin text stored as UTF-8');
assert(scan(utf8Mail, 'подтвердите').snippets[0].snippet.indexOf('подтвердите') !== -1, 'Raw: the snippet shows readable text, not mojibake');
assert(scan(utf8Mail, 'Content-Transfer-Encoding') && scan(utf8Mail, 'content-transfer-encoding'), 'Raw: ASCII queries still work and stay case-insensitive');
assert(scan(utf8Mail, 'аккаунт 帳戶') === null, 'Raw: words that are not next to each other do not match as a phrase');
assert(scan(utf8Mail, 'аккаунт 請確認'), 'Raw: ...but the same words when they are contiguous do');
assert(scan(utf8Mail, 'аккаунт\\s+請', { isRegex: true }), 'Raw: a regex with non-ASCII characters matches UTF-8 text');

// Legacy 8-bit mail: the byte for "é" is 0xE9, not UTF-8 -- a Latin-1-expressible query still finds it
var latin1Mail = [].slice.call(new Uint8Array(buf(utf8Bytes('Subject: x\r\n\r\nVisit our caf'))));
latin1Mail.push(0xE9);
latin1Mail = latin1Mail.concat(utf8Bytes(' for br')).concat([0xFB]).concat(utf8Bytes('lée'.slice(0, 0) + 'l'));
assert(scan(latin1Mail, 'café'), 'Raw: "café" finds a Latin-1 encoded e-acute (single byte 0xE9) too');

// Encoded text is searched AS ENCODED, never decoded
var enc = utf8Bytes('Subject: =?UTF-8?B?0KHRh9GR0YIg0L7Qv9C70LDRgtGD?=\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nr=C3=A9sum=C3=A9 caf=C3=A9\r\n');
assert(scan(enc, '=?UTF-8?B?') && scan(enc, '0KHRh9GR0YIg'), 'Raw: an encoded-word is found by its encoded text');
assert(!scan(enc, 'Счёт'), 'Raw: ...but NOT by its decoded meaning (that is what Decoded search is for)');
assert(scan(enc, '=C3=A9') && !scan(enc, 'résumé'), 'Raw: quoted-printable bytes match as written, the decoded word does not');

// Robustness
assert(scan(utf8Bytes('x'), '(', { isRegex: true }).error, 'Raw: an invalid regex reports an error rather than throwing');
assert(scan(utf8Bytes('nothing here'), 'оплату') === null, 'Raw: no match returns null');

print('---');
print('PASS: ' + pass + '  FAIL: ' + fail);
if (fail > 0) throw new Error(fail + ' test(s) failed');
