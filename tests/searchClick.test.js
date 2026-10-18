/**
 * searchClick.test.js — clicking a Subject / From / To in the email Preview builds a decoded-search query with
 * EV.searchQueryFor (js/ui/render.js) that is then run as an ordinary search. This drives the real pipeline end to
 * end (emlParser -> buildIndexDoc -> searchIndex) to prove the generated query always parses and finds exactly
 * the emails sharing that subject/sender, including awkward values: a subject containing double quotes (the
 * grammar has no escape for a quote inside a phrase), parentheses, a capitalised OR, colons, extra whitespace.
 * The click wiring itself (button -> EV.searchFor -> search box) is DOM and is covered by a live-browser pass.
 * Run via tests/run-all.sh, or directly: jsc tests/searchClick.test.js (from the repo root).
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
EV.settings = { domainCategories: function () { return Promise.resolve([]); }, internalDomains: function () { return Promise.resolve([]); }, trustedDomains: function () { return Promise.resolve([]); } }; // render.js reads it once at load
load('js/core/settingsCache.js');
load('js/ui/uiKit.js');
load('js/ui/email/securityCard.js');
load('js/ui/email/headersView.js');
load('js/ui/email/attachmentsView.js');
load('js/ui/render.js');

var pass = 0, fail = 0;
function assert(cond, label) { if (cond) pass++; else { fail++; print('FAIL: ' + label); } }
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// ---- the query builder on its own ----
var Q = EV.searchQueryFor;
assert(Q('header.subject', 'Invoice 42') === 'header.subject:"Invoice 42"', 'a plain value becomes one quoted phrase');
assert(Q('header.from', 'bw@shared.example') === 'header.from:"bw@shared.example"', 'an address becomes a quoted value');
assert(Q('header.subject', '  Two  spaces \t and\na newline ') === 'header.subject:"Two  spaces   and a newline"', 'inner spacing is kept as in the email; line breaks/tabs become spaces; the ends are trimmed');
assert(Q('header.subject', 'Bretney shared "Company Profit Sharing" with you') ===
  'header.subject:"Bretney shared" header.subject:"Company Profit Sharing" header.subject:"with you"', 'double quotes split the value into ANDed phrases');
assert(Q('header.subject', '"""') === '' && Q('header.subject', '') === '' && Q('header.subject', null) === '' && Q('header.subject', '   ') === '', 'nothing searchable -> empty query');
assert(Q('header.subject', '"leading and trailing"') === 'header.subject:"leading and trailing"', 'quotes at the edges are dropped cleanly');

var QA = EV.searchQueryForAny;
assert(QA('header.to', ['a@x.com']) === 'header.to:"a@x.com"', 'one address: the same plain query as before');
assert(QA('header.to', ['a@x.com', 'b@y.org']) === '(header.to:"a@x.com" OR header.to:"b@y.org")', 'several addresses: an editable (a OR b) group');
assert(QA('header.to', ['', null, 'b@y.org']) === 'header.to:"b@y.org"', 'empty values are skipped (and a lone survivor needs no group)');
assert(QA('header.to', []) === '' && QA('header.to', undefined) === '' && QA('header.to', ['', '  ']) === '', 'nothing searchable -> empty query');

// ---- end to end ----
function mail(headers, body) {
  var s = headers.join('\r\n') + '\r\n\r\n' + body, a = new Uint8Array(s.length);
  for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 255;
  return a.buffer;
}
var SUBJ_Q = 'Bretney Webb shared "Company Profit Sharing" with you';
var SUBJ_ODD = 'Re: (urgent) invoice OR payment: Q4  2024';
var emails = {
  e1: mail(['From: Bretney Webb <bw@shared.example>', 'To: me@example.org', 'Subject: ' + SUBJ_Q, 'Message-ID: <1@t>', 'Content-Type: text/plain'], 'a'),
  e2: mail(['From: Someone Else <other@evil.example>', 'To: me@example.org', 'Subject: ' + SUBJ_Q, 'Message-ID: <2@t>', 'Content-Type: text/plain'], 'b'),
  e3: mail(['From: Bretney Webb <bw@shared.example>', 'To: me@example.org, you@example.org', 'Subject: Totally different', 'Message-ID: <3@t>', 'Content-Type: text/plain'], 'c'),
  e4: mail(['From: nobody@else.example', 'To: you@example.org', 'Subject: ' + SUBJ_ODD, 'Message-ID: <4@t>', 'Cc: cc.person@example.org', 'Content-Type: text/plain'], 'd')
};
var idx = EV.createSearchIndex(null);
idx.resetForTest();
var names = Object.keys(emails);
var chain = Promise.resolve();
names.forEach(function (n, i) { chain = chain.then(function () { return EV.buildIndexDoc(i, n + '.eml', emails[n], {}); }).then(function (d) { idx.ingestDocForTest(d); }); });
function hits(query, expected, label) {
  chain = chain.then(function () { return idx.search(query, {}); }).then(function (res) {
    var got = res.results.map(function (r) { return r.path.replace('.eml', ''); }).sort();
    assert(eq(got, expected.slice().sort()), label + ' [' + query + '] -> ' + JSON.stringify(got) + (res.warnings && res.warnings.length ? ' warnings=' + JSON.stringify(res.warnings) : ''));
  });
}
hits(Q('header.subject', SUBJ_Q), ['e1', 'e2'], 'clicking a subject that contains quotes finds every email with it');
hits(Q('header.subject', SUBJ_ODD), ['e4'], 'a subject with parentheses, a capitalised OR, colons and a double space is searched literally');
hits(Q('header.subject', 'Totally different'), ['e3'], 'a plain subject finds just that email');
hits(Q('header.from', 'bw@shared.example'), ['e1', 'e3'], 'clicking a sender finds every email from that address');
hits(Q('header.to', 'you@example.org'), ['e3', 'e4'], 'clicking a recipient finds every email sent to them (not only when they are the first)');
hits(Q('header.cc', 'cc.person@example.org'), ['e4'], 'Cc address');
hits(QA('header.to', ['me@example.org', 'you@example.org']), ['e1', 'e2', 'e3', 'e4'], 'a To list searches for ANY of its addresses (clicking the To tag)');
hits(QA('header.to', ['nobody@nowhere.example', 'you@example.org']), ['e3', 'e4'], 'an address that matches nothing does not block the others');
hits(QA('header.from', ['bw@shared.example', 'nobody@else.example']), ['e1', 'e3', 'e4'], 'a From list works the same way');
hits(Q('header.from', 'nobody@else.example'), ['e4'], 'a sender with no display name');
hits(Q('header.subject', 'No such subject anywhere'), [], 'an unmatched subject finds nothing (and does not throw)');

// ---- header.subject:"word" is a case-insensitive SUBSTRING search, quoted or not ----
var subs = ['Verify your account now', 'ACCOUNT locked', 'Your accounts summary', 'myaccount@bank update', 'Accounting dept notice',
  'Re:account-recovery', 'Nothing relevant here', 'Acc ount split'];
var idx2 = EV.createSearchIndex(null);
idx2.resetForTest();
subs.forEach(function (sj, i) {
  chain = chain.then(function () { return EV.buildIndexDoc(i, 's' + i + '.eml', mail(['From: a@x.com', 'To: b@x.com', 'Subject: ' + sj, 'Message-ID: <sub' + i + '@t>', 'Content-Type: text/plain'], 'body'), {}); })
    .then(function (d) { idx2.ingestDocForTest(d); });
});
function subjHits(query, expectedIdx, label) {
  chain = chain.then(function () { return idx2.search(query, {}); }).then(function (res) {
    var got = res.results.map(function (r) { return parseInt(r.path.slice(1), 10); }).sort();
    assert(eq(got, expectedIdx), label + ' [' + query + '] -> ' + JSON.stringify(got));
  });
}
var ACC = [0, 1, 2, 3, 4, 5]; // every subject containing the letters "account", wherever they sit
subjHits('header.subject:"account"', ACC, 'quoted word matches inside longer words, addresses and after punctuation (accounts, myaccount@, Accounting, Re:account-)');
subjHits('header.subject:account', ACC, 'the unquoted form is identical');
subjHits('header.subject:"ACCOUNT"', ACC, 'case-insensitive');
subjHits('header.subject:"ccount"', ACC, 'any fragment works, not just the start of a word');
subjHits('header.subject:"account lock"', [1], 'a multi-word quoted phrase needs the words adjacent');

// ---- clicking an attachment name in the Metadata card searches attachment.filename ----
function withAtt(n, names) {
  var parts = '--B\r\nContent-Type: text/plain\r\n\r\nbody\r\n';
  names.forEach(function (nm) {
    parts += '--B\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename="' + nm + '"\r\nContent-Transfer-Encoding: base64\r\n\r\nJVBERi0=\r\n';
  });
  return mail(['From: a@x.com', 'To: b@x.com', 'Subject: att ' + n, 'Message-ID: <att' + n + '@t>', 'Content-Type: multipart/mixed; boundary=B'], parts + '--B--\r\n');
}
var attMails = [
  withAtt(0, ['Inv-001.pdf', 'notes.txt']),
  withAtt(1, ['Inv-002.pdf']),
  withAtt(2, ['report.pdf']),
  withAtt(3, ['Inv-001.pdf.exe']),
  withAtt(4, ["weird 'x' report.pdf"]),
  withAtt(5, ['plain.pdf'])
];
var idx3 = EV.createSearchIndex(null);
idx3.resetForTest();
attMails.forEach(function (m, i) {
  chain = chain.then(function () { return EV.buildIndexDoc(i, 'a' + i + '.eml', m, {}); }).then(function (d) { idx3.ingestDocForTest(d); });
});
function attHits(query, expectedIdx, label) {
  chain = chain.then(function () { return idx3.search(query, {}); }).then(function (res) {
    var got = res.results.map(function (r) { return parseInt(r.path.slice(1), 10); }).sort();
    assert(eq(got, expectedIdx), label + ' [' + query + '] -> ' + JSON.stringify(got));
  });
}
attHits(Q('attachment.filename', 'Inv-001.pdf'), [0, 3], 'clicking an attachment name finds every email with that name (a longer name containing it, Inv-001.pdf.exe, is included: it is a substring search)');
attHits(Q('attachment.filename', 'notes.txt'), [0], 'a second attachment of the same email');
attHits(Q('attachment.filename', 'plain.pdf'), [5], 'a unique attachment name');
attHits('attachment.filename:/Inv-.*\\.pdf$/i', [0, 1], 'the regex form of the same search: Inv-<anything>.pdf, anchored so Inv-001.pdf.exe is excluded');
attHits('attachment.filename:/Inv-.*\\.pdf/i', [0, 1, 3], 'without the $ anchor the .exe variant matches too');
attHits('attachment.filename:/Inv-*\\.pdf/i', [], 'the glob-style Inv-*\\.pdf means "zero or more hyphens" in a regex, so it does NOT match Inv-001.pdf (use Inv-.*\\.pdf)');
chain = chain.then(function () { return idx3.search('Inv-.*\\.pdf$', { isRegex: true }); }).then(function (res) {
  var got = res.results.map(function (r) { return parseInt(r.path.slice(1), 10); }).sort();
  assert(eq(got, [0, 1]), 'the Use Regex toggle also tests each attachment filename on its own (anchors apply per filename) -> ' + JSON.stringify(got));
});
attHits(Q('attachment.filename', "weird 'x' report.pdf"), [4], 'a name with punctuation');
attHits(Q('attachment.filename', 'a "quoted" name.pdf'), [], 'a name with double quotes becomes ANDed pieces and still parses (nothing has it, and no error)');

chain.then(function () {
  print('---');
  print('PASS: ' + pass + '  FAIL: ' + fail);
  if (fail > 0) throw new Error(fail + ' test(s) failed');
});
