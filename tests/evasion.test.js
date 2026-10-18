/**
 * evasion.test.js — the detections that catch evasion tricks, each with the false-positive guards that keep them quiet on
 * ordinary mail: hidden / direction-control characters (zero-width, RTLO), look-alike sender domains, the From / Return-Path /
 * Reply-To envelope (compared by organisation, mailing services noted), CSS-hidden text, and the Attachments row (executable
 * and double extensions, executables disguised by their name, macros, disk images, spoofed names). Driven through the real parser.
 * Run via tests/run-all.sh, or directly: jsc tests/evasion.test.js (from the repo root).
 */
load('tests/helpers/textdecoder_polyfill.js');
load('js/parsing/emlParser.js');
load('js/parsing/urlExtract.js');
load('js/indexing/pathFilter.js');
load('js/parsing/headerTables.js');
load('js/indexing/anomalies.js');
load('js/indexing/indexLogic.js');
var EV = this.EV;
var pass = 0, fail = 0;
function assert(cond, label) { if (cond) pass++; else { fail++; print('FAIL: ' + label); } }
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

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
function b64(bytes) {
  var s = '';
  for (var i = 0; i < bytes.length; i += 3) {
    var n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? B64[n & 63] : '=');
  }
  return s;
}
function toBuf(str) { return new Uint8Array(utf8(str)).buffer; }
var BASE = ['From: Sender <sender@example.com>', 'To: me@example.org', 'Subject: Hello there', 'Message-ID: <id1@example.com>', 'Date: Mon, 1 Jan 2024 10:00:00 +0000',
  'Received: from a by b; Mon, 1 Jan 2024 10:00:05 +0000'];
var PLAIN = 'This is a perfectly normal message about the quarterly meeting schedule and room bookings for next week.';
function run(headers, body, ct, opts) {
  var names = {};
  headers.forEach(function (h) { names[h.split(':')[0].toLowerCase()] = 1; });
  var kept = BASE.filter(function (h) { return !names[h.split(':')[0].toLowerCase()]; });
  var p = EV.parseEml(toBuf(kept.concat(headers, ['Content-Type: ' + (ct || 'text/plain; charset=utf-8')]).join('\r\n') + '\r\n\r\n' + (body == null ? PLAIN : body)));
  return EV.analyzeAnomalies(p, opts || {});
}
function withAttachments(files, opts) { // files: [{name, bytes}]
  var body = ['--B', 'Content-Type: text/plain', '', PLAIN];
  files.forEach(function (f) {
    body.push('--B', 'Content-Type: application/octet-stream', 'Content-Disposition: attachment; filename="' + f.name + '"', 'Content-Transfer-Encoding: base64', '', b64(f.bytes));
  });
  body.push('--B--');
  return run([], body.join('\r\n'), 'multipart/mixed; boundary="B"', opts);
}
function row(a, id) { return a.checks.filter(function (c) { return c.id === id; })[0]; }
function st(a, id) { return row(a, id).status; }
function has(a, flag) { return a.flags.indexOf(flag) !== -1; }
function rep(ch, n) { var s = ''; for (var i = 0; i < n; i++) s += ch; return s; }

// ================= hidden / direction-control characters =================
var S = EV.hiddenCharStats;
assert(eq(S('plain text'), { zeroWidth: 0, bidi: 0, override: 0 }), 'plain text has none');
assert(S('a​b​c').zeroWidth === 2 && S('x⁠y').zeroWidth === 1 && S('x﻿y').zeroWidth === 1, 'zero-width space, word joiner, BOM in the middle');
assert(S('﻿hello').zeroWidth === 0, 'a leading byte-order mark is not hidden text');
assert(S('abc‮def').override === 1 && S('abc‮def').bidi === 1 && S('a‭b').override === 1, 'RLO / LRO are overrides');
assert(S('a‪b').bidi === 1 && S('a⁦b').bidi === 1 && S('a⁦b').override === 0, 'embeddings and isolates count as direction controls, not overrides');
// false-positive guards: things ordinary mail is full of
assert(S('مرحبا‏ ‏العالم‏').zeroWidth === 0 && S('x‎y‏z').bidi === 0, 'LRM / RLM marks (Arabic/Hebrew mail) are not counted');
assert(S('a­b­c­d').zeroWidth === 0, 'soft hyphens (long German words) are not counted');
assert(S('👨‍👩‍👧').zeroWidth === 0, 'a family emoji (zero-width joiners) is not counted');
assert(S('می‌خواهم').zeroWidth === 0, 'a Persian zero-width NON-joiner is not counted');
assert(S('pay‍pal').zeroWidth === 1 && S('pay‌pal').zeroWidth === 1, 'a joiner squeezed between plain Latin letters IS counted');

var a = run(['From: =?UTF-8?B?' + b64(utf8('Pay​pal Support')) + '?= <help@paypal-example.com>']);
assert(st(a, 'hidden-content') === 'flag' && has(a, 'invisible-chars'), 'a zero-width character in the SENDER NAME is flagged on its own');
a = run([], PLAIN + ' a​b');
assert(st(a, 'hidden-content') === 'ok', 'one stray zero-width space in the body is normal');
a = run([], PLAIN + ' a​b c​d e​f');
assert(has(a, 'invisible-chars') && !has(a, 'bidi-override'), 'three in the body are flagged');
a = run(['Subject: =?UTF-8?B?' + b64(utf8('Invoice ‮txt.exe')) + '?=']);
assert(has(a, 'bidi-override') && st(a, 'hidden-content') === 'flag', 'an RTLO in the subject is flagged as bidi-override');
a = run([], 'مرحبا‏ هذا ‏اختبار ‏للنظام ‏الجديد ‏شكرا');
assert(st(a, 'hidden-content') === 'ok', 'an Arabic message full of RLM marks stays clean');
a = run([], '👨‍👩‍👧 👨‍👩‍👧 👨‍👩‍👧 family photos attached, see you soon.');
assert(st(a, 'hidden-content') === 'ok', 'emoji with zero-width joiners stay clean');
a = run([], 'Donaudampf­schifffahrts­gesellschaft­skapitän­ und Ge­schwindig­keits­begrenzung');
assert(st(a, 'hidden-content') === 'ok', 'German soft hyphens stay clean');
a = run([], '﻿Hello, a normal message that starts with a byte-order mark.');
assert(st(a, 'hidden-content') === 'ok', 'a leading BOM stays clean');
a = run([], '<p>Click <a href="http://pay​pal.example.com/login">here</a> to continue ' + PLAIN + '</p>', 'text/html; charset=utf-8');
assert(has(a, 'invisible-chars'), 'a zero-width character inside a link host is flagged');

// ================= CSS-hidden text =================
function css(style) { return st(run([], '<p style="' + style + '">secret words</p><p>' + PLAIN + '</p>', 'text/html'), 'hidden-content'); }
assert(css('position:absolute;left:-9999px') === 'note', 'text pushed far off-screen is hidden text');
assert(css('text-indent:-9999px') === 'note', 'negative text-indent is hidden text');
assert(css('font-size:1px') === 'note', '1px text is hidden text');
assert(css('color:#ffffff;background-color:#ffffff') === 'note', 'white text on a white background (same element) is hidden text');
assert(css('color:white;background:white') === 'note', 'white on white, named colour');
assert(css('color:#ffffff;background-color:#1a1a1a') === 'ok', 'white text on a DARK background is not hidden');
assert(css('color:#ffffff') === 'ok', 'white text alone proves nothing (the background may be dark)');
assert(css('margin-left:-10px') === 'ok', 'a small negative margin is layout, not hiding');
assert(css('font-size:14px') === 'ok', 'ordinary text');

// ================= look-alike sender domains =================
function punycodeEncode(label) { // RFC 3492, enough for tests
  var base = 36, tMin = 1, tMax = 26, skew = 38, damp = 700, n = 128, delta = 0, bias = 72, cps = Array.from(label).map(function (c) { return c.codePointAt(0); });
  var out = cps.filter(function (c) { return c < 128; }).map(function (c) { return String.fromCharCode(c); }).join('');
  var h = out.length, b = h;
  if (b) out += '-';
  function digit(d) { return String.fromCharCode(d + 22 + 75 * (d < 26)); }
  function adapt(d, num, first) { d = first ? Math.floor(d / damp) : d >> 1; d += Math.floor(d / num); var k = 0; while (d > ((base - tMin) * tMax) >> 1) { d = Math.floor(d / (base - tMin)); k += base; } return k + Math.floor((base - tMin + 1) * d / (d + skew)); }
  while (h < cps.length) {
    var m = Math.min.apply(null, cps.filter(function (c) { return c >= n; }));
    delta += (m - n) * (h + 1); n = m;
    for (var i = 0; i < cps.length; i++) {
      var c = cps[i];
      if (c < n) delta++;
      if (c === n) {
        var q = delta;
        for (var k = base; ; k += base) { var t = k <= bias ? tMin : (k >= bias + tMax ? tMax : k - bias); if (q < t) break; out += digit(t + (q - t) % (base - t)); q = Math.floor((q - t) / (base - t)); }
        out += digit(q); bias = adapt(delta, h + 1, h === b); delta = 0; h++;
      }
    }
    delta++; n++;
  }
  return 'xn--' + out;
}
assert(EV.punycodeDecodeLabel(punycodeEncode('раураl').slice(4)) === 'раураl', 'test helper: the punycode encoder round-trips');
var TRUST = { trustedDomains: ['paypal.com', 'google.com'] };
function sender(domain, opts) { return run(['From: Support <help@' + domain + '>'], null, null, opts || TRUST); }
var cyr = 'раураl.com'; // р а у р а l . com  -> "paypal.com" in the skeleton
assert(eq(EV.confusableSkeleton(cyr), 'paypal.com') && EV.confusableSkeleton('plain.com') === 'plain.com', 'the skeleton folds look-alike letters to Latin');
a = sender(cyr);
assert(st(a, 'sender-domain') === 'flag' && has(a, 'confusable-domain') && /paypal\.com/.test(row(a, 'sender-domain').detail), 'an all-Cyrillic look-alike of a trusted domain is flagged');
a = sender(punycodeEncode('раураl') + '.com');
assert(has(a, 'confusable-domain'), 'the same domain arriving as punycode (xn--...) is decoded first, and flagged');
a = sender('gοοgle.com');
assert(has(a, 'confusable-domain'), 'Greek omicrons imitating google.com');
a = sender('ｐａｙｐａｌ.com');
assert(has(a, 'confusable-domain'), 'full-width letters imitating paypal.com');
a = sender('mail.' + cyr);
assert(has(a, 'confusable-domain'), 'a subdomain of the look-alike is still flagged');
// false-positive guards
a = sender('пример.рф');
assert(st(a, 'sender-domain') === 'ok', 'an ordinary Russian domain is not a look-alike of anything');
a = sender('paypal.com'); assert(st(a, 'sender-domain') === 'ok', 'the trusted domain itself');
a = sender('mail.paypal.com'); assert(st(a, 'sender-domain') === 'ok', 'a subdomain of the trusted domain');
a = sender('paypa1.com'); assert(!has(a, 'confusable-domain'), 'an ASCII typosquat is the separate edit-distance check, not this one');
a = sender('bücher.example'); assert(st(a, 'sender-domain') === 'ok', 'an accented domain that imitates nothing');
a = sender(cyr, { trustedDomains: [] }); assert(has(a, 'confusable-domain'), 'the built-in brand list is compared even when the user list is empty');
a = sender('\u0440\u0430\u0443\u0440\u0430l.net', { trustedDomains: ['paypal.com'] }); assert(st(a, 'sender-domain') === 'ok', 'a different TLD is not an exact look-alike');
a = sender(cyr, { trustedDomains: [cyr] }); assert(st(a, 'sender-domain') === 'ok', 'a domain the user trusts explicitly is never flagged');
a = sender(cyr, { trustedDomains: ['/\\.corp\\.example$/i', 'paypal.com'] }); assert(has(a, 'confusable-domain'), 'regex trust entries are skipped (not mis-compared) and do not break the check');
a = run(['From: x@[203.0.113.5]']);
assert(st(a, 'sender-domain') === 'flag' && has(a, 'sender-ip-literal'), 'a sender address that is a bare IP is flagged');
a = run(['From: x@203.0.113.5']); assert(has(a, 'sender-ip-literal'), 'a bare IP without brackets');
a = run(['From: x@example.com']); assert(!has(a, 'sender-ip-literal'), 'a normal domain is not an IP');

// ================= envelope: From / Return-Path / Reply-To =================
function env(headers, opts) { return run(['From: Sender <sender@example.com>'].concat(headers), null, null, opts); }
a = env(['Return-Path: <bounce@bounce.example.com>']); assert(st(a, 'return-path') === 'ok', 'a subdomain bounce address is the same organisation');
a = run(['From: Sender <sender@example.co.uk>', 'Return-Path: <bounce@mailer.example.co.uk>']); assert(st(a, 'return-path') === 'ok', 'two-label public suffixes (co.uk) align by organisation');
a = env(['Return-Path: <bounce@evil.net>']); assert(st(a, 'return-path') === 'flag' && has(a, 'returnpath-mismatch'), 'an unrelated Return-Path domain is a flag');
var ESP = { domainCategories: [{ name: 'Email Service Provider', keywords: ['sendgrid.net', 'amazonses.com'] }] };
a = env(['Return-Path: <b@u123.sendgrid.net>'], ESP);
assert(st(a, 'return-path') === 'note' && has(a, 'returnpath-mismatch') && /mailing service/.test(row(a, 'return-path').detail), 'a bounce on a known mailing service is only a note (still searchable)');
a = env(['Return-Path: <b@evil.net>'], ESP); assert(st(a, 'return-path') === 'flag', 'an unknown domain stays a flag even when a mailing-service category exists');
a = env(['Return-Path: <>']); assert(st(a, 'return-path') === 'ok', 'an empty (bounce) Return-Path is normal');
a = env(['Reply-To: help@support.example.com']); assert(st(a, 'reply-to') === 'ok', 'a subdomain Reply-To aligns');
a = env(['Reply-To: ceo@gmail.com']); assert(st(a, 'reply-to') === 'flag' && has(a, 'replyto-mismatch'), 'a Reply-To on another domain is flagged');
a = env(['Return-Path: <bounce@evil.net>']); assert(a.metrics.envelope[0].label === 'Return-Path' && a.metrics.envelope[0].status === 'flag', 'the envelope metric mirrors the rows');

// ================= attachments =================
var MZ = [0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04];
var PDF = utf8('%PDF-1.7\n%fake'), PNG = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], TEXT = utf8('plain words'), SH = utf8('#!/bin/sh\necho hi\n');
function att(name, bytes) { return withAttachments([{ name: name, bytes: bytes }]); }
a = att('quarterly.pdf', PDF); assert(st(a, 'attachment-risk') === 'ok' && a.metrics.attachments.total === 1 && a.metrics.attachments.risky === 0, 'a genuine PDF is clean');
a = att('photo.jpg', PNG); assert(st(a, 'attachment-risk') === 'ok', 'a PNG named .jpg is not dangerous: no flag');
a = att('notes.txt', SH); assert(st(a, 'attachment-risk') === 'ok', 'a text file that starts with #! is not flagged');
a = att('run.sh', SH); assert(st(a, 'attachment-risk') === 'ok', 'a shell script named .sh is what it says');
a = att('setup.exe', MZ);
assert(st(a, 'attachment-risk') === 'flag' && has(a, 'attachment-executable') && !has(a, 'attachment-disguised'), 'an .exe is an executable (and not "disguised": it says what it is)');
a = att('invoice.pdf.exe', MZ);
assert(has(a, 'attachment-executable') && has(a, 'attachment-double-ext') && a.metrics.attachments.risky === 1, 'a double extension');
a = att('invoice.pdf', MZ);
assert(st(a, 'attachment-risk') === 'flag' && has(a, 'attachment-disguised') && /Windows program/.test(row(a, 'attachment-risk').detail), 'a Windows program named .pdf is disguised');
a = att('invoice.pdf', [0x7F, 0x45, 0x4C, 0x46, 2, 1, 1, 0]); assert(has(a, 'attachment-disguised') && /Linux/.test(row(a, 'attachment-risk').detail), 'an ELF binary named .pdf');
a = att('data.xlsm', PDF); assert(st(a, 'attachment-risk') === 'note' && has(a, 'attachment-macro'), 'a macro-enabled workbook is a note, not a flag');
a = att('scan.iso', TEXT); assert(st(a, 'attachment-risk') === 'note' && has(a, 'attachment-container'), 'a disk image is a note');
a = att('report.docx', [0x50, 0x4B, 3, 4, 0, 0, 0, 0]); assert(st(a, 'attachment-risk') === 'ok', 'an Office file (a zip inside) is clean');
a = att('invoice‮gpj.exe', MZ); assert(has(a, 'attachment-filename-spoof'), 'an RTLO in a filename is a spoof');
a = att('report​.pdf', PDF); assert(has(a, 'attachment-filename-spoof'), 'a zero-width character in a filename');
a = att('report' + rep(' ', 12) + '.pdf', PDF); assert(has(a, 'attachment-filename-spoof'), 'a filename padded with spaces to push the real extension out of view');
a = att('my report 2024 final.pdf', PDF); assert(st(a, 'attachment-risk') === 'ok', 'ordinary spaces in a filename are fine');
a = att('archive.zip', [0x50, 0x4B, 3, 4]); assert(st(a, 'attachment-risk') === 'ok', 'a zip is not flagged (contents are not opened)');
a = run([]); assert(st(a, 'attachment-risk') === 'na' && a.metrics.attachments.total === 0, 'no attachments: not applicable');
var many = []; for (var i = 0; i < 80; i++) many.push({ name: 'f' + i + '.exe', bytes: MZ });
var t0 = Date.now(); a = withAttachments(many); assert(a.metrics.attachments.total === 50 && Date.now() - t0 < 5000, 'at most 50 attachments are inspected');

// ================= sender IPs in the metrics =================
a = run(['Received: from mx.b.org (mx.b.org [198.51.100.7]) by in.c.net; Mon, 1 Jan 2024 10:00:09 +0000', 'Received: from mail.a.com (mail.a.com [203.0.113.9]) by mx.b.org; Mon, 1 Jan 2024 10:00:05 +0000']);
assert(a.metrics.originIp === '203.0.113.9' && a.metrics.connectingIp === '198.51.100.7', 'the checklist metrics carry both sender IPs (the index reads them from here)');
a = run([]); assert(a.metrics.originIp === '' && a.metrics.connectingIp === '', 'no usable Received IP: empty strings');

// ================= metrics + registry =================
a = run(['From: =?UTF-8?B?' + b64(utf8('A​b')) + '?= <x@example.com>'], PLAIN + ' a​b‮c');
assert(a.metrics.hidden.zeroWidth >= 2 && a.metrics.hidden.bidi === 1, 'the metrics count hidden characters by kind');
a = run(['Subject: pаypal account'], 'Verify your pаypal account now please. ' + PLAIN);
assert(a.metrics.lookalikes.fields >= 1, 'the metrics count mixed-script fields');
['bidi-override', 'confusable-domain', 'sender-ip-literal', 'attachment-executable', 'attachment-double-ext', 'attachment-disguised', 'attachment-macro', 'attachment-container', 'attachment-filename-spoof'].forEach(function (id) {
  assert(EV.ANOMALY_FLAG_IDS.indexOf(id) !== -1 && EV.ANOMALY_FLAG_HELP[id], 'flag id registered and documented: ' + id);
});
assert(EV.ANOMALY_CHECKS.some(function (c) { return c.group === 'attachments'; }), 'the checklist has an Attachments group');

print('---');
print('PASS: ' + pass + '  FAIL: ' + fail);
if (fail > 0) throw new Error(fail + ' test(s) failed');
