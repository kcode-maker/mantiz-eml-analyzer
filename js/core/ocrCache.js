/**
 * ocrCache.js — IndexedDB-backed cache of OCR results, keyed by the
 * attachment's own SHA-256 hash (content-addressed) so the same image
 * attachment appearing in multiple emails, or the same folder reopened
 * later, reuses a cached result instead of re-running OCR. Mirrors
 * settings.js/tags.js's small CRUD-wrapper style.
 */
(function (g) {
  'use strict';
  var EV = g.EV || (g.EV = {});
  var STORE = 'ocrResults';

  EV.ocrCache = {
    get: function (sha256) {
      return EV.db.get(STORE, sha256);
    },
    put: function (sha256, text, meta) {
      var rec = Object.assign({
        sha256: sha256,
        text: text,
        engine: 'tesseract-wasm',
        engineVersion: '0.11.0',
        lang: 'eng',
        createdAt: Date.now()
      }, meta || {});
      return EV.db.put(STORE, rec).then(function () { return rec; });
    }
  };
})(typeof self !== 'undefined' ? self : this);
