# Changelog

All notable changes to this project are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.2.0] — 2026-09-28

### Added

- **Search results bulk actions**: Gmail-style checkboxes on every result row
  plus a master select-all/indeterminate/none checkbox above the list
  (alongside the existing Explorer-style Shift/Ctrl-click range/toggle-
  select), a live "N of M selected" count, and right-click → **Copy
  path(s)** / **Copy file name(s)** (clipboard-only, always available) next
  to the existing Move/Copy-to-folder/Delete actions.
- **Rules and Tags panels: "View matches" / "View files"** — lists a rule's
  matched emails or a tag's members in the Search tab, with the exact same
  select-all/multi-select/right-click bulk actions Search already has, so
  clustering-then-moving works identically no matter how the cluster was
  found.
- **VSCode-style "files to include/exclude" path filter**
  (`js/indexing/pathFilter.js`), shared identically by Decoded and Raw
  search — plain substring matching with optional `*`/`?` wildcards,
  exclude always wins over include.
- **Export IOCs (CSV) now scopes itself** to whatever the Search tab is
  currently showing: an explicit multi-selection first, else the current
  search/rule/tag results, else (nothing shown) the whole indexed folder —
  shown live in the button's own tooltip.
- **Configurable max open tabs** (Settings → IDE config, 1–100, default
  10): the tab you viewed longest ago is evicted first (LRU) once you're
  over the limit, not simply the first one you opened — re-selecting an
  older tab keeps it from being the next one closed.
- **Explorer shows a small green ring** right after the file icon for any
  file currently open in a tab (not just the active one), updated live as
  tabs open/close — deliberately a different shape/position from a tag's
  filled color dot(s) after the filename, so the two are never confused
  even when a tag's hash-assigned color happens to also be green.
- **Delete tag** (Tags panel): removes a tag from every email that carries
  it, in one click — the emails themselves are never touched. A still-
  enabled rule that applies the tag will simply re-add it on its next run,
  so this is for a manually-typed tag or one whose rule you've already
  retired.
- **`.mantiz-config.json`**: a small, gitignored, machine-specific config
  file (`{"port": 9000}`) next to `index.html` that `scripts/serve.py` now
  reads for its default port, instead of always assuming 8765 — a CLI port
  argument still overrides it for a single run. Settings → IDE config
  shows a read-only "Server port" line reflecting whatever port you're
  actually running on, with a pointer to this file — it can't be an
  editable/functional control there, since the browser page only loads
  *after* the server has already started and bound to a port.
- Thirteen new regression assertions across `tests/settings.test.js`,
  `tests/detections.test.js`, `tests/tags.test.js`, plus a new
  `tests/pathFilter.test.js` (23 assertions) and 2 new
  `tests/searchIndex.test.js` cases for the include/exclude filter — 327
  assertions across 10 files, up from 284/9.
- **OCR for image attachments** (Attachments tab): a "🔎 Extract text
  (OCR)" button on the first meaningful image per email (over a 512-byte
  size floor, inline or regular attachment alike — a large inline image
  is often exactly where a real phishing screenshot lives), running
  locally via a newly-vendored `tesseract-wasm` (BSD-2-Clause, see
  `vendor/VENDOR.md`) — no network call, nothing executed, pixel analysis
  only. Results are cached in IndexedDB keyed by the attachment's own
  SHA-256 (`js/core/ocrCache.js`), so the same image reused across
  emails, or the same folder reopened later, reuses one cached OCR run.
  `js/core/ocrBridge.js` is the app's one deliberate `<script
  type="module">` (still zero build step — a native browser feature, no
  bundler) since `tesseract-wasm` ships as a genuine ES module.
- **`attachment.ocr:` search field**, wired to that same OCR cache: text
  extracted by an OCR click is pushed straight into the live search
  index (`searchIndex.js`'s `addOcrText`/`ocrStats`), so it's searchable
  immediately, with zero OCR ever run automatically or at search time.
  Deliberately sparse — only covers emails a user has actually clicked
  OCR on — and the search-results status line shows a live "OCR
  coverage: N email(s) OCR-indexed so far — not exhaustive" note
  whenever a query touches this field, so that partial coverage is never
  mistaken for a complete answer.
- **Bulk "Extract OCR (selected)"**: a new right-click action — on any
  multi-selection or single file in Explorer, Search results, or a
  rule's/tag's "View matches"/"View files" list (all four share one
  context menu, so this one addition covers every surface at once) — that
  runs OCR on each selected email's first meaningful image, one at a
  time, skipping anything already cached, with a live "N/M" progress
  count and a Stop button in the status bar. Deliberately scoped to
  whatever's selected, never "the whole folder" in one click — OCR runs
  through one shared, page-session engine instance and is inherently
  sequential, so an unscoped whole-folder version could run for hours at
  this app's ~500K-file scale target; use the existing search/rule/tag
  filters to narrow down to the batch you actually want OCR'd first.
- **`attachment.sha256:` search field** — unlike `attachment.ocr:`, this
  one is eager and covers every attachment in the folder immediately:
  each attachment's SHA-256 is now computed during the normal indexing
  pass (the bytes are already fully decoded in memory at that point, and
  hashing them is cheap — nothing like OCR's per-image cost), so there's
  no "click something first" step and no partial-coverage caveat. Search
  by a known-bad hash from a threat-intel feed or a VirusTotal result to
  find every email carrying that exact file, across the whole folder, at
  full indexing speed.
- **Explorer "Refresh" button** (VS Code-style, ⟳ in the tree toolbar) —
  re-reads the open folder from disk to pick up files added, removed, or
  renamed by something other than this app (there's no live filesystem-
  watch API in browsers, so this app never notices on its own). Only
  meaningful for a folder opened via **Open Folder** (Chrome/Edge); shows
  a toast explaining why for a folder opened any other way, since only
  the native picker's folder handle can be re-read from disk. Keeps
  already-open tabs open (closing only ones for a file that no longer
  exists) rather than closing everything, unlike the same reload this
  app already used internally after Delete/Move/Copy.
- **Namespaced `header.*`/`attachment.*` search grammar** replacing the
  old flat field prefixes (`from:`, `to:`, `attachment:`, `attachments:`,
  `meta:`/`header:`) — a hard rename, see Changed below — plus five
  fields that weren't searchable at all before: `header.cc`,
  `header.bcc`, `header.replyto`, `header.returnpath` (exact full-address
  match — same tokenizer limitation the old `to:` already had),
  `header.messageid` (exact match), and `attachment.ext` (exact
  extension match, e.g. `attachment.ext:.exe`).
- **Links panel shows the exact source of an empty-text link's action**
  instead of one generic "(image or empty link)" placeholder — e.g.
  `[Image: Open shared file]` when the link's only content is an image
  (using its `alt` text when present), or `(empty link text)` when
  there's truly nothing — since an image used as a fake "click here"
  button is a common phishing template pattern worth calling out
  specifically.

### Changed

- **Settings page redesigned as a VS Code-style two-pane layout**: a left
  category nav (IDE Config / Trusted Domains / Domain Categories) plus a
  right detail pane that actually fills the available width, instead of
  every section stacked in one column capped at 640px regardless of window
  size. Each section's long explanatory paragraph now starts collapsed
  behind a small "ⓘ" toggle instead of always taking up space.
- `python3 scripts/serve.py` **simplified to a single foreground mode** —
  it always opens your browser and runs until you close that terminal
  window or press Ctrl+C, exactly like the desktop launchers already did.
  The old default (start detached in the background, requiring a separate
  `--stop` command to remember) is gone entirely, along with its PID-file/
  log-file bookkeeping. It also always binds to exactly **port 8765** now
  (or an explicit port you pass) instead of silently drifting to the next
  free one if 8765 happened to be busy — a clear error tells you to close
  whatever's using it, or pass a different port, instead.
- **Search field names are namespaced now — a breaking, hard rename**:
  `from:`/`to:`/`attachment:`/`attachments:`/`meta:`/`header:` no longer
  parse as fields at all (they fall through to matching as a literal bare
  word instead). Use `header.from:`/`header.to:`/`attachment.filename:`/
  `attachment.count:`/`header.raw:` respectively — see Added above for
  every new field this namespacing unlocked. Nothing persisted (no saved
  searches, no export format) depended on the old syntax, so there's
  nothing to migrate.

### Fixed

- **Domain-category false positives**: the default "URL Shortener"/"File
  Sharing" keywords `t.co`/`box.com` matched via an unanchored substring
  check, so any domain merely *containing* those characters false-flagged
  — `target.com`, `microsoft.com`, `walmart.com` as "URL Shortener";
  `mailbox.com`, `inbox.com` as "File Sharing". Fixed by anchoring any
  keyword shaped like a real domain (contains a `.`) to an exact-or-
  subdomain match; a bare keyword with no dot keeps its existing
  intentionally-flexible substring behavior.
- **`mailto:`/`tel:` links no longer appear in the Links panel** — only
  real `http(s)`/`www` links are listed now (IOC rollups and rules already
  only ever considered real web links, so this was a display-only leak).
- **`setMaxOpenTabs(0)` silently reset to the default of 10** instead of
  clamping to 1, because `Math.round(0) || 10` evaluates the fallback (a
  classic falsy-zero bug) — caught by an automated regression test before
  it shipped anywhere live.
- **A space right after `field:` (e.g. `header.from: paypal`) silently
  zeroed out every search result**, with no warning explaining why —
  reported live against `attachment.ocr: shared document`. The leading
  space made the value-parser match nothing, so the whole `field:` span
  fell through to becoming its own literal (almost never-matching) bare
  word, ANDed into the rest of the query. Fixed by tolerating whitespace
  right after the colon before parsing the value — `field: value` and
  `field:value` now parse identically; the value still stops at the next
  whitespace/paren exactly as before, so a multi-word value still needs
  quotes (`field: "two words"`), same as it always has.
- **The "↻ Resume '…'" toolbar button showed a permanently stale folder
  name** — reported live as always showing an old folder ("healthcare_themed")
  no matter what was opened afterward, even in the same browser tab. It's
  rendered once, from whatever was saved at the moment the page first
  loaded, and was never hidden or refreshed again except by its own
  click-to-resume handler — so opening any *other* folder (Open Folder,
  drag-and-drop, the sample-emails demo) correctly updated the saved
  session underneath, but left the visible button frozen on the old text
  forever. Fixed by hiding it the moment any folder actually opens, for
  any reason — it's only ever meaningful in the "nothing open yet" moment
  right after a fresh page load, which is the only time it's shown now.

## [1.1.0] — 2026-09-24

### Added

- **Sender-spoofing checks**: display-name brand impersonation, sender-
  domain lookalike/typosquat detection, and IDN/punycode-encoded sender
  domains — computed once per email alongside indexing (no second pass),
  exposed as rule facts (`f.nameMismatch`/`f.lookalikeDomain`/
  `f.punycodeSender`) and three new rule templates, and rolled up into the
  IOC CSV export as a sender-anomaly count.
- **Settings page**: a gear icon in the toolbar opens a full-width Settings
  page in the right pane (not a sidebar tab) with a **Trusted domains**
  editor — bulk-paste multiple domains at once (auto-deduped), or add a
  `/regex/flags` entry for full control over what counts as trusted. A
  plain domain entry also covers its real subdomains automatically.
- **Domain categories**: a second Settings section answering "what type of
  domain is this?" — a small starter set (CDN/hosting, file sharing, URL
  shorteners, payment processors, social media, code repos/paste sites,
  email-security link-rewrite services, communication platforms,
  suspicious/free TLDs) checked against sender/reply-to/return-path,
  every URL domain, and domain-like text in headers/attachment filenames.
  Fully user-editable (add keywords to any category, or create new ones)
  and exposed as a rule fact (`f.domainCategories`), an IOC export rollup,
  a Metadata-panel row, and a new "Domain matches a flagged category"
  template. A newer app version can ship additional default categories
  later without resurrecting one a user deliberately deleted, or touching
  one they've customized.
- **Calendar invite card**: a small dependency-free RFC 5545 parser
  (`js/parsing/icsParser.js`) extracts Summary/When/Where/Organizer/
  Attendees/Description from a meeting invite — whether an inline
  `text/calendar` body part or a `.ics` attachment — and shows it as a
  "📅 Meeting Invite" summary card in Preview, without changing the
  existing download-only attachment behavior.
- **Desktop launchers**: `python3 scripts/serve.py --make-launchers`
  generates a double-click launcher per OS (`.command` for macOS, `.bat`
  for Windows, `.desktop`+`.sh` for Linux) into a local, gitignored
  `launchers/` folder, each with this exact copy's folder path baked in —
  safe to copy to an actual Desktop and double-click any time, unlike
  `scripts/run.sh`/`run.bat` which must stay inside the cloned repo. Runs
  the server in the foreground in its own window and opens the browser
  automatically; closing that window (or `Ctrl+C`) stops it immediately —
  unlike the default background mode, nothing is ever left running after
  you're done. `serve.py` also gained a plain `--open` flag (combine with
  `--foreground`) that these launchers use under the hood.
- **Tags sidecar file**: the Tags panel's new **Save to folder** button
  writes all tags/notes as `mantiz-tags.json` at the workspace root (write-
  capable folders only) — a portable alternative to Export/Import JSON
  that travels with the folder itself. Opening that folder again (even in
  a different browser/machine) detects it and offers a one-click Load.
  Hidden from the tree/index/search/rules, same treatment as `.deleted`.
- **`Aa` / `.*` search toggle buttons** (VS Code-style Match Case / Use
  Regex), below the Search button, shared by both Decoded and Raw search.
  In Decoded search they're scoped to subject/from/to/attachment (the
  fields with retained raw text): Match Case verifies exact case for
  quoted phrases and any term; Use Regex treats the whole search box as
  one pattern, bypassing `field:`/`"phrase"`/`tag:` syntax for that search
  (the same one-pattern model Raw search's own regex toggle already used).
  A status-line note explains the scope whenever either is on, and an
  invalid pattern matches nothing rather than crashing or matching
  everything.
- **Search: OR and parenthesized grouping** — `OR` (literal all-caps word
  only, so a lowercase `or` stays an ordinary search word) binds looser
  than the implicit AND, and `(...)` groups a sub-expression, including
  negating a whole group: `(from:paypal OR from:ebay) attachments:>0`,
  `-(from:paypal OR from:ebay)`. Malformed grouping (unbalanced parens, an
  `OR` missing an operand) matches nothing and reports a warning, same as
  every other unresolvable clause. Composes with the `Aa`/`.*` toggles
  too — Match Case verifies each leaf inside a group; Use Regex (which
  bypasses this whole grammar for a single-pattern search) treats
  `(`/`)`/`OR` as literal pattern text rather than grouping syntax.
- **Always-on Signals**: an urgency-language score (a scored keyword match,
  not a grammar check) and financial-indicator detection (IBAN, a labeled
  SWIFT/BIC code or routing number, BTC/ETH wallet addresses, gift-card
  requests) shown as badges in the Preview header for every email
  automatically — plus a new `urgency:` numeric search field, three more
  rule templates, and an IOC export rollup.
- **WHOIS / domain-age lookup**: a button next to the From domain (and
  each link's domain) looks up registration age via the free public RDAP
  service, one click at a time — the app's second (and only other)
  deliberate outbound network call besides Scan URL. Always shows an
  explicit found/not-found/error state, never a silent blank.
- **Sample-emails demo folder**: twelve synthetic messages under
  `sample-emails/` exercising every detection above (including a calendar
  invite and a pair of senders for trying OR/grouping search), loadable
  with one click from a first-run-only banner (tick "show this again next
  time" to bring it back on a later run).
- `js/` reorganized into feature folders (`core/`, `parsing/`, `indexing/`,
  `rules/`, `ui/`) instead of one flat directory.
- `RULE_TEMPLATES` extracted out of `app.js` into a DOM-free
  `js/rules/ruleTemplates.js` so all 17 starter templates are now
  compile-checked by the automated test suite (previously hand-verified
  once, never automated).
- Four new mutually-exclusive recipient-count-tier rule templates (25-75,
  75-200, 200-500, 500+ unique To/Cc/Bcc recipients) for spotting mass-
  sent/spray campaigns.
- `h.domainsAlign`/`h.registrableDomain` — DMARC-style "organizational
  domain" relaxed alignment (subdomain-aware domain comparison, e.g.
  `mail.example.com` aligns with `support.example.com`) — plus two new
  subdomain-aware sender/reply-to and sender/return-path mismatch
  templates using it, so a legitimate internal subdomain setup no longer
  false-positives against the existing exact-match variants. 27 starter
  templates total, up from 14 (including the domain-category template
  above).
- Six new test files (`detections.test.js`, `ruleTemplates.test.js`,
  `settings.test.js`, `whois.test.js`, `icsParser.test.js`,
  `searchIndex.test.js`) plus expanded `fileops.test.js`/`ruleTemplates.test.js`
  — 284 assertions total, up from 40.

### Removed

- A "triage hotkeys" feature (configurable keyboard shortcuts to tag and
  advance) was built partway through this release and then removed after
  reconsideration — it didn't earn its complexity.

### Fixed

- The Rules panel could go completely blank (not just for one rule — every
  rule card, since one uncaught error aborted the whole render) if a rule
  was disabled or deleted while a multi-rule "Run all" scan was still in
  flight: the scan's stale snapshot for that rule carried a `null` match
  count, which a `.toLocaleString()` call crashed on. Fixed by no longer
  persisting that stale snapshot over a rule's own disable/delete handling,
  and by rendering a clear "was disabled during its last run" message
  instead of assuming a finished run's shape.
- The Settings page's trusted-domains textarea rendered far shorter than
  its 3-row size (a sliver a single line tall) because it's a direct child
  of a flex-column Settings page, and a `<textarea>`'s default `overflow:
  auto` makes flexbox treat its minimum height as ~0 — shrinking it to fit
  regardless of the `rows` attribute. Fixed with `flex-shrink: 0`.

## [1.0.0] — 2026-09-24

First stable release. Everything below shipped incrementally; this is the
consolidated summary of what's in it.

### Added

- **Browse & read**: virtualized folder tree with real tree guide lines,
  Collapse All / Expand All / sort, a filter box, multi-tab viewer, and six
  views per email — Preview (sandboxed, sanitized render), Headers,
  text-body, html-body, Attachments, and Raw.
- **Explorer file-filter mode**: ".eml files only" (default) or "All files
  (as email)" — the latter treats extensionless files as candidate emails
  (for messages renamed to a content hash) while still skipping known
  non-email types (`.json`, `.txt`, `.png`, `.zip`, etc.).
- **Search**: a small query grammar (`field:value`, `"phrases"`,
  `-exclude`, `tag:`) over an inverted index, plus numeric fields
  (`attachments:>3`, `size:<2mb`, `urls:>=10`, `recipients:>20`,
  `duplicates:>1` for batch/campaign detection) and `field:/regex/` on
  subject/from/to/attachment. A separate Raw search mode greps untouched
  original bytes (optionally regex). An unresolvable clause matches
  nothing rather than everything, with a warning explaining why.
- **Tagging rules engine**: JavaScript-expression rules with 14 starter
  templates, exact instant disable/rename (no re-scan), live match stats,
  and export/import (previously only tags had this).
- **IOC export**: one-click CSV of every currently-indexed email's sender
  domains, URL/link domains, and attachment extensions.
- **Case-report export**: one-click Markdown report of every tagged email,
  grouped by tag.
- **Parse-errors panel**: files that failed to parse (or were too large)
  are listed with their reason, not just folded into a silent count.
- **Multi-select + bulk tagging**: Ctrl/Cmd-click and Shift-click to select
  multiple files in the tree, then tag them all at once.
- **Delete / Move / Copy** (Chrome/Edge with write access only): right-click
  a file, a multi-selection, a tag, or a rule's matches for a small context
  menu. Delete moves files into a `.deleted` folder at the workspace root
  (reversible; that folder is fully hidden from the tree/index/search/rules
  from then on) rather than a true unrecoverable delete. Move/Copy create
  or reuse a subfolder under the open root.
- **Scan URL** button in the Links panel — opens VirusTotal's URL analysis
  for a link in a new tab, mirroring the existing attachment-hash lookup's
  safety contract (nothing fetched directly by this app).
- A real checked-in test suite (`tests/*.test.js`, run via
  `tests/run-all.sh`) and GitHub Actions CI.

### Changed

- License switched from MIT to **PolyForm Noncommercial 1.0.0** — free for
  personal/noncommercial use, commercial use requires a separate agreement
  with the author.
- UI reorganized so each sidebar panel (Explorer/Search/Tags/Rules) owns
  its own toolbar, instead of a shared top bar.

### Fixed

Hardening for long-running/repeated use:

- Opening a second folder (or re-searching) before a previous background
  run finished could let stale data overwrite the new run's index — fixed
  with a per-run epoch guard in `searchIndex.js`/`rawSearch.js`.
- Disabling a rule while a scan across many rules was still running could
  resurrect tags `disableRule()` had already retracted — `rulesEngine.js`
  now re-checks each rule's live enabled state before applying its diff.
- A crashed Web Worker silently stalled its job (and the pool's capacity)
  forever — it's now replaced and its task rejected instead.
- `IndexedDB` opens blocked by another tab used to hang every tag/rule
  operation with no error at all — now surfaces a clear message and
  doesn't poison the connection for the rest of the session.

Parser and rendering correctness:

- A malformed address could swallow the rest of a recipient list; bounded
  to roughly one bogus segment instead.
- A MIME boundary reused across nesting levels (invalid, but possibly
  adversarial) could hide real content past it; fixed to use the last
  close marker instead of the first.
- RFC 2231 multi-segment filenames (`filename*0*=`, `filename*1*=`, ...)
  weren't reassembled at all; fixed, including a double-decode bug this
  fix's own test caught along the way.
- Base64 decode failures now surface a warning instead of silently
  looking like an empty part.
- A control-character-obfuscated remote URL could bypass the
  remote-content blocker; `resolveUrl` now normalizes control characters
  before checking the scheme.
- Link-mismatch detection now catches a domain embedded in a sentence
  ("Click here: paypal.com"), not just anchor text that's nothing but a
  bare URL.
- Attachment SHA-256 is now cached instead of recomputed on every visit to
  the Attachments tab.
- Tags now carry provenance (manually-typed vs. rule-applied): disabling
  or renaming a rule's tag no longer strips an identically-named manual
  tag on the same email.

## [0.x] — prior to the changelog

Everything from the initial commit through the UI-reorganization/hardening
pass: the original parser, sandboxed rendering, search, tagging, rules
engine, cross-platform launcher scripts, and the first round of live-tested
bug fixes. See `git log` for the full history.
