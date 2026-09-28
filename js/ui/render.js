/**
 * render.js — renders one open tab (a parsed email) into the right pane:
 * Preview / Headers / Attachments / Raw. Owns creation/revocation of the
 * blob: URLs used for inline (cid:) images and attachment downloads.
 */
(function (g) {
  'use strict';
  var EV = g.EV || (g.EV = {});

  // The Preview tab's Metadata panel is rendered synchronously, but the domain-categories list is
  // Settings-backed (async, IndexedDB). Cached here and refreshed once at load and whenever the
  // Settings page saves a change (EV.refreshDomainCategoriesCache, called from app.js) rather than
  // doing an async round-trip on every single render.
  var cachedDomainCategories = [];
  function refreshDomainCategoriesCache() {
    return EV.settings.domainCategories().then(function (categories) { cachedDomainCategories = categories; });
  }
  EV.refreshDomainCategoriesCache = refreshDomainCategoriesCache;
  refreshDomainCategoriesCache();

  var FINANCIAL_INDICATOR_LABELS = {
    iban: 'IBAN', swift_bic: 'SWIFT/BIC code', routing_number: 'Bank routing number',
    crypto_wallet_btc: 'BTC wallet address', crypto_wallet_eth: 'ETH wallet address',
    gift_card_request: 'Gift card request'
  };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function fmtBytes(n) {
    if (n == null) return '?';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function fmtAddr(a) {
    return a.name ? a.name + ' <' + a.address + '>' : a.address;
  }

  function copyBtn(getText, label) {
    var b = el('button', 'ev-mini-btn', label || 'Copy');
    b.onclick = function () {
      navigator.clipboard && navigator.clipboard.writeText(getText()).catch(function () {});
      b.textContent = 'Copied!';
      setTimeout(function () { b.textContent = label || 'Copy'; }, 1200);
    };
    return b;
  }

  function downloadBlob(bytes, filename, mime) {
    var blob = new Blob([bytes], { type: mime || 'application/octet-stream' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  async function sha256Hex(bytes) {
    if (!g.crypto || !g.crypto.subtle) return null;
    try {
      var digest = await g.crypto.subtle.digest('SHA-256', bytes);
      var arr = Array.from(new Uint8Array(digest));
      return arr.map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    } catch (e) {
      return null;
    }
  }
  // Exported so app.js's bulk "Extract OCR (selected)" action can hash an attachment it
  // never renders a card for, using the exact same hashing this tab's own Attachments-tab
  // hash display/OCR cache already relies on -- one implementation, not a second copy.
  EV.sha256Hex = sha256Hex;

  /** The same "first meaningful image" rule renderAttachments uses for its OCR button:
   * an image, under the 8MB preview cap, over a tiny-tracking-pixel size floor -- inline or
   * regular attachment alike (see the comment at the OCR-button call site below for why).
   * Exported so app.js's bulk OCR action picks the exact same attachment a per-email click
   * would have, instead of drifting from it as a second, separately-maintained rule. */
  function pickFirstMeaningfulImageAttachment(attachments) {
    for (var i = 0; i < (attachments || []).length; i++) {
      var att = attachments[i];
      if (/^image\//.test(att.mimeType) && att.size < 8 * 1024 * 1024 && att.size > 512) return att;
    }
    return null;
  }
  EV.pickFirstMeaningfulImageAttachment = pickFirstMeaningfulImageAttachment;

  // ---------- security signals ----------

  function authBadge(label, value) {
    var b = el('span', 'ev-badge ev-auth-' + (value || 'none'), label + ': ' + (value || 'n/a'));
    return b;
  }

  // ---------- Links panel ----------

  /**
   * A button that opens VirusTotal's URL analysis for this exact URL in a
   * new tab — never fetched or navigated to from this app itself. Mirrors
   * the attachment VirusTotal button's safety contract: only the URL string
   * is sent to a trusted third-party scanner, never touched directly by the
   * analyst's own browser/network. This is deliberately NOT a "fetch this
   * URL" button — see README's security notes for why resolving redirects
   * client-side would be unsafe (tips off the sender that the link was
   * opened) and unreliable (CORS blocks reading most cross-origin redirect
   * chains anyway).
   */
  function scanUrlBtn(url) {
    var btn = el('button', 'ev-mini-btn ev-vt-btn', '🛡 Scan URL');
    btn.title = 'Look up this URL on VirusTotal (opens in a new tab) — shows the resolved redirect chain and final destination without your browser ever visiting it directly.';
    btn.onclick = function () {
      window.open('https://www.virustotal.com/gui/search/' + encodeURIComponent(url), '_blank', 'noopener,noreferrer');
    };
    return btn;
  }

  /**
   * A button that looks up a domain's registration age via the free public RDAP service — the
   * app's one other deliberate exception (besides Scan URL) to "nothing is ever fetched by this app
   * itself"; see js/core/whois.js's header comment and README's Security notes. Explicit per-click,
   * never automatic/bulk. Always shows one of found/not-found/error inline next to the button —
   * never a silent blank — and disables itself while the lookup is in flight so a slow/hung request
   * can't be fired twice.
   */
  function whoisBtn(domain) {
    var wrap = el('span', 'ev-whois-wrap');
    var btn = el('button', 'ev-mini-btn ev-whois-btn', '🔍 WHOIS');
    btn.title = 'Look up ' + domain + '\'s registration age via the free public RDAP service (one request, sends only the domain name).';
    var resultEl = el('span', 'ev-whois-result');
    btn.onclick = function () {
      btn.disabled = true;
      btn.textContent = 'Looking up…';
      resultEl.textContent = '';
      resultEl.className = 'ev-whois-result';
      EV.whois.lookup(domain).then(function (res) {
        btn.disabled = false;
        btn.textContent = '🔍 WHOIS';
        resultEl.textContent = res.message;
        resultEl.className = 'ev-whois-result ev-whois-' + res.status;
      });
    };
    wrap.appendChild(btn);
    wrap.appendChild(resultEl);
    return wrap;
  }

  function renderLinksPanel(links) {
    var wrap = el('div', 'ev-links-panel');
    if (!links || links.length === 0) {
      wrap.appendChild(el('div', 'ev-muted', 'No links found in the HTML body.'));
      return wrap;
    }
    var header = el('div', 'ev-links-header');
    var mismatchCount = links.filter(function (l) { return l.mismatch; }).length;
    header.appendChild(el('strong', null, links.length + ' link' + (links.length === 1 ? '' : 's') + ' found'));
    if (mismatchCount) {
      header.appendChild(el('span', 'ev-badge ev-auth-fail', mismatchCount + ' text/destination mismatch'));
    }
    wrap.appendChild(header);
    var table = el('div', 'ev-links-table');
    links.forEach(function (l) {
      var row = el('div', 'ev-link-row' + (l.mismatch ? ' mismatch' : ''));
      var textCell = el('div', 'ev-link-text', l.text || '(empty link text)'); // sanitize.js always fills l.text now; kept only as a last-resort safety net
      var hrefCell = el('div', 'ev-link-href', l.href);
      hrefCell.title = l.href;
      var btn = copyBtn(function () { return l.href; }, 'Copy URL');
      row.appendChild(textCell);
      row.appendChild(el('div', 'ev-link-arrow', '→'));
      row.appendChild(hrefCell);
      row.appendChild(btn);
      if (l.mismatch) {
        var warn = el('span', 'ev-badge ev-auth-fail', 'mismatch');
        warn.title = 'Displayed text does not match the actual destination host';
        row.appendChild(warn);
      } else {
        row.appendChild(el('span', null, '')); // keeps the mismatch-badge column aligned across rows
      }
      row.appendChild(scanUrlBtn(l.href));
      var linkHost = null;
      try { linkHost = new URL(l.href).hostname; } catch (e) { /* not a parseable URL */ }
      if (linkHost) row.appendChild(whoisBtn(linkHost));
      table.appendChild(row);
    });
    wrap.appendChild(table);
    return wrap;
  }

  function renderBlockedPanel(urls) {
    var wrap = el('div', 'ev-links-panel');
    if (!urls || urls.length === 0) {
      wrap.appendChild(el('div', 'ev-muted', 'Nothing was blocked.'));
      return wrap;
    }
    var table = el('div', 'ev-links-table');
    urls.forEach(function (u) {
      var row = el('div', 'ev-link-row');
      row.appendChild(el('div', 'ev-link-text', '🚫 blocked'));
      row.appendChild(el('div', 'ev-link-arrow', '→'));
      var hrefCell = el('div', 'ev-link-href', u);
      hrefCell.title = u;
      row.appendChild(hrefCell);
      row.appendChild(copyBtn(function () { return u; }, 'Copy URL'));
      row.appendChild(scanUrlBtn(u));
      table.appendChild(row);
    });
    wrap.appendChild(table);
    return wrap;
  }

  function domainMismatchBadge(a, b, label) {
    if (!a || !b || a === b) return null;
    var badge = el('span', 'ev-badge ev-auth-fail', label + ' mismatch');
    badge.title = a + ' ≠ ' + b;
    return badge;
  }

  /**
   * The same derived "facts" a rule expression sees (js/indexing/indexLogic.js),
   * shown as a human-readable panel so an analyst gets the benefit without
   * writing a rule — domains, mismatches, attachment/URL summaries.
   */
  function renderMetadataPanel(p) {
    var facts = EV.buildRuleFacts(p, { domainCategories: cachedDomainCategories });
    var wrap = el('div', 'ev-metadata-panel');

    function row(label, valueEl) {
      var r = el('div', 'ev-meta-row2');
      r.appendChild(el('div', 'ev-meta-label', label));
      var v = el('div', 'ev-meta-value');
      if (typeof valueEl === 'string') v.textContent = valueEl;
      else if (valueEl) v.appendChild(valueEl);
      else v.textContent = '—';
      r.appendChild(v);
      wrap.appendChild(r);
    }

    function domainWithBadge(addrFact, otherFact, label) {
      if (!addrFact) return null;
      var span = el('span', null, addrFact.domain || addrFact.address);
      var frag = document.createDocumentFragment();
      frag.appendChild(span);
      var badge = otherFact ? domainMismatchBadge(addrFact.domain, otherFact.domain, label) : null;
      if (badge) { frag.appendChild(document.createTextNode(' ')); frag.appendChild(badge); }
      var holder = document.createElement('span');
      holder.appendChild(frag);
      return holder;
    }

    if (facts.from && facts.from.domain) {
      var fromDomainFrag = document.createDocumentFragment();
      fromDomainFrag.appendChild(document.createTextNode(facts.from.domain + '  '));
      fromDomainFrag.appendChild(whoisBtn(facts.from.domain));
      var fromDomainHolder = document.createElement('span');
      fromDomainHolder.appendChild(fromDomainFrag);
      row('From domain', fromDomainHolder);
    } else {
      row('From domain', null);
    }
    row('Recipients', String(facts.recipientCount) + (facts.recipientCount > 1 ? ' (To/Cc/Bcc, deduplicated)' : ''));
    if (facts.replyTo) row('Reply-To domain', domainWithBadge(facts.replyTo, facts.from, 'From/Reply-To'));
    if (facts.returnPath) row('Return-Path domain', domainWithBadge(facts.returnPath, facts.from, 'From/Return-Path'));

    if (facts.attachmentCount) {
      var list = el('div', 'ev-meta-attachment-list');
      facts.attachments.forEach(function (a) {
        list.appendChild(el('div', 'ev-meta-attachment-item',
          a.filename + '  —  ' + (a.ext || 'no ext') + ', ' + fmtBytes(a.size) + (a.isInline ? ' (inline)' : '')));
      });
      row('Attachments (' + facts.attachmentCount + ')', list);
    } else {
      row('Attachments', 'None');
    }
    row('URL domains', facts.urlDomains.length ? facts.urlDomains.join(', ') : 'None');
    if (facts.domainCategories.length) row('Domain categories', facts.domainCategories.join(', '));
    return wrap;
  }

  // ---------- calendar-invite card (text/calendar body part or .ics attachment) ----------

  // A text/calendar body part with no filename/attachment-disposition falls
  // through emlParser.js's deriveParts() into p.attachments (it isn't
  // text/plain or text/html), same as a genuine .ics file attachment — so
  // both of this feature's two real-world cases (inline METHOD=REQUEST part,
  // or an attached .ics file) already show up in the same place. Detect
  // whichever comes first: base64/park mimeType text/calendar or
  // application/ics (ignoring any Content-Type parameters — those were
  // already stripped by parseContentType), or a filename ending in .ics.
  function findCalendarAttachment(p) {
    if (!p.attachments) return null;
    for (var i = 0; i < p.attachments.length; i++) {
      var a = p.attachments[i];
      var mime = (a.mimeType || '').toLowerCase();
      var fname = (a.filename || '').toLowerCase();
      if (mime === 'text/calendar' || mime === 'application/ics' || /\.ics$/.test(fname)) return a;
    }
    return null;
  }

  var ICS_METHOD_TITLES = {
    REQUEST: '📅 Meeting Invite',
    CANCEL: '📅 Meeting Cancelled',
    REPLY: '📅 Meeting Response',
    COUNTER: '📅 Meeting Counter-Proposal',
    DECLINECOUNTER: '📅 Meeting Counter-Proposal Declined',
    REFRESH: '📅 Meeting Refresh Request',
    PUBLISH: '📅 Calendar Event',
    ADD: '📅 Meeting Update'
  };

  function calendarCardTitle(method) {
    if (!method) return '📅 Calendar Invite';
    return ICS_METHOD_TITLES[method] || ('📅 Calendar Invite (' + method + ')');
  }

  function fmtCalAddress(a) {
    if (!a) return '';
    if (a.name && a.email) return a.name + ' <' + a.email + '>';
    return a.name || a.email || '';
  }

  /** Renders the parsed VEVENT as a small bordered summary card. All values
   * are untrusted (attacker-influenced calendar data) and go in via
   * textContent only — never innerHTML. */
  function renderCalendarCard(icsResult) {
    var ev = icsResult.event;
    var card = el('div', 'ev-ics-card');
    card.appendChild(el('div', 'ev-ics-card-title', calendarCardTitle(icsResult.method)));

    function row2(label, text) {
      if (!text) return;
      var r = el('div', 'ev-meta-row2');
      r.appendChild(el('div', 'ev-meta-label', label));
      r.appendChild(el('div', 'ev-meta-value', text));
      card.appendChild(r);
    }

    row2('Summary', ev.summary);
    var when = ev.dtstart ? ev.dtstart.display : '';
    if (ev.dtend) when += (when ? '  →  ' : '') + ev.dtend.display;
    row2('When', when || null);
    row2('Where', ev.location);
    if (ev.organizer) row2('Organizer', fmtCalAddress(ev.organizer));
    if (ev.attendees && ev.attendees.length) {
      row2('Attendees', ev.attendees.map(fmtCalAddress).filter(Boolean).join(', '));
    }
    row2('Status', ev.status);
    row2('Description', ev.description);
    return card;
  }

  /** Finds and parses calendar data on this message, if any — returns null
   * (not an error card) for anything that isn't genuinely calendar data or
   * fails to parse; the Preview tab is meant to look exactly as before for
   * every ordinary, non-calendar email. */
  function findParsedCalendarInvite(p) {
    var att = findCalendarAttachment(p);
    if (!att || !att.bytes || !att.bytes.length) return null;
    var text;
    try {
      text = EV.decodeTextBytes(att.bytes, 'utf-8');
    } catch (e) {
      return null;
    }
    var result;
    try {
      result = EV.parseIcs(text);
    } catch (e) {
      return null;
    }
    return (result && result.ok) ? result : null;
  }

  // ---------- Tag editor ----------

  function renderTagEditor(tab, host) {
    var id = EV.emailId(tab.parsed);
    var wrap = el('div', 'ev-tag-editor');
    var chips = el('div', 'ev-tag-chips');
    var input = el('input', 'ev-tag-input');
    input.type = 'text';
    input.placeholder = '+ add tag';
    wrap.appendChild(chips);
    wrap.appendChild(input);
    host.appendChild(wrap);

    function refresh() {
      EV.tags.get(id).then(function (rec) {
        chips.innerHTML = '';
        var list = (rec && rec.tags) || [];
        list.forEach(function (t) {
          var chip = el('span', 'ev-tag-chip', t);
          chip.style.background = EV.tagColor(t);
          var x = el('span', 'ev-tag-remove', '×');
          x.onclick = function () { EV.tags.removeTag(id, t).then(refresh).then(function(){ if (g.EV.onTagsChanged) g.EV.onTagsChanged(); }); };
          chip.appendChild(x);
          chips.appendChild(chip);
        });
      });
    }
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && input.value.trim()) {
        EV.tags.addTag(id, input.value.trim()).then(function () {
          input.value = '';
          refresh();
          if (g.EV.onTagsChanged) g.EV.onTagsChanged();
        });
      }
    });
    refresh();
  }

  // ---------- sub-tab: Preview ----------

  function ensureInlineBlobUrls(tab) {
    if (tab._blobUrlsCreated) return;
    tab._blobUrlsCreated = true;
    tab.parsed.attachments.forEach(function (a) {
      if (a.contentId) {
        var blob = new Blob([a.bytes], { type: a.mimeType || 'application/octet-stream' });
        a.blobUrl = URL.createObjectURL(blob);
        tab.blobUrls.push(a.blobUrl);
      }
    });
  }

  function renderPreview(tab, container) {
    ensureInlineBlobUrls(tab);
    var p = tab.parsed;
    container.innerHTML = '';

    var head = el('div', 'ev-preview-head');
    var subjectRow = el('div', 'ev-subject');
    subjectRow.appendChild(el('span', null, p.subject || '(no subject)'));
    subjectRow.appendChild(copyBtn(function () { return p.subject || ''; }, 'Copy'));
    head.appendChild(subjectRow);

    var meta = el('div', 'ev-meta-grid');
    function metaRow(label, value) {
      if (!value) return;
      var r = el('div', 'ev-meta-row');
      r.appendChild(el('div', 'ev-meta-label', label));
      r.appendChild(el('div', 'ev-meta-value', value));
      r.appendChild(copyBtn(function () { return value; }, 'Copy'));
      meta.appendChild(r);
    }
    metaRow('From', p.from.map(fmtAddr).join(', '));
    metaRow('To', p.to.map(fmtAddr).join(', '));
    metaRow('Cc', p.cc.map(fmtAddr).join(', '));
    metaRow('Bcc', p.bcc.map(fmtAddr).join(', '));
    metaRow('Date', p.date ? p.date.toString() : p.dateRaw);
    metaRow('Reply-To', p.replyTo.map(fmtAddr).join(', '));
    head.appendChild(meta);

    var authRow = el('div', 'ev-auth-row');
    authRow.appendChild(authBadge('SPF', p.authSummary.spf));
    authRow.appendChild(authBadge('DKIM', p.authSummary.dkim));
    authRow.appendChild(authBadge('DMARC', p.authSummary.dmarc));
    head.appendChild(authRow);

    // Always-on local signals (urgency-language score, financial indicators) -- computed here,
    // not read off a search-index cache, since this tab may be open on a file the index hasn't
    // (re)processed yet. Deliberately just badges, not a dedicated button like Scan URL/WHOIS --
    // these never leave the browser, so there's no reason to gate them behind a click.
    var signalBodyText = (p.textBody || '') + '\n' + EV.htmlToText(p.htmlBody || '');
    var urgencyScore = EV.urgencyScore(signalBodyText);
    var financialIndicators = EV.extractFinancialIndicators(signalBodyText);
    if (urgencyScore > 0 || financialIndicators.length > 0) {
      var signalsRow = el('div', 'ev-signals-row');
      if (urgencyScore > 0) {
        var urgencyBadge = el('span', 'ev-signal-badge ev-signal-urgency', 'Urgency language: ' + urgencyScore);
        urgencyBadge.title = 'Count of distinct urgency/pressure phrases found (e.g. "urgent", "wire transfer", "asap") -- a scored keyword match, not a grammar judgment.';
        signalsRow.appendChild(urgencyBadge);
      }
      financialIndicators.forEach(function (type) {
        signalsRow.appendChild(el('span', 'ev-signal-badge ev-signal-financial', FINANCIAL_INDICATOR_LABELS[type] || type));
      });
      head.appendChild(signalsRow);
    }

    var icsInvite = findParsedCalendarInvite(p);
    if (icsInvite) head.appendChild(renderCalendarCard(icsInvite));

    renderTagEditor(tab, head);

    var toolbar = el('div', 'ev-preview-toolbar');
    var remoteLabel = el('label', 'ev-remote-toggle');
    var remoteCheckbox = document.createElement('input');
    remoteCheckbox.type = 'checkbox';
    remoteCheckbox.checked = tab.allowRemote;
    remoteCheckbox.onchange = function () {
      tab.allowRemote = remoteCheckbox.checked;
      renderPreview(tab, container);
    };
    remoteLabel.appendChild(remoteCheckbox);
    remoteLabel.appendChild(document.createTextNode(' Load remote images/content (off by default for safety)'));
    toolbar.appendChild(remoteLabel);
    if (p.textBody || p.htmlBody) {
      toolbar.appendChild(copyBtn(function () { return p.textBody || EV.htmlToText(p.htmlBody); }, 'Copy body text'));
    }
    head.appendChild(toolbar);

    container.appendChild(head);

    var bodyWrap = el('div', 'ev-body-wrap');
    var iframe = document.createElement('iframe');
    iframe.className = 'ev-body-frame';
    // allow-same-origin (WITHOUT allow-scripts) so blob: URLs for inline cid: images —
    // which are origin-scoped — resolve inside the iframe. No script execution is ever
    // permitted either way, since allow-scripts is never set; DOMPurify + this sandbox
    // together mean this grant carries no meaningful risk (see README security notes).
    iframe.setAttribute('sandbox', 'allow-same-origin');
    iframe.setAttribute('referrerpolicy', 'no-referrer');
    var sanitized;
    var links = [];
    var blockedUrls = [];
    var blockedCount = 0;
    if (p.htmlBody) {
      sanitized = EV.sanitizeEmailHtml(p.htmlBody, p.attachments, { allowRemote: tab.allowRemote });
      links = sanitized.links || [];
      blockedUrls = sanitized.blockedRemoteUrls || [];
      blockedCount = blockedUrls.length;
      iframe.srcdoc = sanitized.html;
    } else if (p.textBody) {
      iframe.srcdoc = EV.plainTextToSafeHtml(p.textBody);
      links = EV.extractUrls(p.textBody, null).map(function (u) { return { text: u, href: u, mismatch: false }; });
    } else {
      iframe.srcdoc = EV.plainTextToSafeHtml('(This message has no readable text or HTML body.)');
    }
    bodyWrap.appendChild(iframe);
    container.appendChild(bodyWrap);

    if (blockedCount) {
      var notice = el('div', 'ev-blocked-notice',
        blockedCount + ' remote resource(s) blocked — hover a placeholder in the body, or see the list below for the URLs. ');
      var showBtn = el('button', 'ev-mini-btn', 'Load anyway');
      showBtn.onclick = function () { tab.allowRemote = true; renderPreview(tab, container); };
      notice.appendChild(showBtn);
      container.insertBefore(notice, bodyWrap);
    }

    if (p.decodeWarnings && p.decodeWarnings.length) {
      var dwNames = p.decodeWarnings.map(function (w) { return w.filename || w.mimeType || 'a part'; }).join(', ');
      var dwNotice = el('div', 'ev-blocked-notice');
      dwNotice.title = 'The raw content-transfer-encoding for this part could not be decoded (corrupt or deliberately malformed base64) — it was skipped rather than shown as empty.';
      dwNotice.textContent = '⚠ ' + p.decodeWarnings.length + ' part(s) failed to decode and were skipped: ' + dwNames + '.';
      container.insertBefore(dwNotice, bodyWrap);
    }

    var metaSection = el('details', 'ev-collapsible');
    metaSection.open = true;
    metaSection.appendChild(el('summary', null, 'Metadata (domains, attachments, URL hosts)'));
    metaSection.appendChild(renderMetadataPanel(p));
    container.appendChild(metaSection);

    var linksSection = el('details', 'ev-collapsible');
    var summary = el('summary', null, 'Links (' + links.length + ')');
    linksSection.appendChild(summary);
    linksSection.appendChild(renderLinksPanel(links));
    container.appendChild(linksSection);

    if (blockedCount) {
      var blockedSection = el('details', 'ev-collapsible');
      blockedSection.appendChild(el('summary', null, 'Blocked remote resources (' + blockedCount + ')'));
      blockedSection.appendChild(renderBlockedPanel(blockedUrls));
      container.appendChild(blockedSection);
    }

    if (p.attachments.length) {
      var attSummary = el('div', 'ev-att-summary',
        '📎 ' + p.attachments.length + ' attachment(s) — see the Attachments tab');
      container.appendChild(attSummary);
    }
  }

  // ---------- sub-tab: Headers ----------

  function renderHeaders(tab, container) {
    container.innerHTML = '';
    var p = tab.parsed;
    var toolbar = el('div', 'ev-headers-toolbar');
    toolbar.appendChild(copyBtn(function () {
      return p.headers.map(function (h) { return h.name + ': ' + h.value; }).join('\n');
    }, 'Copy all headers'));
    container.appendChild(toolbar);

    var authHeaders = EV.getHeaderAll(p.headers, 'authentication-results');
    var received = EV.getHeaderAll(p.headers, 'received');
    if (authHeaders.length || received.length) {
      var sec = el('div', 'ev-security-headers');
      if (authHeaders.length) {
        sec.appendChild(el('div', 'ev-section-title', 'Authentication-Results'));
        authHeaders.forEach(function (v) { sec.appendChild(el('div', 'ev-header-value-block', v)); });
      }
      if (received.length) {
        sec.appendChild(el('div', 'ev-section-title', 'Received chain (' + received.length + ' hops, top = most recent)'));
        received.forEach(function (v, i) {
          var row = el('div', 'ev-received-hop');
          row.appendChild(el('span', 'ev-hop-index', '#' + (i + 1)));
          row.appendChild(el('span', 'ev-header-value-block', v));
          sec.appendChild(row);
        });
      }
      container.appendChild(sec);
    }

    var table = el('div', 'ev-headers-table');
    p.headers.forEach(function (h) {
      var row = el('div', 'ev-header-row');
      row.appendChild(el('div', 'ev-header-name', h.name));
      var valCell = el('div', 'ev-header-value', h.value);
      row.appendChild(valCell);
      var btn = copyBtn(function () { return h.value; }, 'Copy');
      row.appendChild(btn);
      table.appendChild(row);
    });
    container.appendChild(table);
  }

  // ---------- sub-tab: Attachments ----------

  function renderTextAttachmentPreview(att, host) {
    var text = EV.decodeTextBytes(att.bytes, 'utf-8');
    var pre = el('pre', 'ev-attachment-text-preview');
    pre.textContent = text.length > 200000 ? text.slice(0, 200000) + '\n\n… truncated …' : text;
    host.appendChild(pre);
  }

  /** The OCR button/status/output panel for one image attachment -- same interaction pattern as
   * the WHOIS button (disable-while-running, inline status text, never silently blank). Caches the
   * result on the attachment object (att._ocrPromise), mirroring att._sha256Promise above, so
   * re-visiting this sub-tab doesn't lose an in-flight or completed result. */
  function renderOcrPanel(att, path) {
    var wrap = el('div', 'ev-ocr-panel');
    var btn = el('button', 'ev-btn ev-ocr-btn', '🔎 Extract text (OCR)');
    btn.title = 'Runs local OCR on this image — no network call, nothing executed, pixel analysis only. Runs once and caches the result.';
    var statusEl = el('span', 'ev-ocr-status');
    var textHost = el('pre', 'ev-ocr-text-output');
    textHost.style.display = 'none';
    wrap.appendChild(btn);
    wrap.appendChild(statusEl);
    wrap.appendChild(textHost);

    function showResult(text) {
      textHost.textContent = text && text.trim() ? text : '(no text detected)';
      textHost.style.display = 'block';
      statusEl.textContent = '';
    }

    if (att._ocrText !== undefined) {
      btn.textContent = 'Re-run OCR';
      showResult(att._ocrText);
    }

    btn.onclick = function () {
      if (!window.EV.ocr || !window.EV.ocr.isSupported()) {
        statusEl.textContent = 'OCR isn’t available in this browser.';
        return;
      }
      btn.disabled = true;
      statusEl.textContent = 'Running OCR… (first use this session may take a few seconds to load the engine)';
      att._ocrPromise = window.EV.ocr.run(att);
      att._ocrPromise.then(function (text) {
        btn.disabled = false;
        btn.textContent = 'Re-run OCR';
        att._ocrText = text;
        showResult(text);
        // Extends this text's search coverage to the current session's index immediately --
        // covers both a cache-hit (an already-OCR'd attachment from an earlier session) and a
        // freshly-computed result alike, since EV.ocr.run() checks the IndexedDB cache internally.
        if (path && window.EV.onOcrTextReady) window.EV.onOcrTextReady(path, text);
      }).catch(function (err) {
        btn.disabled = false;
        statusEl.textContent = 'OCR failed: ' + (err && err.message || 'unknown error');
      });
    };
    return wrap;
  }

  function renderAttachments(tab, container) {
    container.innerHTML = '';
    var p = tab.parsed;
    if (!p.attachments.length) {
      container.appendChild(el('div', 'ev-muted', 'No attachments in this message.'));
      return;
    }
    var firstMeaningfulImage = pickFirstMeaningfulImageAttachment(p.attachments);
    p.attachments.forEach(function (att, idx) {
      var card = el('div', 'ev-attachment-card');
      var head = el('div', 'ev-attachment-head');
      head.appendChild(el('span', 'ev-attachment-name', att.filename));
      head.appendChild(el('span', 'ev-attachment-meta',
        (att.isInline ? 'inline · ' : '') + att.mimeType + ' · ' + fmtBytes(att.size)));
      card.appendChild(head);

      var actions = el('div', 'ev-attachment-actions');
      var dlBtn = el('button', 'ev-btn', 'Download');
      dlBtn.onclick = function () { downloadBlob(att.bytes, att.filename, att.mimeType); };
      actions.appendChild(dlBtn);

      var vtBtn = el('button', 'ev-btn ev-vt-btn', '🛡 VirusTotal');
      vtBtn.title = 'Look up this file’s SHA-256 on VirusTotal (opens in a new tab; nothing is uploaded, only the hash is looked up)';
      vtBtn.style.display = 'none';
      actions.appendChild(vtBtn);

      var hashSpan = el('span', 'ev-attachment-hash', 'sha256: computing…');
      hashSpan.title = 'SHA-256 of this attachment\'s raw bytes — computed once and cached, not recomputed on every visit to this tab.';
      actions.appendChild(hashSpan);
      // Cache the promise itself (not just its resolved value) on the
      // attachment object, mirroring _previewBlobUrl below — re-visiting this
      // tab used to recompute the hash from scratch every time, which is
      // wasteful on a message with large attachments.
      if (!att._sha256Promise) att._sha256Promise = sha256Hex(att.bytes);
      att._sha256Promise.then(function (hex) {
        if (hex) {
          hashSpan.textContent = 'sha256: ' + hex;
          vtBtn.style.display = 'inline-block';
          vtBtn.onclick = function () {
            window.open('https://www.virustotal.com/gui/file/' + hex, '_blank', 'noopener,noreferrer');
          };
        } else {
          hashSpan.textContent = 'sha256: unavailable (serve over http(s) to enable)';
        }
      });
      card.appendChild(actions);

      if (/^image\//.test(att.mimeType) && att.size < 8 * 1024 * 1024) {
        if (!att._previewBlobUrl) {
          att._previewBlobUrl = URL.createObjectURL(new Blob([att.bytes], { type: att.mimeType }));
          tab.blobUrls.push(att._previewBlobUrl);
        }
        var img = document.createElement('img');
        img.className = 'ev-attachment-image-preview';
        img.src = att._previewBlobUrl;
        card.appendChild(img);
        // "First image" = first one over a tiny-tracking-pixel size floor, inline or attached
        // alike -- inline (cid:) images are often exactly where a real phishing screenshot lives
        // (e.g. an entire fake login page embedded as one image), not just tracking pixels/logos,
        // so the inline flag alone was never the right signal to skip on.
        if (att === firstMeaningfulImage) {
          card.appendChild(renderOcrPanel(att, tab.path));
        }
      } else if (/^text\/(plain|csv)$/.test(att.mimeType) || /\.(txt|csv|log|json)$/i.test(att.filename)) {
        renderTextAttachmentPreview(att, card);
      } else if (att.mimeType === 'text/html' || /\.html?$/i.test(att.filename)) {
        var warn = el('div', 'ev-muted', 'HTML attachment — shown as inert source text only, never rendered:');
        card.appendChild(warn);
        renderTextAttachmentPreview(att, card);
      }
      container.appendChild(card);
    });
  }

  // ---------- sub-tab: text-body / html-body (decoded MIME parts, verbatim) ----------

  function renderDecodedPartView(text, emptyMessage, container, note) {
    container.innerHTML = '';
    if (note) container.appendChild(el('div', 'ev-muted', note));
    var toolbar = el('div', 'ev-raw-toolbar');
    toolbar.appendChild(copyBtn(function () { return text || ''; }, 'Copy'));
    container.appendChild(toolbar);

    if (!text) {
      container.appendChild(el('div', 'ev-muted', emptyMessage));
      return;
    }
    var pre = el('pre', 'ev-raw-view');
    var lines = text.split(/\r\n|\r|\n/);
    var frag = document.createDocumentFragment();
    var MAX_LINES = 20000;
    lines.slice(0, MAX_LINES).forEach(function (line, i) {
      var row = document.createElement('div');
      row.className = 'ev-raw-line';
      row.setAttribute('data-line', String(i + 1));
      row.textContent = line;
      frag.appendChild(row);
    });
    pre.appendChild(frag);
    if (lines.length > MAX_LINES) {
      pre.appendChild(el('div', 'ev-muted', '… truncated at ' + MAX_LINES + ' lines (' + lines.length + ' total).'));
    }
    container.appendChild(pre);
  }

  /**
   * The visible text of the email — the decoded text/plain part verbatim
   * when there is one, otherwise the readable text extracted from the
   * HTML part (so this tab always shows "what a human would read as text"
   * rather than just reporting that no text/plain part exists).
   */
  function renderTextBody(tab, container) {
    var p = tab.parsed;
    if (p.textBody) {
      renderDecodedPartView(p.textBody, '', container);
      return;
    }
    if (p.htmlBody) {
      renderDecodedPartView(EV.htmlToText(p.htmlBody), '', container,
        'No text/plain part in this message — showing text extracted from the HTML body instead:');
      return;
    }
    renderDecodedPartView(null, 'This message has no readable text.', container);
  }

  /**
   * The decoded text/html MIME part's raw source, verbatim and un-rendered —
   * useful for spotting things a sanitized Preview hides on purpose (hidden
   * elements, tracking pixels, obfuscated markup) or where the plain-text
   * and HTML parts of a multipart/alternative message tell different
   * stories. Always shown as inert escaped text, never executed.
   */
  function renderHtmlBody(tab, container) {
    renderDecodedPartView(tab.parsed.htmlBody, 'This message has no text/html part.', container);
  }

  // ---------- sub-tab: Raw ----------

  function renderRaw(tab, container) {
    container.innerHTML = '';
    var p = tab.parsed;
    var toolbar = el('div', 'ev-raw-toolbar');
    toolbar.appendChild(copyBtn(function () { return p.raw; }, 'Copy raw source'));
    var dlBtn = el('button', 'ev-btn', 'Download original .eml');
    dlBtn.onclick = function () { downloadBlob(EV.binaryStringToBytes(p.raw), tab.name, 'message/rfc822'); };
    toolbar.appendChild(dlBtn);
    container.appendChild(toolbar);

    var pre = el('pre', 'ev-raw-view');
    var lines = p.raw.split(/\r\n|\r|\n/);
    var frag = document.createDocumentFragment();
    var MAX_LINES = 20000;
    lines.slice(0, MAX_LINES).forEach(function (line, i) {
      var row = document.createElement('div');
      row.className = 'ev-raw-line';
      row.setAttribute('data-line', String(i + 1));
      row.textContent = line;
      frag.appendChild(row);
    });
    pre.appendChild(frag);
    if (lines.length > MAX_LINES) {
      pre.appendChild(el('div', 'ev-muted', '… truncated at ' + MAX_LINES + ' lines (' + lines.length + ' total); download the original to see everything.'));
    }
    container.appendChild(pre);
  }

  // ---------- top-level: render a whole tab ----------

  var SUBTAB_ORDER = ['preview', 'headers', 'textbody', 'htmlbody', 'attachments', 'raw'];
  var SUBTAB_LABELS = { preview: 'Preview', headers: 'Headers', textbody: 'text-body', htmlbody: 'html-body', attachments: 'Attachments', raw: 'Raw' };
  var SUBTAB_RENDERERS = {
    preview: renderPreview, headers: renderHeaders, textbody: renderTextBody,
    htmlbody: renderHtmlBody, attachments: renderAttachments, raw: renderRaw
  };

  EV.renderTab = function (tab, elements) {
    // elements: { subtabNav, content, loading }
    function showLoading(msg) {
      elements.content.innerHTML = '';
      elements.loading.style.display = 'flex';
      elements.loading.textContent = msg;
    }
    function hideLoading() {
      elements.loading.style.display = 'none';
    }

    function renderSubtabNav() {
      elements.subtabNav.innerHTML = '';
      SUBTAB_ORDER.forEach(function (key) {
        var label = SUBTAB_LABELS[key] + (key === 'attachments' && tab.parsed ? ' (' + tab.parsed.attachments.length + ')' : '');
        var btn = el('button', 'ev-subtab-btn' + (tab.activeSubTab === key ? ' active' : ''), label);
        btn.onclick = function () {
          tab.activeSubTab = key;
          renderSubtabNav();
          renderContent();
        };
        elements.subtabNav.appendChild(btn);
      });
    }

    function renderContent() {
      var fn = SUBTAB_RENDERERS[tab.activeSubTab] || renderPreview;
      fn(tab, elements.content);
    }

    renderSubtabNav();

    if (tab.parsed) {
      hideLoading();
      renderContent();
      return;
    }
    if (tab.parseError) {
      hideLoading();
      elements.content.innerHTML = '';
      elements.content.appendChild(el('div', 'ev-error', 'Failed to parse this email: ' + tab.parseError));
      return;
    }
    showLoading('Parsing ' + tab.name + '…');
    tab.entry.getBytes().then(function (buf) {
      tab.parsed = EV.parseEml(buf);
      hideLoading();
      renderSubtabNav();
      renderContent();
      if (elements.onParsed) elements.onParsed(tab);
    }).catch(function (err) {
      tab.parseError = String(err && err.message || err);
      hideLoading();
      elements.content.innerHTML = '';
      elements.content.appendChild(el('div', 'ev-error', 'Failed to parse this email: ' + tab.parseError));
      if (elements.onParsed) elements.onParsed(tab);
    });
  };
})(typeof self !== 'undefined' ? self : this);
