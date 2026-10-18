# Mantiz-EML-Analyzer

[![License: PolyForm Noncommercial 1.0.0](https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-blue.svg)](LICENSE)
![Dependencies: zero build](https://img.shields.io/badge/dependencies-zero%20build-brightgreen)
![Runs on](https://img.shields.io/badge/runs%20on-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey)
![Requires](https://img.shields.io/badge/requires-Python%203-informational)

A local, IDE-style tool for bulk-reviewing `.eml` files — built for security
analysts triaging batches of suspicious/phishing email samples, but useful
for anyone who needs to browse, search, tag, and rule-match a folder of raw
emails without importing them into a mail client.

Everything runs entirely in your own browser tab: no server-side
component, no account, no telemetry, nothing ever uploaded anywhere.

**[Try it in your browser](https://kcode-maker.github.io/mantiz-eml-analyzer/)**
— click **Open Folder** and point it at any folder of `.eml` files. The
page is just the app's code; your files are still read straight from your
own disk, in your own browser.

## Quick start

Requires only **Python 3** (already on macOS/Linux; a free install on
Windows from [python.org](https://www.python.org/downloads/)). No Node,
no npm, no build step.

```bash
cd mantiz-eml-analyzer
python3 scripts/serve.py
```

This opens the app in your browser. The server shuts itself down a few
seconds after you close the app's last browser tab (or press `Ctrl+C` /
close the terminal) — nothing to clean up. Pass `--keep-running` to keep it
up after the browser closes. For double-click launchers and other ways to
start it, see [HELP.md](HELP.md#getting-started).

**"Address already in use"** means an older copy is still running; the
error message names its PID and the exact command to stop it (e.g.
`kill 12345`), or pass a different port: `python3 scripts/serve.py 9000`.

Opening a folder never copies or moves your files — everything is read in
place, straight from disk.

## Documentation

| Doc | Covers |
|---|---|
| [HELP.md](HELP.md) | A complete, task-by-task guide to every feature |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Internals, design rationale, dependencies, security model |
| [CHANGELOG.md](CHANGELOG.md) | What shipped in each version |

## Highlights

- **Browse and read**: a virtualized file tree, multi-tab viewer, safe
  rendering (scripts always stripped, remote content blocked by default).
- **Inspect**: SPF/DKIM/DMARC badges, sender-spoofing and lookalike-domain
  detection, always-on urgency/financial-indicator signals, a WHOIS
  lookup, local OCR text extraction from image attachments, a Security
  checks checklist (header, body and script/language signals), a Headers
  tab with parsed authentication results, a drawn Received chain
  (broken or backwards hops flagged) and every header shown decoded,
  inserted-header and spoofed-internal-sender detection, and the opened
  folder's full path.
- **Search**: whatever you type matches as plain text anywhere in the
  email (body, links, any header, OCR text, non-English included), with a
  namespaced grammar to narrow it (`header.<any header>:`, `auth.spf:`,
  `attachment.*`), phrases, exclusion, OR/grouping, numeric comparisons,
  regex, and a raw-byte fallback mode — with VS Code-style autocomplete
  for fields, your folder's real header names, and values (the tag boxes
  and the rule editor autocomplete too).
- **Tag and automate**: manual tags plus a rules engine — write a boolean
  JavaScript expression once and every matching email gets tagged
  automatically, now and on every future run. 27 starter templates ship
  with it.
- **Organize**: Delete/Move/Copy (Chrome/Edge), IOC export (CSV),
  case-report export (Markdown).

See [HELP.md](HELP.md) for the full guide to every feature.

## Security

Built to be safe to point at hostile input: no script from an email ever
executes, no network request happens as a side effect of browsing, and
nothing is sent anywhere except two explicit, per-click, user-initiated
exceptions (a VirusTotal URL/hash lookup and a WHOIS domain lookup); the
app also talks to the local server that serves it, and only to that. See
[ARCHITECTURE.md](ARCHITECTURE.md#security-model) for the full model.

## License

[PolyForm Noncommercial 1.0.0](LICENSE) — free for any noncommercial
purpose (personal use, research, education, hobby projects, evaluation),
with full source access and the right to modify it. Commercial use is not
included in this license. See [LICENSE](LICENSE) for full terms,
including the required copyright notice, and the in-app contact link for
commercial licensing or support.
