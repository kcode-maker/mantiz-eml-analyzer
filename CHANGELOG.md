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
- **Reader pane redesigned as a glass bento grid** (Preview tab): the email
  view is now a set of frosted-glass cards on an ultra-dark background —
  Message (subject, From/To/Date), Security (SPF/DKIM/DMARC in emerald/red/
  amber, urgency and financial Signals, Tags), Message body, Metadata, Links,
  Blocked resources — arranged as a 12-column bento grid when the pane is wide
  (metadata beside the body, no scrolling to reach it) and simply stacked when
  it is narrow (driven by the pane's own width via a container query, not the
  window). Built with plain CSS and a few new inline-SVG icons: no Tailwind,
  no icon library, no CDN, no new dependency, nothing loaded from the network.
  Pure layout — the same elements and code paths as before, only regrouped, so
  every Preview feature (tags and their autocomplete, copy buttons, remote-
  content toggle and blocked notice, calendar card, WHOIS, Scan URL, links
  panel, collapsible sections) is unchanged; the other tabs (Headers, text/html
  body, Attachments, Raw), the sidebars and Settings are untouched.
- **Long content can no longer break the layout** (stress-tested with
  hundreds of lines, a 3000px-wide table, unbreakable 250-character subjects
  and tokens, 200-character display names and filenames, 30 recipients, 500-
  character URLs, 2000-character headers, twelve 40-character tags): subjects,
  addresses, metadata values, tag chips and attachment names now wrap inside
  their card instead of pushing the reader pane sideways (a long subject used
  to run off-screen and take the Copy button with it; a long attachment name
  spilled out of its card). A very long or very wide email body scrolls inside
  the body panel, and its scrollbars are now always visible (they used to
  appear only while scrolling on macOS). Long names in the Explorer end in an
  ellipsis with the full name on hover; tabs are capped at a sensible width the
  same way; the rule editor's template dropdown no longer overflows its dialog.
- **"Load remote images/content" is now one switch for every email** (was
  per email): tick it once and all emails you open load remote content;
  untick it in any email and all go back to blocked. Because that widens a
  security decision, turning it on asks you to confirm, an amber "Remote
  content: ON" chip stays in the status bar while it is on (click it to turn
  it off), and it is held in memory only — a page reload or opening a different
  folder resets it to off.
- **Fix: "Load remote images/content" could not be ticked in some hosts**:
  the tick asked for confirmation through the browser's native `confirm()`, which
  some hosts (embedded browser panes in desktop apps) never show — it
  returns "no" instantly, so every tick was silently cancelled. The app now has its own
  confirm/alert dialogs (`js/ui/dialogs.js`) that work in every browser and host:
  Esc cancels, Tab cycles between the buttons, the safe button is focused first,
  and clicking outside cancels. They replace every native `confirm()` (remote
  content, "Move emails to .deleted", "Delete rule" — the last two would have
  silently done nothing there too) and all 27 native `alert()` messages (import
  results, permission and failure notices, which were invisible in that pane).
  Two messages in a row queue and are shown one after the other, and a
  double-click can't stack two confirmations.
- **Metadata card attachments are now laid out as aligned rows**: one row per
  attachment with three columns — name, type (extension) and size (with an
  "inline" note where it applies) — on one shared grid so they line up across
  rows however long a name is; a long name wraps inside its own column.
- **Click an attachment name to search for it**: each attachment in the Metadata
  card is a clickable tag that runs `attachment.filename:"<name>"` (editable, e.g.
  into `attachment.filename:/Inv-.*\.pdf$/i`). Also fixed: a regex on
  `attachment.filename` (and the Use Regex toggle) used to run against all of an
  email's filenames joined into one string, so `\.pdf$` missed an email whose PDF
  wasn't its last attachment; it now tests each attachment name on its own, so
  `^`/`$` anchor one filename. The indexer keeps each email's attachment names as
  a list for this.
- **Sender IPs, delay chart and hop table** (Headers tab, ideas from reviewing a header-analyzer
  tool, reimplemented offline): the Received chain now shows the **IP that connected to the
  receiving side** (newest public hop — recorded by the receiver, so the sender cannot forge it)
  and the **earliest public IP** (what the sender's own hops claim), each with Copy; a **Where the
  time went** bar chart (slowest gap named; days kept; negative gaps shown, not clamped to zero);
  and **Copy hop table** (TSV). Searchable as `meta.connectingip:` / `meta.originip:`, available to
  rules as `f.connectingIp` / `f.originIp`, shown in the Metadata card, and exported in the IOC CSV
  (`connecting_ip` / `origin_ip`). Per-hop country lookup was deliberately NOT added: it needs a
  licensed GeoIP database or a network call, against the standalone/offline rule.
- **Code architecture**: `js/ui/app.js` (once a 2,800-line closure) is now a ~180-line composition
  root; the app's features live in `js/ui/features/` (explorer, fileOps, tabsView, pages,
  folderLocation, workspace, tagsPanel, settingsPage, rulesPanel, searchPanel, exportsPanel, session),
  sharing one `ctx`; `render.js` hands its large views to `js/ui/email/` (securityCard,
  headersView, attachmentsView); shared UI primitives are in `uiKit.js`/`overlays.js` and the
  Settings lists the Preview reads are in `js/core/settingsCache.js`. No behaviour change.
  `tests/test_structure.py` now enforces the standalone / OS-independent / architecture rules
  (local-only scripts, allow-listed hosts, stdlib-only Python, no orphan modules, feature list
  matches the folder, load order, features talk only through `ctx`).
- **Fixed: the "Spaces are not allowed" tag note stuck on screen.** When a button (Tag file, Save
  rule) submitted an invalid name, the box had already lost focus, so nothing ever hid the note.
  It is now dismissed by any click or key outside the box, Escape, the box disappearing (bar
  cleared, modal closed) and a 4-second timeout — and the box's own text scrolling while you
  type no longer hides it early.
- **Evasion checks, tuned against false positives**: a new **Attachments** row (executable
  or script types, double extensions, a program disguised by its name via its first bytes,
  macro-enabled files, disk images, spoofed names) and a **Sender domain** row (look-alike
  letters imitating a trusted domain — punycode decoded, full-width folded — and bare-IP
  senders); `bidi-override` for RTLO characters; CSS-hidden text now also catches
  off-screen, 1px and white-on-white (same element). Hidden-character counting no longer
  trips on ordinary mail (Arabic/Hebrew LRM/RLM, emoji and Persian joiners, German soft
  hyphens, a leading BOM); any hidden character in a sender name or link host is flagged.
  From / Return-Path / Reply-To are now compared **by organisation** (subdomains align) and
  a Return-Path on a known mailing service (new default *Email Service Provider* category)
  is a note instead of a flag.
- **Security checks metric tiles + Folder overview**: four clickable tiles above the checklist
  (hidden characters, look-alikes, envelope, attachments) and a bar-chart button that opens
  a folder-wide overview — emails per flag, grouped, click to search. Four new sample emails
  (`12-evasion-tricks`) demonstrate the techniques.
- `attachment.ext:` accepts the extension with or without its dot (`exe` = `.exe`),
  matching what the autocomplete already offered; the Move/Copy and Tag Deletion
  dialogs can no longer be stacked by clicking their button repeatedly.
- **Headers are shown decoded**: the Headers tab's *All headers* table (and its Copy
  buttons) now decodes RFC 2047 encoded words in any charset (B/Q, split across words,
  language tags, missing base64 padding), RFC 2231 parameters (charset, percent-encoding,
  continuations) and raw UTF-8, with a "decoded" tag; the filter matches both forms and
  the Raw tab is untouched. The same decoders fixed: a multi-byte character split across
  two encoded words (also in Subject/From), non-UTF-8 RFC 2231 attachment filenames
  (`filename*=iso-8859-1''…`), UTF-7 text (a filter-evasion trick), and a latent
  double-decode of strings that were already Unicode.
- **Full folder path, found automatically**: browsers never reveal where a picked
  folder lives, so the local server (`scripts/serve.py`) finds it — the page sends the
  folder's name plus a small fingerprint (some relative paths and sizes) to
  `/__mantiz/locate-folder` and the server returns a path only when every fingerprinted
  file exists there with the same size (`scripts/folder_locator.py`: Spotlight on macOS,
  a bounded search elsewhere). No question is ever asked. The Explorer root, path bar,
  status bar and **Copy path(s)** show the full path (plus **Copy relative path(s)**).
  The endpoint accepts only same-origin requests from a loopback host.
- **Internal / External sender** (Settings → Organization): with your own
  domains configured, the Preview shows an Internal/External pill and the Security
  checks flag `claims-internal` — your domain, first hop from an unrelated public
  address, nothing authenticating it. Cloud mail that passes DMARC for your
  domain, and Exchange `AuthAs: Internal`, stay internal (no false alarms).
- **Inserted-header detection, strong evidence only**: `auth-results-conflict`
  (one server wrote two disagreeing Authentication-Results) and
  `auth-results-planted` (one sits below the oldest Received and names a server
  no hop was received by). Weak signals (HELO/rDNS differences, odd dates,
  private-IP hops) are intentionally not reported. Shown in the checklist and
  above the Headers tab's Authentication results; searchable via `meta.flag:`.
- **Sample emails now carry `Received` headers**, including a broken chain, backwards
  timestamps, an inserted Authentication-Results and a spoofed internal sender.
- Authentication-Results headers with no server id (Exchange Online style) are
  parsed correctly instead of treating `spf=pass` as the server name.
- `tests/run-all.sh` now also fails on `FAIL:`/`Exception:` lines — a promise-based
  suite failing inside a `.then()` previously left jsc's exit status at 0.
- **Headers tab redesigned into three sections**: a parsed **Authentication
  results** table (SPF/DKIM/DMARC pills, comments and properties as chips), a
  **Received chain** drawn from the sender (start point) through every hop to the
  recipient, with a red broken-link symbol where two hops don't connect, an amber
  marker for timestamps going backwards and the delay on each connector, and an
  **All headers** table with a filter and per-row Copy. The Security checks row
  gains `received-broken` (searchable as `meta.flag:received-broken`); chain
  logic lives in one pure module, `js/parsing/headerTables.js`, shared by the tab,
  the checklist and the search index.
- **Security checks: a full Header / Body / Language checklist in the Preview**:
  a new full-width card lists *every* check with ✓ / flag / note / not-applicable,
  so you can see what was tested. **Header**: Reply-To and Return-Path domain
  mismatch, Received-chain anomalies (none, timestamps going backwards, unusually
  long), Message-ID missing or from an unrelated domain, forged display name
  (an address inside the name that isn't the sender), duplicate From/Subject/Date…
  headers, DKIM signed by another domain. **Body**: no text part / no HTML part /
  empty body, image-only body, plain-text vs HTML disagreement, hidden content
  (CSS-hidden text, zero-width characters), **threading** (genuine reply vs fake
  "Re:" with no reply headers), and **mixed-script (homoglyph) words** in the
  subject, sender name, body and link hosts, naming the odd letter's code point.
  **Language**: the script of the subject and the body (LATIN, CYRILLIC, GREEK,
  ARMENIAN, HAN…) plus a script-mismatch note — script only, by design, not a
  language guess. Every flag is searchable via `meta.flag:<id>` (which now lists
  all of them, with autocomplete) and the scripts via `script.subject:` /
  `script.body:`; rules get `f.anomalies`, `f.subjectScripts`, `f.bodyScripts`.
  One shared pure module (`js/indexing/anomalies.js`) so card, search and rules
  cannot disagree; it adds about 0.09 ms per email to indexing (plain-ASCII text
  takes a fast path).
- **Metadata search (`meta.*`)**: the Metadata card's rows are now searchable —
  `meta.fromdomain:`, `meta.replytodomain:`, `meta.returnpathdomain:`,
  `meta.urldomain:`, `meta.category:`, plus `meta.flag:` (`replyto-mismatch`,
  `returnpath-mismatch`, `name-mismatch`, `lookalike`, `punycode` — the same
  definitions as the card's badges) and `meta.financial:` (iban, swift_bic,
  routing_number, crypto wallets, gift_card_request). The domain fields match the
  domain only, so `meta.fromdomain:paypal` finds `paypal.evil.net` but not a
  display name that merely says "PayPal". The Metadata card itself stays plain
  (only the attachment names are clickable). Autocomplete
  suggests the field names, the flag/financial values and the folder's real
  categories. The indexer now also records each email's Reply-To and
  Return-Path domain and their mismatch flags. `url:` (link addresses, e.g.
  `url:".pdf"`) already existed but was missing from the in-app help; it is
  documented there now, and no second `links:` name was added.
- **Click the Subject / From / To / Cc / Bcc / Reply-To tag to search for it**:
  the field labels in the Message card are now clickable tags (the values next
  to them stay plain, selectable text). A click fills the search box with the
  query (`header.subject:"…"` / `header.from:"…"`), runs it as a Decoded search
  (switching Raw mode and Use Regex off) and leaves the cursor in the box so you
  can edit and re-search. A recipient line with several addresses searches for
  any of them as an editable `(… OR …)` group. The subject also now has a
  "Subject" label like From/To/Date. The query builders (`EV.searchQueryFor`,
  `EV.searchQueryForAny`) are unit-tested end to end, including subjects with
  quotes, parentheses, a capital OR, colons and double spaces (inner spacing is
  kept, since the stored subject keeps it too).
- **Links in an email: normal pointer, click copies**: the pointer over a
  link was a "?" (the help cursor), which looked broken because clicking did
  nothing. It is now a normal hand, and clicking a link copies its address
  (a "✓ Link copied" confirmation in the hover bar) — it still never opens it.
  Also: Firefox gets themed email-body scrollbars via a guarded fallback, and
  the Windows "port already in use" helper no longer depends on Windows being
  set to English (it matched the word LISTENING, which is translated).
- **Link-hover bar**: hovering (or keyboard-focusing) a link in the email
  body now shows its full real destination in a bar just above the status bar
  — wrapped, never truncated to one line, and a red "⚠ Displayed text says …
  — actual destination: …" form for a deceptive link. Before, only the browser's
  own link bubble showed it, at the bottom-left over the status bar's text, and
  cut long URLs short. Display only (`textContent`); nothing is fetched or opened.
- **Autocomplete in the search box** (VS Code-style): type `head` and
  get the matching fields; after `header.` the list includes the header
  names actually present in your folder; accepting a field offers its
  values where they're a fixed set (SPF/DKIM/DMARC results, the attachment
  extensions in your folder, your tags, numeric examples). Tab accepts,
  ↑/↓ choose, Esc closes, Ctrl+Space (or ↓) lists everything — and Enter
  always searches unless you arrowed into the list, so a plain word search
  is never hijacked. Off in Raw search, with Use Regex on, and inside an
  open quote. Built on a pure, unit-tested suggestion function and a test
  that fails if the suggestion list ever drifts from the real query grammar.
- **Search any header by name, and by SPF/DKIM/DMARC result**:
  `header.<name>:` works for every header (`header.received:`,
  `header.x-mailer:`, `header.authentication-results:`, …) — the search
  help panel lists the header names present in the open folder, and an
  unknown name warns instead of silently matching nothing — and
  `auth.spf:` / `auth.dkim:` / `auth.dmarc:` match the recorded result
  exactly (`fail`, `pass`, `softfail`, `none`, or `missing`). A plain
  search also covers all headers.
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
- **Searching for text inside a longer word/address/URL found nothing** —
  reported live: `adobe` (or `header.from:adobe`) didn't find senders like
  `message@adobe.com`, and a plain search didn't reach every part of an
  email. Decoded search matched whole indexed words only, and an address or
  dotted domain is one word. It now matches what you type as plain text
  wherever it appears — subject, sender, recipients, body, links, every
  header and OCR text, including Cyrillic/CJK/accented text the word
  tokenizer can't index — by keeping each email's decoded text (lowercased)
  in the index up to a fixed memory budget. Emails past the budget fall
  back to whole-word matching and the search status line says how many are
  covered; Raw search finds any substring regardless. Quoted phrases now
  require real adjacency.
- **Autocomplete for tag boxes and the rule expression editor**: the
  per-email "+ add tag", the multi-select bar and the rule editor's tag box
  suggest your existing tag names (never one an email already has). The rule
  expression editor suggests `f.` facts (with types), `h.` helpers (with
  signatures), nested members (`f.from.` → `name`/`address`/`domain`,
  string/array methods), bare-word search (`cont` → `h.contains`), and the
  folder's real header names inside `f.getHeader('…')`; Tab accepts and adds
  the `(` for functions, Enter still inserts a newline. A test fails if the
  fact or helper list ever drifts from the real rule engine.
- **Tag names are validated**: lowercase `a-z`, `0-9`, `-` and `_` only,
  1–40 characters, no spaces — checked live in every tag box (capitals are
  lowercased as you type, anything else turns the box red with the reason)
  and again on submit, rule save and import. Tags and rule tags saved by
  earlier versions are converted automatically on first start (`Needs
  Review` → `needs-review`, merging names that collide), and imports convert
  old names the same way and report how many.
- **Tags panel redesigned around one action bar**: the per-row "View
  files" / "⋯" / "Delete tag" buttons are gone. Tick one or more tags and use
  **View files**, **Un-Tag file**, **Tag Deletion** and **Copy / move / delete
  emails…** above the list (one place for these actions — no duplicate
  right-click menu). Works on several tags at once
  (View files / file actions use "any of them", the same rule as the tree
  filter). A multi-tag delete + undo is sequential, because a live test
  showed two tags sharing an email record lose one tag when undone in parallel.
- **A tag's or rule's emails listed in the Search tab no longer go stale**:
  reported — after deleting a tag, Search still said `N email(s) tagged
  "set1"`. That list now follows tag changes (Tag Deletion, Un-Tag file, a
  rule being disabled): it shrinks to what still matches, or empties with
  "No emails carry the tag … any more." A typed search is never altered by
  tag changes.
- **Tag Deletion dialog shows the numbers**: emails carrying the tag (and
  how many are in the open folder) and rules that apply it (and how many are
  enabled), per tag when several are ticked.
- **A rule whose tag was deleted is switched off and blocked**: every rule
  using a deleted tag is disabled automatically (kept, not deleted) and
  cannot be enabled or run until it is edited to use a different tag — the
  store refuses to enable it, the Rules panel disables its switch/Run now and
  explains, and the editor says why. Saving it with the deleted tag name
  is refused (an automatic "-2" suffix can't sneak past the block). Undo lifts
  the block and re-enables the rules that were running.
- **Tag Deletion, redesigned** (and the three actions named plainly: **Tag
  file** / **Un-Tag file** / **Tag Deletion**, so "remove" and "delete" are
  never confused): each tag in the Tags panel shows its email
  count; **Tag Deletion** opens a dialog with the exact count, offers to also
  disable a rule that would re-add the tag, and a toast gives an 8-second
  **Undo** that restores the tag on exactly the emails that had it (and
  re-enables the rule). New **Un-Tag file** button in the multi-select bar
  untags just the selected emails (a rule-applied tag is reported, not
  silently skipped).
- **Decoded search accuracy**: HTML entities (named, numeric, Windows-1252
  quirks) are decoded before indexing; punycode hostnames are also
  searchable by their Unicode name; zero-width/soft-hyphen characters
  inserted to dodge keyword filters are ignored; `header.from:`/`to:`/`cc:`/
  `bcc:`/`replyto:` also match the decoded display name. Raw search now finds
  non-ASCII (UTF-8) text as stored instead of only ASCII.
- **The local server no longer lingers after you close the app**: reported
  as needing a manual `kill` before re-running `run.sh`. The page now sends
  a small same-origin "still open" ping (localhost only), and
  `scripts/serve.py` exits a few seconds after the last tab closes (about
  2.5 minutes if the browser died without saying goodbye). `Ctrl+C`
  still works; `--keep-running` opts out. The "address already in use"
  error now names the PID and the exact command to stop it.
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
