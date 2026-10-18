/**
 * decodedSearch.test.js — Decoded search must find what a human READS, whatever encoding the mail used on
 * the wire. Drives the real pipeline end to end (emlParser -> buildIndexDoc -> searchIndex) over emails
 * built byte-for-byte with RFC 2047 encoded-words (B and Q, split and folded), base64 / quoted-printable /
 * 8-bit bodies (with soft line breaks), HTML entities (named, hex, decimal, with or without a semicolon),
 * invisible-character obfuscation, internationalized (punycode) link hosts and decoded display names. The
 * charsets jsc's TextDecoder polyfill can't do (windows-1251, Shift-JIS, GB2312, UTF-16...) are covered in
 * a real browser instead. Run via tests/run-all.sh, or directly: jsc tests/decodedSearch.test.js.
 */
load('tests/helpers/textdecoder_polyfill.js');
load('js/parsing/emlParser.js');
load('js/parsing/urlExtract.js');
load('js/indexing/pathFilter.js');
load('js/parsing/headerTables.js');
load('js/indexing/anomalies.js');
load('js/indexing/indexLogic.js');
load('js/indexing/searchIndex.js');
var EV = this.EV;
EV.tags = { getAll: function () { return Promise.resolve([]); } };
var pass = 0, fail = 0;
function assert(cond, label) { if (cond) pass++; else { fail++; print('FAIL: ' + label); } }

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
function b64(str) { var bytes = utf8(str), s = ''; for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s); }
function mail(headers, body) { return new Uint8Array(utf8(headers.join('\r\n') + '\r\n\r\n' + body)).buffer; }
var common = ['To: v@example.com', 'Date: Mon, 1 Jan 2024 00:00:00 +0000'];

var cases = {
  subjB: mail(['From: a@x.com', 'Subject: =?UTF-8?B?' + b64('Счёт оплату срочно') + '?=', 'Message-ID: <1@t>'].concat(common, ['Content-Type: text/plain']), 'plain'),
  subjQ: mail(['From: a@x.com', 'Subject: =?iso-8859-1?Q?caf=E9_cr=E8me?=', 'Message-ID: <2@t>'].concat(common, ['Content-Type: text/plain']), 'plain'),
  subjSplit: mail(['From: a@x.com', 'Subject: =?UTF-8?B?' + b64('оплату ') + '?= =?UTF-8?B?' + b64('сегодня вечером') + '?=', 'Message-ID: <3@t>'].concat(common, ['Content-Type: text/plain']), 'plain'),
  subjFolded: mail(['From: a@x.com', 'Subject: =?UTF-8?B?' + b64('Первая часть ') + '?=\r\n =?UTF-8?B?' + b64('вторая часть') + '?=', 'Message-ID: <4@t>'].concat(common, ['Content-Type: text/plain']), 'plain'),
  subjRaw8: mail(['From: a@x.com', 'Subject: Приглашение на собрание', 'Message-ID: <5@t>'].concat(common, ['Content-Type: text/plain']), 'plain'),
  names: mail(['From: =?utf-8?B?' + b64('Иван Петров') + '?= <ivan@example.ru>', 'To: =?utf-8?Q?J=C3=BCrgen_M=C3=BCller?= <jm@example.de>', 'Cc: =?utf-8?B?' + b64('Zoë Ünal') + '?= <cc@example.com>', 'Subject: names', 'Message-ID: <6@t>', 'Date: Mon, 1 Jan 2024 00:00:00 +0000', 'Content-Type: text/plain'], 'plain'),
  bodyB64: mail(['From: a@x.com', 'Subject: s7', 'Message-ID: <7@t>'].concat(common, ['Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64']), b64('Ваш платёж подтверждён') + '\r\n'),
  bodyQP: mail(['From: a@x.com', 'Subject: s8', 'Message-ID: <8@t>'].concat(common, ['Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: quoted-printable']), 'r=C3=A9sum=C3=\r\n=A9 =E2=82=AC500 invoice\r\n'),
  body8bit: mail(['From: a@x.com', 'Subject: s9', 'Message-ID: <9@t>'].concat(common, ['Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit']), 'Пожалуйста подтвердите 請確認您的帳戶\r\n'),
  html: mail(['From: a@x.com', 'Subject: s10', 'Message-ID: <10@t>'].concat(common, ['Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: base64']),
    b64('<p>pay&#112;al &amp; &eacute;t&#xE9; &nbsp;invoice &#1089;&#1095;&#1105;&#1090; &euro;99 &#112aypal2 &#99999999;</p><span style="display:none">hiddenmarker</span><a href="http://xn--e1afmkfd.xn--p1ai/pay">link</a>') + '\r\n'),
  zerowidth: mail(['From: a@x.com', 'Subject: s11', 'Message-ID: <11@t>'].concat(common, ['Content-Type: text/html; charset=utf-8']), '<p>verify your pay&shy;pal acc&#8203;ount &zwnj;now</p>'),
  xheader: mail(['From: a@x.com', 'Subject: s12', 'X-Campaign: =?utf-8?B?' + b64('Кампания Альфа') + '?=', 'Message-ID: <12@t>'].concat(common, ['Content-Type: text/plain']), 'plain'),
  attach: mail(['From: a@x.com', 'Subject: s13', 'Message-ID: <13@t>'].concat(common, ['Content-Type: multipart/mixed; boundary=M']),
    "--M\r\nContent-Type: text/plain\r\n\r\nbody\r\n--M\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment; filename*=UTF-8''%D0%BE%D0%BF%D0%BB%D0%B0%D1%82%D0%B0.pdf\r\nContent-Transfer-Encoding: base64\r\n\r\nJVBERi0=\r\n--M\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment; filename=\"=?utf-8?B?" + b64('счёт.pdf') + "?=\"\r\nContent-Transfer-Encoding: base64\r\n\r\nJVBERi0=\r\n--M--\r\n")
};

var idx = EV.createSearchIndex(null);
idx.resetForTest();
var names = Object.keys(cases);
var chain = Promise.resolve();
names.forEach(function (name, i) {
  chain = chain.then(function () { return EV.buildIndexDoc(i, name + '.eml', cases[name], {}); }).then(function (doc) { idx.ingestDocForTest(doc); });
});
function expectHits(q, expected, label) {
  chain = chain.then(function () { return idx.search(q); }).then(function (res) {
    var got = res.results.map(function (r) { return r.path.replace('.eml', ''); }).sort();
    var want = expected.slice().sort();
    assert(JSON.stringify(got) === JSON.stringify(want), label + ' [' + q + '] expected ' + JSON.stringify(want) + ' got ' + JSON.stringify(got));
  });
}

// ---- headers: RFC 2047 words (B and Q, split, folded) and raw 8-bit UTF-8 ----
expectHits('оплату', ['subjB', 'subjSplit'], 'subject: B-encoded word');
expectHits('café', ['subjQ'], 'subject: Q-encoded latin1');
expectHits('crème', ['subjQ'], 'subject: Q-encoded latin1 (underscore = space)');
expectHits('"оплату сегодня"', ['subjSplit'], 'subject: two encoded-words are joined');
expectHits('"Первая часть вторая часть"', ['subjFolded'], 'subject: folded across lines');
expectHits('Приглашение', ['subjRaw8'], 'subject: raw 8-bit UTF-8 header');
expectHits('header.subject:оплату', ['subjB', 'subjSplit'], 'header.subject: decodes too');
expectHits('Иван', ['names'], 'From display name decoded');
expectHits('header.from:Иван', ['names'], 'header.from: finds the decoded display name');
expectHits('header.to:Jürgen', ['names'], 'header.to: finds the decoded display name (not only the address)');
expectHits('header.cc:Zoë', ['names'], 'header.cc: finds the decoded display name');
expectHits('header.to:jm@example.de', ['names'], 'header.to: still finds the full address');
expectHits('header.x-campaign:Альфа', ['xheader'], 'any other header is decoded and searchable by name');
expectHits('header.raw:Кампания', ['xheader'], 'header.raw: searches decoded header text');
expectHits('attachment.filename:оплата', ['attach'], 'attachment filename: RFC 2231 percent-encoding decoded');
expectHits('attachment.filename:счёт', ['attach'], 'attachment filename: RFC 2047 word decoded');
// ---- bodies: transfer encodings ----
expectHits('платёж', ['bodyB64'], 'body: base64 UTF-8');
expectHits('résumé', ['bodyQP'], 'body: quoted-printable, soft line break inside a multi-byte character');
expectHits('€500', ['bodyQP'], 'body: quoted-printable euro sign');
expectHits('подтвердите', ['body8bit'], 'body: 8-bit UTF-8');
expectHits('帳戶', ['body8bit'], 'body: CJK');
expectHits('body:платёж', ['bodyB64'], 'body: field-scoped search');
// ---- HTML entities and obfuscation ----
expectHits('paypal', ['html', 'zerowidth'], 'HTML decimal entity inside a word, and soft hyphen / zero-width characters inside a word');
expectHits('paypal2', ['html'], 'numeric entity with no trailing semicolon');
expectHits('été', ['html'], 'HTML named + hex entities');
expectHits('€99', ['html'], 'HTML named entity &euro;');
expectHits('счёт', ['html', 'attach', 'subjB'], 'HTML decimal Cyrillic entities (plus the attachment счёт.pdf and subject Счёт…, found case-insensitively)');
expectHits('account now', ['zerowidth'], 'zero-width space / joiner removed from body text');
expectHits('hiddenmarker', ['html'], 'text hidden with CSS is still searchable');
expectHits('пример.рф', ['html'], 'a punycode link host is searchable by its readable name');
expectHits('xn--e1afmkfd', ['html'], '...and by its raw punycode form');

chain.then(function () {
  print('---');
  print('PASS: ' + pass + '  FAIL: ' + fail);
  if (fail > 0) throw new Error(fail + ' test(s) failed');
});
