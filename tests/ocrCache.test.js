/**
 * ocrCache.test.js — regression coverage for js/core/ocrCache.js, the IndexedDB-backed cache of
 * OCR results keyed by an attachment's own SHA-256 hash. Mocks EV.db with a plain in-memory object,
 * same pattern tags.test.js/settings.test.js already use. The real OCR engine call (Worker, WASM,
 * createImageBitmap) can't run under jsc at all — that's a live-browser-only concern, same
 * category as whois.test.js's real fetch() path. Run via
 * tests/run-all.sh, or directly: jsc tests/ocrCache.test.js (from the repo root).
 */
var EV = {};
this.EV = EV;
var __store = {};
EV.db = {
  get: function (storeName, key) { return Promise.resolve(__store[key] ? JSON.parse(JSON.stringify(__store[key])) : undefined); },
  put: function (storeName, value) { __store[value.sha256] = JSON.parse(JSON.stringify(value)); return Promise.resolve(); }
};

load('js/core/ocrCache.js');

var pass = 0, fail = 0;
function assert(cond, label) { if (cond) pass++; else { fail++; print('FAIL: ' + label); } }

var chain = Promise.resolve();
function step(fn) { chain = chain.then(fn); }

step(function () {
  return EV.ocrCache.get('abc123').then(function (rec) {
    assert(rec === undefined, 'get() on a never-cached hash returns undefined, not a stale/blank record');
  });
});

step(function () { return EV.ocrCache.put('abc123', 'Invoice 12345'); });
step(function (rec) {
  assert(rec.sha256 === 'abc123' && rec.text === 'Invoice 12345', 'put() returns the stored record');
  assert(rec.engine === 'tesseract-wasm' && rec.engineVersion === '0.11.0' && rec.lang === 'eng',
    'put() fills in default engine/version/lang metadata (' + JSON.stringify(rec) + ')');
  assert(typeof rec.createdAt === 'number', 'put() stamps a createdAt time');
});
step(function () {
  return EV.ocrCache.get('abc123').then(function (rec) {
    assert(rec && rec.text === 'Invoice 12345', 'get() round-trips the cached text for a known hash');
  });
});

step(function () { return EV.ocrCache.put('def456', 'Different text', { lang: 'fra' }); });
step(function (rec) {
  assert(rec.lang === 'fra', 'put() lets an explicit meta field override the default (' + JSON.stringify(rec) + ')');
});
step(function () {
  return EV.ocrCache.get('abc123').then(function (rec) {
    assert(rec && rec.text === 'Invoice 12345', 'caching a second, different hash does not disturb the first (' + JSON.stringify(rec) + ')');
  });
});

step(function () {
  print('---');
  print('PASS: ' + pass + '  FAIL: ' + fail);
  if (fail > 0) throw new Error(fail + ' test(s) failed');
});
