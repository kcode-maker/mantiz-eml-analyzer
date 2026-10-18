# Architecture

Internals, design rationale, and dependencies. For what the app does and
how to use it, see [README.md](README.md) and [HELP.md](HELP.md).

## Contents

- [No build step](#no-build-step)
- [File layout](#file-layout)
- [Feature modules and `ctx`](#feature-modules-and-ctx)
- [Portability and standalone rules](#portability-and-standalone-rules)
- [Why JavaScript expressions for rules](#why-javascript-expressions-for-rules)
- [Security model](#security-model)
- [Design notes](#design-notes)
- [Dependencies](#dependencies)
- [Browser support](#browser-support)
- [Test suite](#test-suite)
- [Known limitations](#known-limitations)

## No build step

Everything under `js/` is a classic (non-module) script attached to a
single `window.EV` namespace, loaded in order by `index.html`. No bundler,
no npm, no transpilation — nothing in the toolchain that can go out of
date or fail to build. `js/` is grouped into five folders —
`core/` (storage/config), `parsing/` (turning raw bytes into a safe
structured email), `indexing/` (search + the Worker pool), `rules/` (the
tagging-rules engine), and `ui/` (everything that touches the DOM, itself
split into `features/` and `email/`).

## File layout

| File | Responsibility |
|---|---|
| `js/parsing/emlParser.js` | Hand-written RFC 5322 / 2045 / 2046 / 2047 parser: headers, MIME multipart tree, base64/quoted-printable decoding, charsets, encoded-word subjects/names, address lists, stable per-email id. Zero dependencies. |
| `js/parsing/sanitize.js` | Turns a raw HTML body into a safe document: DOMPurify → resource URL rewriting (blocks remote content, resolves `cid:` to local blob URLs, flags link text/destination mismatches) → CSP-wrapped shell, for a sandboxed `<iframe>`. |
| `js/parsing/urlExtract.js` | URL extraction, HTML→text fallback, the shared tokenizer used by both the search index and query parser. |
| `js/indexing/indexLogic.js` | The actual per-file work for indexing, raw search, and rule evaluation (facts-object construction + the compiled-rule cache) — runs identically inside a Worker or (fallback) the main thread. Also owns the sender-spoofing helpers, the always-on urgency/financial-indicator scanners, and eager per-attachment SHA-256 hashing, all computed once per file alongside everything else. |
| `js/core/folderPath.js` | Pure helpers for the opened folder's full on-disk path: `fingerprint` (a dozen evenly-spread `{p, s}` file path/size pairs) and `join` (unix or backslash separator by the base). The real lookup is `scripts/folder_locator.py`, called through serve.py's `/__mantiz/locate-folder`. |
| `scripts/folder_locator.py` | Read-only, bounded, stdlib-only search that finds a folder by name and accepts it only when every fingerprinted file exists with the same size (mdfind on macOS, a time-limited walk elsewhere). |
| `js/parsing/headerTables.js` | Pure parsing for the Headers tab and the checklist: `parseAuthResults` (Authentication-Results → method/result/comment/props), `parseReceived`/`receivedChain`, and `originOf` (earliest / newest public IP in the chain), `chainTiming` (per-gap delays, slowest, negative gaps kept) and `hopTableText`, `analyzeHeaderForgery` (two strong inserted-header patterns only), `classifyOrigin` (internal/external verdict against Settings → Organization), `analyzeChain` (per-hop hand-off state ok/broken/unknown via `hopsConnect`, plus time-travel beyond a 5-minute skew). The one definition used by the Headers tab, the Security checks row (`received-broken`/`received-time-travel`) and the search index. |
| `js/indexing/anomalies.js` | The Security card's Header / Body / Attachments / Language checklist as pure, DOM-free logic (`EV.analyzeAnomalies`, plus `EV.scriptProfile`/`EV.mixedScriptWords`). The one definition shared by the Preview card, the search index (`meta.flag:`, `script.*:`) and rule facts (`f.anomalies`, `f.subjectScripts`, `f.bodyScripts`); bounded scans (20K chars of body, 200K of HTML, 50 hops) and an ASCII fast path keep it cheap enough for every email at indexing time. |
| `js/indexing/worker.js` | Thin Web Worker entry point around `indexLogic.js`. |
| `js/indexing/workerClient.js` | A pool of Workers (one per CPU core) with a synchronous, yielding fallback; streams a huge file list through the pool with bounded concurrency so memory never holds more than a small window of files at once. |
| `js/indexing/searchIndex.js` | Main-thread decoded search: structure-of-arrays metadata + an inverted index built incrementally from worker results, plus the query grammar/ranking. |
| `js/indexing/rawSearch.js` | Orchestrates a parallel, cancelable, streaming raw-byte grep across the open folder. |
| `js/indexing/pathFilter.js` | The "files to include/exclude" path filter (plain substring matching, optional `*`/`?` wildcards) — a small pure module shared identically by `searchIndex.js` and `rawSearch.js`. |
| `js/rules/rulesStore.js` | IndexedDB CRUD for rule definitions plus the per-rule "current match set" that makes disabling/renaming exact and instant. |
| `js/rules/rulesEngine.js` | Runs enabled rules across the pool, diffs new vs. previous match sets, applies exactly the tag add/remove operations needed; the dry-run "Test" path. |
| `js/rules/ruleTemplates.js` | The 27 starter rule templates (`EV.RULE_TEMPLATES`) — a DOM-free module so `tests/ruleTemplates.test.js` can compile-check every one under `jsc`. |
| `js/ui/app.js` | The composition root, ~180 lines: builds the long-lived objects (worker pool, search index, rules engine, `state`), looks up the page's elements once, creates every feature module with one shared `ctx`, and starts the app. The only file that knows the whole module list. |
| `js/ui/features/*.js` | The app's features, one module each, created by `app.js` in order: `explorer` (file tree, multi-select), `fileOps` (right-click menu, Delete/Move/Copy, bulk OCR), `tabsView` (tab strip glue), `pages` (Folder overview and Settings pages), `folderLocation` (names/paths shown, real-path lookup), `workspace` (opening folders, demo, indexing start), `tagsPanel` (tags, Tag Deletion), `settingsPage`, `rulesPanel`, `searchPanel`, `exportsPanel` (tag/rule import-export, sidecar, case report), `session`. See *Feature modules and `ctx`* below. |
| `js/ui/overlays.js` / `js/ui/uiKit.js` | Shared UI primitives with no app state: the context menu, toast (with Undo), clipboard copy, one-dialog-at-a-time slot, byte formatters; and the DOM/format helpers (`el`, `copyBtn`, ...) every UI file uses. |
| `js/ui/fileTree.js` | Folder ingestion — File System Access API, `<input webkitdirectory>`, and drag-and-drop, unified into one tree model — plus the Delete/Move/Copy write-side logic. |
| `js/ui/virtualList.js` | Minimal virtualized list so the tree and search results stay smooth at any folder size. |
| `js/ui/tabs.js` / `js/ui/render.js` | Multi-tab viewer (LRU eviction) and the email renderer: the Preview (bento cards, Metadata, Links, calendar card, tag editor), Raw and decoded text/HTML views. |
| `js/ui/email/*.js` | The email view's larger pieces, each a pure presentation of one analysis module: `securityCard` (checklist + metric tiles), `headersView` (Authentication-Results, Received chain, decoded All headers), `attachmentsView` (attachments, SHA-256, OCR panel). |
| `js/core/settingsCache.js` | Synchronous copies of the Settings lists the Preview needs (categories, trusted domains, the organization's own domains), refreshed when Settings change. |
| `js/ui/icons.js` | A small dependency-free inline-SVG icon set used throughout the toolbar/tree/tabs/context menus. |
| `js/core/tags.js` / `js/core/db.js` | IndexedDB-backed tags/notes, keyed by `Message-ID` (content-hash fallback), with JSON export/import. |
| `js/core/settings.js` | The user-editable trusted-domains list, domain categories, the max-open-tabs setting, and the sample-emails demo banner's dismissed/always-show state, all IndexedDB-backed. |
| `js/core/whois.js` | The WHOIS/RDAP domain-age lookup — the app's one outbound `fetch()` besides OCR-model loading, gated behind an explicit per-domain click. |
| `js/core/ocrBridge.js` | The app's one ES module (`<script type="module">`) — bridges to the vendored OCR engine. Runs entirely client-side against already-in-memory attachment bytes. |
| `js/core/ocrCache.js` | IndexedDB-backed cache of OCR results, keyed by the attachment's own SHA-256 (content-addressed), so the same image reused across emails or sessions never re-runs OCR. |
| `js/core/session.js` | Persists what was open so the app can offer to resume it. |

## Feature modules and `ctx`

`js/ui/app.js` is deliberately small. Each feature lives in `js/ui/features/<name>.js` as `EV.ui.features.<name> = function create(ctx) { ... }`:

- **One shared `ctx` object.** It holds the long-lived objects (`state`, `els`, `pool`, `searchIdx`, `rawSearchObj`, `rulesEngine`) and whatever each feature *exports* for the others (`ctx.openTab`, `ctx.renderRulesList`, ...). Features never call each other's modules directly — `tests/test_structure.py` fails if one does — and only reach into `ctx` when a user action runs, never while being created, so creation order is irrelevant for correctness.
- **A feature owns its DOM wiring.** It attaches its own listeners and keeps its own private state; state shared between features lives on `state` or `ctx`.
- **Shared primitives** (`el`, toast, context menu, dialog slot) come from `EV.ui.*` (`uiKit.js`, `overlays.js`) — never re-implemented.
- **Pure logic stays out of `ui/`.** Anything that can be decided without the DOM (parsing, analysis, query grammar, path math) lives in `parsing/`, `indexing/`, `core/` or `rules/` and is covered by the `jsc` tests; a feature module only presents it.

What each module exports to the others, and what it needs from them:

| Module | Exports on `ctx` | Uses from other modules |
|---|---|---|
| `explorer` | `rebuildVisibleRows`, `revealInTree`, `updateBulkTagBar`, `treeList` | `openTab`, `showFileActionMenu`, `startIndexing`, `untagSelectedEmails`, `updateFilesStatus` |
| `fileOps` | `showFileActionMenu`, `WRITE_UNAVAILABLE_TITLE` | `fullPath`, `reloadWorkspaceFromHandle` |
| `tabsView` | `onTabActivate`, `openTab`, `tabMgr` | `closeOverviewView`, `closeSettingsView`, `fullPath`, `overviewOpen`, `renderPathBar`, `revealInTree`, `saveSession`, `settingsOpen`, `treeList` |
| `pages` | `closeOverviewView`, `closeSettingsView`, `overviewOpen`, `settingsOpen` | `onTabActivate`, `renderSettingsView`, `tabMgr` |
| `folderLocation` | `fullPath`, `renderPathBar`, `resolveFolderLocation`, `updateFilesStatus` | `tabMgr` |
| `workspace` | `initDemoBanner`, `reloadWorkspaceFromHandle`, `setWorkspace`, `startIndexing` | `checkForTagsSidecar`, `clearSearchResults`, `fullPath`, `rebuildVisibleRows`, `refreshTagDotCache`, `resolveFolderLocation`, `runAllEnabledRules`, `saveSession`, `tabMgr`, `updateBulkTagBar`, `updateFilesStatus`, `updateTagsSidecarButtonState` |
| `tagsPanel` | `refreshTagDotCache`, `renderTagFilterList`, `resolvePathsForTags`, `untagSelectedEmails` | `rebuildVisibleRows`, `refreshLiveResultsView`, `refreshSuggestTagNames`, `renderRulesList`, `showFileActionMenu`, `showTagMatches`, `tabMgr`, `toggleRule` |
| `settingsPage` | `renderSettingsView` | `tabMgr` |
| `rulesPanel` | `refreshLiveResultsView`, `renderRulesList`, `runAllEnabledRules`, `showTagMatches`, `toggleRule`, `liveResultsView` | `clearSearchResults`, `currentResults`, `resolvePathsForTags`, `searchResultsList`, `showFileActionMenu`, `showSidebarView`, `updateSearchSelectionBar` |
| `searchPanel` | `clearSearchResults`, `refreshSuggestTagNames`, `updateSearchSelectionBar`, `currentResults`, `searchResultsList` | `liveResultsView`, `openTab`, `showFileActionMenu`, `showSidebarView` |
| `exportsPanel` | `checkForTagsSidecar`, `updateTagsSidecarButtonState` | `WRITE_UNAVAILABLE_TITLE`, `renderRulesList` |
| `session` | `saveSession`, `tryResumeSession` | `openTab`, `setWorkspace`, `tabMgr` |

To add a feature: create `js/ui/features/<name>.js`, add its `<script>` tag before `app.js` in `index.html`, and add its name to the list in `app.js`; `tests/test_structure.py` checks all three agree.

## Portability and standalone rules

These hold for every change (and `tests/test_structure.py` enforces the checkable ones):

- **Standalone.** No build step, no npm/pip packages, no CDN: every `<script>`/`<link>` is a local file; the browser code needs only a modern browser, and `scripts/serve.py` needs only the Python 3 standard library. The only network requests are two explicit, per-click lookups (VirusTotal, WHOIS) plus same-origin calls to the local server.
- **OS-independent.** The same files run on macOS, Windows and Linux: no hard-coded user paths, no platform sniffing in the browser, modifier keys are `Ctrl || Cmd`, paths are joined with the separator of the path that was found (`/` or `\`). Anything OS-specific in `scripts/` sits behind a runtime check (`mdfind` only on macOS, drive letters only on Windows) and has a test with a mock for the other platforms.
- **Graceful degradation.** A feature that needs something a host lacks (File System Access for writes, `crypto.subtle` over `file://`, the local server for folder paths) says so and falls back, rather than failing.

## Why JavaScript expressions for rules

The rule editor asks for a **boolean JavaScript expression** — e.g.
`f.from && f.replyTo && f.from.domain !== f.replyTo.domain` — rather than a
custom mini-language. That's a deliberate choice:

- **It's the simplest option that's still fully expressive.** A custom DSL
  needs its own grammar for comparisons, boolean logic, string/regex
  matching, and field access — and still falls short the moment you want
  something the grammar didn't anticipate. Plain JS already has all of
  that, with no new syntax to learn.
- **The trust model fits.** Rules are config *you* write for *your own*
  browser tab — never attacker-controlled content flowing through the app
  (that's the email body, always sandboxed separately and never executed).
  Running a rule as real JS is no more of a security boundary crossing
  than a personal userscript.
- **It scales with the task.** The same mechanism that runs
  `f.dmarc === 'fail'` also runs a Levenshtein-distance typosquat check or
  a regex over attachment filenames, with no engineering needed to "add
  support" for either.
- Rule expressions run inside the same Worker pool used for indexing, so
  a slow or even infinite-looping rule can't freeze the UI.

Three rule helpers (`h.hasDualExtension`, `h.hasHiddenUnicode`,
`h.shannonEntropy`/`h.looksRandom`) implement general, independently
re-derived detection concepts (double-extension attachments, hidden
Unicode, random-token detection) rather than anything copied from a
specific source.

## Security model

This tool is built to be safe to point at hostile input — that's the
whole point of a phishing-analysis tool:

- No script from an opened email ever executes: the body renders inside
  `<iframe sandbox="allow-same-origin">`, deliberately without
  `allow-scripts`. `allow-same-origin` alone is what inline `cid:` images
  (`blob:` URLs, origin-scoped) need to load; it grants no script
  execution on its own.
- No network request happens as a side effect of opening or browsing an
  email — remote images/CSS are blocked by default and only fetched after an
  explicit, confirmed "Load remote content" switch, which applies to all emails
  until turned off, a new folder is opened or the page is reloaded (it is held
  in memory only, never persisted, and a status-bar chip shows while it is on).
- The only other traffic is same-origin requests from the page to the local
  server that serves it (`scripts/serve.py`): a keep-alive ping and the folder
  lookup that finds an opened folder's real path (`/__mantiz/locate-folder`).
  That endpoint is read-only and bounded, answers only requests from the app's own
  page on a loopback host (checked via Host, Origin and Sec-Fetch-Site), and returns
  a path only when every fingerprinted file matches by name and size.
- Attachments are never auto-opened or rendered live. HTML/script
  attachments are shown as inert, escaped source text only. The only way
  to act on one is an explicit Download click.
- Links are never auto-navigable from inside a rendered body (no
  `allow-popups`/`allow-top-navigation`) — inspect a link's real
  destination via its tooltip or the Links panel instead of clicking it.
- **Rules are the one deliberate exception**: a rule expression runs as
  real JavaScript, by design — see
  [Why JavaScript expressions](#why-javascript-expressions-for-rules).
  This is safe specifically because rules are config you author yourself,
  never content extracted from an email.
- Nothing is sent anywhere on its own: no backend, no analytics, no
  telemetry. The only outbound network activity this app's own code ever
  initiates is two deliberate, explicit, per-click exceptions:
  - **Scan URL** — sends only the URL string (never the file it came
    from) to VirusTotal in a new tab; nothing is ever fetched by this app
    itself. Resolving a redirect chain client-side was deliberately not
    built — it would mean this app's own network directly contacts
    whatever the link points to, tipping off the sender that the message
    is under investigation.
  - **WHOIS** — a single request to the free public RDAP service with
    only the domain string, on explicit per-domain click. Always resolves
    to an explicit found/not-found/error state, times out after 8s.
- File writes (Delete/Move/Copy) only ever happen as the direct result of
  explicitly right-clicking and choosing an action — never automatically.
  Delete moves files into a recoverable `.deleted` folder rather than
  removing them.

## Design notes

- **Scale**: browsing the tree and opening any single email is instant
  regardless of folder size — files are read lazily, never all loaded
  into memory. Full-folder decoded search indexing (and rule evaluation)
  is bound by real disk-read + MIME-decode throughput, parallelized
  across a Worker pool (one per CPU core) — incremental and searchable
  while still running, with a live progress indicator. Raw search skips
  MIME decoding entirely and is always fast.
- **No dependency for parsing**: the MIME parser is hand-written rather
  than a library, both to avoid needing a bundler and to keep the
  highest-volume code path fully auditable. Run against several hundred
  real-world sample emails (legitimate and phishing) plus targeted
  synthetic fixtures covering multipart nesting, inline images, RFC 2047
  encoded subjects, and SPF/DKIM/DMARC header parsing, with zero parse
  failures.
- **Rule match tracking**: `js/rules/rulesStore.js` records exactly which
  emails each rule currently matches, which is what makes disabling a
  rule an instant, exact retraction instead of a re-scan-and-guess, and
  what makes tag-renaming safe (swaps the tag directly on every recorded
  match rather than leaving old tag text stranded).
- **Attachment SHA-256 is eager, OCR is not**: hashing an attachment is
  cheap once its bytes are already decoded during indexing, so
  `attachment.sha256:` search covers the whole folder immediately. OCR
  runs through one shared, sequential engine instance and costs real
  seconds per image, so it stays opportunistic — only ever covering
  images a user has explicitly clicked OCR on, or explicitly selected via
  the bulk "Extract OCR (selected)" action — never automatic, and never a
  single whole-folder button.

## Dependencies

### Vendored third-party libraries

| Library | Version | License | Used for |
|---|---|---|---|
| DOMPurify | 3.1.6 | Apache-2.0 OR MIT | Sanitizing attacker-controlled HTML email bodies before rendering. |
| tesseract-wasm | 0.11.0 | BSD-2-Clause | Local, offline OCR text extraction for the first meaningful image attachment — runs entirely client-side, no network call. |

See [`vendor/VENDOR.md`](vendor/VENDOR.md) for the exact files, source
tarball, and SHA-256 hashes used to verify each one hasn't been tampered
with. Everything else — the MIME parser, search index, rules engine, and
UI — is hand-written for this app with no further dependencies.

### Browser platform APIs relied on

| API | Used for |
|---|---|
| Web Workers | Parallel background parsing/indexing/search/rule evaluation, one worker per CPU core (falls back to a yielding main-thread loop when unavailable) |
| IndexedDB | Storing tags, notes, rule definitions, OCR cache, and session/resume state locally in your browser |
| File System Access API | One-click folder open and genuine one-click resume, in Chrome/Edge |
| `<input type="file" webkitdirectory>` | Folder-open fallback in Firefox/Safari |
| `crypto.subtle` (SubtleCrypto) | SHA-256 hashing of attachments |
| Blob / File / `URL.createObjectURL` | Rendering inline images, attachment downloads, the sandboxed preview `<iframe>` |
| `fetch` / `AbortController` | The WHOIS button's per-click RDAP request, and loading the OCR model file |

## Browser support

| Feature | Chrome / Edge | Firefox | Safari |
|---|---|---|---|
| Open a folder | ✅ native picker + remembers it | ✅ classic picker | ✅ classic picker |
| Resume last session (one click) | ✅ | re-pick the folder to relink | re-pick the folder to relink |
| Background workers / hashing | ✅ (over http://) | ✅ (over http://) | ✅ (over http://) |
| Delete / Move / Copy | ✅ (with write permission granted) | ❌ | ❌ |
| Everything else, incl. rules | ✅ | ✅ | ✅ |

## Test suite

`tests/*.test.js` are real, checked-in regression tests — no Node/npm
involved, they run under JavaScriptCore (`jsc`), the same engine used for
manual syntax checking. `bash tests/run-all.sh` runs the whole suite (25
files, over 1,000 assertions, plus the Python tests for the folder locator) and a
syntax check of every `js/**/*.js` file;
CI (`.github/workflows/ci.yml`) runs the same script on every push/PR.

Coverage includes: the MIME parser against real fixtures, tag-provenance
tracking, the Delete/Move/Copy filesystem logic against a hand-built mock
of the File System Access API, the sender-spoofing and always-on
urgency/financial-indicator helpers, every starter rule template
compile-checked against a synthetic facts object, the Settings store, the
WHOIS response-normalization logic, the calendar-invite parser, the
decoded-search query grammar (including OR/grouping and namespaced
fields), the OCR cache, and `buildIndexDoc` itself (the per-file indexing
work, including eager attachment hashing).

## Known limitations

- **`.eml` only** — not Outlook's proprietary `.msg` binary format.
- **S/MIME signature verification** is out of scope.
- **No absolute file paths**: browsers never expose a picked folder's
  real OS path to a web page, by design. The tree shows the folder's own
  name as its root and paths relative to it everywhere.
- **Tags live in the browser's IndexedDB by default**, not written back
  into the `.eml` files. Switching machines/browsers loses them unless
  you use Export/Import, or (Chrome/Edge, write access granted) the Tags
  panel's **Save to folder** button, which writes a portable
  `mantiz-tags.json` sidecar at the workspace root.
- **Search grammar** has no way to express arbitrary boolean nesting
  beyond AND/OR/NOT. Body/`header.raw` phrase queries mean "all these
  words present", not strict word-adjacency — a deliberate, permanent
  tradeoff for memory-bounded search at very large folder sizes. Rules
  don't have this limitation, since they're full JS expressions.
- **Delete/Move/Copy require Chrome or Edge**, a folder opened via
  **Open Folder** specifically, and write permission granted when
  prompted.
- Opened via plain `file://` (no local server): Web Workers and
  `crypto.subtle` are unavailable in Chromium-based browsers, so parsing/
  search/rules run single-threaded and attachment hashes aren't shown.
