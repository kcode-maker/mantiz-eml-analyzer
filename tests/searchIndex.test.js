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
load('js/indexing/pathFilter.js');
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
  var ccStr = opts.ccStr || '';
  var bccStr = opts.bccStr || '';
  var replyToStr = opts.replyToStr || '';
  var returnPathStr = opts.returnPathStr || '';
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
    ccStr: ccStr,
    bccStr: bccStr,
    replyToStr: replyToStr,
    returnPathStr: returnPathStr,
    messageId: opts.messageId || null,
    dateMs: opts.dateMs || 1700000000000,
    size: opts.size || 1000,
    attCount: opts.attCount || 0,
    urlCount: opts.urlCount || 0,
    recipientCount: opts.recipientCount || 1,
    fromDomain: opts.fromDomain || '',
    urlDomains: opts.urlDomains || [],
    attExts: opts.attExts || [],
    attSha256s: opts.attSha256s || [],
    attNames: attNames,
    emailId: opts.emailId || null,
    spf: 'pass', dkim: 'pass', dmarc: 'pass',
    fieldTokens: {
      subject: EV.tokenize(subject),
      from: EV.tokenize(fromAddr + ' ' + fromName),
      to: EV.tokenize(toStr),
      cc: EV.tokenize(ccStr),
      bcc: EV.tokenize(bccStr),
      replyto: EV.tokenize(replyToStr),
      returnpath: EV.tokenize(returnPathStr),
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
  makeDoc({ fileId: 0, path: 'a/paypal1.eml', subject: 'Urgent payment required', fromAddr: 'billing@paypal.com', fromName: 'PayPal Billing', fromDomain: 'paypal.com', attCount: 1, attNames: 'statement.pdf', attExts: ['.pdf'], attSha256s: ['9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'], emailId: 'mid:1' }),
  makeDoc({ fileId: 1, path: 'a/amazon1.eml', subject: 'Your order shipped', fromAddr: 'ship@amazon.com', fromName: 'Amazon', fromDomain: 'amazon.com', attCount: 0, emailId: 'mid:2' }),
  makeDoc({ fileId: 2, path: 'a/random1.eml', subject: 'Team lunch Friday', fromAddr: 'alice@example.com', fromName: 'Alice', fromDomain: 'example.com', attCount: 0, emailId: 'mid:3' }),
  makeDoc({ fileId: 3, path: 'a/paypal2.eml', subject: 'Invoice attached', fromAddr: 'noreply@paypal.com', fromName: 'PayPal', fromDomain: 'paypal.com', attCount: 2, attNames: 'invoice.exe', attExts: ['.exe'], emailId: 'mid:4' }),
  makeDoc({ fileId: 4, path: 'a/cashcheck.eml', subject: 'cash or check payment options', fromAddr: 'ops@example.com', fromName: 'Ops', fromDomain: 'example.com', emailId: 'mid:5' }),
  makeDoc({ fileId: 5, path: 'a/cashonly.eml', subject: 'cash bonus', fromAddr: 'promo@example.com', fromName: 'Promo', emailId: 'mid:6' }),
  makeDoc({ fileId: 6, path: 'a/checkonly.eml', subject: 'check this out', fromAddr: 'promo2@example.com', fromName: 'Promo2', emailId: 'mid:7' }),
  // nested-group fixtures (markera/b/c/d in the body, not reused elsewhere)
  makeDoc({ fileId: 7, path: 'a/markerC-D.eml', subject: 'note', body: 'markerc markerd', emailId: 'mid:8' }),
  makeDoc({ fileId: 8, path: 'a/markerA-D.eml', subject: 'note', body: 'markera markerd', emailId: 'mid:9' }),
  makeDoc({ fileId: 9, path: 'a/markerD-only.eml', subject: 'note', body: 'markerd', emailId: 'mid:10' }),
  makeDoc({ fileId: 10, path: 'a/markerA-only.eml', subject: 'note', body: 'markera', emailId: 'mid:11' }),
  makeDoc({ fileId: 11, path: 'a/markerB-only.eml', subject: 'note', body: 'markerb', emailId: 'mid:12' }),
  // header.cc/bcc/replyto/returnpath/messageid + attachment.ext fixture
  makeDoc({
    fileId: 12, path: 'a/cc-bcc-reply.eml', subject: 'Quarterly report', fromAddr: 'sender@example.com', fromName: 'Sender',
    ccStr: 'carol@example.com', bccStr: 'dave@example.com', replyToStr: 'noreply@example.com', returnPathStr: 'bounce@example.com',
    messageId: 'unique-msg-id-123@example.com', attNames: 'report.docx', attExts: ['.docx'], emailId: 'mid:13'
  })
];
docs.forEach(function (d) { idx.ingestDocForTest(d); });

var chain = Promise.resolve();
function step(fn) { chain = chain.then(fn); }

// ---- 1. Regression baseline: plain AND, unchanged behavior ----
step(function () { return idx.search('header.from:paypal header.subject:invoice'); });
step(function (res) {
  assertPaths(res.results, ['a/paypal2.eml'], 'plain AND: header.from:paypal header.subject:invoice');
  assert(res.warnings.length === 0, 'plain AND: no warnings');
});

// ---- 2. OR across two field clauses ----
step(function () { return idx.search('header.from:paypal OR header.from:amazon'); });
step(function (res) {
  assertPaths(res.results, ['a/paypal1.eml', 'a/amazon1.eml', 'a/paypal2.eml'], 'OR across field clauses');
});

// ---- 3. Parenthesized OR combined with an outer AND term ----
step(function () { return idx.search('(header.from:paypal OR header.from:amazon) attachment.count:>0'); });
step(function (res) {
  assertPaths(res.results, ['a/paypal1.eml', 'a/paypal2.eml'], 'grouped OR AND-ed with attachment.count:>0');
});

// ---- 4. Negation of a whole parenthesized group ----
step(function () { return idx.search('-(header.from:paypal OR header.from:amazon)'); });
step(function (res) {
  assertPaths(res.results, ['a/random1.eml', 'a/cashcheck.eml', 'a/cashonly.eml', 'a/checkonly.eml',
    'a/markerC-D.eml', 'a/markerA-D.eml', 'a/markerD-only.eml', 'a/markerA-only.eml', 'a/markerB-only.eml',
    'a/cc-bcc-reply.eml'],
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
step(function () { return idx.search('(header.from:paypal OR header.from:amazon'); });
step(function (res) {
  assert(res.results.length === 0, 'unbalanced parens -> zero results');
  assert(res.warnings.length >= 1, 'unbalanced parens -> at least one warning (' + JSON.stringify(res.warnings) + ')');
});

// ---- 8. Regression: one assertion per existing leaf type ----
// numeric clause
step(function () { return idx.search('attachment.count:>0'); });
step(function (res) { assertPaths(res.results, ['a/paypal1.eml', 'a/paypal2.eml'], 'regression: numeric clause attachment.count:>0'); });

// tag: clause
step(function () { return idx.search('tag:phish'); });
step(function (res) { assertPaths(res.results, ['a/paypal1.eml', 'a/paypal2.eml'], 'regression: tag:phish'); });

// field:/regex/ clause
step(function () { return idx.search('attachment.filename:/\\.exe$/i'); });
step(function (res) { assertPaths(res.results, ['a/paypal2.eml'], 'regression: attachment.filename:/\\.exe$/i'); });

// bare quoted phrase
step(function () { return idx.search('"Your order shipped"'); });
step(function (res) { assertPaths(res.results, ['a/amazon1.eml'], 'regression: bare quoted phrase'); });

// -exclude term
step(function () { return idx.search('paypal -invoice'); });
step(function (res) { assertPaths(res.results, ['a/paypal1.eml'], 'regression: -exclude term'); });

// ---- 9. Sanity: tag: composed with OR/NOT (new capability, not just bolted on at the end) ----
step(function () { return idx.search('tag:phish OR header.from:amazon'); });
step(function (res) { assertPaths(res.results, ['a/paypal1.eml', 'a/paypal2.eml', 'a/amazon1.eml'], 'tag: composed with OR'); });

// ---- 10. OR/grouping combined with the "Match Case" (caseSensitive) toggle ----
// PayPal Billing's display name is "PayPal Billing" (mixed case); Amazon's is "Amazon" (also
// mixed case) -- an exact-case "PayPal" OR "Amazon" search should still hit both, but an
// exact-case "paypal" (all-lowercase) should hit neither, since neither fromName/fromAddr
// contains that exact casing anywhere (fromAddr is "billing@paypal.com"/"ship@amazon.com" --
// also lowercase, so this needs a query whose case genuinely doesn't appear at all).
step(function () { return idx.search('header.from:PayPal OR header.from:Amazon', { caseSensitive: true }); });
step(function (res) {
  assertPaths(res.results, ['a/paypal1.eml', 'a/amazon1.eml', 'a/paypal2.eml'],
    'OR + caseSensitive: exact-case "PayPal"/"Amazon" still matches (fromName carries that casing)');
  assert(res.warnings.some(function (w) { return /case-sensitive/i.test(w); }), 'OR + caseSensitive: scope warning present');
});
step(function () { return idx.search('(header.from:PAYPAL OR header.from:AMAZON)', { caseSensitive: true }); });
step(function (res) {
  assertPaths(res.results, [], 'OR + caseSensitive: an exact-case that appears nowhere matches nothing, not everything');
});
step(function () { return idx.search('(header.from:paypal OR header.from:amazon) attachment.count:>0', { caseSensitive: true }); });
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

// ---- 12. VSCode-style include/exclude path filter (js/indexing/pathFilter.js), applied as a final
// filter over the resolved candidate id list -- composes with a plain query unchanged. ----
step(function () { return idx.search('paypal', { include: '*paypal2*' }); });
step(function (res) {
  assertPaths(res.results, ['a/paypal2.eml'], 'include filter narrows a multi-match query down to only the matching path');
});
step(function () { return idx.search('paypal', { exclude: 'paypal2' }); });
step(function (res) {
  assertPaths(res.results, ['a/paypal1.eml'], 'exclude filter drops one specific fixture, leaving the rest of the query\'s matches');
});

// ---- 13. Namespaced header.*/attachment.* grammar (a hard rename from the old flat field
// names) -- new fields that weren't searchable at all before (cc/bcc/replyto/returnpath/
// messageid/ext), plus confirming the old flat syntax no longer parses as a field. ----
// Like the pre-existing header.to (formerly "to:"), cc/bcc/replyto/returnpath store only the bare
// address (no display name) -- EV.tokenize keeps a full email address as one token, so a query has
// to match the whole address, not just a substring of its local-part (same limitation "to:" already
// had before this rename; not something newly introduced here).
step(function () { return idx.search('header.cc:carol@example.com'); });
step(function (res) { assertPaths(res.results, ['a/cc-bcc-reply.eml'], 'header.cc: matches the cc fixture'); });

step(function () { return idx.search('header.bcc:dave@example.com'); });
step(function (res) { assertPaths(res.results, ['a/cc-bcc-reply.eml'], 'header.bcc: matches the bcc fixture'); });

step(function () { return idx.search('header.replyto:noreply@example.com'); });
step(function (res) { assertPaths(res.results, ['a/cc-bcc-reply.eml'], 'header.replyto: matches the reply-to fixture'); });

step(function () { return idx.search('header.returnpath:bounce@example.com'); });
step(function (res) { assertPaths(res.results, ['a/cc-bcc-reply.eml'], 'header.returnpath: matches the return-path fixture'); });

step(function () { return idx.search('header.messageid:unique-msg-id-123@example.com'); });
step(function (res) { assertPaths(res.results, ['a/cc-bcc-reply.eml'], 'header.messageid: exact-matches the Message-ID fixture'); });

step(function () { return idx.search('header.messageid:UNIQUE-MSG-ID-123@EXAMPLE.COM'); });
step(function (res) { assertPaths(res.results, ['a/cc-bcc-reply.eml'], 'header.messageid: case-insensitive exact match'); });

step(function () { return idx.search('attachment.ext:.docx'); });
step(function (res) { assertPaths(res.results, ['a/cc-bcc-reply.eml'], 'attachment.ext: matches by extension, not filename substring'); });

step(function () { return idx.search('attachment.ext:.pdf'); });
step(function (res) { assertPaths(res.results, ['a/paypal1.eml'], 'attachment.ext: .pdf matches only the pdf fixture, not the exe/docx ones'); });

// attachment.sha256: -- eager, computed during indexing (see indexLogic.js's buildIndexDoc),
// exact match, case-insensitive, on a whole attachment's own hash (not a substring).
step(function () { return idx.search('attachment.sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'); });
step(function (res) { assertPaths(res.results, ['a/paypal1.eml'], 'attachment.sha256: matches the fixture carrying that exact hash'); });

step(function () { return idx.search('attachment.sha256:9F86D081884C7D659A2FEAA0C55AD015A3BF4F1B2B0B822CD15D6C15B0F00A08'); });
step(function (res) { assertPaths(res.results, ['a/paypal1.eml'], 'attachment.sha256: is case-insensitive'); });

step(function () { return idx.search('attachment.sha256:deadbeef'); });
step(function (res) { assertPaths(res.results, [], 'attachment.sha256: a hash no attachment actually has matches nothing'); });

// An empty quoted value is the one way to actually reach the "needs a value" branch --
// a bare trailing colon with nothing after it at all doesn't parse as a field clause in the
// first place (falls through to a literal, harmlessly-unmatching bare word instead).
step(function () { return idx.search('attachment.sha256:""'); });
step(function (res) { assert(res.warnings.length === 1 && /needs a value/.test(res.warnings[0]), 'attachment.sha256:"" (empty value) warns instead of matching everything'); });

step(function () { return idx.search('from:paypal'); });
step(function (res) {
  assertPaths(res.results, [], 'old flat "from:" no longer parses as a field (hard rename) -- falls through to a bare word matching nothing here');
});

step(function () { return idx.search('attachments:>0'); });
step(function (res) {
  assertPaths(res.results, [], 'old flat "attachments:" no longer parses as a numeric field (hard rename)');
});

// ---- 14. attachment.ocr: sparse search coverage (addOcrText/ocrStats) -- populated only via the
// TEST-ONLY-equivalent public addOcrText() hook (app.js's real EV.onOcrTextReady calls the exact
// same method), never during ingestDoc/indexing itself. Confirms: text pushed via addOcrText is
// found by attachment.ocr:, an un-OCR'd doc with similar body text is NOT matched by it (the 'ocr'
// field is its own separate postings list, not merged into body/attachment), a bare "any-field" word
// search also picks up OCR'd text (since 'ocr' is in FIELDS), and ocrStats().coveredCount tracks
// exactly how many docs have been OCR'd so far, unaffected by a doc that was never OCR'd at all. ----
step(function () {
  assert(idx.ocrStats().coveredCount === 0, 'ocrStats: zero coverage before any addOcrText call');
  idx.addOcrText('a/paypal1.eml', 'Bretney Webb shared a document with you');
  return idx.search('attachment.ocr:bretney');
});
step(function (res) {
  assertPaths(res.results, ['a/paypal1.eml'], 'attachment.ocr: matches text pushed in via addOcrText');
  assert(idx.ocrStats().coveredCount === 1, 'ocrStats: coveredCount is 1 after one addOcrText call');
});

step(function () { return idx.search('attachment.ocr:invoice'); });
step(function (res) {
  assertPaths(res.results, [], 'attachment.ocr: a doc that was never OCR\'d is not matched, even if its subject/body has a similar word');
});

step(function () { return idx.search('bretney'); });
step(function (res) {
  assertPaths(res.results, ['a/paypal1.eml'], 'a bare any-field word search also finds OCR\'d text (ocr is included in FIELDS)');
});

step(function () {
  idx.addOcrText('a/amazon1.eml', 'Open the attached shipping label');
  return idx.search('attachment.ocr:shipping');
});
step(function (res) {
  assertPaths(res.results, ['a/amazon1.eml'], 'a second addOcrText call on a different doc is independently searchable');
  assert(idx.ocrStats().coveredCount === 2, 'ocrStats: coveredCount reflects both OCR\'d docs now');
});

step(function () {
  idx.addOcrText('a/does-not-exist.eml', 'unreachable text');
  return idx.search('attachment.ocr:unreachable');
});
step(function (res) {
  assertPaths(res.results, [], 'addOcrText on a path that isn\'t currently indexed is a silent no-op, not a crash');
  assert(idx.ocrStats().coveredCount === 2, 'ocrStats: an unindexed-path no-op does not bump coveredCount');
});

// ---- 15. Whitespace right after "field:" is tolerated (e.g. "header.from: paypal"), not just
// "field:value" with no space. Before this fix, a leading space made the value-parsing match
// nothing, so the whole "field:" span fell through to becoming its own literal (near-unmatchable)
// bare word ANDed into the rest of the query -- silently zeroing out every result for a perfectly
// natural way to type a query, with no warning. Real user-reported repro: "attachment.ocr: shared
// document" against an OCR'd doc returned zero matches before this fix. ----
step(function () {
  idx.addOcrText('a/random1.eml', 'Bretney Webb shared document with you right now');
  return idx.search('attachment.ocr: shared document');
});
step(function (res) {
  // a/paypal1.eml also matches -- section 14 above already OCR'd it with text containing
  // both "shared" and "document" ("Bretney Webb shared a document with you").
  assertPaths(res.results, ['a/paypal1.eml', 'a/random1.eml'], 'space after "field:" no longer silently zeroes out the query (real user repro)');
});

step(function () { return idx.search('header.subject:invoice'); });
step(function (resA) {
  return idx.search('header.subject: invoice').then(function (resB) {
    assertPaths(resB.results, resA.results.map(function (r) { return r.path; }), '"field: value" (space) matches "field:value" (no space) identically');
  });
});

step(function () { return idx.search('attachment.ocr: "shared document"'); });
step(function (res) {
  assertPaths(res.results, ['a/paypal1.eml', 'a/random1.eml'], 'space before a quoted value is also tolerated: attachment.ocr: "shared document"');
});

step(function () {
  print('---');
  print('PASS: ' + pass + '  FAIL: ' + fail);
  if (fail > 0) throw new Error(fail + ' test(s) failed');
});
