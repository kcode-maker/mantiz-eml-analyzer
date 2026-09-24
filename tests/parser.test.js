/**
 * parser.test.js — regression coverage for js/parsing/emlParser.js: the 5 real
 * fixture files still parse correctly, plus one test per bug fixed this
 * session (address-list bound recovery, MIME boundary-reuse handling,
 * base64 decode-failure warnings, RFC 2231 filename continuation
 * reassembly, and the single-segment filename*= double-decode fix that
 * surfaced while testing the continuation fix). Run via tests/run-all.sh,
 * or directly: jsc tests/parser.test.js (from the repo root).
 */
load('tests/helpers/textdecoder_polyfill.js');
load('js/parsing/emlParser.js');

var EV = this.EV;
var pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; }
  else { fail++; print('FAIL: ' + label); }
}
function strToBuf(s) {
  var arr = new Uint8Array(s.length);
  for (var i = 0; i < s.length; i++) arr[i] = s.charCodeAt(i) & 0xff;
  return arr.buffer;
}

// ---- 1. Regression: real fixtures still parse without throwing ----
var fs = ['plain_text.eml', 'html_inline_image.eml', 'attachment_mixed.eml', 'non_ascii_subject.eml', 'auth_headers_sample.eml'];
fs.forEach(function (name) {
  var path = 'test-fixtures/' + name;
  var text = readFile(path);
  try {
    var parsed = EV.parseEml(strToBuf(text));
    assert(!!parsed, 'regression: ' + name + ' parses');
  } catch (e) {
    fail++; print('FAIL: ' + name + ' threw: ' + e);
  }
});
// spot-check attachment_mixed still finds its attachment with a real filename
(function () {
  var text = readFile('test-fixtures/attachment_mixed.eml');
  var parsed = EV.parseEml(strToBuf(text));
  assert(parsed.attachments.length >= 1, 'attachment_mixed: has at least 1 attachment');
})();

// ---- 2. Address-list bound recovery ----
(function () {
  var junk = 'A'.repeat(400); // longer than MAX_UNCLOSED_ANGLE_SPAN (320)
  var header = 'Bad <' + junk + ', Good One <good1@example.com>, Good Two <good2@example.com>';
  var addrs = EV.parseAddressList(header);
  var goodAddrs = addrs.filter(function (a) { return a.address === 'good1@example.com' || a.address === 'good2@example.com'; });
  assert(goodAddrs.length === 2, 'address-list: recipients after a stray unmatched "<" are recovered (found ' + goodAddrs.length + '/2, total parsed: ' + addrs.length + ')');
})();
// sanity: well-formed lists still parse exactly as before
(function () {
  var addrs = EV.parseAddressList('"Doe, John" <john@example.com>, Jane Roe <jane@example.com>');
  assert(addrs.length === 2 && addrs[0].address === 'john@example.com' && addrs[1].address === 'jane@example.com',
    'address-list: well-formed quoted-comma list unaffected (' + JSON.stringify(addrs) + ')');
})();

// ---- 3. Boundary reuse across nesting levels ----
(function () {
  var B = 'SAMEBOUNDARY';
  var raw =
    'From: a@example.com\r\n' +
    'To: b@example.com\r\n' +
    'Subject: boundary reuse test\r\n' +
    'Content-Type: multipart/mixed; boundary="' + B + '"\r\n' +
    '\r\n' +
    '--' + B + '\r\n' +
    'Content-Type: multipart/alternative; boundary="' + B + '"\r\n' +
    '\r\n' +
    '--' + B + '\r\n' +
    'Content-Type: text/plain\r\n' +
    '\r\n' +
    'nested plain text\r\n' +
    '--' + B + '--\r\n' +
    '--' + B + '\r\n' +
    'Content-Type: text/plain\r\n' +
    '\r\n' +
    'THIS MUST NOT BE LOST — top-level second part\r\n' +
    '--' + B + '--\r\n';
  var parsed = EV.parseEml(strToBuf(raw));
  var everything = (parsed.textBody || '');
  assert(everything.indexOf('THIS MUST NOT BE LOST') !== -1,
    'boundary-reuse: content after a colliding nested close marker is preserved (textBody: ' + JSON.stringify(everything) + ')');
})();

// ---- 4. Base64 decode-failure warning ----
(function () {
  var raw =
    'From: a@example.com\r\n' +
    'To: b@example.com\r\n' +
    'Subject: bad attachment\r\n' +
    'Content-Type: multipart/mixed; boundary="X"\r\n' +
    '\r\n' +
    '--X\r\n' +
    'Content-Type: application/octet-stream; name="bad.bin"\r\n' +
    'Content-Disposition: attachment; filename="bad.bin"\r\n' +
    'Content-Transfer-Encoding: base64\r\n' +
    '\r\n' +
    'a\r\n' +
    '--X--\r\n';
  var parsed = EV.parseEml(strToBuf(raw));
  assert(parsed.decodeWarnings && parsed.decodeWarnings.length >= 1,
    'decode-warning: invalid base64 surfaces a warning instead of a silent empty part (warnings: ' + JSON.stringify(parsed.decodeWarnings) + ')');
})();

// ---- 5. RFC 2231 filename continuation reassembly ----
(function () {
  var raw =
    'From: a@example.com\r\n' +
    'To: b@example.com\r\n' +
    'Subject: rfc2231 test\r\n' +
    'Content-Type: multipart/mixed; boundary="X"\r\n' +
    '\r\n' +
    '--X\r\n' +
    'Content-Type: application/pdf\r\n' +
    'Content-Disposition: attachment;\r\n' +
    ' filename*0*=UTF-8\'\'invoice%20final%20;\r\n' +
    ' filename*1*=report%202024.pdf\r\n' +
    'Content-Transfer-Encoding: base64\r\n' +
    '\r\n' +
    'aGVsbG8=\r\n' +
    '--X--\r\n';
  var parsed = EV.parseEml(strToBuf(raw));
  var fn = parsed.attachments[0] && parsed.attachments[0].filename;
  assert(fn === 'invoice final report 2024.pdf',
    'rfc2231: multi-segment filename reassembled correctly (got: ' + JSON.stringify(fn) + ')');
})();
// sanity: plain single-segment filename still works
(function () {
  var raw =
    'From: a@example.com\r\nTo: b@example.com\r\nSubject: plain filename\r\n' +
    'Content-Type: multipart/mixed; boundary="X"\r\n\r\n--X\r\n' +
    'Content-Type: text/plain\r\nContent-Disposition: attachment; filename="simple.txt"\r\n\r\nhi\r\n--X--\r\n';
  var parsed = EV.parseEml(strToBuf(raw));
  assert(parsed.attachments[0].filename === 'simple.txt', 'rfc2231: plain filename= unaffected (got: ' + JSON.stringify(parsed.attachments[0].filename) + ')');
})();
// sanity: single-segment extended filename* still works
(function () {
  var raw =
    'From: a@example.com\r\nTo: b@example.com\r\nSubject: extended filename\r\n' +
    'Content-Type: multipart/mixed; boundary="X"\r\n\r\n--X\r\n' +
    'Content-Type: text/plain\r\nContent-Disposition: attachment; filename*=UTF-8\'\'r%C3%A9sum%C3%A9.txt\r\n\r\nhi\r\n--X--\r\n';
  var parsed = EV.parseEml(strToBuf(raw));
  assert(parsed.attachments[0].filename === 'résumé.txt', 'rfc2231: single-segment filename*= unaffected (got: ' + JSON.stringify(parsed.attachments[0].filename) + ')');
})();

print('---');
print('PASS: ' + pass + '  FAIL: ' + fail);
if (fail > 0) throw new Error(fail + ' test(s) failed');
