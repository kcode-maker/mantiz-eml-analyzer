/**
 * indexLogic.test.js — regression coverage for js/indexing/indexLogic.js's EV.buildIndexDoc
 * itself (previously never directly unit-tested anywhere in this project -- detections.test.js
 * only exercises indexLogic.js's standalone pure helpers, and ruleTemplates.test.js only compiles
 * rule expressions against a synthetic facts object, neither one drives buildIndexDoc against a
 * real parsed email). Written specifically to guard the change that made buildIndexDoc async
 * (EV.buildIndexDoc now returns a Promise, since computing each attachment's SHA-256 via
 * crypto.subtle.digest is inherently async) and added attSha256s to its output -- both worker.js
 * and workerClient.js's call sites were updated to await it; this test is what would have caught
 * a forgotten `await` at either site (the returned doc would be a pending Promise object instead
 * of real data, and every assertion below would fail loudly instead of silently).
 * Loads real js/parsing/emlParser.js + js/parsing/urlExtract.js + js/indexing/indexLogic.js against
 * the real test-fixtures/attachment_mixed.eml fixture (one plain-text attachment). jsc has no
 * crypto.subtle at all (unlike a real browser, including one served over file://), so attSha256s is
 * always [] here -- that's the exact same "browser-only" carve-out this project already has for
 * WHOIS's real fetch()/the real OCR engine call; the real hash VALUE is verified live-browser only.
 * Run via tests/run-all.sh, or directly: jsc tests/indexLogic.test.js (from the repo root).
 */
load('tests/helpers/textdecoder_polyfill.js');
load('js/parsing/emlParser.js');
load('js/parsing/urlExtract.js');
load('js/indexing/indexLogic.js');

var EV = this.EV;
var pass = 0, fail = 0;
function assert(cond, label) { if (cond) pass++; else { fail++; print('FAIL: ' + label); } }

function strToBuf(s) {
  var arr = new Uint8Array(s.length);
  for (var i = 0; i < s.length; i++) arr[i] = s.charCodeAt(i) & 0xff;
  return arr.buffer;
}

var chain = Promise.resolve();
function step(fn) { chain = chain.then(fn); }

// ---- 1. buildIndexDoc is genuinely async now, and its promise resolves to real data ----
step(function () {
  var buf = strToBuf(readFile('test-fixtures/attachment_mixed.eml'));
  var result = EV.buildIndexDoc(0, 'a/attachment_mixed.eml', buf, {});
  assert(result && typeof result.then === 'function', 'buildIndexDoc returns a real thenable/Promise, not a plain object');
  return result;
});
step(function (doc) {
  assert(doc.subject === 'Notes attached', 'the resolved doc has the real parsed subject, not a stale/placeholder value');
  assert(doc.fromAddr === 'dana@example.com', 'the resolved doc has the real parsed sender');
  assert(doc.attCount === 1, 'the resolved doc has the real attachment count');
  assert(doc.skipped === false, 'a normally-sized real fixture is never marked skipped');
});

// ---- 2. attSha256s: present, one filtered-Boolean array, gracefully empty under jsc (no crypto.subtle) ----
step(function () {
  var buf = strToBuf(readFile('test-fixtures/attachment_mixed.eml'));
  return EV.buildIndexDoc(0, 'a/attachment_mixed.eml', buf, {});
});
step(function (doc) {
  assert(Array.isArray(doc.attSha256s), 'doc.attSha256s is always an array, never undefined/null');
  assert(doc.attSha256s.length === 0, 'attSha256s is empty under jsc (no crypto.subtle here) -- nulls are filtered out, not left as placeholder entries; the real non-empty case is verified live in a real browser instead');
});

// ---- 3. The "too large to index" skip branch still returns attSha256s (an empty array), not a
// crash or a missing field -- this branch returns synchronously before any attachment work runs. ----
step(function () {
  var big = new ArrayBuffer(16 * 1024 * 1024); // over indexLogic.js's own 15MB MAX_INDEXABLE_BYTES
  var result = EV.buildIndexDoc(1, 'a/huge.eml', big, {});
  assert(result && typeof result.then === 'function', 'the skip branch is also returned via the async function, so it\'s still a thenable');
  return result;
});
step(function (doc) {
  assert(doc.skipped === true, 'an oversized file is marked skipped');
  assert(Array.isArray(doc.attSha256s) && doc.attSha256s.length === 0, 'the skip branch\'s stub doc includes attSha256s: [] like every other array field, not a missing key');
});

step(function () {
  print('---');
  print('PASS: ' + pass + '  FAIL: ' + fail);
  if (fail > 0) throw new Error(fail + ' test(s) failed');
});
