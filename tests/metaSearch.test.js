/**
 * metaSearch.test.js — the meta.* search fields (one per row of the Preview's Metadata card) and url:.
 * Drives the real pipeline end to end (emlParser -> buildIndexDoc -> searchIndex) over emails built to differ in
 * exactly the ways those fields look at: sender / Reply-To / Return-Path domains, link hosts and link paths,
 * domain categories, the mismatch/anomaly flags and financial indicators.
 * Run via tests/run-all.sh, or directly: jsc tests/metaSearch.test.js (from the repo root).
 */
load('tests/helpers/textdecoder_polyfill.js');
// jsc has no URL class (every browser does); the indexer only reads `.hostname` from it, so a tiny stand-in is enough.
if (typeof URL === 'undefined') {
  this.URL = function (u) {
    var m = /^[a-z][a-z0-9+.-]*:\/\/([^\/:?#]+)/i.exec(String(u));
    if (!m) throw new TypeError('Invalid URL');
    this.hostname = m[1];
  };
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

function mail(headers, body, ct) {
  var s = headers.concat(['Content-Type: ' + (ct || 'text/plain')]).join('\r\n') + '\r\n\r\n' + body, a = new Uint8Array(s.length);
  for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 255;
  return a.buffer;
}
var base = function (n, from) { return ['From: ' + from, 'To: me@example.org', 'Subject: mail ' + n, 'Message-ID: <' + n + '@t>']; };
var emails = {
  // A: sender on a paypal-ish look-alike domain, Reply-To elsewhere, bounce domain elsewhere, shortener + pdf links
  A: mail(base('A', 'Support <help@mail.paypal-secure.com>').concat(['Reply-To: scammer@gmail.com', 'Return-Path: <bounce@other.net>']),
    'Open https://bit.ly/abc123 or https://files.example.com/docs/invoice.pdf now'),
  // B: clean, everything aligned, a pdf link on its own domain
  B: mail(base('B', 'ok@corp.com').concat(['Reply-To: ok@corp.com']), 'Report: https://corp.com/reports/q4.pdf'),
  // C: display name claims PayPal but the domain is unrelated
  C: mail(base('C', 'PayPal Service <svc@payments-update.net>'), 'Hello, see https://payments-update.net/login'),
  // D: punycode sender
  D: mail(base('D', 'x@xn--pypal-4ve.com'), 'nothing to see'),
  // E: financial indicator in the body, no links
  E: mail(base('E', 'cfo@corp.com'), 'Please wire to IBAN GB29NWBK60161331926819 today'),
  // F: html link whose text hides the destination
  F: mail(base('F', 'news@corp.com'), '<p>Read <a href="https://news.corp.com/story.html">https://example.com/safe</a></p>', 'text/html'),
  // G: two public hops: it claims to start at 203.0.113.9 and was handed to the receiving side by 198.51.100.7
  G: mail(base('G', 'g@corp.com').concat(['Received: from mx.b.org (mx.b.org [198.51.100.7]) by in.c.net; Mon, 1 Jan 2024 10:00:09 +0000', 'Received: from mail.a.com (mail.a.com [203.0.113.9]) by mx.b.org; Mon, 1 Jan 2024 10:00:05 +0000']), 'hello')
};
var cats = [{ name: 'URL Shortener', keywords: ['bit.ly'] }, { name: 'File Sharing', keywords: ['files.example.com'] }];
var idx = EV.createSearchIndex(null);
idx.resetForTest();
var names = Object.keys(emails);
var chain = Promise.resolve();
names.forEach(function (n, i) {
  chain = chain.then(function () { return EV.buildIndexDoc(i, n + '.eml', emails[n], { domainCategories: cats }); }).then(function (d) { idx.ingestDocForTest(d); });
});
function hits(query, expected, label) {
  chain = chain.then(function () { return idx.search(query, {}); }).then(function (res) {
    var got = res.results.map(function (r) { return r.path.replace('.eml', ''); }).sort();
    assert(eq(got, expected.slice().sort()), label + '  [' + query + '] -> ' + JSON.stringify(got) + (res.warnings && res.warnings.length ? ' warnings=' + JSON.stringify(res.warnings) : ''));
    return res;
  });
}
function warns(query, pattern, label) {
  chain = chain.then(function () { return idx.search(query, {}); }).then(function (res) {
    assert(res.warnings && res.warnings.some(function (w) { return pattern.test(w); }) && res.results.length === 0, label + '  [' + query + '] warnings=' + JSON.stringify(res.warnings));
  });
}

// ---- url: = substring on the link ADDRESSES (there is deliberately no second name for it) ----
hits('url:".pdf"', ['A', 'B'], 'url:".pdf" finds every email linking to a pdf');
hits('url:example', ['A', 'F'], 'url:example is a substring match (files.example.com in A, the example.com text in F counts as its own url)');
hits('url:bit.ly', ['A'], 'url:bit.ly');
hits('url:"docs/invoice"', ['A'], 'a path fragment of the link');
hits('url:.PDF', ['A', 'B'], 'case-insensitive');
hits('-url:".pdf" url:corp', ['F'], 'combined with negation');
// ---- the Metadata card, row by row ----
hits('meta.fromdomain:paypal', ['A'], 'sender domain contains paypal (the display name of C is NOT the domain)');
hits('meta.fromdomain:corp.com', ['B', 'E', 'F', 'G'], 'sender domain');
hits('meta.replytodomain:gmail', ['A'], 'Reply-To domain');
hits('meta.returnpathdomain:other.net', ['A'], 'Return-Path domain');
hits('meta.urldomain:corp.com', ['B', 'F'], 'host of any link (substring)');
hits('meta.urldomain:bit.ly', ['A'], 'a shortener host');
hits('meta.category:shortener', ['A'], 'domain category by name, case-insensitive substring');
hits('meta.category:"file sharing"', ['A'], 'a category name with a space');
// ---- flags, same definitions as the card's badges ----
hits('meta.flag:replyto-mismatch', ['A'], 'Reply-To domain differs from the sender domain');
hits('meta.flag:returnpath-mismatch', ['A'], 'Return-Path domain differs from the sender domain');
hits('meta.flag:name-mismatch', ['C'], 'display name claims a brand the domain is not');
hits('meta.flag:punycode', ['D'], 'punycode sender domain');
hits('meta.flag:REPLYTO-MISMATCH', ['A'], 'flag names are case-insensitive');
hits('-meta.flag:replyto-mismatch meta.fromdomain:corp.com', ['B', 'E', 'F', 'G'], 'negated flag');
hits('meta.financial:iban', ['E'], 'financial indicator type');
hits('meta.financial:"swift bic"', [], 'a financial type that is not present matches nothing (spaces tolerated)');
// ---- the sender IPs (from the Received chain) ----
hits('meta.connectingip:198.51.100.7', ['G'], 'the IP that connected to the receiving side');
hits('meta.originip:203.0.113.9', ['G'], 'the earliest public IP in the chain');
hits('meta.connectingip:203.0.113', [], 'the origin IP is not the connecting IP when there are two public hops');
hits('meta.originip:198.51', [], 'and the other way round');
hits('meta.connectingip:198.51.100', ['G'], 'substring match on the address');
hits('-meta.connectingip:198.51 meta.fromdomain:corp.com', ['B', 'E', 'F'], 'negated');
hits('meta.originip:2001', [], 'an email with no IP never matches');
warns('meta.connectingip:""', /needs a value/, 'an empty value warns instead of matching everything');
chain = chain.then(function () {
  var sum = idx.iocSummary();
  assert(eq(sum.connectingIps, [{ value: '198.51.100.7', count: 1 }]) && eq(sum.originIps, [{ value: '203.0.113.9', count: 1 }]), 'the IOC summary rolls up both sender IPs');
  var only = idx.iocSummary(new Set(['A.eml']));
  assert(only.connectingIps.length === 0 && only.originIps.length === 0, 'and honours the selection scope');
});
// ---- mistakes are explained, never silently "everything" ----
warns('meta.flag:bogus', /not a known meta\.flag/, 'an unknown flag name explains the valid ones');
warns('meta.fromdomain:""', /needs a value/, 'an empty value warns instead of matching everything');
// ---- single source of truth for the autocomplete's closed lists ----
chain = chain.then(function () {
  var offered = EV.SEARCH_META_VALUES['meta.flag'];
  assert(['replyto-mismatch', 'returnpath-mismatch', 'name-mismatch', 'lookalike', 'punycode'].every(function (f) { return offered.indexOf(f) !== -1; }) &&
    EV.ANOMALY_FLAG_IDS.every(function (f) { return offered.indexOf(f) !== -1; }) && offered.length === new Set(offered).size,
    'the flag list the autocomplete offers = the five sender flags + every Security-checklist id, no duplicates (' + offered.length + ')');
  var cn = idx.categoryNames();
  assert(cn.length === 2 && cn[0].count === 1, 'categoryNames() lists the folder\'s domain categories with counts for autocomplete (' + JSON.stringify(cn) + ')');
});

chain.then(function () {
  print('---');
  print('PASS: ' + pass + '  FAIL: ' + fail);
  if (fail > 0) throw new Error(fail + ' test(s) failed');
});
