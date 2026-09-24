# Changelog

All notable changes to this project are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
