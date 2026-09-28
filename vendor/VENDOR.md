# Vendored third-party code

This app deliberately vendors two third-party libraries, checked in
directly (no npm/build step required to run the app).

## DOMPurify

- Version: 3.1.6
- File: `dompurify.min.js`
- Source: https://unpkg.com/dompurify@3.1.6/dist/purify.min.js
- SHA-256: `c0845096a7c4a6741f362ac506c94c1c7d27dc603bcc1bf64a587f76f2dbe3a1`
- License: Apache-2.0 OR MIT (dual-licensed by Cure53)
- Why: sanitizing attacker-controlled HTML email bodies before they're
  rendered is the single highest-consequence security surface in this app.
  DOMPurify is the de facto standard for this and is used here as one more
  defense-in-depth layer underneath a script-less sandboxed `<iframe>` — see
  `js/parsing/sanitize.js`.

To verify the file hasn't been tampered with:

```bash
shasum -a 256 vendor/dompurify.min.js
# should print the hash above
```

## tesseract-wasm (OCR)

- Version: 0.11.0
- Files: `tesseract-wasm/lib.js`, `tesseract-wasm/tesseract-worker.js`,
  `tesseract-wasm/tesseract-core.wasm`, `tesseract-wasm/tesseract-core-fallback.wasm`
- Source: npm registry tarball
  `https://registry.npmjs.org/tesseract-wasm/-/tesseract-wasm-0.11.0.tgz`
  (files taken from its `package/dist/` directory, unmodified)
- SHA-256:
  - `lib.js`: `ed6b39d775484081affa3d21bf491f705673c2a3fd616b2f7bce9020ed8eba13`
  - `tesseract-worker.js`: `a2773a8a09bd51ce066092980f8243a08cbda37277d7ad577e5cfda0435b656a`
  - `tesseract-core.wasm`: `3822dc6ee83d507f2bd2f83b97a3dd5dabf3ea71a9836d951602c9054615137e`
  - `tesseract-core-fallback.wasm`: `94d9ce820d31a75814d0b4e5d099405b8738b11633bcef8c0d078a53b2b1ded2`
- License: BSD-2-Clause (Robert Knight and tesseract-wasm contributors).
  Bundles [comlink](https://github.com/GoogleChromeLabs/comlink) (Apache-2.0,
  Google) inlined into `lib.js`/`tesseract-worker.js` at its own build time —
  no separate file to vendor/document for it.
- Why: local, offline OCR text extraction for the Attachments tab's first
  meaningful image attachment (inline or attached), so an analyst doesn't
  have to leave the app to read text embedded in a phishing screenshot.
  Chosen over the more well-known `tesseract.js` specifically because it
  ships no built-in image-format decoding (this app already decodes the
  image itself via `createImageBitmap`, so that code would be dead weight),
  making it roughly 7x smaller and an order of magnitude faster per image
  in published benchmarks. Runs 100% locally against already-in-memory
  attachment bytes — no network call, no code execution from attachment
  content, matching this app's read-only/never-run-an-attachment posture.

### eng.traineddata (English OCR model)

- Source: the `tessdata_fast` repo, pinned to commit
  `923915d4ced2a7235221788285785a29c4a42d4a` (the *only* commit that has
  ever touched this file — "Initial import to github", 2017-09-14 — so
  pinning to it is fully reproducible and identical to what `main` serves
  today):
  `https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/923915d4ced2a7235221788285785a29c4a42d4a/eng.traineddata`
- Size: 4,113,088 bytes
- SHA-256: `7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2`
- License: Apache-2.0 (tesseract-ocr project)
- Why: the `tessdata_fast` variant trades a little accuracy for much
  faster inference — appropriate for an interactive per-click UI action
  rather than a batch OCR pipeline. English-only for now; another language
  would be its own additional vendored file and entry here.

To verify none of these six files have been tampered with:

```bash
shasum -a 256 vendor/tesseract-wasm/lib.js
shasum -a 256 vendor/tesseract-wasm/tesseract-worker.js
shasum -a 256 vendor/tesseract-wasm/tesseract-core.wasm
shasum -a 256 vendor/tesseract-wasm/tesseract-core-fallback.wasm
shasum -a 256 vendor/tesseract-wasm/eng.traineddata
# each should match the hash listed above
```

Everything else in this project (MIME parsing, search indexing, tagging,
the UI) is hand-written with zero further dependencies.
