/**
 * securitySearch.test.js — the Security checklist's flags and the script fields as SEARCH: meta.flag:<id> for every id
 * the checklist can raise, and script.subject: / script.body:. Drives the real pipeline end to end (emlParser ->
 * buildIndexDoc -> analyzeAnomalies -> searchIndex) so the card, the index and the search provably share one
 * definition. Run via tests/run-all.sh, or directly: jsc tests/securitySearch.test.js (from the repo root).
 */
load('tests/helpers/textdecoder_polyfill.js');
if (typeof URL === 'undefined') {
  this.URL = function (u) { var m = /^[a-z][a-z0-9+.-]*:\/\/([^\/:?#]+)/i.exec(String(u)); if (!m) throw new TypeError('Invalid URL'); this.hostname = m[1]; };
}
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
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function utf8(str) {
  var out = [];
  for (var i = 0; i < str.length; i++) {
    var c = str.codePointAt(i); if (c > 0xFFFF) i++;
    if (c < 0x80) out.push(c); else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}
function mail(headers, body) { return new Uint8Array(utf8(headers.join('\r\n') + '\r\n\r\n' + body)).buffer; }
var REC = 'Received: from a by b; Mon, 1 Jan 2024 10:00:05 +0000';
var BODY = 'Please review the attached quarterly report and send your comments about the budget before Friday afternoon meeting.';
function base(n, subj, extra) { return ['From: Sender <s' + n + '@example.com>', 'To: me@example.org', 'Subject: ' + subj, 'Message-ID: <m' + n + '@example.com>', REC].concat(extra || []); }
var cyrA = 'а';
var emails = {
  fake:     mail(base('1', 'Re: invoice 77', ['Content-Type: text/plain']), BODY),                                    // 0 Re: with no thread headers
  thread:   mail(base('2', 'Re: invoice 77', ['In-Reply-To: <o@x>', 'Content-Type: text/plain']), BODY),             // 1 genuine thread
  htmlonly: mail(base('3', 'Offer', ['Content-Type: text/html']), '<p>' + BODY + '</p>'),                            // 2 no text part
  glyphBody: mail(base('4', 'Hello', ['Content-Type: text/plain']), 'Verify your p' + cyrA + 'ypal account today please ' + BODY), // 3
  cyrSubject: mail(base('5', 'Привет мир это тест', ['Content-Type: text/plain; charset=utf-8']), BODY), // 4
  noReceived: mail(['From: Sender <s6@example.com>', 'To: me@example.org', 'Subject: Hi', 'Message-ID: <m6@example.com>', 'Content-Type: text/plain'], BODY), // 5
  dupFrom:  mail(['From: a@example.com', 'From: b@evil.net', 'To: me@example.org', 'Subject: Hi', 'Message-ID: <m7@example.com>', REC, 'Content-Type: text/plain'], BODY), // 6
  replyTo:  mail(base('8', 'Hi', ['Reply-To: boss@gmail.com', 'Content-Type: text/plain']), BODY),                   // 7
  clean:    mail(base('9', 'Meeting notes', ['Content-Type: text/plain']), BODY),                                     // 8
  cyrBody:  mail(base('10', 'Meeting', ['Content-Type: text/plain; charset=utf-8']), 'Ваш платёж подтверждён и мы благодарим вас') // 9
};
var names = Object.keys(emails);
var idx = EV.createSearchIndex(null);
idx.resetForTest();
var chain = Promise.resolve();
names.forEach(function (n, i) { chain = chain.then(function () { return EV.buildIndexDoc(i, n + '.eml', emails[n], {}); }).then(function (d) { idx.ingestDocForTest(d); }); });
function hits(query, expected, label) {
  chain = chain.then(function () { return idx.search(query, {}); }).then(function (res) {
    var got = res.results.map(function (r) { return r.path.replace('.eml', ''); }).sort();
    assert(eq(got, expected.slice().sort()), label + '  [' + query + '] -> ' + JSON.stringify(got) + (res.warnings && res.warnings.length ? ' warnings=' + JSON.stringify(res.warnings) : ''));
  });
}
function warns(query, pattern, label) {
  chain = chain.then(function () { return idx.search(query, {}); }).then(function (res) {
    assert(res.warnings && res.warnings.some(function (w) { return pattern.test(w); }) && res.results.length === 0, label + '  [' + query + '] warnings=' + JSON.stringify(res.warnings));
  });
}

hits('meta.flag:fake-reply', ['fake'], 'a "Re:" with no reply headers');
hits('meta.flag:threaded', ['thread'], 'a genuine reply thread');
hits('meta.flag:no-text-part', ['htmlonly'], 'HTML-only mail');
hits('meta.flag:no-html-part', ['fake', 'thread', 'glyphBody', 'cyrSubject', 'noReceived', 'dupFrom', 'replyTo', 'clean', 'cyrBody'], 'plain-text-only mail');
hits('meta.flag:homoglyph-body', ['glyphBody'], 'a mixed-script word in the body');
hits('meta.flag:no-received', ['noReceived'], 'no Received headers');
hits('meta.flag:duplicate-headers', ['dupFrom'], 'a duplicated From header');
hits('meta.flag:replyto-mismatch', ['replyTo'], 'Reply-To mismatch (same definition as the Security card)');
hits('meta.flag:script-mismatch', ['cyrSubject', 'cyrBody'], 'subject and body in different scripts');
hits('script.subject:cyrillic', ['cyrSubject'], 'a Cyrillic subject');
hits('script.body:cyrillic', ['cyrBody'], 'a Cyrillic body');
hits('script.subject:latin', ['fake', 'thread', 'htmlonly', 'glyphBody', 'noReceived', 'dupFrom', 'replyTo', 'clean', 'cyrBody'], 'Latin subjects');
hits('script.body:CYRILLIC', ['cyrBody'], 'script names are case-insensitive');
hits('-script.body:latin script.body:cyrillic', ['cyrBody'], 'negation composes');
hits('meta.flag:fake-reply -meta.flag:replyto-mismatch', ['fake'], 'flags combine with AND and NOT');
hits('(meta.flag:fake-reply OR meta.flag:no-received)', ['fake', 'noReceived'], 'flags combine with OR');
hits('meta.flag:homoglyph-subject', [], 'a flag nothing has matches nothing');
warns('script.body:klingon', /not a known script/, 'an unknown script explains the valid ones');
warns('script.subject:""', /needs a value/, 'an empty script value warns');
warns('meta.flag:bogus', /not a known meta\.flag/, 'an unknown flag still explains itself');
chain = chain.then(function () {
  // the clean email raises nothing except what a plain-text-only mail always does
  return idx.search('meta.flag:no-html-part', {});
}).then(function (res) {
  var clean = res.results.filter(function (r) { return r.path === 'clean.eml'; }).length === 1;
  assert(clean, 'the clean email only carries the benign "no HTML part" note');
  var allIds = EV.ANOMALY_FLAG_IDS.length;
  assert(allIds >= 20, 'the checklist registers its ids (' + allIds + ')');
});

chain.then(function () {
  var fc = idx.flagCounts();
  assert(fc.indexed === Object.keys(emails).length, 'flagCounts: every indexed email is counted (' + fc.indexed + ')');
  assert(fc.counts['fake-reply'] === 1 && fc.counts['threaded'] === 1, 'flagCounts: per-flag counts match what meta.flag: finds');
  var sum = 0; Object.keys(fc.counts).forEach(function (k) { sum += fc.counts[k]; });
  assert(sum > 0 && fc.counts['no-such-flag'] === undefined, 'flagCounts: only flags that occur are listed');
  return idx.search('meta.flag:fake-reply', {}).then(function (res) { assert(res.results.length === fc.counts['fake-reply'], 'flagCounts agrees with the search itself'); });
});

chain.then(function () {
  print('---');
  print('PASS: ' + pass + '  FAIL: ' + fail);
  if (fail > 0) throw new Error(fail + ' test(s) failed');
});
