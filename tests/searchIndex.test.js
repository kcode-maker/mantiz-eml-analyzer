/**
 * searchIndex.test.js — regression coverage for js/searchIndex.js's query
 * grammar, in particular the OR / parenthesized-grouping support added on
 * top of the pre-existing flat AND-everything grammar: a proper tokenizer
 * (tokenizeQuery) -> recursive-descent parser (parseTokens) -> recursive
 * evaluator (evalNode) replacing the old single-pass regex-based
 * parseQuery(). Exercises real js/urlExtract.js (for EV.tokenize, the only
 * runtime dependency searchIndex.js has for token matching) and real
 * js/searchIndex.js against synthetic per-file docs fed in through the
 * TEST-ONLY ingestDocForTest/resetForTest hooks (see searchIndex.js's
 * `return { ... }` at the bottom of createSearchIndex). Run via
 * tests/run-all.sh, or directly: jsc tests/searchIndex.test.js (from the
 * repo root).
 */
load('js/parsing/urlExtract.js');
load('js/indexing/searchIndex.js');

var EV = this.EV;

// Minimal EV.tags mock: two of our synthetic docs are tagged 'phish'.
EV.tags = {
  getAll: function () {
    return Promise.resolve([
      { id: 'mid:1', tags: ['phish'] },
      { id: 'mid:4', tags: ['phish'] }
    ]);
  }
};

var pass = 0, fail = 0;
function assert(cond, label) { if (cond) pass++; else { fail++; print('FAIL: ' + label); } }
function assertPaths(actualResults, expectedPaths, label) {
  var actual = actualResults.map(function (r) { return r.path; }).sort();
  var expected = expectedPaths.slice().sort();
  assert(JSON.stringify(actual) === JSON.stringify(expected),
    label + ' (expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual) + ')');
}

var idx = EV.createSearchIndex(null);

/** Builds a synthetic per-file doc in exactly the shape ingestDoc() expects — see searchIndex.js's ingestDoc(). */
function makeDoc(opts) {
  var subject = opts.subject || '';
  var fromAddr = opts.fromAddr || '';
  var fromName = opts.fromName || '';
  var toStr = opts.toStr || '';
  var body = opts.body || '';
  var attNames = opts.attNames || '';
  var urls = opts.urls || '';
  var meta = opts.meta || '';
  return {
    fileId: opts.fileId,
    path: opts.path,
    subject: subject,
    fromAddr: fromAddr,
    fromName: fromName,
    toStr: toStr,
    dateMs: opts.dateMs || 1700000000000,
    size: opts.size || 1000,
    attCount: opts.attCount || 0,
    urlCount: opts.urlCount || 0,
    recipientCount: opts.recipientCount || 1,
    fromDomain: opts.fromDomain || '',
    urlDomains: opts.urlDomains || [],
    attExts: opts.attExts || [],
    attNames: attNames,
    emailId: opts.emailId || null,
    spf: 'pass', dkim: 'pass', dmarc: 'pass',
    fieldTokens: {
      subject: EV.tokenize(subject),
      from: EV.tokenize(fromAddr + ' ' + fromName),
      to: EV.tokenize(toStr),
      body: EV.tokenize(body),
      url: EV.tokenize(urls),
      attachment: EV.tokenize(attNames),
      meta: EV.tokenize(meta)
    }
  };
}

// ---- synthetic corpus ----
idx.resetForTest();
var docs = [
  makeDoc({ fileId: 0, path: 'a/paypal1.eml', subject: 'Urgent payment required', fromAddr: 'billing@paypal.com', fromName: 'PayPal Billing', fromDomain: 'paypal.com', attCount: 1, attNames: 'statement.pdf', attExts: ['pdf'], emailId: 'mid:1' }),
  makeDoc({ fileId: 1, path: 'a/amazon1.eml', subject: 'Your order shipped', fromAddr: 'ship@amazon.com', fromName: 'Amazon', fromDomain: 'amazon.com', attCount: 0, emailId: 'mid:2' }),
  makeDoc({ fileId: 2, path: 'a/random1.eml', subject: 'Team lunch Friday', fromAddr: 'alice@example.com', fromName: 'Alice', fromDomain: 'example.com', attCount: 0, emailId: 'mid:3' }),
  makeDoc({ fileId: 3, path: 'a/paypal2.eml', subject: 'Invoice attached', fromAddr: 'noreply@paypal.com', fromName: 'PayPal', fromDomain: 'paypal.com', attCount: 2, attNames: 'invoice.exe', attExts: ['exe'], emailId: 'mid:4' }),
  makeDoc({ fileId: 4, path: 'a/cashcheck.eml', subject: 'cash or check payment options', fromAddr: 'ops@example.com', fromName: 'Ops', fromDomain: 'example.com', emailId: 'mid:5' }),
  makeDoc({ fileId: 5, path: 'a/cashonly.eml', subject: 'cash bonus', fromAddr: 'promo@example.com', fromName: 'Promo', emailId: 'mid:6' }),
  makeDoc({ fileId: 6, path: 'a/checkonly.eml', subject: 'check this out', fromAddr: 'promo2@example.com', fromName: 'Promo2', emailId: 'mid:7' }),
  // nested-group fixtures (markera/b/c/d in the body, not reused elsewhere)
  makeDoc({ fileId: 7, path: 'a/markerC-D.eml', subject: 'note', body: 'markerc markerd', emailId: 'mid:8' }),
  makeDoc({ fileId: 8, path: 'a/markerA-D.eml', subject: 'note', body: 'markera markerd', emailId: 'mid:9' }),
  makeDoc({ fileId: 9, path: 'a/markerD-only.eml', subject: 'note', body: 'markerd', emailId: 'mid:10' }),
  makeDoc({ fileId: 10, path: 'a/markerA-only.eml', subject: 'note', body: 'markera', emailId: 'mid:11' }),
  makeDoc({ fileId: 11, path: 'a/markerB-only.eml', subject: 'note', body: 'markerb', emailId: 'mid:12' })
];
docs.forEach(function (d) { idx.ingestDocForTest(d); });

var chain = Promise.resolve();
function step(fn) { chain = chain.then(fn); }

// ---- 1. Regression baseline: plain AND, unchanged behavior ----
step(function () { return idx.search('from:paypal subject:invoice'); });
step(function (res) {
  assertPaths(res.results, ['a/paypal2.eml'], 'plain AND: from:paypal subject:invoice');
  assert(res.warnings.length === 0, 'plain AND: no warnings');
});

// ---- 2. OR across two field clauses ----
step(function () { return idx.search('from:paypal OR from:amazon'); });
step(function (res) {
  assertPaths(res.results, ['a/paypal1.eml', 'a/amazon1.eml', 'a/paypal2.eml'], 'OR across field clauses');
});

// ---- 3. Parenthesized OR combined with an outer AND term ----
step(function () { return idx.search('(from:paypal OR from:amazon) attachments:>0'); });
step(function (res) {
  assertPaths(res.results, ['a/paypal1.eml', 'a/paypal2.eml'], 'grouped OR AND-ed with attachments:>0');
});

// ---- 4. Negation of a whole parenthesized group ----
step(function () { return idx.search('-(from:paypal OR from:amazon)'); });
step(function (res) {
  assertPaths(res.results, ['a/random1.eml', 'a/cashcheck.eml', 'a/cashonly.eml', 'a/checkonly.eml',
    'a/markerC-D.eml', 'a/markerA-D.eml', 'a/markerD-only.eml', 'a/markerA-only.eml', 'a/markerB-only.eml'],
    'negated group excludes exactly the paypal/amazon senders');
});

// ---- 5. Nested group: (a OR (b OR c)) d ----
step(function () { return idx.search('(markera OR (markerb OR markerc)) markerd'); });
step(function (res) {
  assertPaths(res.results, ['a/markerC-D.eml', 'a/markerA-D.eml'], 'nested group (a OR (b OR c)) d');
});

// ---- 6. Literal lowercase "or" is an ordinary word, never the operator ----
step(function () { return idx.search('cash or check'); });
step(function (res) {
  assertPaths(res.results, ['a/cashcheck.eml'], 'lowercase "or" is literal — behaves as a 3-word AND, not OR-logic');
});

// ---- 7. Unbalanced parens: warning + zero results, never throws ----
step(function () { return idx.search('(from:paypal OR from:amazon'); });
step(function (res) {
  assert(res.results.length === 0, 'unbalanced parens -> zero results');
  assert(res.warnings.length >= 1, 'unbalanced parens -> at least one warning (' + JSON.stringify(res.warnings) + ')');
});

// ---- 8. Regression: one assertion per existing leaf type ----
// numeric clause
step(function () { return idx.search('attachments:>0'); });
step(function (res) { assertPaths(res.results, ['a/paypal1.eml', 'a/paypal2.eml'], 'regression: numeric clause attachments:>0'); });

// tag: clause
step(function () { return idx.search('tag:phish'); });
step(function (res) { assertPaths(res.results, ['a/paypal1.eml', 'a/paypal2.eml'], 'regression: tag:phish'); });

// field:/regex/ clause
step(function () { return idx.search('attachment:/\\.exe$/i'); });
step(function (res) { assertPaths(res.results, ['a/paypal2.eml'], 'regression: attachment:/\\.exe$/i'); });

// bare quoted phrase
step(function () { return idx.search('"Your order shipped"'); });
step(function (res) { assertPaths(res.results, ['a/amazon1.eml'], 'regression: bare quoted phrase'); });

// -exclude term
step(function () { return idx.search('paypal -invoice'); });
step(function (res) { assertPaths(res.results, ['a/paypal1.eml'], 'regression: -exclude term'); });

// ---- 9. Sanity: tag: composed with OR/NOT (new capability, not just bolted on at the end) ----
step(function () { return idx.search('tag:phish OR from:amazon'); });
step(function (res) { assertPaths(res.results, ['a/paypal1.eml', 'a/paypal2.eml', 'a/amazon1.eml'], 'tag: composed with OR'); });

// ---- 10. OR/grouping combined with the "Match Case" (caseSensitive) toggle ----
// PayPal Billing's display name is "PayPal Billing" (mixed case); Amazon's is "Amazon" (also
// mixed case) -- an exact-case "PayPal" OR "Amazon" search should still hit both, but an
// exact-case "paypal" (all-lowercase) should hit neither, since neither fromName/fromAddr
// contains that exact casing anywhere (fromAddr is "billing@paypal.com"/"ship@amazon.com" --
// also lowercase, so this needs a query whose case genuinely doesn't appear at all).
step(function () { return idx.search('from:PayPal OR from:Amazon', { caseSensitive: true }); });
step(function (res) {
  assertPaths(res.results, ['a/paypal1.eml', 'a/amazon1.eml', 'a/paypal2.eml'],
    'OR + caseSensitive: exact-case "PayPal"/"Amazon" still matches (fromName carries that casing)');
  assert(res.warnings.some(function (w) { return /case-sensitive/i.test(w); }), 'OR + caseSensitive: scope warning present');
});
step(function () { return idx.search('(from:PAYPAL OR from:AMAZON)', { caseSensitive: true }); });
step(function (res) {
  assertPaths(res.results, [], 'OR + caseSensitive: an exact-case that appears nowhere matches nothing, not everything');
});
step(function () { return idx.search('(from:paypal OR from:amazon) attachments:>0', { caseSensitive: true }); });
step(function (res) {
  // fromAddr ("billing@paypal.com") is genuinely lowercase, so an exact-case "paypal" still
  // matches via the raw address text even with Match Case on -- confirms the grouped-OR AND
  // numeric-clause combination composes correctly with case-sensitive leaf verification too.
  assertPaths(res.results, ['a/paypal1.eml', 'a/paypal2.eml'], 'OR-group AND numeric, combined with caseSensitive');
});

// ---- 11. The "Use Regular Expression" toggle bypasses the OR/grouping grammar entirely ----
// isRegex short-circuits before tokenizeQuery/parseTokens ever run (see search()) -- so "(" / ")"
// / "OR" are never parsed as grouping syntax in this mode, they're just literal regex syntax
// (parens = a real capture group, alternation is real regex "|", not the word "OR").
step(function () { return idx.search('paypal|amazon', { isRegex: true }); });
step(function (res) {
  assertPaths(res.results, ['a/paypal1.eml', 'a/amazon1.eml', 'a/paypal2.eml'], 'isRegex: real regex alternation "|" finds both senders');
});
step(function () { return idx.search('(from:paypal OR from:amazon)', { isRegex: true }); });
step(function (res) {
  // The literal text "from:paypal OR from:amazon" (with real parens as a regex group) does not
  // appear anywhere in subject/from/to/attachment -- this must match nothing, not silently fall
  // back to interpreting the OR/grouping syntax, proving the two features don't leak into each other.
  assertPaths(res.results, [], 'isRegex: OR/grouping syntax is NOT parsed as grouping in regex mode -- treated as literal pattern text');
});
step(function () { return idx.search('PAYPAL|AMAZON', { isRegex: true, caseSensitive: true }); });
step(function (res) {
  assertPaths(res.results, [], 'isRegex + caseSensitive together: exact-case alternation matching nothing is honored (not silently case-insensitive)');
});
step(function () { return idx.search('PayPal|Amazon', { isRegex: true, caseSensitive: true }); });
step(function (res) {
  assertPaths(res.results, ['a/paypal1.eml', 'a/amazon1.eml', 'a/paypal2.eml'], 'isRegex + caseSensitive together: exact-case alternation that does appear (fromName) matches');
});

step(function () {
  print('---');
  print('PASS: ' + pass + '  FAIL: ' + fail);
  if (fail > 0) throw new Error(fail + ' test(s) failed');
});
