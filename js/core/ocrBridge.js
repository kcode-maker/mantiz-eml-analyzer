// ocrBridge.js — the only file in this app loaded as <script type="module"> (a native browser
// feature, no bundler involved — every other file here is a classic script sharing window.EV).
// This exposes one plain async function onto that same EV object so classic scripts (render.js's
// OCR button handler) can call into the ES-module-based tesseract-wasm library without needing a
// build step of their own. See vendor/VENDOR.md for exactly which vendored files this imports and
// how to verify them.
import { OCRClient } from '../../vendor/tesseract-wasm/lib.js';

var EV = window.EV || (window.EV = {});

// One OCRClient (and its Worker + loaded model) for the whole page session, not one per call --
// its constructor spins up a Worker and loadModel() does a real ~4MB fetch/parse/instantiate, both
// genuine one-time-per-session costs. Promise-cached at module scope, same "cache the promise
// itself" idiom render.js already uses for att._sha256Promise, so concurrent/repeat calls share the
// one in-flight setup instead of racing to create it twice.
var clientPromise = null;
function getClient() {
  if (!clientPromise) {
    var client = new OCRClient();
    clientPromise = client.loadModel('vendor/tesseract-wasm/eng.traineddata').then(function () {
      return client;
    });
  }
  return clientPromise;
}

EV.ocr = {
  /** True when this browser can run OCR at all (createImageBitmap is required; every browser this
   * app targets already has it, but this keeps the failure mode an explicit message instead of a
   * confusing thrown error, matching how render.js's sha256Hex already degrades over file://). */
  isSupported: function () {
    return typeof createImageBitmap === 'function';
  },
  /** Runs OCR on one attachment (or returns its already-cached result). `att` needs `.bytes`
   * (raw file bytes), `.mimeType`, and `._sha256Promise` (already computed/cached by render.js). */
  run: function (att) {
    if (!EV.ocr.isSupported()) {
      return Promise.reject(new Error('OCR isn’t available in this browser (createImageBitmap is missing).'));
    }
    return Promise.resolve(att._sha256Promise).then(function (hash) {
      var cached = hash ? EV.ocrCache.get(hash) : Promise.resolve(null);
      return cached.then(function (rec) {
        if (rec) return rec.text;
        return getClient().then(function (client) {
          return createImageBitmap(new Blob([att.bytes], { type: att.mimeType })).then(function (bitmap) {
            return client.loadImage(bitmap).then(function () {
              return client.getText().then(function (text) {
                return client.clearImage().then(function () {
                  if (hash) return EV.ocrCache.put(hash, text).then(function () { return text; });
                  return text;
                });
              });
            });
          });
        });
      });
    });
  }
};
