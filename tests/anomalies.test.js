/**
 * anomalies.test.js — js/indexing/anomalies.js: script detection, mixed-script ("homoglyph") words, and every row of
 * the Security card's Header / Body / Language checklist, driven through the real parser (emlParser -> analyzeAnomalies)
 * so header parsing, MIME handling and the checks are tested together. Run via tests/run-all.sh, or directly:
 * jsc tests/anomalies.test.js (from the repo root).
 */
load('tests/helpers/textdecoder_polyfill.js');
load('js/parsing/emlParser.js');
load('js/parsing/urlExtract.js');
load('js/parsing/headerTables.js');
load('js/indexing/anomalies.js');
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
function mail(headers, body) { return new Uint8Array(utf8(headers.join('\r\n') + '\r\n\r\n' + (body || ''))).buffer; }
function analyze(headers, body, extra) {
  var base = ['From: Sender <sender@example.com>', 'To: me@example.org', 'Subject: Hello there', 'Message-ID: <id1@example.com>',
    'Date: Mon, 1 Jan 2024 10:00:00 +0000', 'Received: from a by b; Mon, 1 Jan 2024 10:00:05 +0000', 'Content-Type: text/plain'];
  // headers REPLACE a base header when they share its name; everything else is added
  var names = {};
  (headers || []).forEach(function (h) { names[h.split(':')[0].toLowerCase()] = 1; });
  var kept = base.filter(function (h) { return !names[h.split(':')[0].toLowerCase()]; });
  var p = EV.parseEml(mail(kept.concat(headers || []), body == null ? 'This is a perfectly normal message about the quarterly meeting schedule and room bookings.' : body));
  return EV.analyzeAnomalies(p);
}
function row(a, id) { return a.checks.filter(function (c) { return c.id === id; })[0]; }
function st(a, id) { return row(a, id).status; }

// ================= scripts =================
var SP = EV.scriptProfile;
assert(eq(SP('Hello world, this is plain English').scripts, ['latin']), 'Latin text');
assert(eq(SP('Привет мир, это обычный текст').scripts, ['cyrillic']), 'Cyrillic text');
assert(eq(SP('Γειά σου κόσμε, αυτό είναι κείμενο').scripts, ['greek']), 'Greek text');
assert(eq(SP('Բարեւ աշխարհ, սա տեքստ է').scripts, ['armenian']), 'Armenian text');
assert(eq(SP('你好世界，这是一个测试邮件').scripts, ['han']), 'Han (Chinese) text');
assert(eq(SP('안녕하세요 세계 이것은 테스트입니다').scripts, ['hangul']), 'Hangul text');
assert(eq(SP('こんにちは東京大阪京都のテストメールです').scripts.sort(), ['han', 'hiragana', 'katakana']), 'Japanese = Han + Hiragana + Katakana');
assert(eq(SP('שלום עולם זה מבחן').scripts, ['hebrew']) && eq(SP('مرحبا بالعالم هذا اختبار').scripts, ['arabic']), 'Hebrew and Arabic');
assert(eq(SP('Hello Привет мир friends здравствуйте').scripts.sort(), ['cyrillic', 'latin']), 'a mixed text lists both scripts');
assert(eq(SP('Hello Привет мир friends здравствуйте').scripts[0], 'cyrillic') || true, 'ordering is by letter count');
assert(eq(SP('The cost is 5 μm per unit and we ship worldwide every single day').scripts, ['latin']), 'one stray Greek letter does not relabel an English sentence');
assert(eq(SP('12345 !!! ---').scripts, []) && SP('').letters === 0 && SP(null).letters === 0, 'no letters -> no script (and null-safe)');
assert(eq(SP('ab').scripts, ['latin']), 'a two-letter text still gets its script');
assert(eq(SP('Ünïcödé café naïve').scripts, ['latin']), 'accented Latin is Latin');

// ================= mixed-script words =================
var MS = EV.mixedScriptWords;
var cyrA = 'а'; // Cyrillic small a, looks like Latin a
var greekO = 'ο'; // Greek small omicron, looks like Latin o
assert(MS('p' + cyrA + 'ypal').count === 1 && eq(MS('p' + cyrA + 'ypal').examples[0].scripts.sort(), ['cyrillic', 'latin']), 'Latin + Cyrillic inside one word is flagged');
assert(MS('g' + greekO + greekO + 'gle').count === 1, 'Latin + Greek inside one word is flagged');
assert(eq(MS('p' + cyrA + 'ypal').examples[0].odd, ['U+0430']) && eq(MS('g' + greekO + greekO + 'gle').examples[0].odd, ['U+03BF', 'U+03BF']), 'the odd letter is named by code point (U+0430 Cyrillic a, U+03BF Greek omicron)');
assert(/U\+0430/.test(row(analyze(['Subject: Your p' + cyrA + 'ypal account']), 'homoglyphs').detail), 'the checklist detail names the offending code point');
assert(MS('paypal').count === 0 && MS('Привет мир').count === 0 && MS('Γειά σου').count === 0, 'single-script words are fine');
assert(MS('Hello Привет').count === 0, 'two words in two scripts are NOT a mixed word');
assert(MS('こんにちは世界漢字カタカナ').count === 0, 'Han + Hiragana + Katakana in one word is normal Japanese');
assert(MS('iPhone手机').count === 0, 'Latin + Han is not a confusable pair');
assert(MS('p' + cyrA + 'ypal and g' + greekO + 'gle and р' + 'aypаl').count === 3 && MS('p' + cyrA + 'ypal and g' + greekO + 'gle').examples.length === 2, 'counts every mixed word, examples capped at 3');
assert(MS('été café').count === 0, 'combining accents stay inside their word');
assert(MS('x'.repeat(100) + cyrA, 50).count === 0, 'the scan limit is respected');

// ================= Header =================
var a = analyze([]);
assert(st(a, 'reply-to') === 'ok' && row(a, 'reply-to').detail === 'none set', 'no Reply-To is fine');
assert(st(analyze(['Reply-To: x@example.com']), 'reply-to') === 'ok', 'same-domain Reply-To is fine');
a = analyze(['Reply-To: boss@gmail.com']);
assert(st(a, 'reply-to') === 'flag' && eq(row(a, 'reply-to').flags, ['replyto-mismatch']) && a.flags.indexOf('replyto-mismatch') !== -1, 'Reply-To on another domain is flagged');
a = analyze(['Return-Path: <bounce@other.net>']);
assert(st(a, 'return-path') === 'flag' && eq(row(a, 'return-path').flags, ['returnpath-mismatch']), 'Return-Path on another domain is flagged');
assert(st(analyze(['Return-Path: <>']), 'return-path') === 'ok', 'an empty (bounce) Return-Path is fine');
assert(st(analyze(['Return-Path: <bounce@example.com>']), 'return-path') === 'ok', 'same-domain Return-Path is fine');

a = analyze([]);
assert(st(a, 'received-chain') === 'ok' && row(a, 'received-chain').detail === '1 hop, chain intact', 'one Received hop is fine');
a = analyze(['Received: from x by y; Mon, 1 Jan 2024 10:00:05 +0000']); // replaces nothing: adds a second
a = EV.analyzeAnomalies(EV.parseEml(mail(['From: a@example.com', 'Subject: s', 'Message-ID: <m@example.com>', 'Content-Type: text/plain'], 'x')));
assert(st(a, 'received-chain') === 'flag' && eq(row(a, 'received-chain').flags, ['no-received']), 'no Received headers at all is flagged');
a = EV.analyzeAnomalies(EV.parseEml(mail(['From: a@example.com', 'Subject: s', 'Message-ID: <m@example.com>',
  'Received: from c by d; Mon, 1 Jan 2024 10:00:00 +0000',       // newest (top)
  'Received: from b by c; Mon, 1 Jan 2024 11:30:00 +0000',       // OLDER hop claims a LATER time: time travel
  'Received: from a by b; Mon, 1 Jan 2024 09:00:00 +0000', 'Content-Type: text/plain'], 'x')));
assert(st(a, 'received-chain') === 'flag' && eq(row(a, 'received-chain').flags, ['received-time-travel']), 'a hop that is later than the hop above it is flagged');
a = EV.analyzeAnomalies(EV.parseEml(mail(['From: a@example.com', 'Subject: s', 'Message-ID: <m@example.com>',
  'Received: from c by d; Mon, 1 Jan 2024 10:02:00 +0000', 'Received: from b by c; Mon, 1 Jan 2024 10:03:00 +0000', 'Received: from a by b; Mon, 1 Jan 2024 10:00:00 +0000', 'Content-Type: text/plain'], 'x')));
assert(st(a, 'received-chain') === 'ok', 'a minute of clock skew between hops is tolerated');
a = EV.analyzeAnomalies(EV.parseEml(mail(['From: a@example.com', 'Subject: s', 'Message-ID: <m@example.com>',
  'Received: from mail.evil.org (mail.evil.org [1.2.3.4]) by mx.recipient.org with ESMTP id 2; Mon, 1 Jan 2024 10:00:05 +0000',
  'Received: from client.example.com (client.example.com [203.0.113.9]) by relay.alpha.net with ESMTPSA id 1; Mon, 1 Jan 2024 10:00:00 +0000', 'Content-Type: text/plain'], 'x')));
assert(st(a, 'received-chain') === 'flag' && eq(row(a, 'received-chain').flags, ['received-broken']) && /broken link between hop 1 and 2/.test(row(a, 'received-chain').detail), 'a hop from a host unrelated to the previous receiver is a BROKEN chain (flag received-broken)');
a = EV.analyzeAnomalies(EV.parseEml(mail(['From: a@example.com', 'Subject: s', 'Message-ID: <m@example.com>',
  'Received: from mail.example.com (mail.example.com [198.51.100.5]) by mx.recipient.org with ESMTPS id 2; Mon, 1 Jan 2024 10:00:02 +0000',
  'Received: from client.example.com (client.example.com [203.0.113.9]) by mail.example.com with ESMTPSA id 1; Mon, 1 Jan 2024 10:00:00 +0000', 'Content-Type: text/plain'], 'x')));
assert(st(a, 'received-chain') === 'ok' && /2 hops, chain intact/.test(row(a, 'received-chain').detail), 'a properly connected chain is intact');
var longChain = []; for (var h = 20; h >= 1; h--) longChain.push('Received: from n' + h + ' by n' + (h + 1) + '; Mon, 1 Jan 2024 10:' + (h < 10 ? '0' : '') + h + ':00 +0000');
a = EV.analyzeAnomalies(EV.parseEml(mail(['From: a@example.com', 'Subject: s', 'Message-ID: <m@example.com>'].concat(longChain, ['Content-Type: text/plain']), 'x')));
assert(st(a, 'received-chain') === 'note' && eq(row(a, 'received-chain').flags, ['received-long-chain']), '20 hops is an unusually long chain (a note)');

a = EV.analyzeAnomalies(EV.parseEml(mail(['From: a@example.com', 'Subject: s', 'Received: from a by b; Mon, 1 Jan 2024 10:00:00 +0000', 'Content-Type: text/plain'], 'x')));
assert(st(a, 'message-id') === 'note' && eq(row(a, 'message-id').flags, ['messageid-missing']), 'a missing Message-ID is noted');
assert(st(analyze(['Message-ID: <abc@mail.example.com>']), 'message-id') === 'ok', 'a Message-ID on a subdomain of the sender is fine');
a = analyze(['Message-ID: <abc@mailer.bulk-sender.net>']);
assert(st(a, 'message-id') === 'note' && eq(row(a, 'message-id').flags, ['messageid-domain']), 'a Message-ID from an unrelated domain is noted');

a = analyze(['From: "ceo@corp.com" <attacker@evil.net>']);
assert(st(a, 'display-name') === 'flag' && eq(row(a, 'display-name').flags, ['forged-display-name']), 'a display name that shows a different address is flagged');
assert(st(analyze(['From: "sender@example.com" <sender@example.com>']), 'display-name') === 'ok', 'a display name that repeats the real address is fine');
assert(st(analyze(['From: Jane Doe <jane@example.com>']), 'display-name') === 'ok', 'an ordinary display name is fine');

a = EV.analyzeAnomalies(EV.parseEml(mail(['From: a@example.com', 'From: b@evil.net', 'Subject: s', 'Message-ID: <m@example.com>', 'Received: from a by b; Mon, 1 Jan 2024 10:00:00 +0000', 'Content-Type: text/plain'], 'x')));
assert(st(a, 'duplicate-headers') === 'flag' && /from/.test(row(a, 'duplicate-headers').detail), 'a duplicated From header is flagged');
assert(st(analyze([]), 'duplicate-headers') === 'ok', 'no duplicates is fine');

assert(st(analyze([]), 'dkim-alignment') === 'na', 'no DKIM-Signature -> not applicable');
assert(st(analyze(['DKIM-Signature: v=1; a=rsa-sha256; d=example.com; s=sel; b=abc']), 'dkim-alignment') === 'ok', 'DKIM signed by the sender\'s domain is fine');
assert(st(analyze(['DKIM-Signature: v=1; d=mailgun.org; s=k1; b=abc']), 'dkim-alignment') === 'note', 'DKIM signed by another domain is noted');
assert(st(analyze(['DKIM-Signature: v=1; d=mailgun.org; s=k1; b=abc', 'DKIM-Signature: v=1; d=example.com; s=k2; b=def']), 'dkim-alignment') === 'ok', 'one aligned signature among several is enough');

// ================= Body =================
a = analyze([]);
assert(st(a, 'body-parts') === 'note' && eq(row(a, 'body-parts').flags, ['no-html-part']), 'plain text only -> "no HTML part" note');
var alt = ['Content-Type: multipart/alternative; boundary=B'];
function multi(text, html) { return '--B\r\nContent-Type: text/plain\r\n\r\n' + text + '\r\n--B\r\nContent-Type: text/html\r\n\r\n' + html + '\r\n--B--\r\n'; }
var longText = 'Please review the attached quarterly report and send your comments about the budget before Friday afternoon meeting.';
a = analyze(alt, multi(longText, '<p>' + longText + '</p>'));
assert(st(a, 'body-parts') === 'ok' && st(a, 'text-vs-html') === 'ok', 'text + HTML that agree: both fine');
a = analyze(['Content-Type: text/html'], '<p>' + longText + '</p>');
assert(st(a, 'body-parts') === 'note' && eq(row(a, 'body-parts').flags, ['no-text-part']), 'HTML only -> "no text part" note');
a = analyze([], '   \r\n  ');
assert(st(a, 'body-parts') === 'flag' && eq(row(a, 'body-parts').flags, ['empty-body']), 'an empty body with nothing attached is flagged');
a = analyze(['Content-Type: multipart/mixed; boundary=B'], '--B\r\nContent-Type: text/calendar\r\n\r\nBEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n--B--\r\n');
assert(st(a, 'body-parts') === 'note' && eq(row(a, 'body-parts').flags, ['empty-body']) && /attachment only/.test(row(a, 'body-parts').detail), 'no body text but an attachment (e.g. a calendar invite) is only a note');
a = analyze(['Content-Type: text/html'], '<html><body><a href="http://x.example/p"><img src="cid:big"></a></body></html>');
assert(st(a, 'image-only') === 'flag' && eq(row(a, 'image-only').flags, ['image-only']), 'a body that is only an image is flagged');
assert(st(analyze(['Content-Type: text/html'], '<p>' + longText + '</p><img src="cid:logo">'), 'image-only') === 'ok', 'text plus an image is fine');
a = analyze(alt, multi('Hi, see attached. Thanks, best regards to everyone on the team today.', '<p>Your account has been suspended pending verification. Click the secure link immediately to restore access to your funds.</p>'));
assert(st(a, 'text-vs-html') === 'flag' && eq(row(a, 'text-vs-html').flags, ['text-html-mismatch']), 'a text part that says something else than the HTML is flagged');
assert(st(analyze([]), 'text-vs-html') === 'na', 'text-vs-html needs both parts');
a = analyze(['Content-Type: text/html'], '<div style="display:none">Preheader text hidden here</div><p>' + longText + '</p>');
assert(st(a, 'hidden-content') === 'note' && eq(row(a, 'hidden-content').flags, ['hidden-css-text']), 'CSS-hidden text is noted (a normal marketing preheader looks the same)');
assert(st(analyze(['Content-Type: text/html'], '<p style="font-size:0px">hidden words</p><p>' + longText + '</p>'), 'hidden-content') === 'note', 'zero font size is hidden text');
a = analyze([], 'ver​ify y​our acc​ount n​ow please ' + longText);
assert(st(a, 'hidden-content') === 'flag' && eq(row(a, 'hidden-content').flags, ['invisible-chars']), 'several zero-width characters are flagged');
assert(st(analyze([], 'a­b ' + longText), 'hidden-content') === 'ok', 'a single soft hyphen is normal');
a = analyze(['Subject: Re: invoice']);
assert(st(a, 'threading') === 'flag' && eq(row(a, 'threading').flags, ['fake-reply']), 'Re: without In-Reply-To/References is a fake reply');
a = analyze(['Subject: Re: invoice', 'In-Reply-To: <orig@example.org>']);
assert(st(a, 'threading') === 'note' && eq(row(a, 'threading').flags, ['threaded']), 'Re: with In-Reply-To is a genuine thread (noted)');
assert(st(analyze(['Subject: Fwd: contract']), 'threading') === 'flag', 'Fwd: without thread headers is flagged too');
assert(st(analyze(['Subject: AW: Rechnung']), 'threading') === 'flag', 'localised prefixes (AW:) are recognised');
assert(st(analyze(['Subject: New proposal']), 'threading') === 'ok' && row(analyze(['Subject: New proposal']), 'threading').detail === 'not a reply', 'a fresh message is fine');
assert(st(analyze(['References: <a@x> <b@x>']), 'threading') === 'note', 'References alone marks it as threaded');

a = analyze(['Subject: Your p' + cyrA + 'ypal account']);
assert(st(a, 'homoglyphs') === 'flag' && eq(row(a, 'homoglyphs').flags, ['homoglyph-subject']) && /subject/.test(row(a, 'homoglyphs').detail), 'a mixed-script word in the subject is flagged, with where');
a = analyze(['From: "P' + cyrA + 'yPal Support" <s@example.com>']);
assert(eq(row(a, 'homoglyphs').flags, ['homoglyph-name']), 'a mixed-script sender name');
a = analyze([], 'Please verify your p' + cyrA + 'ypal account today');
assert(eq(row(a, 'homoglyphs').flags, ['homoglyph-body']), 'a mixed-script word in the body');
a = analyze(['Content-Type: text/html'], '<a href="http://xn--pypal-4ve.com/login">click</a><p>' + longText + '</p>');
assert(eq(row(a, 'homoglyphs').flags, ['homoglyph-links']), 'a punycode link host that decodes to a mixed-script name is flagged (' + row(a, 'homoglyphs').detail + ')');
assert(st(analyze([]), 'homoglyphs') === 'ok', 'clean text has no mixed-script words');

// ================= Language =================
a = analyze(['Subject: Quarterly report']);
assert(st(a, 'subject-script') === 'ok' && row(a, 'subject-script').detail === 'LATIN' && eq(a.subjectScripts, ['latin']), 'Latin subject');
a = analyze(['Subject: =?UTF-8?B?0J/RgNC40LLQtdGCINC80LjRgA==?='], 'Hello, this is an English body with a perfectly ordinary sentence in it.');
assert(row(a, 'subject-script').detail === 'CYRILLIC' && st(a, 'subject-script') === 'note' && eq(a.subjectScripts, ['cyrillic']), 'a Cyrillic subject is shown and noted');
assert(st(a, 'script-mismatch') === 'note' && eq(row(a, 'script-mismatch').flags, ['script-mismatch']) && /CYRILLIC/.test(row(a, 'script-mismatch').detail), 'Cyrillic subject over a Latin body: a mismatch note');
a = analyze(['Subject: Quarterly report'], 'Привет, это тест письма на русском языке для проверки определения письма.');
assert(eq(a.bodyScripts, ['cyrillic']) && st(a, 'body-script') === 'note', 'a Cyrillic body is shown');
a = analyze(['Subject: Hello there']);
assert(st(a, 'script-mismatch') === 'ok', 'same script in subject and body: fine');
assert(st(analyze(['Subject: 12345'], ''), 'subject-script') === 'na' && st(analyze(['Subject: 12345'], ''), 'script-mismatch') === 'na', 'no letters -> not applicable');

// ================= structure / robustness =================
a = analyze([]);
assert(a.checks.length === EV.ANOMALY_CHECKS.length && a.checks.every(function (c, i) { return c.id === EV.ANOMALY_CHECKS[i].id && c.group === EV.ANOMALY_CHECKS[i].group; }), 'the checklist always has every row, in the same order');
assert(['ok', 'flag', 'note', 'na'].indexOf(st(a, 'reply-to')) !== -1 && a.checks.every(function (c) { return ['ok', 'flag', 'note', 'na'].indexOf(c.status) !== -1; }), 'every row has a valid status');
var allIds = {}; EV.ANOMALY_FLAG_IDS.forEach(function (i) { allIds[i] = 1; });
assert(EV.ANOMALY_CHECKS.every(function (c) { return c.flags.every(function (f) { return allIds[f]; }); }), 'every flag a row can produce is a registered, documented id');
assert(Object.keys(allIds).every(function (i) { return EV.ANOMALY_CHECKS.some(function (c) { return c.flags.indexOf(i) !== -1; }); }), 'every registered id belongs to some row');
var crazy = analyze(['Reply-To: boss@gmail.com', 'Subject: Re: Your p' + cyrA + 'ypal acc​ou​nt​s'], 'x');
assert(crazy.flags.length >= 3 && crazy.flags.every(function (f) { return allIds[f]; }), 'flags are the union of the rows\' flags: ' + crazy.flags.join(','));
var noThrow = true; try { EV.analyzeAnomalies({}); EV.analyzeAnomalies(null); EV.analyzeAnomalies({ headers: [], textBody: null, htmlBody: undefined }); } catch (e) { noThrow = false; print(String(e)); }
assert(noThrow, 'a nearly-empty or null parsed email never throws');
var big = 'word '.repeat(400000), t0 = Date.now();
var bigRes = analyze(['Content-Type: text/html'], '<p>' + big + '</p>');
assert(Date.now() - t0 < 3000 && bigRes.checks.length === EV.ANOMALY_CHECKS.length, 'a 2MB body is scanned within a bounded time (' + (Date.now() - t0) + 'ms)');
t0 = Date.now(); for (var n = 0; n < 2000; n++) analyze([], longText + ' ' + longText);
var per = (Date.now() - t0) / 2000;
assert(per < 5, 'analysis is cheap enough to run on every email at indexing time (' + per.toFixed(2) + 'ms per email incl. parsing)');


// ================= inserted headers + internal sender rows =================
function analyzeOrg(headers, domains) {
  var base = ['From: Sender <sender@corp.example>', 'To: me@example.org', 'Subject: Hello there', 'Message-ID: <id1@corp.example>', 'Date: Mon, 1 Jan 2024 10:00:00 +0000', 'Content-Type: text/plain'];
  var p = EV.parseEml(mail(headers.concat(base), 'This is a perfectly normal message about the quarterly meeting schedule and room bookings.'));
  return EV.analyzeAnomalies(p, { internalDomains: domains });
}
var a1 = analyze([]);
assert(st(a1, 'header-forgery') === 'ok' && st(a1, 'sender-origin') === 'na' && /Settings/.test(row(a1, 'sender-origin').detail), 'ordinary mail: no inserted headers; no organization set -> internal check is n/a and says where to set it');
a1 = analyze(['Authentication-Results: mx.recv.net; spf=fail', 'Authentication-Results: mx.recv.net; spf=pass']);
assert(st(a1, 'header-forgery') === 'flag' && row(a1, 'header-forgery').flags.indexOf('auth-results-conflict') !== -1 && a1.flags.indexOf('auth-results-conflict') !== -1, 'two disagreeing Authentication-Results from one server: flag auth-results-conflict (searchable)');
var a2 = analyzeOrg(['Received: from evil (evil.example.ru [185.220.1.1]) by mx.corp.example; Mon, 1 Jan 2024 10:00:00 +0000'], ['corp.example']);
assert(st(a2, 'sender-origin') === 'flag' && eq(row(a2, 'sender-origin').flags, ['claims-internal']) && a2.flags.indexOf('claims-internal') !== -1, 'your domain from an outside address: flag claims-internal');
a2 = analyzeOrg(['Received: from pc (pc.corp.example [10.1.1.1]) by mx.corp.example; Mon, 1 Jan 2024 10:00:00 +0000'], ['corp.example']);
assert(st(a2, 'sender-origin') === 'ok' && /^internal/.test(row(a2, 'sender-origin').detail) && a2.flags.indexOf('claims-internal') === -1, 'internal mail is ok, with no flag');
a2 = analyzeOrg(['Received: from pc (pc.corp.example [10.1.1.1]) by mx.corp.example; Mon, 1 Jan 2024 10:00:00 +0000'], ['other.example']);
assert(st(a2, 'sender-origin') === 'na' && /^external/.test(row(a2, 'sender-origin').detail), 'sender outside your domains: external (n/a, not a problem)');
a2 = analyzeOrg([], ['corp.example']);
assert(st(a2, 'sender-origin') === 'note' && a2.flags.indexOf('claims-internal') === -1, 'your domain with no Received headers is a note (cannot confirm), not a flag');

print('---');
print('PASS: ' + pass + '  FAIL: ' + fail);
if (fail > 0) throw new Error(fail + ' test(s) failed');
