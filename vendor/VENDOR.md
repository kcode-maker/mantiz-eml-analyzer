# Vendored third-party code

This app deliberately vendors exactly one third-party library, checked in
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

Everything else in this project (MIME parsing, search indexing, tagging,
the UI) is hand-written with zero further dependencies.
