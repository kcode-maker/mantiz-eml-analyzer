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
  }),
  // substring-fallback fixture: no display name at all, so "adobe" is never its own indexed
  // token -- EV.tokenize keeps "message@adobe.com" glued together as one token, exactly the real
  // user-reported repro (a real Adobe notification with no display name didn't show up searching
  // "adobe"). attNames similarly has no word boundary around "invoice".
  makeDoc({ fileId: 13, path: 'a/adobe-nodisplayname.eml', subject: 'Please review and sign', fromAddr: 'message@adobe.com', attNames: 'siginvoice2024.pdf', emailId: 'mid:14' }),
  // body has no retained raw text (unlike subject/from/etc.) -- "markerglued" is one token, never
  // split, so a search for "marker" alone must NOT match it via substring fallback; only an exact
  // "markerglued" token lookup should.
  makeDoc({ fileId: 14, path: 'a/markerGlued.eml', subject: 'note', body: 'markerglued', emailId: 'mid:15' })
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
    'a/cc-bcc-reply.eml', 'a/adobe-nodisplayname.eml', 'a/markerGlued.eml'],
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

step(function () { return idx.search('attachment.ext:docx'); });
step(function (res) { assertPaths(res.results, ['a/cc-bcc-reply.eml'], 'attachment.ext: works without the leading dot too'); });
step(function () { return idx.search('attachment.ext:DOCX'); });
step(function (res) { assertPaths(res.results, ['a/cc-bcc-reply.eml'], 'attachment.ext: is case-insensitive'); });
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
  // a/paypal1.eml's OCR text is "shared a document" -- the words aren't adjacent, so a quoted phrase
  // (now verified for real adjacency on retained text) correctly excludes it.
  assertPaths(res.results, ['a/random1.eml'], 'space before a quoted value is also tolerated: attachment.ocr: "shared document"');
});

// ---- 16. Substring fallback on raw-text fields (real user-reported bug): EV.tokenize keeps a
// punctuation-glued run (an email address, a dotted domain, a filename with no word boundary) as
// ONE token, so "adobe" was never its own indexed token for a sender with no display name at all
// (message@adobe.com) -- a plain word search, or header.from:, found nothing even though the term
// is plainly "in" the email. substringCandidatesForToken widens the token-index lookup with a
// linear substring scan over the same RAW_TEXT_FIELDS field:/regex/ already scans, for exactly
// this case -- never for body/meta/url/ocr, which have no raw text retained per file at all. ----
step(function () { return idx.search('adobe'); });
step(function (res) {
  assertPaths(res.results, ['a/adobe-nodisplayname.eml'], 'bare word "adobe" finds a sender with no display name at all, only "message@adobe.com" (real user repro)');
});

step(function () { return idx.search('header.from:adobe'); });
step(function (res) {
  assertPaths(res.results, ['a/adobe-nodisplayname.eml'], 'header.from:adobe finds it too, not just a bare "any field" search');
});

step(function () { return idx.search('header.from:adobe.com'); });
step(function (res) {
  assertPaths(res.results, ['a/adobe-nodisplayname.eml'], 'the full glued domain "adobe.com" also matches as a substring, not just a leading fragment');
});

step(function () { return idx.search('attachment.filename:invoice'); });
step(function (res) {
  // a/paypal2.eml's "invoice.exe" is also one glued token ("." is part of EV.tokenize's allowed
  // character class) and legitimately contains "invoice" as a substring too -- correctly widened.
  assertPaths(res.results, ['a/adobe-nodisplayname.eml', 'a/paypal2.eml'], 'attachment.filename: substring-matches "invoice" inside filenames with no word boundary around it');
});

step(function () { return idx.search('marker'); });
step(function (res) {
  assertPaths(res.results, [], 'an email whose decoded text was NOT retained (no bodyLc, e.g. beyond the memory budget) falls back to whole-word matching -- "marker" must not match the body token "markerglued"');
});
step(function () { return idx.search('markerglued'); });
step(function (res) {
  assertPaths(res.results, ['a/markerGlued.eml'], 'the exact full token "markerglued" still matches normally');
});

// ---- 17. Full-text substring search (retained decoded text) + per-header + auth search ----
// A second index instance so these fixtures can carry retained text / header text without disturbing
// the shared corpus above.
var idx2 = EV.createSearchIndex(null);
function makeDoc2(o) {
  var d = makeDoc(o);
  d.bodyLc = (o.body || '').toLowerCase();
  d.urlsLc = (o.urls || '').toLowerCase();
  d.headerTextsLc = {};
  Object.keys(o.headers || {}).forEach(function (n) { d.headerTextsLc[n] = String(o.headers[n]).toLowerCase(); });
  d.headerTokens = {};
  Object.keys(d.headerTextsLc).forEach(function (n) { d.headerTokens[n] = EV.tokenizeExpanded(d.headerTextsLc[n]); });
  d.spf = o.hasOwnProperty('spf') ? o.spf : 'pass'; d.dkim = o.hasOwnProperty('dkim') ? o.dkim : 'pass'; d.dmarc = o.hasOwnProperty('dmarc') ? o.dmarc : 'pass';
  return d;
}
idx2.resetForTest();
[
  makeDoc2({ fileId: 0, path: 'b/one.eml', subject: 'hello', fromAddr: 'x@example.com', body: 'Please wire the funds to https://secure-paypa1-login.example/verify today',
    headers: { 'received': 'from mail-ej1-f68.google.com (mail-ej1-f68.google.com [209.85.218.68]) by mx.example.org', 'x-mailer': 'Apple Mail (2.3774.600.62)', 'authentication-results': 'mx.example.org; spf=fail; dkim=pass; dmarc=fail' },
    spf: 'fail', dkim: 'pass', dmarc: 'fail', emailId: 'e1' }),
  makeDoc2({ fileId: 1, path: 'b/two.eml', subject: 'bonjour', fromAddr: 'y@example.com', body: 'Счёт на оплату срочно, 請確認您的帳戶',
    headers: { 'x-mailer': 'Microsoft Outlook 16.0' }, spf: 'pass', dkim: 'pass', dmarc: 'pass', emailId: 'e2' }),
  makeDoc2({ fileId: 2, path: 'b/three.eml', subject: 'plain', fromAddr: 'z@example.com', body: 'nothing here', headers: {}, spf: null, dkim: null, dmarc: null, emailId: 'e3' })
].forEach(function (d) { idx2.ingestDocForTest(d); });
function s2(q, opts) { return idx2.search(q, opts); }

step(function () { return s2('oogle'); });
step(function (res) { assertPaths(res.results, ['b/one.eml'], 'a bare mid-word fragment ("oogle") matches inside a Received header host'); });
step(function () { return s2('paypa1-login'); });
step(function (res) { assertPaths(res.results, ['b/one.eml'], 'a fragment of a URL host in the body matches'); });
step(function () { return s2('funds wire'); });
step(function (res) { assertPaths(res.results, ['b/one.eml'], 'unquoted multi-word is ANDed per word in any order, each word a substring'); });
step(function () { return s2('"wire the funds"'); });
step(function (res) { assertPaths(res.results, ['b/one.eml'], 'quoted phrase matches contiguous body text'); });
step(function () { return s2('"funds the wire"'); });
step(function (res) { assertPaths(res.results, [], 'quoted phrase with the words in a different order does not match'); });
step(function () { return s2('оплату'); });
step(function (res) { assertPaths(res.results, ['b/two.eml'], 'Cyrillic body text is searchable (the word tokenizer cannot index it)'); });
step(function () { return s2('帳戶'); });
step(function (res) { assertPaths(res.results, ['b/two.eml'], 'CJK body text is searchable'); });
step(function () { return s2('header.received:google.com'); });
step(function (res) { assertPaths(res.results, ['b/one.eml'], 'header.received: finds a host inside the Received header'); });
step(function () { return s2('header.x-mailer:outlook'); });
step(function (res) { assertPaths(res.results, ['b/two.eml'], 'header.x-mailer: targets one named header'); });
step(function () { return s2('header.x-mailer:mail'); });
step(function (res) { assertPaths(res.results, ['b/one.eml'], 'header.x-mailer: substring ("mail" in "Apple Mail" only, not Outlook)'); });
step(function () { return s2('header.Received:GOOGLE'); });
step(function (res) { assertPaths(res.results, ['b/one.eml'], 'header names and values are case-insensitive'); });
step(function () { return s2('header.no-such-header:foo'); });
step(function (res) { assert(res.results.length === 0 && /no indexed email has a "no-such-header" header/.test(res.warnings.join(' ')), 'an unknown header name warns instead of silently matching nothing'); });
step(function () { return s2('header.raw:apple'); });
step(function (res) { assertPaths(res.results, ['b/one.eml'], 'header.raw: substring-matches across all header values'); });
step(function () { return s2('auth.spf:fail'); });
step(function (res) { assertPaths(res.results, ['b/one.eml'], 'auth.spf:fail'); });
step(function () { return s2('auth.dmarc:pass'); });
step(function (res) { assertPaths(res.results, ['b/two.eml'], 'auth.dmarc:pass'); });
step(function () { return s2('auth.dkim:missing'); });
step(function (res) { assertPaths(res.results, ['b/three.eml'], 'auth.dkim:missing finds emails with no DKIM result at all'); });
step(function () { return s2('-auth.spf:fail header.x-mailer:mail'); });
step(function (res) { assertPaths(res.results, [], 'auth/header clauses compose with negation and AND'); });
step(function () {
  var names = idx2.headerNames().map(function (h) { return h.name + ':' + h.count; });
  assert(names[0] === 'x-mailer:2' && names.indexOf('received:1') !== -1, 'headerNames() lists header names by frequency (' + JSON.stringify(names) + ')');
  assert(idx2.textCoverage().retained === 3 && idx2.textCoverage().total === 3, 'all 3 emails have retained text');
});

// ---- 18. Beyond the memory budget: emails whose text isn't retained fall back to whole-word + per-header postings ----
var idx3 = EV.createSearchIndex(null);
idx3.resetForTest();
idx3.setRetainedBudgetForTest(10); // far too small to retain anything
idx3.ingestDocForTest(makeDoc2({ fileId: 0, path: 'c/big.eml', subject: 'x', fromAddr: 'q@example.com', body: 'see mail.google.com now', headers: { 'received': 'from mail-ej1-f68.google.com by mx' }, emailId: 'c1' }));
step(function () { return idx3.search('header.received:google.com'); });
step(function (res) { assertPaths(res.results, ['c/big.eml'], 'non-retained email: header.received:google.com still found via the per-header token index (domain suffixes are indexed)'); });
step(function () { return idx3.search('google'); });
step(function (res) { assertPaths(res.results, ['c/big.eml'], 'non-retained email: a bare domain label is found via header token parts'); });
step(function () { return idx3.search('oogle'); });
step(function (res) { assertPaths(res.results, [], 'non-retained email: a mid-word fragment is NOT found (whole-word fallback) -- the documented limit'); });
step(function () { assert(idx3.textCoverage().retained === 0 && idx3.textCoverage().total === 1, 'textCoverage reports 0 of 1 retained'); });

step(function () {
  print('---');
  print('PASS: ' + pass + '  FAIL: ' + fail);
  if (fail > 0) throw new Error(fail + ' test(s) failed');
});
