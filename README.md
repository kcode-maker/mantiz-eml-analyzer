# Mantiz-EML-Analyzer

[![License: PolyForm Noncommercial 1.0.0](https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-blue.svg)](LICENSE)
![Dependencies: zero build](https://img.shields.io/badge/dependencies-zero%20build-brightgreen)
![Runs on](https://img.shields.io/badge/runs%20on-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey)
![Requires](https://img.shields.io/badge/requires-Python%203-informational)

## 🚀 [Try it now, right in your browser](https://kcode-maker.github.io/mantiz-eml-analyzer/)

Nothing to install, no clone, no server — click the link, then **Open Folder**
and point it at any folder of `.eml` files. Hosted as a static site on GitHub
Pages, served over HTTPS, which actually unlocks the *full* experience with
zero setup (background Workers for parallel parsing/search, and attachment
SHA-256 hashing — see [Install](#install) below for why that matters).
Opening this link never uploads your `.eml` files anywhere: the page is just
the app's code; the folder you pick is still read straight from your own
disk, in your own browser, same as running it locally.

A local, IDE-style tool for bulk-reviewing `.eml` files — built for security
analysts triaging batches of suspicious/phishing email samples, but useful
for anyone who needs to browse, read, search, tag and rule-match a folder
full of raw emails without importing them into a mail client.

Everything runs **entirely in your own browser tab, locally** — no server-side
component, no account, no telemetry, nothing uploaded anywhere.

**Author:** Kalpesh Mantri — contact: [kmantri.code@gmail.com](mailto:kmantri.code@gmail.com)

**New here?** [HELP.md](HELP.md) is the full how-to-use-every-feature guide.
See [CHANGELOG.md](CHANGELOG.md) for what shipped in each version
(currently **v1.1.0**).

## Contents

- [Quick start](#quick-start-one-command-every-os)
- [Features](#features)
- [Install](#install)
- [Dependencies & tools used](#dependencies--tools-used)
- [Using it](#using-it)
- [Why JavaScript expressions for rules](#why-javascript-expressions-for-rules)
- [Architecture](#architecture)
- [Known limitations](#known-limitations)
- [Security notes](#security-notes)
- [Author & support](#author--support)
- [License](#license)

## Quick start (one command, every OS)

The only requirement is **Python 3** (already on macOS/Linux; a common,
free install on Windows from [python.org](https://www.python.org/downloads/)).
No Node, no npm, no build step, nothing else to install.

```bash
cd mantiz-eml-analyzer        # or wherever you cloned/downloaded this repo
python3 scripts/serve.py      # macOS / Linux
```
```powershell
python scripts\serve.py       # Windows (PowerShell or cmd)
```

That single script — [`scripts/serve.py`](scripts/serve.py) — is the same
file on every platform: it starts the server **in the background**, opens
the app in your browser, and immediately hands your terminal back — it
doesn't sit there occupying the window. Stop it whenever you're done:

```bash
python3 scripts/serve.py --stop      # macOS / Linux
python  scripts\serve.py --stop      # Windows
```

(Prefer a server that blocks in the foreground so you can watch the access
log? `python3 scripts/serve.py --foreground` does that instead — `Ctrl+C`
stops it.)

Prefer a literal double-click instead of typing a command? Use whichever
of these matches your OS — they just call the same script for you and
return the same way (background, terminal handed back immediately):

| OS | Double-click this |
|---|---|
| macOS / Linux | [`scripts/run.sh`](scripts/run.sh) |
| Windows | [`scripts/run.bat`](scripts/run.bat) |

**Want an icon you can move to your actual Desktop**, rather than
double-clicking something inside the cloned repo folder every time? Run
this once (from inside the repo):

```bash
python3 scripts/serve.py --make-launchers    # any OS
```

This generates one launcher per OS into a local `launchers/` folder (not
committed to git — each one has *this exact copy's* folder path baked in,
so it still finds the app after you move it):

| OS | Generated file |
|---|---|
| macOS | `launchers/Mantiz-EML-Analyzer.command` |
| Windows | `launchers/Mantiz-EML-Analyzer.bat` |
| Linux | `launchers/Mantiz-EML-Analyzer.desktop` (keep `Mantiz-EML-Analyzer-linux.sh` alongside it, or edit its `Exec=` path if you move only the `.desktop` file) |

Copy the one for your OS to your Desktop (or anywhere) and double-click it
any time. Unlike the background mode above, **this one runs the server in
its own window in the foreground and opens your browser automatically** —
closing that window (or `Ctrl+C`) stops the server immediately, so nothing
ever keeps running silently in the background after you're done with it.
If you ever move the *app folder itself*, re-run `--make-launchers` to get
a launcher pointing at the new location.

See [Install](#install) below for why a server is recommended over just
opening `index.html` directly, and [Using it](#using-it) for how to actually
use the tool once it's open.

Opening a folder never copies or moves your files, either — the app reads
each `.eml` file in place, lazily, straight from where it already lives on
disk.

**New here?** The first time you open the app with no prior session, a
banner offers **Load sample emails** — twelve synthetic (fully invented, no
real data) messages under [`sample-emails/`](sample-emails/) that walk you
through every detection: brand impersonation, a lookalike domain, a
punycode domain, a BEC wire-fraud lure, auth failures, a risky attachment,
an exact-duplicate pair, a calendar invite, and a pair of senders for
trying OR/grouping search. One click loads them; see
[`sample-emails/README.md`](sample-emails/README.md) for a guided
walkthrough. The banner only appears once by default — tick **Show this
again next time** before dismissing it if you want it back on a later run.

## Features

### Browse and read
- **Open a folder** of `.eml` files, any depth of subfolders, and browse it
  in a virtualized, VS Code-style file tree (smooth even at very large
  folder sizes) — or **Open Files** for a handful of loose `.eml` files,
  or just drag a folder onto the window.
- **Tree toolbar**: Collapse All / Expand All, a Name A→Z / Z→A sort toggle
  (folders always sort before files, either direction), and a file-filter
  mode — **".eml files only"** (default) or **"All files (as email)"** for
  folders where messages were renamed to a bare content hash with no
  extension (still skips obviously-non-email types like `.json`/`.png`/
  `.zip` even in that mode). Real vertical guide lines connect each row to
  its parent folder, like a conventional file explorer. The currently open
  email is highlighted, and opening one from search results or a resumed
  session auto-expands and scrolls to reveal it.
- **Multi-select**: Ctrl/Cmd-click to toggle individual files, Shift-click to
  select a range, then tag every selected email at once from the bar that
  appears — for tagging a batch faster than one at a time.
- **Right-click a file** (or the current multi-selection) for **Delete**,
  **Move to folder…**, or **Copy to folder…** — see
  [Organize and clean up](#organize-and-clean-up) below.
- **Multi-tab viewer**, like a code editor: open several emails at once,
  each tab showing a live state icon (parsing / parsed / failed), a
  paperclip badge when it has attachments, and colored dots for its tags.
- A **breadcrumb path bar** shows the full path of the open email relative
  to the folder root (browsers never expose a picked folder's true OS path
  to a web page — see [Known limitations](#known-limitations) — so this is
  the most precise path any browser-based tool can show).
- **Read emails safely**: subject, headers, and body (text and HTML) render
  properly, with inline (`cid:`) images working — but scripts are always
  stripped and remote content is blocked by default, so opening a phishing
  sample can't call home or execute anything. Toggle remote content on
  per-email when you deliberately want to see it.

### Inspect and analyze
- **Headers tab**: every header in original order with a copy button on
  each, plus `Authentication-Results` and the numbered `Received` chain
  called out separately for quick triage.
- **SPF / DKIM / DMARC badges** shown right in the Preview header, color
  coded pass/fail/none.
- **Metadata panel**: From/Reply-To/Return-Path domains with a mismatch
  badge when they don't agree, the unique recipient count across
  To/Cc/Bcc, each attachment's name/extension/size, the set of unique
  domains referenced by URLs in the body, and any matched **Domain
  categories** (see Settings, below) — the same derived facts a tagging
  rule sees (below), shown human-readable for every email even if you
  never write a rule. Deliberately leaves out anything already plainly
  visible elsewhere (Message-ID, raw header values) rather than repeating it.
  A **WHOIS** button next to the From domain looks up its registration age
  via the free public RDAP service, one click at a time (see
  [Security notes](#security-notes)) — always shows found/not-found/error
  explicitly, never a silent blank.
- **Calendar invite card**: a meeting invite — whether an inline
  `text/calendar` body part (the common Outlook-style case) or a `.ics`
  attachment — is summarized right in the Preview tab (Summary/When/Where/
  Organizer/Attendees/Description, titled "Meeting Invite"/"Meeting
  Cancelled"/"Meeting Response" per its `METHOD`), parsed by a small
  dependency-free RFC 5545 parser (`js/parsing/icsParser.js`). Purely
  presentational extraction of plain-text fields — nothing is opened,
  executed, or fetched, and the attachment (if any) is still also offered
  as a normal download, same as before.
- **Signals**: an always-on, local-only urgency-language score (a scored
  keyword match — "urgent", "wire transfer", "gift card", "kindly", "asap",
  etc. — not a grammar/linguistic judgment call) and financial-indicator
  detection (IBAN, a labeled SWIFT/BIC code or bank routing number, a BTC/
  ETH wallet address, a gift-card-brand request) shown as badges right in
  the Preview header for every email automatically — no button, no
  network call, computed the moment the email is opened. Unlike WHOIS/Scan
  URL, these never need an explicit click since they never leave the
  browser.
- **Sender-spoofing checks**: display-name brand impersonation ("PayPal
  Support" from a domain that isn't PayPal's, or isn't a real subdomain of
  it), sender-domain lookalike/typosquat detection (edit-distance against
  a built-in brand list plus your own **Settings**-configured trusted
  domains — which also accepts a `/regex/` entry for full control, e.g.
  `/\.corp\.mycompany\.com$/`), and IDN/punycode-encoded sender domains —
  all exposed as facts (`f.nameMismatch`, `f.lookalikeDomain`,
  `f.punycodeSender`) and as ready-made rule templates.
- **Links panel**: every URL found in the body, with a warning when the
  displayed link text doesn't match where it actually points (a classic
  phishing tell — catches a domain embedded in a sentence like "Click here:
  paypal.com", not just anchor text that's nothing but a bare URL) — hover
  any link in the rendered body for a tooltip showing its real destination
  without ever needing to click it. A **Scan URL** button next to each link
  (and each blocked resource) opens VirusTotal's URL analysis for it in a
  new tab — the URL string is sent to that trusted third party, nothing is
  ever fetched directly by this app (see [Security notes](#security-notes)
  for why resolving redirects client-side would be unsafe).
- **Blocked remote resources panel**: whenever a remote image/resource is
  blocked, see exactly what URL was blocked (and hover the placeholder in
  the body for the same info) — inspect a tracking/exfil URL without ever
  loading it.
- **text-body / html-body tabs**: `text-body` is the visible text of the
  email — the decoded `text/plain` part verbatim, or (when there isn't
  one) text extracted from the HTML part instead, clearly labeled as such.
  `html-body` is the raw decoded HTML source itself, unrendered. Both are
  line-numbered and distinct from the sanitized, rendered **Preview** —
  useful for spotting things a safe render hides on purpose (hidden
  elements, tracking pixels, obfuscated markup) or where a
  multipart/alternative message's plain and HTML parts tell different
  stories. `html-body` is always inert escaped text, never rendered.
- **Attachments tab**: download any attachment (saves to your normal
  Downloads folder), see its SHA-256, and get a safe inline preview for
  images and plain text. HTML/script attachments are shown as inert,
  escaped source text only — never rendered live. A **VirusTotal** button
  opens a hash lookup (`virustotal.com/gui/file/<sha256>`) in a new tab —
  only the hash is looked up, the file itself is never uploaded anywhere.
- **Raw tab**: the exact original bytes of the `.eml` file, line-numbered,
  with one-click copy or re-download of the untouched original.
- Copy buttons throughout — subject, any header value, any link URL, the
  body text, the full raw source — so pulling something into a ticket or
  report never means retyping it.

### Search
- **Search across the whole open folder** like VS Code's "Search across
  files" (`Ctrl`/`Cmd`+`Shift`+`F`):
  - **Decoded search** (default): a small query grammar —
    `field:value` for `from:`, `to:`, `subject:`, `url:`, `attachment:`
    (matches attachment filenames), `meta:`/`header:` (matches across all
    header values), `tag:`; `"exact phrases"`; `-exclude` terms (works on
    any field, e.g. `-tag:reviewed`); bare words ANDed together — running
    over an inverted index built incrementally across a worker pool.
    **OR and parenthesized grouping**: OR (the literal all-caps word only —
    lowercase `or` is just an ordinary search word) binds looser than the
    implicit AND, and `(...)` groups a sub-expression, including negating a
    whole group: `(from:paypal OR from:ebay) attachments:>0`,
    `-(from:paypal OR from:ebay)`.
    **Numeric fields** support comparison operators glued directly onto
    the value: `attachments:>3`, `attachments:3` (exact), `size:<2mb`
    (accepts b/kb/mb/gb), `urls:>=10`, `recipients:>20`, and
    `duplicates:>1` — how many indexed files share this one's Message-ID/
    content id, for finding every file that's part of a repeated/bulk-sent
    batch — and `urgency:>=3` for the always-on urgency-language score
    (see Signals, above). **Regex**: `field:/pattern/i` runs a real regular expression
    instead of substring matching, on `subject:`/`from:`/`to:`/
    `attachment:` (e.g. `attachment:/\.(exe|scr)$/i`) — those are the
    fields whose full text is retained per file, not just its tokens; use
    Raw search below for regex over anything else. A full reference is one
    click away via the **?** button next to the search box. A term or
    value that can't be resolved (too short to tokenize, an unparseable
    comparison, or an invalid regex) deliberately matches *nothing* rather
    than silently matching the whole folder, with a note explaining why —
    important for a tool where "I searched and found nothing" needs to be
    trustworthy.
  - **`Aa` / `.*` toggle buttons** below the Search button (VS Code-style,
    shared with Raw search below) — **Match Case** verifies exact case for
    quoted phrases and any term, and **Use Regex** treats the whole search
    box as one pattern, ignoring `field:`/phrase/`tag:` syntax. Both are
    scoped to subject/from/to/attachment (the fields with retained raw
    text, same as `field:/pattern/` above) — a status-line note says so
    whenever either is on, and an invalid pattern matches nothing rather
    than crashing or matching everything.
  - **Raw search**: greps the untouched original bytes of every file
    instead, using the same `Aa`/`.*` toggles — the fast, always-available
    path that skips MIME decoding entirely, so nothing hidden by encoding
    is ever missed, and (unlike Decoded search) covers the full raw body.

### Tag and automate — the rules engine
- **Manual tagging**: add freeform tags to any email from its Preview tab
  (or to a whole multi-selection at once from the Explorer tree); filter
  the tree to just tagged emails from the **Tags** sidebar view;
  **Export tags** / **Import tags** as JSON to back up or share your
  triage work. Tags carry provenance internally (manually-typed vs.
  rule-applied) — an identically-named manual tag and rule tag on the same
  email stay independent, so disabling the rule never strips the one you
  typed by hand.
- **Save to folder** (Chrome/Edge, folder opened with write access): writes
  every tag/note as a `mantiz-tags.json` sidecar file at the workspace
  root — a portable alternative to Export/Import that travels with the
  folder itself. Opening that folder again later (this browser or another
  machine entirely) detects the sidecar and offers a one-click **Load** —
  never automatic, and never overwrites what you already have without you
  clicking Load. The sidecar file is fully hidden from the tree/index/
  search/rules, same treatment as the `.deleted` folder.
- **Tagging rules** (**Rules** sidebar view): write a rule once and every
  matching email — now and every time you re-run it — gets tagged
  automatically. For example, a **Sender Anomaly** rule:
  ```js
  f.from && f.replyTo && f.from.domain !== f.replyTo.domain
  ```
  tags every email whose `From` domain doesn't match its `Reply-To` domain.
  Rules run as real JavaScript boolean expressions — see
  [Why JavaScript expressions](#why-javascript-expressions-for-rules) for
  why that's the right fit here, and the in-app "fields & helpers
  reference" (in the rule editor) for the full list of what's available:
  sender/recipient/reply-to/return-path addresses and domains, SPF/DKIM/
  DMARC results, subject, body text, extracted URLs and their domains,
  attachments (count, filename, extension, size), any raw header — plus
  ergonomic match helpers so you never have to hand-write regex syntax:
  `h.equals` / `h.contains` / `h.startsWith` / `h.endsWith` (all
  case-insensitive by default) for exact/substring/prefix/suffix matching
  on subject, sender name, domain, header values or anything else, and
  `h.matches(value, pattern)` for a real regex when you need one. Plus
  `h.looksLikeDomain(a, b)` for typosquat detection,
  `h.domainsAlign(a, b)` for DMARC-style organizational-domain alignment
  (subdomain-aware — not a full Public Suffix List, just a small built-in
  list of common two-label suffixes like `co.uk`/`com.au`, plus the simple
  last-two-labels heuristic otherwise), and
  `h.attachmentExtIn(f.attachments, ['.exe', '.scr'])` /
  `h.anyAttachment(...)` / `h.countAttachments(...)` for attachment checks,
  plus `h.hasDualExtension`, `h.hasHiddenUnicode`, and `h.shannonEntropy` /
  `h.looksRandom` for well-known evasion techniques (double extensions,
  zero-width Unicode characters, randomly-generated tokens) — these three
  and the templates that use them were adapted from the general concepts in
  the author's own prior detection-engine work, reimplemented from scratch
  against this app's own facts object rather than copied, since that
  engine's actual rule content depends on binary attachment parsing this
  app deliberately doesn't do. Also available: `f.nameMismatch` /
  `f.lookalikeDomain` / `f.punycodeSender` (the same sender-spoofing checks
  described below, as facts a rule can combine with anything else) and
  `f.urgencyScore` / `f.financialIndicators` (the always-on Signals below).
  - **Twenty-seven starter templates** ship in the rule editor: sender/reply-to
    mismatch, sender/return-path mismatch, subdomain-aware ("organizational
    domain") variants of both — same idea as DMARC's relaxed alignment, so
    `mail.example.com` and `support.example.com` don't false-positive
    against each other, only a genuinely different domain does — DMARC
    fail, SPF-or-DKIM fail, look-alike-brand-domain, urgency language in the subject,
    executable-looking attachments, many-attachments, a suspicious
    mail-client-header regex, a nested `.eml` attachment flag, a
    possible-PII-in-body check (public credit-card/SSN/Aadhaar-shaped
    patterns), a double-extension attachment check (`invoice.pdf.exe`),
    hidden/invisible Unicode characters in the subject, a
    random-looking-token-in-subject check (Shannon entropy), display-name
    brand impersonation, sender-domain-looks-like-a-typosquat, IDN/punycode
    sender domain, high urgency-language score, a financial/wire-transfer
    indicator present, a combined urgency+financial-indicator check (a
    stronger BEC signal than either alone), and four mutually-exclusive
    recipient-count tiers (25-75, 75-200, 200-500, 500+) over the unique
    To/Cc/Bcc recipient count, for spotting mass-sent/spray campaigns, and a
    domain-category check against your Settings-configured category list —
    pick one as a starting point and edit it.
  - **Test before you save**: the editor's "Test against loaded emails"
    button runs the expression against everything currently open (no
    tagging side effects) and reports *"Matched 300 of 1,000 loaded
    emails"* plus a few example matches, so you can tighten a rule before
    committing to it.
  - **Every run reports its match count** the same way — "Run now" and
    "Run all" show live progress while scanning and a final matched/total
    count on the rule card, so you can edit and re-run to dial a rule in.
  - **Disabling a rule is instant and exact**: the app tracks precisely
    which emails each rule tagged, so turning a rule off removes its tag
    from exactly those emails immediately — no folder re-scan needed.
    Editing an enabled rule's expression and re-running converges tags the
    same way: newly-matching emails get tagged, emails that no longer
    match get untagged. Renaming a rule's tag swaps it cleanly on every
    email that rule had tagged.
  - Rules auto-run against a newly opened folder right after indexing
    finishes, so tags are ready without an extra click. Both indexing and
    a rule run show a **Stop** button while in progress — stopping a rule
    run leaves every tag exactly as it was (a partial scan is never used
    to untag emails it simply hasn't reached yet).
  - **Export rules** / **Import rules** as JSON, matching tag export/
    import — back up your rule library or move it to another machine.
    Import skips (rather than overwrites) any incoming rule whose tag
    already matches an existing one, and never auto-runs an imported rule.

### Organize and clean up
- **IOC export**: a small link under the search box downloads one CSV
  (`type,value,email_count`) covering every currently-indexed email's
  sender domains, URL/link domains, attachment extensions, financial
  indicator types, and a sender-domain-anomaly count (name-mismatch/
  lookalike/punycode) — the aggregate artifact for a blocklist or incident
  report, without reading it off one email at a time.
- **Case-report export**: a button in the Tags panel generates a
  shareable Markdown report of every tagged email, grouped by tag, with
  subject/from/date/path — for handing off triage results instead of
  re-typing them.
- **Parse-errors panel**: if any file failed to parse (or was too large to
  index), a collapsible "⚠ N file(s) failed to parse" panel under the tree
  filter lists which ones and why — the file that fails to parse might be
  the most interesting one, not just noise to discard.
- **Delete / Move / Copy** (Chrome/Edge, folder opened via **Open Folder**
  with write access granted): right-click a file, a multi-selection, a tag
  in the Tags panel, or a rule card in the Rules panel — each resolves the
  right set of emails and opens the same menu.
  - **Delete** moves the file(s) into a `.deleted` folder at the root of
    the open folder rather than truly removing them — reversible, and that
    folder (and its contents) is completely hidden from the tree, search,
    and rules from then on, as if it doesn't exist to the tool.
  - **Move** / **Copy** open a small dialog to pick an existing subfolder
    or name a new one (always created under the already-open root, so no
    second permission prompt); copying auto-renames on a name collision
    rather than ever overwriting a file.
  - The browser will ask for write permission the *first* time you use
    any of these in a session — a normal read-only session never sees that
    prompt. This is unavailable in Firefox/Safari and when a folder was
    opened via the fallback picker or drag-and-drop: those only ever hand
    over inert file snapshots with no way to write back to disk, so the
    menu items show disabled with a tooltip instead of failing silently.

### Settings
The gear icon at the top-right of the toolbar opens Settings as a full-width
page in the right pane (like an IDE's Settings editor tab), not a cramped
sidebar panel:
- **Trusted domains**: the list used by the sender-spoofing checks above,
  pre-filled with a small built-in brand list. Add your own organization's
  domain(s) so impersonation of *your* company is caught too, not just
  public brands — paste a whole list at once (comma/space/newline
  separated; duplicates are silently merged, never shown twice), or add a
  `/regex/flags` entry for full control over what counts as "yours" (e.g.
  `/\.corp\.mycompany\.com$/` to trust a whole internal subdomain family).
  A plain domain entry also covers its real subdomains automatically
  (adding `mycompany.com` trusts `mail.mycompany.com` too).
- **Domain categories**: "what type of domain is this?" — a small starter
  set (CDN/hosting, file sharing, URL shorteners, payment processors,
  social media, code repos/paste sites, email-security link-rewrite
  services, communication platforms, suspicious/free TLDs), checked
  against the sender/reply-to/return-path domains, every URL domain in the
  body, and domain-like text found in headers and attachment filenames.
  Add your own keywords to any category, or create entirely new ones — a
  keyword starting with `.` matches as a TLD/suffix (e.g. `.xyz`), anything
  else matches as a plain substring. Matched categories show up in the
  Metadata panel, in the IOC export, and as a rule fact
  (`f.domainCategories`) with a ready-made "Domain matches a flagged
  category" template. Like trusted domains, everything you add here stays
  in this browser's local storage only — never written into the app's own
  source.
- No configuration is needed for WHOIS (always the free public RDAP
  service) or for the always-on Signals — both work with zero setup.

### Persistence
- **Resume where you left off**: your open tabs are remembered; in
  Chrome/Edge the folder handle itself is remembered too, for a genuine
  one-click resume after re-granting permission.

## Install

There is nothing to install in the traditional sense — this is a
zero-build, dependency-light static web app (one vendored library,
[DOMPurify](vendor/VENDOR.md); everything else, including the rules engine,
is hand-written with no further dependencies). The
[Quick start](#quick-start-one-command-every-os) above is the whole
install; this section just explains the two ways to run it and why one is
recommended.

### Why a local server is recommended

`scripts/serve.py` starts a plain local static server on
`http://localhost:8765` (or the next free port) serving nothing but the
files in this folder, to your own machine only, then opens your browser to
it. Running over `http://localhost` instead of a plain `file://` page
unlocks Web Workers (parallel background parsing/search/rule-evaluation
across all your CPU cores) and `crypto.subtle` (attachment SHA-256
hashing) — both are disabled by Chromium-based browsers on `file://`
pages. This matters most on large folders — see
[Known limitations](#known-limitations).

### Run it (no server, just open the file)

You can also just double-click `index.html` / open it directly in your
browser. Everything still works — folder picking, parsing, search,
tagging, rules — just single-threaded and without attachment hashing. Fine
for casual use or small folders; use the server method above for large
batches.

### Browser support

| Feature | Chrome / Edge | Firefox | Safari |
|---|---|---|---|
| Open a folder | ✅ native picker + remembers it | ✅ classic picker | ✅ classic picker |
| Resume last session (one click) | ✅ | re-pick the folder to relink | re-pick the folder to relink |
| Background workers / hashing | ✅ (over http://) | ✅ (over http://) | ✅ (over http://) |
| Delete / Move / Copy | ✅ (with write permission granted) | ❌ | ❌ |
| Everything else, incl. rules | ✅ | ✅ | ✅ |

## Dependencies & tools used

### Third-party library (vendored, checked into the repo)

| Library | Version | License | Used for |
|---|---|---|---|
| [DOMPurify](https://github.com/cure53/DOMPurify) | 3.1.6 | Apache-2.0 OR MIT | Sanitizing attacker-controlled HTML email bodies before they're rendered — see [`vendor/VENDOR.md`](vendor/VENDOR.md) for the exact file, source URL, and SHA-256 to verify it hasn't been tampered with. |

That's the **only** third-party library this app uses. Everything else — the
MIME/RFC 5322 parser, the search index, the rules engine, the UI — is
hand-written specifically for this app with no further dependencies (see
[Architecture](#architecture)).

### Browser platform APIs relied on

| API | Used for |
|---|---|
| Web Workers | Parallel background parsing/indexing/search/rule evaluation, one worker per CPU core (falls back to a yielding main-thread loop when unavailable, e.g. plain `file://`) |
| IndexedDB | Storing tags, notes, rule definitions, and session/resume state locally in your browser |
| File System Access API (`showDirectoryPicker`) | One-click folder open and genuine one-click resume, in Chrome/Edge |
| `<input type="file" webkitdirectory>` | Folder-open fallback in Firefox/Safari, or wherever File System Access isn't available |
| `crypto.subtle` (SubtleCrypto) | SHA-256 hashing of attachments, shown in the Attachments tab and used for the VirusTotal lookup button |
| Blob / File / `URL.createObjectURL` | Rendering inline (`cid:`) images, offering attachment downloads, and building the sandboxed preview `<iframe>`'s content — all without a server |
| `fetch` / `AbortController` | The WHOIS button's single, explicit, per-click RDAP request (8s timeout) — the only outbound network call this app's own code ever makes |

### Tooling to run it

| Tool | Required? | Purpose |
|---|---|---|
| A modern browser (Chrome, Edge, Firefox, or Safari) | Required | Runs the entire app — see [Browser support](#browser-support) above |
| Python 3 | Optional, recommended | Powers [`scripts/serve.py`](scripts/serve.py), a plain local static file server — needed to unlock Web Workers and `crypto.subtle` (browsers disable both on plain `file://` pages). The app itself contains no Python code and doesn't need Python if you just open `index.html` directly. |

No npm, no bundler, no build step, and no other dependency of any kind.

## Using it

1. **Open Folder** (top left) — picks a directory of `.eml` files. Drag-and-
   drop a folder onto the window works too, as does **Open Files** for a
   handful of loose `.eml` files without a containing folder.
2. Browse the tree on the left; click any `.eml` file to open it in a tab.
   Multiple emails can be open at once, like editor tabs (`Alt`+`←`/`→` to
   switch, `Alt`+`W` to close the active one — `Ctrl`/`Cmd`+`W` is reserved
   by every browser for closing the actual browser tab, so it can't be
   reused here; the × on the tab always works too).
3. Each open email has six views — **Preview**, **Headers**, **text-body**,
   **html-body**, **Attachments**, **Raw** — see [Features](#features)
   above for what each shows.
4. **Search** (`Ctrl`/`Cmd`+`Shift`+`F`) searches every email in the open
   folder, in decoded or raw mode (toggle next to the search box).
5. **Tag** an email from its Preview tab, or set up a **Rule** (Rules
   sidebar view → **+ New Rule**) to tag matching emails automatically —
   see [Features](#features) for the full rules walkthrough. Filter the
   tree to tagged emails from the **Tags** sidebar view; use **Export
   tags** / **Import tags** in the toolbar to back up or share your work
   (this exports both manual tags and rule-applied tags together).
6. **Right-click** a file, a multi-selection (Ctrl/Cmd- or Shift-click to
   build one), a tag, or a rule for **Delete** / **Move to folder…** /
   **Copy to folder…** — see [Organize and clean up](#organize-and-clean-up)
   for what each does and the Chrome/Edge-only permission it needs.

For a complete, task-by-task walkthrough of every feature, see
[HELP.md](HELP.md).

## Why JavaScript expressions for rules

The rule editor asks you to write a **boolean JavaScript expression** —
e.g. `f.from && f.replyTo && f.from.domain !== f.replyTo.domain` — rather
than a custom mini-language. That was a deliberate choice, not the default:

- **It's the simplest option that's still fully expressive.** A custom DSL
  would need its own grammar for comparisons, boolean logic, string/regex
  matching, and field access — and would still fall short of real
  expressions the moment you wanted something the grammar didn't
  anticipate. Plain JS already has all of that, precisely, with zero new
  syntax for a technical analyst to learn.
- **The trust model fits.** Rules are config *you* write for *your own*
  browser tab — never attacker-controlled content flowing through the app
  (that's the email body, which is always sandboxed separately and never
  executed). Running a rule as real JS is no more of a security boundary
  crossing than writing a bookmarklet or a personal userscript; there's no
  other user or server it could affect.
- **It scales with the task.** The same mechanism that runs
  `f.dmarc === 'fail'` also runs a Levenshtein-distance typosquat check
  against a brand list, or a regex over attachment filenames, with no
  engineering needed on this app's side to "add support" for it — see the
  starter templates for examples of both.
- Rule expressions run inside the same Worker pool used for indexing (one
  per CPU core, with a main-thread fallback), so a slow or even
  infinite-looping rule can't freeze the UI.

## Architecture

No build step, no bundler, no npm dependency to *run* the app — everything
under `js/` is a classic (non-module) script attached to a small `window.EV`
namespace, loaded in order by `index.html`. This was a deliberate choice:
it keeps the app OS-independent and installation-free (this exact machine
this app was written on doesn't even have Node installed), and it means
there is nothing in the toolchain that can go out of date or fail to build.

`js/` is grouped into five feature folders — `core/` (storage/config),
`parsing/` (turning raw bytes into a safe structured email), `indexing/`
(search + the Worker pool), `rules/` (the tagging-rules engine), and `ui/`
(everything that touches the DOM) — rather than one flat directory, so it's
clear at a glance which layer a given file belongs to.

| File | Responsibility |
|---|---|
| `js/parsing/emlParser.js` | Hand-written RFC 5322 / 2045 / 2046 / 2047 parser: headers, MIME multipart tree, base64/quoted-printable decoding, charsets, encoded-word subjects/names, address lists, stable per-email id. Zero dependencies. |
| `js/parsing/sanitize.js` | Turns a raw HTML body into a safe document: DOMPurify → resource URL rewriting (blocks remote content, resolves `cid:` to local blob URLs, flags link text/destination mismatches) → CSP-wrapped shell, for a sandboxed `<iframe>`. |
| `js/parsing/urlExtract.js` | URL extraction, HTML→text fallback, the shared tokenizer used by both the search index and query parser. |
| `js/indexing/indexLogic.js` | The actual per-file work for indexing, raw search, *and* rule evaluation (facts-object construction + the compiled-rule cache) — runs identically inside a Worker or (fallback) the main thread. Also owns the sender-spoofing helpers (`isPunycodeDomain`, `displayNameBrandMismatch`, `isDomainTrusted`) and the always-on urgency/financial-indicator scanners, computed once per file alongside everything else — no second pass. |
| `js/indexing/worker.js` | Thin Web Worker entry point around `indexLogic.js`. |
| `js/indexing/workerClient.js` | A pool of Workers (one per CPU core) with a synchronous, yielding fallback; streams a huge file list through the pool with bounded concurrency so memory never holds more than a small window of files at once. |
| `js/indexing/searchIndex.js` | Main-thread decoded search: structure-of-arrays metadata + an inverted index built incrementally from worker results, plus the query grammar/ranking. |
| `js/indexing/rawSearch.js` | Orchestrates a parallel, cancelable, streaming raw-byte grep across the open folder. |
| `js/rules/rulesStore.js` | IndexedDB CRUD for rule definitions plus the per-rule "current match set" that makes disabling/renaming exact and instant. |
| `js/rules/rulesEngine.js` | Runs enabled rules across the pool, diffs new vs. previous match sets, applies exactly the tag add/remove operations needed; the dry-run "Test" path. Threads the user's trusted-domains list into every run. |
| `js/rules/ruleTemplates.js` | The 27 starter rule templates (`EV.RULE_TEMPLATES`) — a DOM-free module so `tests/ruleTemplates.test.js` can compile-check every one under `jsc`. |
| `js/ui/app.js` | Bootstraps the page: wires the toolbar, tree, tabs, search panel, rule modal, Settings page, and the sample-emails demo banner together. The only file that reaches into `index.html`'s DOM structure directly. |
| `js/ui/fileTree.js` | Folder ingestion — File System Access API, `<input webkitdirectory>`, and drag-and-drop, unified into one tree model — plus the Delete/Move/Copy write-side logic. |
| `js/ui/virtualList.js` | Minimal virtualized list so the tree and search results stay smooth at any folder size. |
| `js/ui/tabs.js` / `js/ui/render.js` | Multi-tab email viewer (with live tab icons/badges) and its sub-views, including the Signals badges and WHOIS buttons. |
| `js/ui/icons.js` | A small dependency-free inline-SVG icon set used throughout the toolbar/tree/tabs/context menus. |
| `js/core/tags.js` / `js/core/db.js` | IndexedDB-backed tags/notes, keyed by `Message-ID` (content-hash fallback), with JSON export/import. |
| `js/core/settings.js` | The user-editable trusted-domains list (used by the spoof-detection helpers) and the sample-emails demo banner's dismissed/always-show state, both IndexedDB-backed. |
| `js/core/whois.js` | The WHOIS/RDAP domain-age lookup — the app's one genuine outbound `fetch()`, gated behind an explicit per-domain click. |
| `js/core/session.js` | Persists what was open so the app can offer to resume it. |

`tests/*.test.js` are real, checked-in regression tests (parser fixes,
tag-provenance, the Delete/Move/Copy filesystem logic against a hand-built
mock of the File System Access API, the sender-spoofing helpers and the
always-on urgency/financial-indicator signals, every one of the 27 starter
rule templates compile-checked against a synthetic facts object, the
Settings store, the WHOIS response-normalization logic, the calendar-
invite iCalendar parser, and the decoded-search query grammar including
OR/parenthesized grouping) — no Node/npm involved, they run under the
same JavaScriptCore (`jsc`) used for manual syntax checking.
`bash tests/run-all.sh` runs the whole suite (284 assertions across 9
files) plus a syntax check of every `js/**/*.js` file; CI
(`.github/workflows/ci.yml`) runs the same script on every push/PR.

### Why it's built this way (a few notes for anyone extending it)

- **Security posture**: the message body always renders inside
  `<iframe sandbox="allow-same-origin">` — deliberately *without*
  `allow-scripts`, so no script can ever execute regardless of what a
  malicious email contains. `allow-same-origin` alone is what's needed for
  inline `cid:` images (which are `blob:` URLs, origin-scoped) to load; it
  grants no script-execution capability on its own. HTML is sanitized with
  DOMPurify *and* has every remote resource reference stripped unless the
  user explicitly opts in per-email. This is the same pattern major webmail
  clients use for exactly this reason. Rules are the one place this app
  *does* run real code — see
  [Why JavaScript expressions](#why-javascript-expressions-for-rules) for
  why that's a different, and appropriate, trust boundary.
- **Scale**: browsing the tree and opening any single email is instant
  regardless of folder size — files are read lazily via `File`/
  `FileSystemFileHandle` objects, never all loaded into memory. Full-folder
  *decoded* search indexing (and rule evaluation, which reuses the same
  pool-driven sweep) is inherently bound by disk-read + MIME-decode
  throughput (real work, parallelized across a worker pool, one per CPU
  core) — it's incremental and searchable while still running, with a live
  progress indicator, but isn't claimed to be instantaneous on very large
  folders. *Raw* search is the fast, always-available path since it skips
  MIME decoding entirely.
- **No dependency for parsing**: the MIME parser is hand-written rather than
  a library, both to avoid needing a bundler for a no-build app and to keep
  the highest-volume code path fully auditable. It's been run against ~785
  real-world sample emails (a mix of legitimate and phishing) plus real
  DocuSign- and Microsoft-themed phishing samples and targeted synthetic
  fixtures covering multipart nesting, inline images, RFC 2047 encoded
  subjects, and SPF/DKIM/DMARC header parsing, with zero parse failures.
- **Rule match tracking**: `js/rules/rulesStore.js` records exactly which emails
  each rule currently matches (not just the rule definition), which is what
  makes disabling a rule an instant, exact retraction instead of a
  re-scan-and-guess. It's also what makes tag-renaming safe: renaming a
  rule's tag swaps it directly on every recorded match rather than leaving
  the old tag text stranded.

## Known limitations

- **`.eml` only** — not Outlook's proprietary `.msg` binary format.
- **No absolute file paths**: browsers never expose a picked folder's real
  OS path to a web page, by design (a privacy boundary, not something this
  app can work around). The tree shows the folder's own name as its root
  and the full path *relative to that root* everywhere (tree, breadcrumb,
  status bar) — that's the most any browser-based tool can show.
- **Tags (manual and rule-applied) live in that browser's IndexedDB** by
  default, not written back into the individual `.eml` files. Switching
  machines/browsers loses them unless you use Export/Import, or — when the
  folder was opened via **Open Folder** with write access granted — the
  Tags panel's **Save to folder** button, which writes a `mantiz-tags.json`
  sidecar at the workspace root (an explicit click, never automatic).
  Opening that same folder later, even in a different browser/machine,
  detects the sidecar and offers to load it back in.
- **Search grammar** (`field:value`, `"phrase"`, `-exclude`, bare AND
  terms, regex on four fields, plus `OR`/`(...)` grouping) has no way to
  express arbitrary boolean nesting beyond AND/OR/NOT (e.g. no XOR, no
  operator precedence override beyond parentheses). Body/meta phrase
  queries are "all these words present", not strict word-adjacency
  (subject/from/to phrase queries *are* verified exactly, since those
  fields are cheap to keep in full) — this is a deliberate, permanent
  tradeoff for memory-bounded search at 500K files, not a gap being
  tracked for a fix. Rules don't have this limitation at all since they're
  full JS expressions.
- **Delete/Move/Copy require Chrome or Edge**, a folder opened via **Open
  Folder** (not the fallback picker or drag-and-drop), and write
  permission granted when prompted — see
  [Organize and clean up](#organize-and-clean-up). Everything else in the
  app works identically across Chrome, Edge, Firefox, and Safari.
- **S/MIME signature verification** is out of scope for v1 (calendar/ICS
  rendering, previously listed here too, now ships — see Features above).
- Opened via plain `file://` (no local server): Web Workers and
  `crypto.subtle` are unavailable in Chromium-based browsers, so parsing/
  search/rules run single-threaded and attachment hashes aren't shown. Use
  `scripts/serve.py` (or `run.sh` / `run.bat`) for the full experience,
  especially on large folders.

## Security notes

This tool is built to be *safe to point at hostile input* — that's the
whole point of a phishing-analysis tool. Specifically:

- No script from an opened email ever executes (sandboxed iframe with no
  `allow-scripts`, ever). This applies uniformly regardless of how the
  message was opened — tree click, search result, or rule match.
- No network request happens as a side effect of opening or browsing an
  email — remote images/CSS are blocked by default and only fetched if you
  explicitly click "Load remote images/content" for that one message.
- Attachments are never auto-opened or rendered live. HTML/script
  attachments are shown as inert, escaped source text only. The only way to
  act on an attachment is an explicit Download click, same as any browser
  file download.
- Links are never auto-navigable from inside a rendered body (no
  `allow-popups`/`allow-top-navigation` on the sandbox) — inspect a link's
  real destination via its tooltip or the Links panel instead of clicking
  it.
- **Rules are the one deliberate exception to "nothing here executes
  code"**: a rule expression runs as real JavaScript, by design — see
  [Why JavaScript expressions](#why-javascript-expressions-for-rules). This
  is safe specifically because rules are config you author yourself for
  your own browser tab, never content extracted from an email. Don't paste
  a rule expression from a source you don't trust any more than you'd run
  an unfamiliar shell command.
- Nothing is sent anywhere: there is no backend, no analytics, no telemetry.
  The only network activity this app ever initiates on its own is loading
  its own local files, plus two deliberate, explicit exceptions, both
  gated behind an actual click on a specific email/domain, never automatic
  or bulk across a folder:
  - **Scan URL** — sends only the URL string (never the file it came
    from) to VirusTotal in a new tab; nothing is ever fetched by this app
    itself. Resolving a redirect chain client-side was deliberately *not*
    built — it would mean this app's own network directly contacts
    whatever the link points to, which could reveal to the sender that the
    message is being investigated, and is exactly the kind of direct
    contact a phishing-triage tool should avoid.
  - **WHOIS** (domain-age lookup) — this one genuinely does fetch, from
    this app's own code: a single request to the free public RDAP service
    with only the domain string, on explicit per-domain click. Always
    resolves to an explicit found/not-found/error state, never a silent
    blank, and times out after 8 seconds rather than hanging.
- File writes (Delete/Move/Copy) only ever happen as the direct, explicit
  result of you right-clicking and choosing an action — never automatically,
  never as a side effect of opening or browsing an email. Delete moves
  files rather than removing them, specifically so a slip is recoverable.

If you find a way to break out of these boundaries, please treat it as a
real security bug — that would defeat the purpose of the tool.

## Author & support

Built and maintained by **Kalpesh Mantri**.

- For updates, questions, or anything not suited to a public bug report,
  contact [kmantri.code@gmail.com](mailto:kmantri.code@gmail.com).
- To report a bug, please open a GitHub issue on this project's repository.

## License

[PolyForm Noncommercial 1.0.0](LICENSE) — free for any noncommercial
purpose (personal use, research, education, hobby projects, evaluation),
with full source access and the right to modify it. **Commercial use is not
included in this license** — that covers using it, or any modified/derivative
version of it, as part of a commercial product, service, or paid engagement
of any kind. If you want to use this commercially, contact
[kmantri.code@gmail.com](mailto:kmantri.code@gmail.com) to arrange a
commercial license.

All copies and derivative works must keep the copyright notice in
[LICENSE](LICENSE) intact — see that file's "Notices" section. The author
retains full copyright and reserves the right to relicense future versions
of this project under different terms (including a fully proprietary one)
at their sole discretion; doing so doesn't change the license already
granted for versions already released.
