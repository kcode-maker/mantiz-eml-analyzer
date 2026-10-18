/**
 * render.js — renders one open tab (a parsed email) into the right pane:
 * Preview / Headers / Attachments / Raw. Owns creation/revocation of the
 * blob: URLs used for inline (cid:) images and attachment downloads.
 */
(function (g) {
  'use strict';
  var EV = g.EV || (g.EV = {});
  EV.ui = EV.ui || {};
  // Shared DOM helpers (js/ui/uiKit.js) and the cached Settings lists (js/core/settingsCache.js).
  var el = EV.ui.el, fmtBytes = EV.ui.fmtBytes, fmtAddr = EV.ui.fmtAddr, copyBtn = EV.ui.copyBtn, downloadBlob = EV.ui.downloadBlob;


  var FINANCIAL_INDICATOR_LABELS = {
    iban: 'IBAN', swift_bic: 'SWIFT/BIC code', routing_number: 'Bank routing number',
    crypto_wallet_btc: 'BTC wallet address', crypto_wallet_eth: 'ETH wallet address',
    gift_card_request: 'Gift card request'
  };

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
   * URL" button — see ARCHITECTURE.md's Security model for why resolving redirects
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
   * itself"; see js/core/whois.js's header comment and ARCHITECTURE.md's Security model. Explicit per-click,
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
    var facts = EV.buildRuleFacts(p, { domainCategories: EV.settingsCache.domainCategories(), trustedDomains: EV.settingsCache.trustedDomains() });
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
    row('Recipients (Count)', String(facts.recipientCount) + (facts.recipientCount > 1 ? ' (To/Cc/Bcc, deduplicated)' : ''));
    if (facts.replyTo) row('Reply-To domain', domainWithBadge(facts.replyTo, facts.from, 'From/Reply-To'));
    if (facts.returnPath) row('Return-Path domain', domainWithBadge(facts.returnPath, facts.from, 'From/Return-Path'));
    if (facts.connectingIp) {
      var ipWrap = el('span', 'ev-ip-line');
      ipWrap.appendChild(el('span', 'ev-ip-val', facts.connectingIp));
      ipWrap.appendChild(copyBtn(function () { return facts.connectingIp; }, 'Copy'));
      if (facts.originIp && facts.originIp !== facts.connectingIp) ipWrap.appendChild(el('span', 'ev-muted-small', ' (earliest public IP in the chain: ' + facts.originIp + ')'));
      row('Connecting IP', ipWrap);
    }

    if (facts.attachmentCount) {
      var list = el('div', 'ev-meta-attachment-list');
      // One row per attachment, as three aligned columns: name | type | size (the list is one shared grid, so the
      // columns line up across rows however long a name is; a long name wraps inside its own column).
      facts.attachments.forEach(function (a) {
        var item = el('div', 'ev-meta-attachment-item', null); // display: contents -- its 3 cells are grid cells of the list
        var nameCell = el('span', 'ev-att-name', null);
        var q = a.filename ? EV.searchQueryFor('attachment.filename', a.filename) : '';
        // The name is a clickable tag: it searches every email with an attachment of that name (the query stays
        // editable in the search box, e.g. turn it into attachment.filename:/Inv-.*\.pdf$/i).
        if (q) nameCell.appendChild(searchTag(a.filename, q, 'Search all emails with an attachment named like this'));
        else nameCell.textContent = a.filename || '(unnamed)';
        item.appendChild(nameCell);
        item.appendChild(el('span', 'ev-att-ext', a.ext || 'no ext'));
        item.appendChild(el('span', 'ev-att-size', fmtBytes(a.size) + (a.isInline ? ' · inline' : '')));
        list.appendChild(item);
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
    input.title = 'Lowercase a\u2013z, 0\u20139, - and _ only. Press Enter to add.';
    wrap.appendChild(chips);
    wrap.appendChild(input);
    host.appendChild(wrap);
    var currentTags = [];
    // Existing tag names as you type (skipping ones this email already has); app.js provides the list.
    if (EV.searchSuggest && EV.searchSuggest.attachTagInput) {
      EV.searchSuggest.attachTagInput(input, function () { return g.EV.getTagNames ? g.EV.getTagNames() : []; }, function () { return currentTags; });
    }

    function refresh() {
      EV.tags.get(id).then(function (rec) {
        chips.innerHTML = '';
        var list = (rec && rec.tags) || [];
        currentTags = list;
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
    var tagCheck = EV.tagInput ? EV.tagInput.bind(input) : null;
    input.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || !input.value.trim()) return;
      var name = tagCheck ? tagCheck.check() : input.value.trim();
      if (!name) return; // invalid: the box says why
      EV.tags.addTag(id, name).then(function () {
        input.value = '';
        if (tagCheck) tagCheck.reset();
        refresh();
        if (g.EV.onTagsChanged) g.EV.onTagsChanged();
      }).catch(function () { /* addTag only rejects an invalid name, already reported above */ });
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

  // ---------- remote content: ONE switch for every email ----------
  // Off by default. Turning it on applies to every email you open afterwards (each tab re-renders when you
  // switch to it, so they all follow), turning it off applies to all again. It lives in memory only: a page
  // reload, or opening a different folder (app.js calls reset), puts it back to the safe default. The
  // status bar shows a standing "Remote content: ON" chip while it is on, because loading remote content
  // tells a sender you opened their message.
  var remoteContentOn = false;
  var remoteConfirmPending = false; // a double-click must not queue two confirmations
  EV.remoteContent = {
    isOn: function () { return remoteContentOn; },
    set: function (on) {
      on = !!on;
      if (on === remoteContentOn) return;
      remoteContentOn = on;
      if (typeof EV.remoteContent.onChange === 'function') EV.remoteContent.onChange(on);
    },
    onChange: null
  };

  // ---------- click a Subject / From / To ... to search for it ----------
  /** Builds a decoded-search query for "everything with this value in `field`" (e.g. header.subject). The query
   * grammar has no escape for a double quote inside a quoted phrase, so the value is split at any quote and the
   * pieces are ANDed -- always a valid query, and easy to edit afterwards. Returns '' for an empty value. */
  function queryPieces(field, value) {
    // Inner spacing is kept exactly as in the email (the stored subject keeps it too, so collapsing runs of
    // spaces would make the search miss the very email that was clicked); only line breaks/tabs become spaces
    // (a search box is one line) and the ends are trimmed.
    return String(value == null ? '' : value).split('"').map(function (s) { return s.replace(/[\r\n\t]/g, ' ').trim(); })
      .filter(function (s) { return s; }).map(function (s) { return field + ':"' + s + '"'; });
  }
  EV.searchQueryFor = function (field, value) { return queryPieces(field, value).join(' '); };

  /** "Any of these values" in `field` (a To/Cc list): one value is just that query; several become an editable
   * `(a OR b OR c)` group. Empty values are skipped; no usable value gives ''. */
  EV.searchQueryForAny = function (field, values) {
    var parts = [];
    (values || []).forEach(function (v) {
      var pcs = queryPieces(field, v);
      if (pcs.length) parts.push(pcs.length > 1 ? '(' + pcs.join(' ') + ')' : pcs[0]);
    });
    if (!parts.length) return '';
    return parts.length === 1 ? parts[0] : '(' + parts.join(' OR ') + ')';
  };

  /** A field label ("Subject", "From", "To"...) as a small clickable tag that hands `query` to the Search tab
   * (app.js's EV.searchFor), which fills the search box and runs it; the query stays editable there. The value
   * next to it stays plain, selectable text. */
  function searchTag(label, query, title) {
    var b = el('button', 'ev-search-tag', null);
    b.appendChild(EV.iconEl('magnifier', 'ev-search-tag-icon', 10));
    b.appendChild(document.createTextNode(label));
    b.type = 'button';
    b.title = title + '\n(' + query + ')';
    b.onclick = function () { if (query && typeof EV.searchFor === 'function') EV.searchFor(query); };
    return b;
  }

  // ---------- link-hover bar ----------
  // Hovering (or keyboard-focusing) a link in the email body shows its REAL destination in a bar just above
  // the status bar, in full and wrapped, instead of relying on the browser's own link bubble (which sits at
  // the bottom-left, over the status bar's text, and cuts long URLs short). Display only: textContent, never
  // innerHTML, and nothing is fetched or opened (the standing "never follow a link" rule).
  var linkBar = null;
  function getLinkBar() {
    if (linkBar) return linkBar;
    linkBar = el('div', 'ev-link-hover-bar');
    linkBar.setAttribute('role', 'status');
    linkBar.style.display = 'none';
    document.body.appendChild(linkBar);
    return linkBar;
  }
  function hideLinkBar() { if (linkBar) linkBar.style.display = 'none'; }
  EV.hideLinkHoverBar = hideLinkBar;
  function showLinkBar(a) {
    var bar = getLinkBar();
    var mismatch = a.classList.contains('ev-link-mismatch');
    bar.className = 'ev-link-hover-bar' + (mismatch ? ' mismatch' : '');
    // sanitize.js already put the real destination (and, for a deceptive link, what the text claimed) in title
    bar.textContent = (mismatch ? '\u26A0 ' : '\u2192 ') + (a.getAttribute('title') || a.getAttribute('href') || '');
    bar.appendChild(el('span', 'ev-link-hover-hint', '   \u2014 click to copy the link'));
    bar.style.display = ''; // CSS decides (a clamped box)
  }
  /** Clicking a link COPIES its address; it never opens it. (The body is sandboxed and could not open it
   * anyway, so a "link" cursor with a dead click felt broken.) Tries the iframe's clipboard first, since that
   * is the focused document after a click inside it, then the page's. */
  function copyLinkAddress(iframe, a) {
    var href = a.getAttribute('href') || '';
    function done(ok) {
      var bar = getLinkBar();
      bar.className = 'ev-link-hover-bar' + (ok ? ' copied' : ' mismatch');
      bar.textContent = ok ? '\u2713 Link copied to clipboard: ' + href : 'Could not copy automatically \u2014 select the link in the Links panel below.';
      bar.style.display = '';
    }
    function viaPage() {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(href).then(function () { done(true); }, function () { done(false); });
      else done(false);
    }
    try {
      var cw = iframe.contentWindow;
      if (cw && cw.navigator && cw.navigator.clipboard && cw.navigator.clipboard.writeText) {
        cw.navigator.clipboard.writeText(href).then(function () { done(true); }, viaPage);
        return;
      }
    } catch (e) { /* fall through */ }
    viaPage();
  }

  function attachLinkHover(iframe) {
    iframe.addEventListener('load', function () {
      var doc = iframe.contentDocument;
      if (!doc) return;
      // Never navigate (the sandbox already refuses); copy instead. Covers click, Enter on a focused link
      // (which fires a click) and middle-click.
      doc.addEventListener('click', function (e) { var a = e.target && e.target.closest ? e.target.closest('a[href]') : null; if (a) { e.preventDefault(); copyLinkAddress(iframe, a); } });
      doc.addEventListener('auxclick', function (e) { var a = e.target && e.target.closest ? e.target.closest('a[href]') : null; if (a) e.preventDefault(); });
      function linkOf(e) { return e.target && e.target.closest ? e.target.closest('a[href]') : null; }
      doc.addEventListener('mouseover', function (e) { var a = linkOf(e); if (a) showLinkBar(a); });
      doc.addEventListener('mouseout', function (e) { if (linkOf(e)) hideLinkBar(); });
      doc.addEventListener('focusin', function (e) { var a = linkOf(e); if (a) showLinkBar(a); });
      doc.addEventListener('focusout', function (e) { if (linkOf(e)) hideLinkBar(); });
      doc.addEventListener('scroll', hideLinkBar, true);
    });
    iframe.addEventListener('mouseleave', hideLinkBar);
  }

  /** One glass card of the Preview bento grid. `kind` is 'details' for a collapsible card (its title is the
   * <summary>), else a plain section. Pure layout: callers append the SAME elements they always built. */
  function bentoCard(cls, iconName, title, kind) {
    var collapsible = kind === 'details';
    var root = el(collapsible ? 'details' : 'section', 'ev-card ' + cls);
    var header = el(collapsible ? 'summary' : 'div', 'ev-card-title');
    header.appendChild(EV.iconEl(iconName, 'ev-card-icon', 14));
    header.appendChild(el('span', null, title));
    root.appendChild(header);
    var body = el('div', 'ev-card-body');
    root.appendChild(body);
    return { root: root, header: header, body: body };
  }

  function renderPreview(tab, container) {
    ensureInlineBlobUrls(tab);
    var p = tab.parsed;
    container.innerHTML = '';

    // Bento grid: Message + Security on top, body beside the metadata, then links/blocked/attachments.
    var bentoWrap = el('div', 'ev-bento-wrap');
    var bento = el('div', 'ev-bento');
    bentoWrap.appendChild(bento);
    container.appendChild(bentoWrap);
    var msgCard = bentoCard('ev-card-msg', 'mail', 'Message');
    var secCard = bentoCard('ev-card-sec', 'shield', 'Security');
    var checksCard = bentoCard('ev-card-checks', 'shield', 'Security checks');
    bento.appendChild(msgCard.root);
    bento.appendChild(secCard.root);
    bento.appendChild(checksCard.root);
    EV.ui.renderSecurityChecks(checksCard, p);

    var subjectLabel = el('div', 'ev-card-sub', p.subject ? null : 'Subject');
    if (p.subject) subjectLabel.appendChild(searchTag('Subject', EV.searchQueryFor('header.subject', p.subject), 'Search all emails with this subject'));
    msgCard.body.appendChild(subjectLabel);
    var subjectRow = el('div', 'ev-subject');
    subjectRow.appendChild(el('span', null, p.subject || '(no subject)'));
    subjectRow.appendChild(copyBtn(function () { return p.subject || ''; }, 'Copy'));
    msgCard.body.appendChild(subjectRow);
    var origin = EV.classifyOrigin(p, EV.settingsCache.internalDomains());
    if (origin.state !== 'unconfigured') {
      var ORIGIN_PILL = { internal: ['Internal', 'ok'], external: ['External', 'ext'], unverified: ['Internal domain \u2014 path unverified', 'note'], 'claims-internal': ['Claims to be internal \u2014 came from outside', 'flag'] };
      var pill = el('span', 'ev-origin-pill ev-origin-' + ORIGIN_PILL[origin.state][1], ORIGIN_PILL[origin.state][0]);
      pill.title = origin.detail;
      var pillRow = el('div', 'ev-origin-row'); pillRow.appendChild(pill);
      msgCard.body.appendChild(pillRow);
    }

    var meta = el('div', 'ev-meta-grid');
    // For address rows the LABEL is a clickable tag: it searches `field` for any of the row's addresses.
    function metaRow(label, value, addrs, field, what) {
      if (!value) return;
      var r = el('div', 'ev-meta-row');
      var labelEl = el('div', 'ev-meta-label', null);
      var query = addrs ? EV.searchQueryForAny(field, addrs.map(function (a) { return a.address || a.name || ''; })) : '';
      if (query) labelEl.appendChild(searchTag(label, query, 'Search all emails with ' + (addrs.length > 1 ? 'any of these ' + what + 's' : 'this ' + what)));
      else labelEl.textContent = label;
      r.appendChild(labelEl);
      r.appendChild(el('div', 'ev-meta-value', value));
      r.appendChild(copyBtn(function () { return value; }, 'Copy'));
      meta.appendChild(r);
    }
    metaRow('From', p.from.map(fmtAddr).join(', '), p.from, 'header.from', 'sender');
    metaRow('To', p.to.map(fmtAddr).join(', '), p.to, 'header.to', 'recipient');
    metaRow('Cc', p.cc.map(fmtAddr).join(', '), p.cc, 'header.cc', 'Cc recipient');
    metaRow('Bcc', p.bcc.map(fmtAddr).join(', '), p.bcc, 'header.bcc', 'Bcc recipient');
    metaRow('Date', p.date ? p.date.toString() : p.dateRaw);
    metaRow('Reply-To', p.replyTo.map(fmtAddr).join(', '), p.replyTo, 'header.replyto', 'Reply-To address');
    msgCard.body.appendChild(meta);

    secCard.body.appendChild(el('div', 'ev-card-sub', 'Authentication'));
    var authRow = el('div', 'ev-auth-row');
    authRow.appendChild(authBadge('SPF', p.authSummary.spf));
    authRow.appendChild(authBadge('DKIM', p.authSummary.dkim));
    authRow.appendChild(authBadge('DMARC', p.authSummary.dmarc));
    secCard.body.appendChild(authRow);

    // Always-on local signals (urgency-language score, financial indicators) -- computed here,
    // not read off a search-index cache, since this tab may be open on a file the index hasn't
    // (re)processed yet. Deliberately just badges, not a dedicated button like Scan URL/WHOIS --
    // these never leave the browser, so there's no reason to gate them behind a click.
    var signalBodyText = (p.textBody || '') + '\n' + EV.htmlToText(p.htmlBody || '');
    var urgencyScore = EV.urgencyScore(signalBodyText);
    var financialIndicators = EV.extractFinancialIndicators(signalBodyText);
    if (urgencyScore > 0 || financialIndicators.length > 0) {
      secCard.body.appendChild(el('div', 'ev-card-sub', 'Signals'));
      var signalsRow = el('div', 'ev-signals-row');
      if (urgencyScore > 0) {
        var urgencyBadge = el('span', 'ev-signal-badge ev-signal-urgency', 'Urgency language: ' + urgencyScore);
        urgencyBadge.title = 'Count of distinct urgency/pressure phrases found (e.g. "urgent", "wire transfer", "asap") -- a scored keyword match, not a grammar judgment.';
        signalsRow.appendChild(urgencyBadge);
      }
      financialIndicators.forEach(function (type) {
        signalsRow.appendChild(el('span', 'ev-signal-badge ev-signal-financial', FINANCIAL_INDICATOR_LABELS[type] || type));
      });
      secCard.body.appendChild(signalsRow);
    }

    var icsInvite = findParsedCalendarInvite(p);
    if (icsInvite) msgCard.body.appendChild(renderCalendarCard(icsInvite));

    secCard.body.appendChild(el('div', 'ev-card-sub', 'Tags'));
    renderTagEditor(tab, secCard.body);

    var bodyCard = bentoCard('ev-card-reader', 'file', 'Message body');
    bento.appendChild(bodyCard.root);
    var toolbar = el('div', 'ev-preview-toolbar');
    var remoteLabel = el('label', 'ev-remote-toggle');
    var remoteCheckbox = document.createElement('input');
    remoteCheckbox.type = 'checkbox';
    remoteCheckbox.checked = remoteContentOn;
    remoteCheckbox.onchange = function () {
      if (!remoteCheckbox.checked) { // turning it off needs no confirmation
        EV.remoteContent.set(false);
        renderPreview(tab, container);
        return;
      }
      remoteCheckbox.checked = false; // stays off until confirmed (an in-app dialog: native confirm() is not shown in every host)
      if (remoteConfirmPending) return;
      remoteConfirmPending = true;
      EV.confirmDialog({
        title: 'Load remote content for all emails?',
        message: 'Senders can see that you opened their message (tracking pixels, your IP address).\n\n' +
          'It stays on for every email you open until you untick it, open a different folder, or reload the page.',
        confirmLabel: 'Load for all emails'
      }).then(function (ok) {
        remoteConfirmPending = false;
        if (!ok) return;
        remoteCheckbox.checked = true;
        EV.remoteContent.set(true);
        renderPreview(tab, container);
      });
    };
    remoteLabel.appendChild(remoteCheckbox);
    remoteLabel.appendChild(document.createTextNode(remoteContentOn
      ? ' Load remote images/content \u2014 ON for all emails (untick to turn off for all)'
      : ' Load remote images/content (off by default for safety; ticking applies to all emails)'));
    toolbar.appendChild(remoteLabel);
    if (p.textBody || p.htmlBody) {
      toolbar.appendChild(copyBtn(function () { return p.textBody || EV.htmlToText(p.htmlBody); }, 'Copy body text'));
    }
    bodyCard.body.appendChild(toolbar);

    var bodyWrap = el('div', 'ev-body-wrap');
    var iframe = document.createElement('iframe');
    iframe.className = 'ev-body-frame';
    // allow-same-origin (WITHOUT allow-scripts) so blob: URLs for inline cid: images —
    // which are origin-scoped — resolve inside the iframe. No script execution is ever
    // permitted either way, since allow-scripts is never set; DOMPurify + this sandbox
    // together mean this grant carries no meaningful risk (see ARCHITECTURE.md's Security model).
    iframe.setAttribute('sandbox', 'allow-same-origin');
    iframe.setAttribute('referrerpolicy', 'no-referrer');
    attachLinkHover(iframe);
    hideLinkBar(); // a re-render (or another tab) must never leave a stale URL showing
    var sanitized;
    var links = [];
    var blockedUrls = [];
    var blockedCount = 0;
    if (p.htmlBody) {
      sanitized = EV.sanitizeEmailHtml(p.htmlBody, p.attachments, { allowRemote: remoteContentOn });
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
    bodyCard.body.appendChild(bodyWrap);

    if (blockedCount) {
      var notice = el('div', 'ev-blocked-notice',
        blockedCount + ' remote resource(s) blocked — hover a placeholder in the body, or see the list below for the URLs. ');
      var showBtn = el('button', 'ev-mini-btn', 'Load for all emails');
      showBtn.onclick = function () { remoteCheckbox.checked = true; remoteCheckbox.onchange(); };
      notice.appendChild(showBtn);
      bodyCard.body.insertBefore(notice, bodyWrap);
    }

    if (p.decodeWarnings && p.decodeWarnings.length) {
      var dwNames = p.decodeWarnings.map(function (w) { return w.filename || w.mimeType || 'a part'; }).join(', ');
      var dwNotice = el('div', 'ev-blocked-notice');
      dwNotice.title = 'The raw content-transfer-encoding for this part could not be decoded (corrupt or deliberately malformed base64) — it was skipped rather than shown as empty.';
      dwNotice.textContent = '⚠ ' + p.decodeWarnings.length + ' part(s) failed to decode and were skipped: ' + dwNames + '.';
      bodyCard.body.insertBefore(dwNotice, bodyWrap);
    }

    var metaCard = bentoCard('ev-card-meta', 'info', 'Metadata', 'details');
    metaCard.header.title = 'Domains, recipients, attachments and URL hosts';
    metaCard.root.open = true;
    metaCard.body.appendChild(renderMetadataPanel(p));
    bento.appendChild(metaCard.root);

    var linksCard = bentoCard('ev-card-wide', 'link', 'Links (' + links.length + ')', 'details');
    linksCard.body.appendChild(renderLinksPanel(links));
    bento.appendChild(linksCard.root);

    if (blockedCount) {
      var blockedCard = bentoCard('ev-card-wide', 'alert', 'Blocked remote resources (' + blockedCount + ')', 'details');
      blockedCard.body.appendChild(renderBlockedPanel(blockedUrls));
      bento.appendChild(blockedCard.root);
    }

    if (p.attachments.length) {
      var attSummary = el('div', 'ev-att-summary ev-card-wide ev-card-note',
        '📎 ' + p.attachments.length + ' attachment(s) — see the Attachments tab');
      bento.appendChild(attSummary);
    }
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
    preview: renderPreview, headers: EV.ui.renderHeaders, textbody: renderTextBody,
    htmlbody: renderHtmlBody, attachments: EV.ui.renderAttachments, raw: renderRaw
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
