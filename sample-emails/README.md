# Sample emails — a guided first look at the tool

All the messages in this folder are **synthetic** (invented for this demo, no real domains, people,
or incidents) — safe to open, tag, and run rules against. Open this whole folder (**Open Folder**) to
see every core feature fire at least once, in a sensible order (the numbered subfolders sort top to
bottom in the Explorer tree):

| Folder | What it demonstrates |
|---|---|
| `01-legit` | A clean baseline email — nothing should be flagged. Useful for confirming a rule isn't over-firing. |
| `02-brand-impersonation` | Display name says "PayPal Support" but the sending domain isn't PayPal's — triggers the **Display name impersonates a known or trusted brand** rule template, plus urgency-language keywords. |
| `03-lookalike-domain` | Sender domain `paypaI.com` (capital i) is a one-character typosquat of `paypal.com` — triggers **Sender domain looks like a typosquat of a trusted domain**. |
| `04-punycode-domain` | Sender domain is IDN/punycode-encoded (`xn--...`) — triggers **Sender domain uses IDN/punycode encoding**. |
| `05-bec-wire-fraud` | A classic BEC wire-fraud lure: urgency language ("urgent", "confidential", "kindly", "asap") plus an IBAN and a labeled routing number in the body. Add `example-corp.com` as a trusted domain in **Settings** first, and this one *also* trips the lookalike-domain check (`examplle-corp.com` vs. `example-corp.com`) — a good way to see how the trusted-domains list changes what gets flagged. |
| `06-auth-failures` | SPF, DKIM, and DMARC all fail even though the display name claims to be the internal IT Helpdesk — triggers **SPF or DKIM fail** and **DMARC fail**. |
| `07-risky-attachment` | An attachment named `invoice.pdf.exe` (a harmless placeholder, not a real executable) — triggers both **Executable-looking attachment** and **Double-extension attachment**. |
| `08-duplicate-campaign` | Two byte-identical copies of the same message (simulating the same phish landing in two mailboxes) — search `duplicates:>1` to find them, or check the search result's duplicate count. |
| `09-calendar-invite` | An ordinary meeting invite with an inline `text/calendar` body part (`METHOD:REQUEST`) — opens as a "📅 Meeting Invite" summary card in Preview (summary/time/location/organizer/attendees) instead of raw calendar text. Nothing should be flagged; this one's just here to show off the calendar rendering. |
| `10-boolean-search-senders` | Two clean, unflagged emails from `paypal.com` and `amazon.com` (real transactional-style messages, not impersonation) — search `(from:paypal OR from:amazon)` across this whole folder to try OR/parenthesized-grouping search; add ` -tag:reviewed` or similar to see negation compose with a group too. |

## Suggested walkthrough

1. **Open Folder** → point it at this `sample-emails` folder.
2. Go to **Rules**, click **+ New Rule**, and add a few templates from the dropdown (or **Run all**
   once you've added several) — watch the tag dots appear on the flagged files in the tree.
3. Open `05-bec-wire-fraud`'s email and check the **Links**/Metadata area, then add
   `example-corp.com` under the **Settings** gear icon's Trusted domains, and re-run rules to see the
   lookalike-domain check newly trigger on it.
4. Try a raw/decoded search, e.g. `duplicates:>1` or `attachment:.exe`, or
   `(from:paypal OR from:amazon)` to try OR/grouping — toggle **Match Case**/**Use Regex**
   (the `Aa`/`.*` buttons below the search box) to see how they combine with it.
5. Open `09-calendar-invite`'s email and check the "📅 Meeting Invite" card at the top of Preview.
6. Tag a couple of emails manually, then check the **Tags** panel's bulk move/copy/delete menu.

None of this data is real — feel free to delete, edit, or add to these files.
