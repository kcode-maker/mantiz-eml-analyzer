# Mantiz-EML-Analyzer — Help & User Guide

A complete, task-by-task guide to every feature. For a quick start and a
high-level overview, see [README.md](README.md); for internals and design
rationale, see [ARCHITECTURE.md](ARCHITECTURE.md). For what changed in
each version, see [CHANGELOG.md](CHANGELOG.md).

## Contents

- [Getting started](#getting-started)
- [The Explorer (file tree)](#the-explorer-file-tree)
- [Reading an email](#reading-an-email)
- [Search](#search)
- [Tags](#tags)
- [Rules](#rules)
- [Delete, Move, and Copy](#delete-move-and-copy)
- [Settings](#settings)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Resuming a session](#resuming-a-session)
- [Trying it with sample emails](#trying-it-with-sample-emails)
- [Troubleshooting](#troubleshooting)

## Getting started

1. Start the app. The recommended way, any OS:
   ```bash
   python3 scripts/serve.py
   ```
   This opens the app in your browser and keeps running in that terminal
   window until you close it or press `Ctrl+C`. It always uses port 8765
   (pass a different one, e.g. `python3 scripts/serve.py 9000`, if that's
   ever taken) — to change the default permanently instead, create a
   `.mantiz-config.json` file next to `index.html`: `{ "port": 9000 }`
   (gitignored — your own local preference).

   A couple of alternatives, if a typed command isn't what you want:
   - **Double-click instead of typing**: `scripts/run.sh` (macOS/Linux) or
     `scripts/run.bat` (Windows) call the same script for you — but must
     stay inside this cloned folder to work.
   - **A launcher icon for your actual Desktop**: run
     `python3 scripts/serve.py --make-launchers` once. This generates one
     file per OS into a local `launchers/` folder (not committed to git),
     each with this exact copy's path baked in. Copy the one for your OS
     to your Desktop and double-click it any time — closing its window
     (or `Ctrl+C`) stops the server immediately, same as the plain script.
     Re-run `--make-launchers` if you move the app folder itself.
   - **No server at all**: just double-click `index.html`. Everything
     still works — folder picking, parsing, search, tagging, rules — just
     single-threaded and without attachment hashing (see
     [ARCHITECTURE.md](ARCHITECTURE.md#known-limitations)). Fine for
     casual use or small folders.
2. Click **Open Folder** and pick a directory of `.eml` files (any depth of
   subfolders), or **Open Files** for a handful of loose files, or drag a
   folder onto the window. Nothing is copied or uploaded — the app reads
   your files in place, straight from disk.
3. The tree on the left fills in, and the status bar shows indexing
   progress. Once it says "ready to search", every feature below is live.

## The Explorer (file tree)

- **What the dots next to a filename mean** — there are two different
  kinds, and they're deliberately different shapes so they're never
  confused:
  - A small **green ring** right after the file icon (before the
    filename) means that file is **currently open in a tab** — any open
    tab, not just the one you're actively looking at. Hover it: "Open in a
    tab right now".
  - Small **filled, colored dots** after the filename are that email's
    **tags** — one dot per tag (up to 5 shown), each colored by hashing
    the tag's name (the same tag always gets the same color, but two
    different tags can occasionally land on similar-looking colors).
    Hover any one of them: "Tag: `<name>`".
- **Browsing**: click a folder to expand/collapse it (or use **⊟**/**⊞** in
  the toolbar for Collapse All / Expand All). Click a `.eml` file to open it
  in a new tab. The **Name (A→Z / Z→A)** dropdown sorts the tree (folders
  always come first).
- **Refresh** (**⟳**, first icon in the toolbar): this app has no way to
  automatically notice files added, removed, or renamed by something else
  (Finder, another tool, a sync client) — browsers don't offer a live
  "watch this folder" API. Click Refresh any time you know the folder
  changed outside the app to re-read it from disk. Only works for a
  folder opened via **Open Folder** in Chrome/Edge (the same requirement
  Delete/Move/Copy have); for any other way of opening files, you'll see
  a message pointing you back to **Open Folder**. Your open tabs stay
  open — only a tab for a file that no longer exists gets closed
  automatically.
- **Filtering by name**: type into the "Filter files by name…" box to hide
  everything that doesn't match.
- **File-filter mode**: the dropdown next to the sort control has two
  options —
  - **".eml files only"** (default): only files ending in `.eml` are
    treated as emails; anything else shows greyed out and isn't clickable.
  - **"All files (as email)"**: also treats any file with **no extension
    at all** as a candidate email — for folders where messages were
    renamed to a bare content hash (e.g. `5f4dcc3b5aa765d61d8327deb882cf99`)
    with real `.eml` bytes but no `.eml` suffix. It still skips files with
    a *recognized* non-email extension (`.json`, `.txt`, `.csv`, `.png`,
    `.jpg`, `.zip`, `.pdf`, `.docx`, and similar) even in this mode, so a
    stray metadata file sitting next to your real emails doesn't get
    treated as one. Switching this dropdown re-indexes the folder.
- **Multi-select**: `Ctrl`/`Cmd`-click a file to toggle it in or out of a
  selection; `Shift`-click another file to select the whole range between
  them and your last click. A bar appears showing how many are selected,
  with a tag input — type a tag name and click **Add tag** to tag every
  selected email at once. **Clear** empties the selection. A plain click
  (no modifier key) on any file clears the selection and opens that file
  normally.
- **Parse-errors panel**: if any file failed to parse, or was too large to
  index, a collapsible "⚠ N file(s) failed to parse" panel appears under
  the filter box. Expand it to see each file's path and the reason —
  useful because the file that fails to parse might be the most
  interesting one, not just noise.
- **Right-click** a file (or your current multi-selection) for
  **Delete / Move to folder… / Copy to folder…** — see
  [Delete, Move, and Copy](#delete-move-and-copy).

## Reading an email

Each open email is a tab, and each tab has six views:

| View | What it shows |
|---|---|
| **Preview** | The rendered, sanitized email — subject, From/To/Cc/Bcc/Date, SPF/DKIM/DMARC badges, **Signals** badges (urgency-language score and any financial indicators — always on, computed automatically, no click needed), the body (safe to view — no scripts ever run, remote images/content are blocked by default), a Metadata panel (domain mismatches, a **WHOIS** button next to the From domain, recipient count, attachment sizes, URL hosts), a Links panel (each link also has its own WHOIS button), and (if anything was blocked) a Blocked-resources panel. |
| **Headers** | Every header in original order, with a Copy button on each, and `Authentication-Results`/`Received` called out separately. |
| **text-body** | The visible plain text of the email — the real `text/plain` part if there is one, or text extracted from the HTML part (clearly labeled as a fallback) if not. |
| **html-body** | The raw decoded HTML source itself, unrendered, line-numbered — for spotting things a safe render hides on purpose (hidden elements, tracking pixels, obfuscated markup). |
| **Attachments** | Every attachment: filename, MIME type, size, a cached SHA-256 hash, a **Download** button, an inline preview for images/plain text, and a **VirusTotal** button (looks up the hash only — the file is never uploaded). The first meaningful image (inline or attached) also gets an **🔎 Extract text (OCR)** button — see below. |
| **Raw** | The exact original bytes of the `.eml` file, line-numbered, with copy/re-download. |

Tips:
- **Load remote images/content** (checkbox in Preview) turns on remote
  fetches for that one email only, when you deliberately want to see them.
- **The Links panel flags a text/destination mismatch** — a classic
  phishing tell is a link whose visible text says one thing ("paypal.com")
  while its `href` points somewhere else entirely. Hover any link in the
  rendered body for a tooltip showing its real destination without ever
  needing to click it; the Links panel lists every link the same way. A
  link whose only content is an image (or is otherwise empty of text)
  shows exactly what it wraps — `[Image: <alt text>]`, `[Image]`, or
  `(empty link text)` — instead of a vague placeholder.
- **Scan URL** next to any link (in the Links panel or the
  Blocked-resources panel) opens VirusTotal's URL analysis for that exact
  link in a new tab — it shows the resolved redirect chain and final
  destination without your own browser ever visiting the link directly.
- **WHOIS** next to a domain looks up its registration age via the free
  public RDAP service — one click, one domain. Always shows a result:
  found (registrar + registration date), not found (no record for this
  domain/TLD), or an error (e.g. timed out) — never a silent blank.
- Multiple tabs can be open at once, like a code editor —
  `Alt`+`←`/`Alt`+`→` to switch, `Alt`+`W` or the tab's `×` to close.
- **Meeting invites**: if a message carries calendar data — an inline
  meeting-invite body part, or a `.ics` file attachment — a small
  "📅 Meeting Invite" (or Cancelled/Response) card appears near the top of
  Preview with the summary, time, location, organizer, and attendees. This
  is purely a read-only summary of plain-text fields; the attachment (if
  any) is still only ever offered as a normal download in the Attachments
  tab, same as any other attachment.
- **Extract text (OCR)**: in the Attachments tab, the first meaningful
  image in the email (over a tiny size floor, whether inline or a regular
  attachment) gets a **🔎 Extract text (OCR)** button. Click it to run text
  recognition entirely in your browser — nothing is uploaded anywhere, and
  nothing in the image is ever executed, only its pixels are read. The
  first click each browser session is a little slower (a few seconds) while
  the OCR engine starts up; after that, the same image (by its exact
  content, not just its filename) reuses its cached result instantly, even
  in a different email or a later session. The extracted text also becomes
  searchable via `attachment.ocr:` — see Search, below — but only for
  images you've actually clicked this button on; it's never run
  automatically or in bulk. Treat the output as a helpful lead, not ground
  truth: it's English-only, tuned for speed over perfect accuracy, and can
  miss things like light-colored text on a solid dark button.

## Search

Open the **Search** sidebar tab (or `Ctrl`/`Cmd`+`Shift`+`F`). There are two
modes, chosen from the dropdown at the top:

### Decoded search (default)

A small query grammar over an index built as the folder loads:

- **Bare words** are ANDed together: `invoice urgent` finds emails
  containing both words somewhere.
- **`"exact phrase"`** — quoted text. Verified exactly for
  subject/from/to/cc/bcc/reply-to/return-path; for the body/headers it
  means "all these words present", not strict word-adjacency.
- **`field:value`** — restrict to one field, using a namespaced grammar
  (`header.*` for anything header-related, `attachment.*` for anything
  attachment-related): `header.subject:`, `header.from:`, `header.to:`,
  `header.cc:`, `header.bcc:`, `header.replyto:`, `header.returnpath:`
  (address fields match the bare address only, no display name — search
  the full address for these), `header.messageid:` (exact match on the
  Message-ID), `header.raw:` (matches across all header values),
  `attachment.filename:` (matches filenames), `attachment.ext:` (exact
  match on an attachment's extension — include the dot, e.g.
  `attachment.ext:.exe`), `attachment.sha256:` (exact match, case-
  insensitive, on an attachment's own SHA-256 — computed for every
  attachment as the folder indexes, so unlike OCR below this one covers
  the whole folder immediately; paste in a hash from a threat-intel feed
  or a VirusTotal result to find every email carrying that exact file),
  `attachment.ocr:` (matches text extracted from
  image attachments — **sparse, not exhaustive**: only covers emails
  where you've actually clicked "Extract text (OCR)" in the Attachments
  tab, see Reading an email, above; a live "OCR coverage: N email(s)
  OCR-indexed so far" note appears next to your results whenever a query
  uses this field, as a reminder that a miss here doesn't mean the image
  has no matching text), `tag:` (exact tag name match). **This replaced
  the old flat `from:`/`to:`/`attachment:`/`attachments:`/`meta:`/`header:`
  syntax** — those no longer parse as fields.
- **`-exclude`** — put a `-` in front of any term or `field:value` to
  exclude it: `-tag:reviewed`, `-attachment.filename:invoice`.
- **`OR`** (all-caps only — lowercase `or` is just a word) and `(...)`
  grouping — OR binds looser than the implicit AND:
  `(header.from:paypal OR header.from:ebay) attachment.count:>0` finds
  attachments from either sender; `-(header.from:paypal OR header.from:ebay)`
  negates the whole group. Combines
  with the `Aa`/`.*` toggles above too — Match Case still verifies each
  leaf inside the group, and Use Regex (which bypasses this whole grammar)
  treats `(`/`)`/`OR` as literal pattern text, not grouping syntax.
- **Numeric fields** — glue a comparison operator directly onto the value
  (no space):
  - `attachment.count:>3`, `attachment.count:3` (exact), `attachment.count:<=1`
  - `size:>5mb`, `size:<100kb` (accepts `b`/`kb`/`mb`/`gb`, case-insensitive)
  - `urls:>=10` — number of links found in the body
  - `recipients:>20` — unique To/Cc/Bcc count
  - `duplicates:>1` — how many indexed files share this one's Message-ID
    (or content hash, if there's no Message-ID) — `duplicates:>1` finds
    every file that's part of a repeated/bulk-sent batch; `duplicates:1`
    finds only the unique ones.
  - `urgency:>=3` — the always-on urgency-language score
- **Regex** — `field:/pattern/flags` runs a real regular expression instead
  of substring matching, on `header.subject:`, `header.from:`, `header.to:`,
  `header.cc:`, `header.bcc:`, `header.replyto:`, `header.returnpath:`, or
  `attachment.filename:`
  only (the fields whose full text is kept, not just search tokens):
  `attachment.filename:/\.(exe|scr|js)$/i`, `header.subject:/^re:.*invoice/i`.
- Combine freely: `header.from:paypal attachment.count:>3 -tag:reviewed`.
- A term or value that can't be resolved — too short to search on, an
  unparseable numeric comparison, or an invalid regex — deliberately
  matches **nothing** rather than everything, with a warning explaining
  why. For a security tool, "found nothing" needs to be a trustworthy
  answer, not a silent false negative.
- Click the **?** button next to the search box any time for this same
  reference, in-app.

**`Aa` / `.*` toggle buttons** sit below the Search button (VS Code-style —
click to turn either on/off, no separate "case insensitive" option since
that's just Match Case turned off):
- **`Aa` Match Case** — verifies exact case for quoted phrases and any
  term, but only against the fields with retained raw text (the same
  fields `field:/pattern/` above is limited to); `header.raw`/body matches
  are unaffected either way. A status-line note appears whenever it's on to
  make that scope clear.
- **`.*` Use Regex** — treats the *entire* search box as one regex
  pattern, ignoring `field:`/`"phrase"`/`tag:` syntax while it's on, tested
  against those same raw-text fields — the same one-pattern model Raw
  search's own regex toggle uses below, so flipping between the two modes
  behaves predictably. Use Raw search instead to regex the full body. An
  invalid pattern matches nothing (with a warning), never everything.
- Both toggles combine (Match Case + Use Regex together makes the pattern
  case-sensitive).

### Raw search

Greps the untouched original bytes of every file, skipping MIME decoding
entirely — the always-available fallback for anything hidden by encoding,
or before the decoded index has finished building, and (unlike Decoded
search) the way to regex or case-match the full raw body. Uses the same
**`Aa`**/**`.*`** toggle buttons as Decoded search above.

### Files to include/exclude

Below the `Aa`/`.*` toggles, a collapsible **Files to include/exclude**
section adds a VS Code-style path filter shared identically by Decoded and
Raw search: plain substring matching against each file's relative path,
with optional wildcards — `*` for any run of characters, `?` for exactly
one. For example, include `invoices/*` to only search inside an `invoices`
folder, or exclude `*.tmp` to skip scratch files. One pattern per line, or
comma-separate several on one line. An excluded path always wins over an
included one; leaving Include blank means "everything not excluded".

### Selecting and acting on multiple search results

Once you have results, a bar above the list shows a master checkbox and a
count:

- **Check the master checkbox** to select every result, or uncheck it to
  clear the selection (it shows a dash when only some are selected).
- **Check individual rows**, or use `Shift`-click to select a range and
  `Ctrl`/`Cmd`-click to toggle one row — same conventions as the Explorer
  tree's own multi-select.
- **Right-click** a row (or the current selection) for **Copy path(s)**,
  **Copy file name(s)** — both clipboard-only, always available regardless
  of write access —, **Extract OCR (selected)** (see below), or the same
  Move to folder…/Copy to folder…/Delete actions described in
  [Delete, Move, and Copy](#delete-move-and-copy).

### Bulk-extracting OCR for a batch of emails

The same right-click menu (from Explorer, Search results, or a rule's/
tag's "View matches"/"View files" list) has an **Extract OCR (selected)**
action — it runs OCR on each selected email's first meaningful image, one
at a time, so you don't have to open every email and click the
per-attachment button individually. A live "N/M" count and a **Stop**
button appear in the status bar while it runs.

This is deliberately scoped to whatever you've selected — there's no
single "OCR the entire folder" button. OCR runs through one shared engine
instance in your browser and processes images one at a time, so an
unscoped whole-folder run on a very large folder could take a long time;
narrow down to the batch you actually care about first (a search, a
rule's matches, a tag's members, or a manual multi-select), then run this
on that. Re-running it over emails you've already OCR'd is cheap — anything
already cached is skipped, so you can safely re-run it after adding a few
more emails to a selection without redoing the whole batch.

### Export IOCs (CSV)

Below the search box, **⬇ Export IOCs (CSV)** downloads one file: every
sender domain, every URL/link domain, every attachment extension, every
financial-indicator type, and a sender-anomaly count, each with a count of
how many emails referenced it. It automatically scopes to whatever you're
currently looking at in this tab — an explicit selection first, then the
current search/rule/tag results, and only if neither of those is active
does it cover the whole indexed folder. Hover the button any time to see
exactly which of the three it's about to use.

## Tags

Open the **Tags** sidebar tab.

- **Adding a tag**: from an open email's Preview tab, click "+ add tag",
  type a name, press Enter. From the Explorer tree, multi-select several
  files first (see above) to tag them all at once.
- **Removing a tag from one email**: click the **×** on its tag chip in
  that email's Preview tab. To remove a tag from *every* email at once
  instead, see **Delete tag** below.
- **Filtering by tag**: check one or more tag names in the Tags panel to
  filter the Explorer tree down to just emails carrying those tags.
- **Export** / **Import**: back up all tags (and notes) to a JSON file, or
  restore/merge one back in — useful for moving your triage work to
  another machine or sharing it with a teammate.
- **Save to folder**: only enabled when the folder was opened via **Open
  Folder** in Chrome/Edge with write access granted. Writes the same tag
  data as a `mantiz-tags.json` file at the folder's own root, so it travels
  with the folder itself instead of only living in this browser. Next time
  you (or anyone) opens that folder — this browser or a different
  machine — a banner offers a one-click **Load** if it finds that file.
  Nothing is ever saved or loaded automatically; both directions need an
  explicit click.
- **Case Report (Markdown)**: generates one shareable `.md` file with a
  table per tag (subject, from, date, path) for every currently-tagged
  email — for handing off "here's everything I found" without retyping it.
- **Bulk actions per tag**: click the **⋯** button next to any tag name to
  open the same Delete/Move/Copy menu described below, pre-loaded with
  every email that currently carries that tag — this acts on the *files*.
  **View files** lists them in the Search tab instead, with the same
  select-some/select-all tools described in [Search](#search).
- **Delete tag** (untag everywhere): removes that tag from every email
  that carries it, in one click — the emails themselves are never touched
  or deleted, only the tag. Since a tag isn't a separate thing you create
  ahead of time (it exists for as long as at least one email carries it),
  "deleting" one just means clearing it everywhere at once instead of
  removing it from each email's Preview tab one at a time. If a still-
  enabled rule currently applies this tag, its next run simply re-adds it
  — disable or delete that rule too if you want the tag gone for good.

Tags remember *where they came from*: a manually-typed tag and a
rule-applied tag with the exact same name on the same email are tracked
independently — disabling or renaming the rule only retracts its own
claim, never a tag you typed by hand.

## Rules

Open the **Rules** sidebar tab.

- **+ New Rule** opens the rule editor. Give it a name, optionally a tag
  (auto-generated from the name if you leave it blank), and a **JavaScript
  boolean expression** — e.g.:
  ```js
  f.from && f.replyTo && f.from.domain !== f.replyTo.domain
  ```
  This tags every email whose `From` domain doesn't match its `Reply-To`
  domain. See [why a real expression instead of a custom
  mini-language](ARCHITECTURE.md#why-javascript-expressions-for-rules) for
  the reasoning, and click **fields & helpers reference** in the editor for
  the full list of what's available in `f` (the facts about the current
  email — including `f.nameMismatch`/`f.lookalikeDomain`/
  `f.punycodeSender` for sender-spoofing and `f.urgencyScore`/
  `f.financialIndicators` for the always-on Signals, see
  [Reading an email](#reading-an-email)) and `h` (matching helpers like
  `h.contains`, `h.looksLikeDomain`, `h.domainsAlign` (subdomain-aware,
  DMARC-style domain alignment), `h.attachmentExtIn`, `h.hasHiddenUnicode`,
  `h.shannonEntropy`, and more).
- **Start from a template**: the dropdown has 27 ready-made rules covering
  common anomalies — sender/reply-to or sender/return-path mismatch (both
  an exact-match and a subdomain-aware "organizational domain" variant),
  DMARC fail, SPF-or-DKIM fail, look-alike brand domains, IDN/punycode
  sender domains, display-name brand impersonation, urgency language,
  high urgency-score, financial indicators (alone and combined with
  urgency for a stronger BEC signal), executable/double-extension/many
  attachments, a nested `.eml` attachment, possible PII in the body,
  hidden Unicode, a random-token-in-subject check, four
  mutually-exclusive recipient-count tiers for mass-mail/spray detection,
  and a domain-category check against your Settings-configured category
  list (see [Settings](#settings)) — pick one and adjust it.
- **Test against loaded emails**: before saving, see how many currently-open
  emails the expression matches (and a few example paths), with no tagging
  side effect.
- **Run now** / **Run all** apply a rule (or every enabled rule) across the
  whole open folder, tagging matches and untagging anything that no longer
  matches — with live progress and a **Stop** button. Stopping never
  untags anything a partial scan simply hasn't reached yet.
- **Disabling** a rule (the toggle switch) is instant: the app tracks
  exactly which emails that rule tagged, so it retracts precisely those,
  with no re-scan needed.
- **Export** / **Import**: back up your rule library as JSON, or bring one
  in from another machine. Importing skips (never overwrites) any
  incoming rule whose tag already matches an existing one, and doesn't
  auto-run imported rules — run them yourself when ready.
- **Bulk actions per rule**: click the **⋯** button on a rule's card to
  open the Delete/Move/Copy menu, pre-loaded with every email that rule
  has currently matched.

## Delete, Move, and Copy

Right-click a file in the Explorer tree (or your current multi-selection),
or click the **⋯** button next to a tag or a rule, to get a small menu:

- **Delete N email(s) (to .deleted)** — moves the selected file(s) into a
  `.deleted` folder at the root of your opened folder. This is
  **reversible**: nothing is permanently removed, and you can find the
  files there on disk any time. From that point on, the `.deleted` folder
  and everything in it is completely hidden from this app — it won't show
  in the tree, search results, or rule matches, as if it doesn't exist.
- **Move N email(s) to folder…** — opens a small dialog: pick an existing
  subfolder from the dropdown, or type a new folder name (always created
  as a subfolder of the folder you already opened — never somewhere else
  on disk). The original files are removed from their old location.
- **Copy N email(s) to folder…** — same dialog, but the originals stay put
  too. If a file with the same name already exists at the destination, the
  copy is automatically renamed (`invoice.eml` → `invoice-2.eml`) rather
  than ever overwriting anything.

This is useful for building clusters — e.g. a rule matched 10 emails, and
you want them all in one folder for a report, or you've found duplicates
and want to clean them out.

**Requirements**: this only works in **Chrome or Edge**, on a folder opened
via the **Open Folder** button specifically (not "Open Files", not
drag-and-drop, not Firefox/Safari — those hand the app read-only file
snapshots with no way to write back to disk at all). The first time you use
any of these in a session, the browser will show its own permission prompt
asking you to allow write access to the folder — that's the browser itself
being cautious; click Allow. If write access genuinely isn't available, the
menu items appear disabled with a tooltip explaining why, instead of
silently failing.

## Settings

Click the gear icon at the top-right of the toolbar — it opens a full-width
Settings page in the right pane (not a sidebar panel), with:

- **IDE config**: **Max open tabs** (1–100, default 10) — past the limit,
  the tab you viewed longest ago closes first to make room for a new one.
  Below it, a read-only **Server port** line shows which port you're
  currently running on. It can't be changed from here — the page only
  loads *after* `scripts/serve.py` has already started and bound to a
  port, so nothing running in the browser can reach back and change that.
  To actually change the default port, create a `.mantiz-config.json` file
  next to `index.html` (`{ "port": 9000 }`, gitignored — your own local
  preference) and restart the server; a port typed on the command line
  (`python3 scripts/serve.py 9000`) still overrides it for that one run.
- **Trusted domains**: the list the sender-spoofing rule templates (brand
  impersonation, lookalike-domain) check against, pre-filled with a small
  built-in brand list. Paste in your own organization's domain(s) — one at
  a time or a whole list at once, separated by commas, spaces, or new
  lines; duplicates are merged automatically, never shown twice. Adding
  `mycompany.com` also covers real subdomains like `mail.mycompany.com`
  automatically. For finer control, add a regex entry instead, written as
  `/pattern/flags` (same convention as search's `field:/regex/` syntax) —
  e.g. `/\.corp\.mycompany\.com$/` to trust a whole internal subdomain
  family. **Reset to defaults** restores just the built-in brand list.
- **Domain categories**: answers "what type of domain is this?" for the
  sender/reply-to/return-path domains, every URL domain in the body, and
  domain-like text found in headers and attachment filenames. Ships with a
  small starter set (CDN/hosting, file sharing, URL shorteners, payment
  processors, social media, code repos/paste sites, email-security
  link-rewrite services, communication platforms, suspicious/free TLDs).
  Add a keyword to any category with the "+ Add" box under it (comma/
  space/newline-separated, same bulk-paste convention as trusted domains),
  remove one by clicking its `×`, or click **+ New category** to create
  your own from scratch. A keyword starting with `.` matches as a
  TLD/suffix (e.g. `.xyz` matches any `.xyz` domain); anything else matches
  as a plain substring anywhere in the domain. **Reset to defaults** on
  this section restores just the built-in category list. A category a
  matched email falls into shows up in that email's Metadata panel (a
  "Domain categories" row), in the IOC CSV export, and as a ready-made
  "Domain matches a flagged category" rule template you can enable as-is.
  A future update to the app may add a new built-in category for you
  automatically — it won't reappear one you've deliberately deleted, and
  won't touch one you've already customized.
- Nothing else needs configuring here — WHOIS and the Signals badges both
  work with zero setup.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl`/`Cmd` + `Shift` + `F` | Focus the search box |
| `Alt` + `←` / `Alt` + `→` | Switch to the previous/next open tab |
| `Alt` + `W` | Close the active tab |
| `Ctrl`/`Cmd`-click a tree file | Toggle it in/out of multi-selection |
| `Shift`-click a tree file | Select the range from your last click |
| `Escape` | Close an open context menu |

## Resuming a session

The app remembers what folder and tabs you had open. On your next visit, a
**"↻ Resume '...'"** button appears in the top toolbar — click it to pick
up where you left off. In Chrome/Edge (native folder picker), this is a
genuine one-click resume after re-confirming permission; in Firefox/Safari
you'll be asked to re-pick the same folder to relink it (browsers don't let
a web page remember a folder handle across sessions without this).

## Trying it with sample emails

The first time you open the app with no prior session, a banner offers
**Load sample emails** — twelve synthetic (fully invented, no real data)
messages that exercise every detection feature at once: brand
impersonation, a lookalike domain, a punycode domain, a BEC wire-fraud
lure, SPF/DKIM/DMARC failures, a risky attachment, an exact-duplicate
pair, a clean baseline, a calendar invite, and a pair of senders for
trying OR/grouping search. One click loads them all. See
[`sample-emails/README.md`](sample-emails/README.md) for a guided
walkthrough of what to try with them.

The banner only appears once by default. If you dismiss it (or load the
sample emails) without ticking **Show this again next time**, it won't
appear again on later runs — tick that box first if you want it back.

## Troubleshooting

- **"Attachments: sha256 unavailable (serve over http(s) to enable)"** —
  you're likely running via a plain `file://` page. Use
  `scripts/serve.py` (or `run.sh`/`run.bat`) instead; see
  [ARCHITECTURE.md's Known limitations](ARCHITECTURE.md#known-limitations)
  for why.
- **Search/indexing seems slow** — decoded search indexing is bound by real
  disk-read + MIME-decode work, parallelized across a worker pool; it's
  incremental and searchable while still running (watch the progress bar
  and the "N/M emails indexed so far" note in search results). Raw search
  is the always-fast fallback since it skips MIME decoding entirely.
- **Delete/Move/Copy menu items are greyed out** — see the requirements in
  [Delete, Move, and Copy](#delete-move-and-copy) above: Chrome/Edge, and
  the folder opened specifically via **Open Folder**.
- **A rule or search match seems wrong** — check the search **?** reference
  or the rule editor's **fields & helpers reference** for exact field
  semantics; an unparseable query clause intentionally matches nothing
  rather than everything, with a warning shown in the status line.
- **Something looks like a real bug** — see
  [ARCHITECTURE.md's Security model](ARCHITECTURE.md#security-model) for
  what "shouldn't be possible" in this app, and please report it: contact
  [kmantri.code@gmail.com](mailto:kmantri.code@gmail.com) or open a GitHub
  issue on this project's repository.
