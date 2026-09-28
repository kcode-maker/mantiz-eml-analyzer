/**
 * render.test.js — regression coverage for the small pure-logic pieces of js/ui/render.js
 * that can be exercised without a real DOM: EV.pickFirstMeaningfulImageAttachment (the "first
 * meaningful image" rule shared by the per-email Attachments-tab OCR button and app.js's bulk
 * "Extract OCR (selected)" action -- extracted into one function specifically so those two call
 * sites can never drift apart) and EV.sha256Hex's graceful no-crypto fallback. Everything else in
 * render.js builds real DOM elements (document.createElement, etc.) and has no natural seam to
 * test under jsc -- covered by a live-browser pass instead.
 * Mocks EV.settings.domainCategories() (render.js calls it once, synchronously at load time, to
 * seed a cache) so the file can load at all under jsc, same pattern as tags.test.js/settings.test.js
 * mocking EV.db. Run via tests/run-all.sh, or directly: jsc tests/render.test.js (from the repo root).
 */
var EV = {};
this.EV = EV;
EV.settings = { domainCategories: function () { return Promise.resolve([]); } };

load('js/ui/render.js');

var pass = 0, fail = 0;
function assert(cond, label) { if (cond) pass++; else { fail++; print('FAIL: ' + label); } }

function img(size, mimeType) { return { mimeType: mimeType || 'image/png', size: size }; }

// ---- pickFirstMeaningfulImageAttachment ----
assert(EV.pickFirstMeaningfulImageAttachment([]) === null, 'empty attachment list returns null');
assert(EV.pickFirstMeaningfulImageAttachment([{ mimeType: 'application/pdf', size: 5000 }]) === null,
  'a non-image attachment is never picked');

var tinyPixel = img(200); // real tracking pixels are tens-to-low-hundreds of bytes
var real = img(68000);
assert(EV.pickFirstMeaningfulImageAttachment([tinyPixel, real]) === real,
  'a tiny (<=512 byte) tracking-pixel-shaped image is skipped in favor of the next real image');

var first = img(10000);
var second = img(20000);
assert(EV.pickFirstMeaningfulImageAttachment([first, second]) === first,
  'the first eligible image wins, not the largest/last one');

var inline = { mimeType: 'image/png', size: 50000, isInline: true };
assert(EV.pickFirstMeaningfulImageAttachment([inline]) === inline,
  'an inline (cid:) image is just as eligible as a regular attachment -- no isInline exclusion');

var tooBig = img(9 * 1024 * 1024); // over the 8MB preview/OCR cap
var eligible = img(10000);
assert(EV.pickFirstMeaningfulImageAttachment([tooBig, eligible]) === eligible,
  'an over-8MB image is skipped (same cap the image preview itself uses), the next eligible one is picked');

assert(EV.pickFirstMeaningfulImageAttachment([img(512)]) === null,
  'exactly 512 bytes is NOT over the floor (boundary is a strict ">", matching render.js\'s own att.size > 512)');
assert(EV.pickFirstMeaningfulImageAttachment([img(513)]) !== null,
  '513 bytes is over the floor');

assert(EV.pickFirstMeaningfulImageAttachment([{ mimeType: 'application/pdf', size: 5000 }, real]) === real,
  'a non-image attachment before a real image is skipped, not mistakenly picked');

// ---- sha256Hex ----
var chain = Promise.resolve();
function step(fn) { chain = chain.then(fn); }
step(function () { return EV.sha256Hex(new Uint8Array([1, 2, 3])); });
step(function (result) {
  assert(result === null, 'sha256Hex gracefully returns null when Web Crypto isn\'t available (jsc has no crypto.subtle), never throws');
});

step(function () {
  print('---');
  print('PASS: ' + pass + '  FAIL: ' + fail);
  if (fail > 0) throw new Error(fail + ' test(s) failed');
});
