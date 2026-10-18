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
   This opens the app in your browser. It shuts itself down a few seconds
   after you close the app's last browser tab (the page sends a small
   same-origin "still open" ping to this local server every few seconds —
   nothing leaves your machine); `Ctrl+C` or closing the terminal also
   stops it, and `--keep-running` keeps it up after the browser closes.
   It always uses port 8765
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
  with a tag input — type a tag name and click **Tag file** to tag every
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
| **Headers** | Three separate sections: **Authentication results** (SPF/DKIM/DMARC etc. parsed into a table, with coloured pass/fail pills), the **Received chain** (a connected diagram from the sender, through every hop, to you — see below) and **All headers** (a filterable table, original order, with a Copy button per row). |
| **text-body** | The visible plain text of the email — the real `text/plain` part if there is one, or text extracted from the HTML part (clearly labeled as a fallback) if not. |
| **html-body** | The raw decoded HTML source itself, unrendered, line-numbered — for spotting things a safe render hides on purpose (hidden elements, tracking pixels, obfuscated markup). |
| **Attachments** | Every attachment: filename, MIME type, size, a cached SHA-256 hash, a **Download** button, an inline preview for images/plain text, and a **VirusTotal** button (looks up the hash only — the file is never uploaded). The first meaningful image (inline or attached) also gets an **🔎 Extract text (OCR)** button — see below. |
| **Raw** | The exact original bytes of the `.eml` file, line-numbered, with copy/re-download. |

### Showing the full path of a folder

Browsers never tell a web page where a folder you picked lives on disk — only its
name and the paths inside it. When the app is run with `scripts/serve.py` (the
normal way), the app works it out for you, **without asking anything**: it sends
the local server the folder's name plus a handful of file paths and sizes, and the
server looks for a folder with that name that contains exactly those files. Only a
verified match is used, so a different folder that merely shares the name is never
shown. The Explorer root, the path bar above an email, the status bar and **Copy
path(s)** then show the complete path (**Copy relative path(s)** gives the old
behaviour). The lookup searches your home folder and attached drives and takes a
moment; until it finishes — or when the folder isn't found, or the app is opened
from a hosted copy such as GitHub Pages — only the folder's name is shown. The
bundled sample emails are not looked up. This request goes only to the local
server on your own machine, and only the page itself is allowed to make it.

### The Headers tab

- **Authentication results** — every `Authentication-Results` header as a table:
  one row per method (spf, dkim, dmarc, arc …) with a coloured result pill, the
  explanatory comment and the properties (`smtp.mailfrom`, `header.d` …) as chips.
- **Received chain** — drawn **from the start point to your PC**: *Start — the
  sender*, then one card per server the message passed through (oldest first),
  ending at *End — you (the recipient)*. Each card shows the server, its IP, the
  protocol and the time; the connector between two cards shows the delay. A
  connector is **green** when the next hop's "from" matches the previous hop's
  "by", a **red broken-link symbol** when the two name different hosts (a forged or
  missing hop, or a relay the headers don't show), **amber** when a hop is stamped
  earlier than the one before it, and **grey** when there isn't enough
  information to say. A summary line gives the hop count, total transit time and
  how many links are broken. No `Received` headers at all is shown as a broken chain.
  Above the diagram:
  - **Two sender IPs, with a Copy button each.** *Connected to the receiving side
    from* is the newest public IP in the chain — recorded by the receiving side, so
    the sender cannot forge it; it is the one to block or hunt for. *Earliest public
    IP* is where the message claims to have started; hops below your first trusted
    server were written by the sender, so treat it as evidence, not proof. Private
    addresses (10.x, 192.168.x, loopback, …) never count; a single public hop shows
    just one chip. The Metadata card shows the connecting IP too.
  - **Where the time went** — a bar per hop-to-hop gap (plus *Sent → hop 1* from
    the Date header), scaled to the largest, with the slowest gap named when it is a
    minute or more. Days are kept (a 26-hour hold reads `1d 2h`), and a hop stamped
    *before* the one it follows is drawn as a red negative bar instead of being clamped
    to zero.
  - **Copy hop table** puts the hops (`#  From  IP  By  With  Time  Delay`) on the
    clipboard as tab-separated text for a case note or spreadsheet.
- **All headers** — a table of every header in original order, with a filter box,
  counts and a Copy button on each row. Every header is shown **decoded**, however the
  sender encoded it — RFC 2047 words (`=?UTF-8?B?…?=`, any charset, split across words),
  RFC 2231 parameters (`filename*=utf-8''%E2%82%AC.pdf`, continuations), raw UTF-8 and
  UTF-7 — with a small "decoded" tag (hover for why); the filter finds either form, Copy
  and **Copy all headers** copy the decoded text, and the Raw tab keeps the original
  bytes. It lists *every* header the file has —
  including all `Received` and `Authentication-Results` ones, which are also
  drawn above in their own sections. Narrow panes stack each row.

### Security checks

Under the Message and Security cards, the Preview shows a **Security checks**
checklist — *every* check is listed, so you can see what was tested and not just
what failed. Each row is **✓ ok**, a red **flag** (a strong signal worth a look),
an amber **note** (informational, or a signal that many legitimate emails also
show) or a grey **–** (not applicable). The header chip summarises it ("1
flagged · 2 notes", or "all clear"). Hover a row to see the `meta.flag:` id it
can be searched by.

Above the checklist, four **metric tiles** summarise the findings that matter
most — **Hidden characters** (zero-width / direction-control counts), **Look-alikes**
(mixed-script words and look-alike domains), **Envelope** (Return-Path and Reply-To
against the sender) and **Attachments** (risky of total). They are read from the same
checklist (never recomputed) and coloured by it; when the email has the issue, click a
tile to search the whole folder for every other email with it. For the folder-wide
picture, the bar-chart icon in the top bar opens the **Folder overview**: how many
emails carry each flag, grouped as on this card, with a click on any row running that
`meta.flag:` search.

**Header**
- **Reply-To / Return-Path** — compared by **organisation**, so a subdomain
  (`bounce.example.com` for `example.com`, or `mailer.example.co.uk`) is the same
  sender. A different domain is flagged — except a Return-Path on a known mailing
  service (SendGrid, Amazon SES, Mailchimp…, the editable *Email Service Provider*
  category in Settings), which is only a note because legitimate bulk mail always
  differs there. An empty Return-Path (a bounce) is normal. Same test as the badge in
  the Metadata card.
- **Sender domain** — flagged when the domain is built from **look-alike letters**
  imitating one of your trusted domains or a well-known brand (`раураl.com` with
  Cyrillic letters for `paypal.com`; punycode `xn--…` forms are decoded first, and
  full-width letters are folded), and when the sender address is a **bare IP**. A
  normal foreign-language domain that imitates nothing is not flagged, and neither is
  a domain you trust yourself. (ASCII near-misses such as `paypa1.com` are the
  separate *lookalike* flag in the Metadata card.)
- **Received chain** — flagged when there are no `Received` headers at all,
  when a hand-off between two hops doesn't connect (**broken chain**), or when an
  older hop is stamped *later* than the hop above it (more than 5 minutes of
  clock skew is allowed); noted when the chain is unusually long (15+ hops).
  The Headers tab draws the same chain — see [The Headers tab](#the-headers-tab).
- **Message-ID** — noted when missing, or when its domain is unrelated to the
  sender's (mailing services often do this legitimately, hence a note).
- **Sender name** — flagged when the display name contains an email address that
  isn't the real sender: `"ceo@corp.com" <attacker@evil.net>`.
- **Duplicate headers** — flagged when `From`, `Sender`, `Subject`, `Date`,
  `Message-ID`, `Reply-To` or `In-Reply-To` appears more than once.
- **DKIM domain** — noted when a DKIM signature exists but is signed by a domain
  other than the sender's; not applicable when there is no signature.
- **Inserted headers** — flagged only on strong evidence that a trust header was
  planted, never on guesses: **one server wrote two `Authentication-Results`
  that disagree** (e.g. `spf=fail` in one, `spf=pass` in the other — a server
  writes one, so one was inserted), or an `Authentication-Results` that sits
  *below the oldest* `Received` hop (so it existed before any server touched the
  message) and names a server no hop was received by. Deliberately **not**
  reported, because real mail does them constantly: a HELO name that differs from
  reverse DNS, odd dates, private-IP hops, and different servers disagreeing
  (forwarding). Nothing here proves a header is genuine — it only catches the
  forgeries that leave these fingerprints. The Headers tab shows the same finding
  above the Authentication results.
- **Internal sender** — needs your organization's domains in **Settings →
  Organization**. *Internal* = the sender's domain is yours and the first hop
  came from a private address (or one named under your domain), or the message
  authenticates as you (DMARC pass / Exchange `AuthAs: Internal`). *External* =
  a domain that isn't yours (shown as n/a — it isn't a problem). Flagged
  (`claims-internal`) when the sender uses **your** domain but the first hop
  came from a public address that isn't yours and nothing authenticates it — the
  signature of a spoofed internal sender. Cloud-hosted mail that passes DMARC for
  your domain stays *Internal*, so it doesn't raise false alarms; a domain of
  yours with no `Received` headers is only a note (the path can't be confirmed).
  The Preview also shows an **Internal / External** pill under the subject.

**Body**
- **Body parts** — noted for HTML-only (no plain-text part) and plain-text-only
  (no HTML part), and for an email with no body text whose content is an
  attachment (a calendar invite, "see attached"); flagged only when there is no
  body *and* nothing attached.
- **Image-only body** — flagged when there is almost no text and the message is
  an image (text hidden in a picture dodges keyword filters).
- **Text vs HTML** — when both parts exist, compares their words: flagged if the
  plain-text part shares under 25% of its words with the HTML (a decoy for
  filters), noted under 50%. Not applicable when a part is missing or very short.
- **Hidden content** — flagged for hidden characters: **any** in the sender name
  or a link host (never accidental there), or 3 or more in the subject/body (used to
  break up keywords); and flagged as **`bidi-override`** for a left-to-right/right-to-left
  OVERRIDE character (the "RTLO" trick that makes `invoice‮gpj.exe` look like
  `invoicexe.jpg`). Not counted, because ordinary mail is full of them: soft hyphens,
  the LRM/RLM marks every Arabic or Hebrew message has, a leading byte-order mark, and
  the joiners emoji and Persian text need (a joiner only counts between plain Latin
  letters). Noted for CSS-hidden text — `display:none`, zero or 1px size, pushed far
  off-screen, or white text on a white background set on the *same* element —
  which marketing mail also uses for preheader text.
- **Threading** — flagged as a **fake reply** when the subject starts with
  `Re:`/`Fwd:` (or a localised form like `AW:`) but there is no `In-Reply-To` or
  `References` header; noted as **threaded** when those headers are present.
- **Mixed-script words** — flagged when a single word mixes Latin with
  Cyrillic, Greek or Armenian letters (a Cyrillic "а" inside "paypal"), in the
  subject, sender name, body or a link host (punycode hosts are decoded first).
  The detail names the odd letter's code point (e.g. `U+0430`) because it looks
  identical. It does not flag a word written entirely in one script.

**Attachments** — flagged for an executable/script type (`.exe .scr .js .vbs .ps1
.lnk .jar …`), a **double extension** (`invoice.pdf.exe`), a file whose first bytes
are a program (Windows, Linux or macOS) although it is named like something else
(`Statement.pdf`), and a name that hides characters, an RTLO, or is padded with
spaces to push the real extension out of view. Noted for macro-enabled Office files
(`.docm .xlsm …`) and disk images (`.iso .img .vhd`). Only the first bytes of each
file are read, at most 50 files per email, and nothing is ever opened or run.

**Language (script)** — which script the subject and the body are written in
(`LATIN`, `CYRILLIC`, `GREEK`, `ARMENIAN`, `HAN`, …), a note when either isn't
purely Latin, and a note when they differ. This is the *script*, not the
language: English and French are both `LATIN`. Short text counts as a script only
with at least 3 letters (and 5% of the letters).

Every flag and note is searchable (`meta.flag:`, `script.subject:`,
`script.body:` — see [Search](#search)) and available to rules as
`f.anomalies`, `f.subjectScripts` and `f.bodyScripts`. These are heuristics, not
verdicts: a note is a reason to look, not proof of anything.

Tips:
- **Load remote images/content** (checkbox in Preview) turns on remote
  fetches when you deliberately want to see them. It is **one switch for
  every email**: tick it once (you are asked to confirm, since a sender can
  see that you opened their message) and every email you open after that
  loads remote content too; untick it in any email and it goes back to
  blocked for all of them. An amber **Remote content: ON** chip in the status
  bar shows while it is on (click it to turn it off). It is never saved: a
  page reload, or opening a different folder, puts it back to off.
- **Click an attachment name to find every email with an attachment of that
  name.** In the Metadata card each attachment name is a small clickable tag;
  a click fills the search box with `attachment.filename:"Inv-001.pdf"` and runs
  it (a substring match, so `Inv-001.pdf.exe` is listed too — useful for spotting
  look-alikes). Edit it into a regex to find a whole family of names:
  `attachment.filename:/Inv-.*\.pdf$/i` finds `Inv-001.pdf`, `Inv-002.pdf`…
  (note `.*`, not `*`: in a regex `Inv-*` means "Inv followed by zero or more
  hyphens", so a glob-style `Inv-*\.pdf` would miss `Inv-001.pdf`). The regex is
  tested against **each attachment name on its own**, so `^` and `$` mean the
  start and end of one filename even when an email has several attachments.
- **Click the Subject, From, To, Cc, Bcc or Reply-To tag to search for it.**
  The field labels in the Message card are small clickable tags (a magnifier
  and a violet pill); the values beside them stay plain text you can select and
  copy as usual. Clicking a tag fills the search box with the matching query —
  e.g. `header.subject:"Invoice overdue"` or `header.from:"billing@example.com"`
  — and runs it, listing every email with that subject or from that address.
  The cursor is left in the box, so you can edit the query (add
  `-tag:reviewed`, loosen the address to just the domain, combine it with a body
  word…) and press **Enter** to search again. On a To/Cc/Bcc line with several
  addresses the tag searches for **any** of them, as an editable
  `(header.to:"a@x.com" OR header.to:"b@y.org")` group. A subject containing
  quote marks becomes several quoted pieces ANDed together, since the query
  language has no way to write a quote inside a phrase. It always runs as a
  normal Decoded search (it switches Raw mode and Use Regex off). Date has no
  tag, since there is nothing useful to search for.
- **Hovering a link in the email shows its real destination** in a bar just
  above the status bar — the full URL, wrapped, never cut off and never over
  the status bar's text. A link whose visible text names a different site than
  where it really goes turns the bar red: "⚠ Displayed text says … — actual
  destination: …". Tabbing to a link with the keyboard shows it too. The
  pointer over a link is a normal hand; **clicking a link copies its address**
  (a green "✓ Link copied" confirmation appears in the same bar) — it never
  opens the link, hovering or clicking, so it is safe to click anything.
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
  containing both, in any order. **Whatever you type matches as plain text
  wherever it appears** — inside words, addresses, URLs and non-English
  text — across the subject, sender, recipients, body, links, *every
  header* and OCR text: `oogle` finds `mail.google.com`, `adobe` finds
  `message@adobe.com`, `оплату` and `帳戶` find Cyrillic/CJK text. Prefix a
  field (below) to narrow it. *Memory note:* full-text matching inside
  body/headers keeps the decoded text of each email in memory, up to a
  fixed budget (a few hundred thousand typical emails). Past that,
  remaining emails match whole words only, and the search status line says
  so (`⚠ … covers N/M emails`) — use Raw search for any substring there.

"Decoded" means the search sees what you'd read, not how it travelled:
encoded headers (`=?UTF-8?B?…?=`, quoted-printable, 8-bit text, folded and
split words) and encoded bodies (base64, quoted-printable, any common
charset — UTF-8, Windows-1251/1252, Shift-JIS, GB2312, UTF-16…) are decoded
first; HTML entities (`&amp;`, `&eacute;`, `&#1076;`) become the real
characters; punycode hostnames (`xn--…`) are also searchable by their
readable Unicode name; and zero-width / soft-hyphen characters inserted to
dodge keyword filters are ignored, so `verify` still finds `ver​ify`.
- **`"exact phrase"`** — quoted text: the words must appear next to each
  other, in that order (for emails past the memory budget above, "all these
  words present").
- **`field:value`** — restrict to one field, using a namespaced grammar
  (`header.*` for anything header-related, `attachment.*` for anything
  attachment-related): `header.subject:`, `header.from:`, `header.to:`,
  `header.cc:`, `header.bcc:`, `header.replyto:`, `header.returnpath:`
  (`header.from:`/`to:`/`cc:`/`bcc:`/`replyto:` match the decoded display
  name as well as the address, so `header.from:"PayPal"` and
  `header.from:noreply@paypal.com` both work), `header.messageid:` (exact match on the
  Message-ID), `header.raw:` (matches across all header values at once),
  **`header.<name>:` for any other header by name** —
  `header.received:google.com`, `header.x-mailer:outlook`,
  `header.authentication-results:fail`, `header.list-unsubscribe:`,
  `header.reply-to:`… (the **?** panel lists the header names actually
  present in your folder; an unknown name warns instead of silently
  matching nothing), **`auth.spf:` / `auth.dkim:` / `auth.dmarc:`** (the
  result, exact: `auth.spf:fail`, `auth.dmarc:pass`, `auth.dkim:softfail`,
  `auth.spf:missing` for no result recorded),
  `attachment.filename:` (matches filenames), `attachment.ext:` (exact
  match on an attachment's extension, with or without the dot — `attachment.ext:.exe`
  and `attachment.ext:exe` are the same), `attachment.sha256:` (exact match, case-
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
- **`url:`** — the **addresses of the links** in the body, as a substring:
  `url:example`, `url:".pdf"` (every email linking to a PDF), `url:bit.ly`.
  (`urls:>5` counts links instead; see Numeric fields below.)
- **`meta.*` — search the Metadata card.** One field per row of an email's
  Metadata card, so anything you can read there you can search for by typing the
  field. (The card itself stays plain, apart from the attachment names, which
  are clickable.) All are case-insensitive substring matches unless noted:
  - `meta.fromdomain:paypal` — the sender's **domain** only. Unlike
    `header.from:paypal`, it does not match a display name: it finds
    `paypal.evil.net`, not a message that merely says "PayPal" in its name.
  - `meta.connectingip:198.51.100` — the IP that connected to the receiving side
    (see [The Headers tab](#the-headers-tab)); `meta.originip:` — the earliest public
    IP in the Received chain. Substring match on the address.
  - `meta.replytodomain:gmail.com`, `meta.returnpathdomain:bounce` — the
    Reply-To / Return-Path domain.
  - `meta.urldomain:bit.ly` — the host of **any** link in the email.
  - `meta.category:shortener` — a domain category from Settings (the
    categories present in your folder are suggested as you type).
  - `meta.flag:` — an exact flag name. The sender flags `replyto-mismatch`,
    `returnpath-mismatch`, `name-mismatch` (display name claims a brand the
    domain isn't), `lookalike`, `punycode`, **plus every flag and note on the
    Security checks card** (see [Security checks](#security-checks)):
    `no-received`, `received-broken`, `received-time-travel`, `auth-results-conflict`, `auth-results-planted`, `claims-internal`, `confusable-domain`, `sender-ip-literal`, `bidi-override`, `attachment-executable`, `attachment-double-ext`, `attachment-disguised`, `attachment-macro`, `attachment-container`, `attachment-filename-spoof`, `received-long-chain`,
    `messageid-missing`, `messageid-domain`, `forged-display-name`,
    `duplicate-headers`, `dkim-misaligned`, `no-text-part`, `no-html-part`,
    `empty-body`, `image-only`, `text-html-mismatch`, `hidden-css-text`,
    `invisible-chars`, `fake-reply`, `threaded`, `homoglyph-subject`,
    `homoglyph-name`, `homoglyph-body`, `homoglyph-links`, `script-mismatch`.
    For example `meta.flag:fake-reply -tag:reviewed` lists unreviewed emails
    whose subject says "Re:" with no reply headers.
  - `script.subject:cyrillic`, `script.body:greek` — the **script** the
    subject / body is written in: `latin`, `cyrillic`, `greek`, `armenian`,
    `hebrew`, `arabic`, `devanagari`, `thai`, `hangul`, `han`, `hiragana`,
    `katakana`. Script, not language: it cannot tell English from French (both
    are `latin`). `script.body:cyrillic script.subject:latin` finds a Latin
    subject over a Cyrillic body.
  - `meta.financial:iban` — a financial indicator found in the body: `iban`,
    `swift_bic`, `routing_number`, `crypto_wallet_btc`, `crypto_wallet_eth`,
    `gift_card_request`.
  A flag name that doesn't exist, or an empty value, warns in the status line
  instead of silently matching everything.
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

### Autocomplete in the search box

Decoded search suggests as you type, like a code editor:

- Start a field name — `head`, `auth.`, `attach` — and a list appears.
  After `header.` it includes the **header names actually present in your
  folder** (with how many emails have each), so `header.x-` shows every
  `X-…` header you can search.
- Accepting a field inserts `name:` and, when the field has a fixed set of
  values, immediately lists them: `auth.spf:` → `fail`, `pass`, `softfail`…;
  `attachment.ext:` → the extensions found in your folder, with counts;
  `tag:` → your tags; `size:` / `attachment.count:` → example comparisons
  (`>5mb`, `>3`). Free-text fields (`header.subject:`, `body:`,
  `header.received:`…) have no value list — just type.
- **Tab** accepts the highlighted (or top) suggestion, **↑/↓** move through
  the list, **Esc** closes it, **Ctrl+Space** (or **↓**) lists everything.
  **Enter always searches** unless you've moved into the list with the
  arrow keys — so a plain search for a word like `from` is never hijacked.
- It stays out of the way: no popup for an empty word, inside an open
  quote, in Raw search, or with **Use Regex** on.

The same idea is available in two more places:

- **Tag boxes** (an email's "+ add tag", the multi-select bar, the rule
  editor's tag): your existing tag names are suggested as you type — pick
  one instead of retyping it (and risking a near-duplicate). A tag an email
  already has isn't offered again on that email.
- **The rule expression editor**: type `f.` for every fact about an email
  (with its type), `h.` for every helper (with its signature), `f.from.`
  for `name` / `address` / `domain`, or just a few letters (`cont` →
  `h.contains`). Accepting a function types the `(` for you, and
  `f.getHeader('` lists the header names present in your folder. Tab
  accepts, ↑/↓ choose, Esc closes, **Ctrl+Space** lists everything; Enter
  still inserts a new line unless you've arrowed into the list.

### Raw search

Greps the untouched original bytes of every file, skipping MIME decoding
entirely — the always-available fallback for anything hidden by encoding,
or before the decoded index has finished building, and (unlike Decoded
search) the way to regex or case-match the full raw body. Uses the same
**`Aa`**/**`.*`** toggle buttons as Decoded search above.

Raw search matches the bytes **as stored**: plain-text and UTF-8 content
(including non-English text such as `счёт` or `帳戶`) is found as written,
and encoded content is found only in its encoded form — to find the word
inside a base64 body or an `=?…?=` header, use Decoded search instead.

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
sender domain, the connecting and earliest public sender IPs (`connecting_ip` / `origin_ip`,
ready for a blocklist), every URL/link domain, every attachment extension, every
financial-indicator type, and a sender-anomaly count, each with a count of
how many emails referenced it. It automatically scopes to whatever you're
currently looking at in this tab — an explicit selection first, then the
current search/rule/tag results, and only if neither of those is active
does it cover the whole indexed folder. Hover the button any time to see
exactly which of the three it's about to use.

## Tags

Open the **Tags** sidebar tab.

- **Tag names**: lowercase letters, digits, `-` and `_` only, up to 40
  characters, **no spaces** (`set1`, `needs-review`, `phish_kit`). Capitals
  are lowercased as you type; anything else turns the box red and says why,
  and nothing is created until the name is valid. The same check applies to
  the rule editor's tag and to imports. Tags saved by an older version
  (capitals/spaces) are converted automatically the first time you open
  this version (`Needs Review` → `needs-review`; names that become identical
  merge), and an import of an old export converts them the same way and
  tells you how many.
- **Adding a tag**: from an open email's Preview tab, click "+ add tag",
  type a name, press Enter. From the Explorer tree, multi-select several
  files first (see above), type a name in the bar that appears, and click
  **Tag file** to tag them all at once.
- **Un-Tag file** (take a tag off some emails): click the **×** on its tag
  chip in that email's Preview tab, or multi-select several files in the
  Explorer and either type the tag in the bar there and click **Un-Tag
  file**, or tick the tag(s) in the Tags tab and click **Un-Tag file** —
  only the selected emails lose it.
  (A tag applied by a rule can't be taken off one email by hand — the
  rule would just re-add it — so the toast says so and points you to the
  rule.) To get rid of a tag on *every* email at once, use **Tag
  Deletion** below.
- **Filtering by tag**: tick one or more tag names in the Tags panel to
  filter the Explorer tree down to emails carrying *any* of those tags.
  Each tag shows how many emails carry it.
- **Acting on tags — one action bar for whatever is ticked**: above the
  list, **View files**, **Un-Tag file**, **Tag Deletion** and **Copy / move /
  delete emails…** work on all ticked tags at once (they stay greyed out
  until you tick something). There is deliberately no second, right-click
  copy of these actions — the bar is the one place for them.
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
- **Bulk actions on the emails of a tag**: **Copy / move / delete
  emails…** (action bar) opens the same Delete/Move/Copy menu described below,
  pre-loaded with every email carrying the ticked tag(s) — this acts on the
  *files*. **View files** lists them in the Search tab instead, with the
  same select-some/select-all tools described in [Search](#search).
- **Tag Deletion** (delete the tag itself, everywhere): tick the tag(s)
  (each shows its email count — `set2 (5)`) and click **Tag Deletion**. It
  asks first (stating how many emails lose the tag, and how many of them
  are in the open folder), then removes the tag from every email that
  carries it — you never need to know *which* ones had it. Example: tag 10
  samples `set1`, 5 of those `set2`, 2 of those `set3`; deleting `set2`
  leaves `set1` on all 10 and `set3` on its 2, and `set2` on none. The
  emails themselves are never touched or deleted, only the tag. A toast
  offers **Undo** for 8 seconds, which puts the tag back on exactly the
  emails that had it. The count covers every folder you've tagged, since
  tags are stored by email, not by folder.
  The dialog also shows how many rules apply the tag. **Every rule that
  uses a deleted tag is switched off automatically** (the rule itself is
  kept, never deleted) and **stays off until you edit it and choose a
  different tag** — its switch and **Run now** are disabled and its card
  says why; saving it with the deleted tag still in place is refused, and
  giving it a different tag lets you enable it again. Undo restores the tag,
  lifts the block and turns back on the rules that were running.
  The three actions are separate: **Tag file** (add a tag to files),
  **Un-Tag file** (take a tag off just the selected files), **Tag
  Deletion** (delete the tag itself, from all emails).

Tags remember *where they came from*: a manually-typed tag and a
rule-applied tag with the exact same name on the same email are tracked
independently — disabling or renaming the rule only retracts its own
claim, never a tag you typed by hand.

## Rules

Open the **Rules** sidebar tab.

- **+ New Rule** opens the rule editor. Give it a name, optionally a tag
  (auto-generated from the name if you leave it blank; same naming rules as
  any tag — see [Tags](#tags)), and a **JavaScript boolean expression**
  with autocomplete (see [Autocomplete](#autocomplete-in-the-search-box)) — e.g.:
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
- **Organization**: your own domains (a domain covers its subdomains). With
  these set, each email shows an Internal / External pill and the Security
  checks can flag mail that spoofs one of your domains (`claims-internal`).
  Nothing is guessed — with no domains here no verdict is shown. The search
  flag is computed while a folder is indexed, so re-open the folder after
  changing the list (the Preview pill updates immediately).
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
| `Tab` / `↑` `↓` / `Esc` in the search box | Accept / move through / close the autocomplete list |
| `Ctrl` + `Space` (or `↓`) in the search box | List all autocomplete suggestions |
| `Tab` / `Ctrl` + `Space` in the rule expression editor | Accept a suggestion / list all facts and helpers |
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
- **Does it work on my OS / browser?** — yes on macOS, Linux and Windows:
  the app is plain HTML/CSS/JS plus a small Python server, and nothing in it is
  tied to one OS. **Chrome or Edge** give the full experience; Firefox and
  Safari work for reading, searching, tagging and rules but not the file
  actions (see above), and in Firefox the email-body scrollbars use the
  system's (on macOS they appear only while scrolling). The glass bento layout
  needs a 2023-or-newer browser; older ones show the same cards stacked.
  Autocomplete's **Ctrl+Space** can be taken by your OS or input method (macOS
  input-source switching, Windows Chinese/Japanese IMEs) — **↓** in the search
  box does the same, and the rule editor suggests as you type anyway.
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
