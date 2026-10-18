/**
 * searchPanel.js — the Search panel: query running (decoded and raw), the autocomplete wiring, results list with multi-select and bulk actions, the shared results view used by Tags/Rules, the match-case/regex toggles, the include/exclude filter and IOC export.
 */
(function (g) {
  'use strict';
  var EV = g.EV || (g.EV = {});
  EV.ui = EV.ui || {};
  EV.ui.features = EV.ui.features || {};

  EV.ui.features.searchPanel = function createSearchPanel(ctx) {
    var state = ctx.state, els = ctx.els, searchIdx = ctx.searchIdx, rawSearchObj = ctx.rawSearchObj;
    var fmtBytesShort = EV.ui.fmtBytesShort;
    // Exported to the other features (function declarations are hoisted, so these are valid before their definitions).
    ctx.clearSearchResults = clearSearchResults;
    ctx.refreshSuggestTagNames = refreshSuggestTagNames;
    ctx.updateSearchSelectionBar = updateSearchSelectionBar;

    // Called from render.js right after EV.ocr.run(att) resolves (cache-hit or freshly-
    // computed alike) -- pushes the extracted text into the LIVE search index immediately,
    // no re-indexing pass needed. Deliberately does not re-run the current search itself;
    // attachment.ocr: only ever reflects what's been indexed as of when a search is run.
    window.EV.onOcrTextReady = function (path, text) {
      searchIdx.addOcrText(path, text);
    };


    // "Match Case" / "Use Regular Expression" toggle buttons, VS Code-style (a plain on/off
    // state each, not three mutually-exclusive options) -- shared between Decoded and Raw
    // search, since both modes now support them.
    function isToggleActive(btn) { return btn.classList.contains('active'); }

    function setToggleActive(btn, active) { btn.classList.toggle('active', active); }

    [els.search_case, els.search_regex].forEach(function (btn) {
      btn.addEventListener('click', function () {
        setToggleActive(btn, !isToggleActive(btn));
        updateSearchOptionsHint();
      });
    });

    var searchSuggest = null; // the search box's autocomplete (js/ui/searchSuggest.js), attached below

    function updateSearchOptionsHint() {
      if (searchSuggest) searchSuggest.close(); // mode / Use Regex just changed -- re-evaluate on the next keystroke
      var raw = els.search_mode.value === 'raw';
      var caseSensitive = isToggleActive(els.search_case);
      var isRegex = isToggleActive(els.search_regex);
      if (raw || (!caseSensitive && !isRegex)) { els.search_options_hint.textContent = ''; return; }
      els.search_options_hint.textContent = isRegex
        ? 'Regex mode matches header.subject/from/to/cc/bcc/replyto/returnpath/attachment.filename only — use Raw search to regex the body.'
        : 'Case-sensitive verifies header.subject/from/to/cc/bcc/replyto/returnpath/attachment.filename only — header.raw/body matches are unaffected.';
    }

    els.search_mode.addEventListener('change', function () {
      var raw = els.search_mode.value === 'raw';
      els.search_input.placeholder = raw
        ? 'Grep the raw bytes of every file…  e.g. X-Mailer or a base64 fragment'
        : 'any text, e.g. paypal "verify your account" · header.received:google.com · auth.dmarc:fail';
      updateSearchOptionsHint();
    });

    var SEARCH_HELP_HTML =
      '<table>' +
      '<tr><td>header.subject: header.from: header.to:</td><td>substring match on that header, e.g. <code>header.from:paypal</code> finds <code>noreply@paypal.com</code> too</td></tr>' +
      '<tr><td>header.cc: header.bcc: header.replyto: header.returnpath:</td><td>substring match on that address header — Cc/Bcc/Reply-To also match the decoded display name; Return-Path is the bare address (e.g. <code>header.cc:carol</code>)</td></tr>' +
      '<tr><td>url:</td><td>substring match on the <b>addresses</b> of the links in the body, e.g. <code>url:example</code> · <code>url:".pdf"</code> · <code>url:bit.ly</code>. (To <i>count</i> links use <code>urls:&gt;5</code>.)</td></tr>' +
      '<tr><td colspan="2" style="padding-top:6px;color:var(--fg-dim)"><b>Metadata</b> — one field per row of the email\'s Metadata card (case-insensitive substring unless noted):</td></tr>' +
      '<tr><td>meta.fromdomain:</td><td>the sender\'s <i>domain</i> only, e.g. <code>meta.fromdomain:paypal</code> finds <code>paypal.evil.net</code> but not a mail that just says "PayPal" in its display name</td></tr>' +
      '<tr><td>meta.connectingip: meta.originip:</td><td>the IP that connected to the receiving side (recorded by the receiver, so the sender cannot forge it) / the earliest public IP in the Received chain (what the sender\'s own hops claim), substring match, e.g. <code>meta.connectingip:198.51.100</code></td></tr>' +
      '<tr><td>meta.replytodomain: meta.returnpathdomain:</td><td>the Reply-To / Return-Path domain, e.g. <code>meta.replytodomain:gmail.com</code></td></tr>' +
      '<tr><td>meta.urldomain:</td><td>the host of <i>any</i> link in the email, e.g. <code>meta.urldomain:bit.ly</code></td></tr>' +
      '<tr><td>meta.category:</td><td>a Settings domain category, e.g. <code>meta.category:shortener</code> (the list in this folder is suggested as you type)</td></tr>' +
      '<tr><td>meta.flag:</td><td>an exact flag name — the five sender flags <code>replyto-mismatch</code> · <code>returnpath-mismatch</code> · <code>name-mismatch</code> · <code>lookalike</code> · <code>punycode</code>, plus every flag/note on the <b>Security checks</b> card: ' + EV.ANOMALY_FLAG_IDS.filter(function (id) { return ['replyto-mismatch', 'returnpath-mismatch'].indexOf(id) === -1; }).map(function (id) { return '<code>' + id + '</code>'; }).join(' · ') + '. E.g. <code>meta.flag:fake-reply -tag:reviewed</code></td></tr>' +
      '<tr><td>script.subject: script.body:</td><td>the script a subject / body is written in: ' + EV.SCRIPT_NAMES.map(function (n) { return '<code>' + n + '</code>'; }).join(' · ') + ' — e.g. <code>script.body:cyrillic</code> or <code>script.subject:latin script.body:greek</code>. (Script, not language: it cannot tell English from French.)</td></tr>' +
      '<tr><td>meta.financial:</td><td>a financial-indicator type found in the body: <code>iban</code> · <code>swift_bic</code> · <code>routing_number</code> · <code>crypto_wallet_btc</code> · <code>crypto_wallet_eth</code> · <code>gift_card_request</code></td></tr>' +
      '<tr><td>header.messageid:</td><td>exact match on the Message-ID header</td></tr>' +
      '<tr><td>header.&lt;name&gt;:</td><td>search one specific header by its name — <b>any</b> header works: <code>header.received:google.com</code> · <code>header.x-mailer:outlook</code> · <code>header.authentication-results:fail</code> · <code>header.list-unsubscribe:</code>… (the names found in this folder are listed below)</td></tr>' +
      '<tr><td>header.raw:</td><td>match across <i>all</i> header values at once</td></tr>' +
      '<tr><td>auth.spf: auth.dkim: auth.dmarc:</td><td>the SPF/DKIM/DMARC result, exact match: <code>auth.spf:fail</code> · <code>auth.dmarc:pass</code> · <code>auth.dkim:softfail</code> · <code>auth.spf:missing</code> (no result recorded)</td></tr>' +
      '<tr><td>attachment.filename:</td><td>substring match on attachment filenames</td></tr>' +
      '<tr><td>attachment.ext:</td><td>exact match on an attachment\'s extension, e.g. <code>attachment.ext:.exe</code> (the dot is optional: <code>attachment.ext:exe</code> works too)</td></tr>' +
      '<tr><td>attachment.sha256:</td><td>exact match on an attachment\'s own SHA-256 hash (case-insensitive) — computed for every attachment during indexing, so this covers the whole folder immediately, unlike <code>attachment.ocr:</code></td></tr>' +
      '<tr><td>attachment.ocr:</td><td>substring match on OCR\'d image-attachment text — <b>sparse, not exhaustive</b>: only covers emails where you\'ve already clicked "Extract text (OCR)" in the Attachments tab, never run automatically. See the OCR coverage count near the search results.</td></tr>' +
      '<tr><td>tag:</td><td>exact match on a tag name, e.g. <code>tag:phish</code></td></tr>' +
      '<tr><td>"exact phrase"</td><td>quoted phrase — the words must appear next to each other, in order</td></tr>' +
      '<tr><td colspan="2" style="padding-bottom:6px;color:var(--fg-dim)"><b>Autocomplete:</b> start typing a field (<code>head</code>…) for suggestions — <b>Tab</b> accepts, <b>↑↓</b> choose, <b>Esc</b> closes, <b>Ctrl+Space</b> (or ↓) lists everything. <b>Enter always searches</b> unless you arrowed into the list. After <code>header.</code> it lists the header names in this folder; after <code>auth.spf:</code> / <code>attachment.ext:</code> / <code>tag:</code> it lists values.</td></tr>' +
      '<tr><td colspan="2" style="padding-bottom:6px;color:var(--fg-dim)"><b>Whatever you type matches as plain text anywhere it appears</b> — inside words, addresses, URLs and non-English text (<code>oogle</code> finds <code>mail.google.com</code>) — across the subject, sender, recipients, body, links, <i>every header</i> and OCR text. Prefix a field to narrow it.</td></tr>' +
      '<tr><td>-term</td><td>exclude a word; also works on any field:, e.g. <code>-tag:reviewed</code></td></tr>' +
      '<tr><td>OR / ( )</td><td>OR (all-caps only) binds looser than the implicit AND, and parentheses group: <code>(header.from:paypal OR header.from:ebay) attachment.count:&gt;0</code> · <code>-(header.from:paypal OR header.from:ebay)</code> negates a whole group. Lowercase <code>or</code> is just a word.</td></tr>' +
      '<tr><td colspan="2" style="padding-top:6px;color:var(--fg-dim)">Numeric fields — glue a comparison operator directly onto the value, no space:</td></tr>' +
      '<tr><td>attachment.count:</td><td><code>attachment.count:3</code> (exact) · <code>attachment.count:&gt;3</code> · <code>attachment.count:&gt;=3</code> · <code>attachment.count:&lt;2</code></td></tr>' +
      '<tr><td>size:</td><td><code>size:&gt;5mb</code> · <code>size:&lt;100kb</code> (accepts b / kb / mb / gb)</td></tr>' +
      '<tr><td>urls:</td><td>number of links found in the body, e.g. <code>urls:&gt;=10</code></td></tr>' +
      '<tr><td>recipients:</td><td>unique To/Cc/Bcc count, e.g. <code>recipients:&gt;20</code></td></tr>' +
      '<tr><td>duplicates:</td><td>how many indexed files share this one\'s Message-ID/content id, e.g. <code>duplicates:&gt;1</code> finds every file that\'s part of a repeated/bulk-sent batch</td></tr>' +
      '<tr><td>urgency:</td><td>the always-on urgency-language score, e.g. <code>urgency:&gt;=3</code></td></tr>' +
      '<tr><td colspan="2" style="padding-top:6px;color:var(--fg-dim)">Regex — on header.subject/from/to/cc/bcc/replyto/returnpath/attachment.filename only (not header.raw/body — use Raw search for those):</td></tr>' +
      '<tr><td>field:/…/</td><td><code>attachment.filename:/\\.(exe|scr)$/i</code> · <code>header.subject:/^re:.*invoice/i</code></td></tr>' +
      '<tr><td colspan="2" style="padding-top:6px;color:var(--fg-dim)"><b>Aa</b> / <b>.*</b> toggle buttons below Search:</td></tr>' +
      '<tr><td><b>Aa</b> Match Case</td><td>verifies exact case for quoted phrases and any term, but only against the fields with retained raw text (header.subject/from/to/cc/bcc/replyto/returnpath/attachment.filename) — header.raw/body matches are unaffected</td></tr>' +
      '<tr><td><b>.*</b> Use Regex</td><td>treats the whole search box as one regex pattern against those same raw-text fields, ignoring field:/phrase/tag syntax — same one-pattern model as Raw search\'s own regex toggle, so use Raw search to regex the body</td></tr>' +
      '</table>' +
      '<div class="ev-muted-small" style="margin-top:6px">Combine freely: <code>header.from:paypal attachment.count:&gt;3 -tag:reviewed</code>. ' +
      'A term or field value that’s too short/unparseable matches nothing rather than everything, and a note explains why.</div>';

    /** Folder-specific extras for the help panel: the header names actually present, and text coverage. */
    function searchHelpFolderNotes() {
      var html = '';
      var names = searchIdx.headerNames();
      if (names.length) {
        html += '<div class="ev-muted-small" style="margin-top:6px"><b>Headers in this folder</b> (use as <code>header.&lt;name&gt;:</code>): ' +
          names.slice(0, 60).map(function (h) { return '<code>' + h.name.replace(/[<>&]/g, '') + '</code> ' + h.count.toLocaleString(); }).join(' · ') +
          (names.length > 60 ? ' · … +' + (names.length - 60) + ' more' : '') + '</div>';
      }
      var cov = searchIdx.textCoverage();
      if (cov.total > cov.retained) {
        html += '<div class="ev-muted-small" style="margin-top:6px">⚠ Substring matching inside body/headers covers ' + cov.retained.toLocaleString() + ' of ' + cov.total.toLocaleString() +
          ' emails (memory limit); the rest match whole words only — use <b>Raw search</b> for any substring in those.</div>';
      }
      return html;
    }

    els.btn_search_help.addEventListener('click', function () {
      ctx.showSidebarView('search');
      if (els.search_help.style.display === 'none') {
        els.search_help.innerHTML = SEARCH_HELP_HTML + searchHelpFolderNotes();
        els.search_help.style.display = 'block';
      } else {
        els.search_help.style.display = 'none';
      }
    });

    ctx.searchResultsList = EV.createVirtualList(els.search_results, { rowHeight: 46, renderRow: renderSearchResultRow });

    ctx.currentResults = [];

    function toggleSearchRowSelected(path) {
      if (state.searchSelectedPaths.has(path)) state.searchSelectedPaths.delete(path);
      else state.searchSelectedPaths.add(path);
      state.lastClickedSearchPath = path;
      updateSearchSelectionBar();
      ctx.searchResultsList.setItems(ctx.currentResults.slice());
    }

    function renderSearchResultRow(item, rowEl) {
      if (!item) return;
      rowEl.className = 'ev-result-row' + (state.searchSelectedPaths.has(item.path) ? ' multi-selected' : '');
      // Gmail-style checkbox -- the explicit, discoverable way to build up a selection one row (or a
      // few) at a time, alongside the Explorer-style Shift/Ctrl-click range/toggle-select below for
      // anyone who prefers that. Never opens the tab itself (stopPropagation). Checkbox + subject sit
      // on their own top line; path/snippet is a second, full-width line below -- two clearly separate
      // lines per row rather than the checkbox looking like it floats beside a two-line text block.
      var line1 = document.createElement('div');
      line1.className = 'ev-result-line1';
      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'ev-result-checkbox';
      checkbox.checked = state.searchSelectedPaths.has(item.path);
      checkbox.onclick = function (e) { e.stopPropagation(); };
      checkbox.onchange = function () { toggleSearchRowSelected(item.path); };
      line1.appendChild(checkbox);
      var top = document.createElement('div');
      top.className = 'ev-result-top';
      top.textContent = item.subject || item.path;
      line1.appendChild(top);
      rowEl.appendChild(line1);
      var bottom = document.createElement('div');
      bottom.className = 'ev-result-bottom';
      bottom.textContent = item.path + (item.snippet ? '  —  ' + item.snippet : (item.fromAddr ? '  —  ' + item.fromAddr : ''));
      rowEl.appendChild(bottom);
      rowEl.title = item.path;
      // Shift/Ctrl-click multi-select, mirroring the Explorer tree's own pattern exactly (see
      // renderTreeRow) -- a SEPARATE selection Set from the tree's, since Search and Explorer are
      // different lists with independent scrolling/visibility (sharing one Set would show stale
      // highlights and misdrive the tree-only bulk-tag bar).
      rowEl.onclick = function (e) {
        var allPaths = ctx.currentResults.map(function (r) { return r.path; });
        if (e.shiftKey && state.lastClickedSearchPath) {
          var a = allPaths.indexOf(state.lastClickedSearchPath), b = allPaths.indexOf(item.path);
          if (a !== -1 && b !== -1) {
            var lo = Math.min(a, b), hi = Math.max(a, b);
            for (var i = lo; i <= hi; i++) state.searchSelectedPaths.add(allPaths[i]);
            updateSearchSelectionBar();
            ctx.searchResultsList.setItems(ctx.currentResults.slice());
            return;
          }
        }
        if (e.metaKey || e.ctrlKey) {
          toggleSearchRowSelected(item.path);
          return;
        }
        if (state.searchSelectedPaths.size) { state.searchSelectedPaths.clear(); updateSearchSelectionBar(); }
        state.lastClickedSearchPath = item.path;
        var entry = state.pathToEntry.get(item.path);
        if (entry) ctx.openTab(entry);
      };
      rowEl.oncontextmenu = function (e) {
        e.preventDefault();
        var targetPaths = (state.searchSelectedPaths.has(item.path) && state.searchSelectedPaths.size > 1)
          ? Array.from(state.searchSelectedPaths) : [item.path];
        ctx.showFileActionMenu(e.clientX, e.clientY, targetPaths);
      };
    }

    /** Shows/hides the Gmail-style select-all bar below the search-status row and keeps the master
     * checkbox (checked/indeterminate/unchecked) and count text in sync with the current selection. */
    function updateSearchSelectionBar() {
      updateExportIocsLabel();
      if (!ctx.currentResults.length) { els.search_select_bar.style.display = 'none'; return; }
      els.search_select_bar.style.display = 'flex';
      var n = state.searchSelectedPaths.size;
      var total = ctx.currentResults.length;
      els.search_select_all_checkbox.checked = n > 0 && n === total;
      els.search_select_all_checkbox.indeterminate = n > 0 && n < total;
      els.search_select_count.textContent = n ? (n.toLocaleString() + ' of ' + total.toLocaleString() + ' selected') : total.toLocaleString() + ' result(s)';
      els.btn_clear_search_select.style.display = n ? 'inline-block' : 'none';
    }

    els.search_select_all_checkbox.addEventListener('change', function () {
      if (els.search_select_all_checkbox.checked) ctx.currentResults.forEach(function (r) { state.searchSelectedPaths.add(r.path); });
      else state.searchSelectedPaths.clear();
      updateSearchSelectionBar();
      ctx.searchResultsList.setItems(ctx.currentResults.slice());
    });

    els.btn_clear_search_select.addEventListener('click', function () {
      state.searchSelectedPaths.clear();
      updateSearchSelectionBar();
      ctx.searchResultsList.setItems(ctx.currentResults.slice());
    });

    function clearSearchResults() {
      searchIdx.cancel();
      rawSearchObj.cancel();
      ctx.liveResultsView = null;
      ctx.currentResults = [];
      ctx.searchResultsList.setItems([]);
      state.searchSelectedPaths.clear();
      state.lastClickedSearchPath = null;
      updateSearchSelectionBar();
      els.search_status.textContent = '';
      els.btn_search_cancel.style.display = 'none';
      els.btn_clear_search.style.display = 'none';
    }

    els.btn_clear_search.addEventListener('click', clearSearchResults);

    /** Called from the email Preview when you click a Subject/From/To...: puts the query in the search box and
     * runs it as a normal Decoded search (so it is exactly what you'd have typed), then leaves the cursor in the
     * box so you can edit it and press Enter to search again. */
    EV.searchFor = function (query) {
      if (!query || !state.workspace) return;
      if (els.search_mode.value !== 'decoded') {
        els.search_mode.value = 'decoded';
        els.search_mode.dispatchEvent(new Event('change'));
      }
      if (isToggleActive(els.search_regex)) els.search_regex.click(); // Use Regex would treat the query as a pattern
      els.search_input.value = query;
      runSearch();
      els.search_input.focus();
      els.search_input.setSelectionRange(query.length, query.length);
    };

    function runSearch() {
      if (searchSuggest) searchSuggest.close();
      var query = els.search_input.value.trim();
      if (!query || !state.workspace) return;
      ctx.showSidebarView('search');
      ctx.liveResultsView = null; // a typed search replaces any tag/rule view
      ctx.currentResults = [];
      ctx.searchResultsList.setItems([]);
      state.searchSelectedPaths.clear();
      state.lastClickedSearchPath = null;
      updateSearchSelectionBar();
      els.btn_search_cancel.style.display = 'inline-block';
      els.btn_clear_search.style.display = 'inline-block';
      // Captured so a slow search's results/progress never get applied to the
      // UI after the user has since opened a different folder.
      var searchedWorkspace = state.workspace;
      function stillCurrent() { return state.workspace === searchedWorkspace; }
      var pathFilterOpts = { include: els.search_include.value, exclude: els.search_exclude.value };

      if (els.search_mode.value === 'decoded') {
        els.search_status.textContent = 'Searching…';
        searchIdx.search(query, { isRegex: isToggleActive(els.search_regex), caseSensitive: isToggleActive(els.search_case), include: pathFilterOpts.include, exclude: pathFilterOpts.exclude }).then(function (res) {
          if (!stillCurrent()) return;
          els.btn_search_cancel.style.display = 'none';
          function numericFieldLabel(field, r) {
            if (field === 'attachments') return 'attachments=' + r.attCount;
            if (field === 'size') return 'size=' + fmtBytesShort(r.size);
            if (field === 'urls') return 'urls=' + r.urlCount;
            if (field === 'recipients') return 'recipients=' + r.recipientCount;
            if (field === 'duplicates') return 'duplicates=' + r.duplicateCount;
            return null;
          }
          ctx.currentResults = res.results.map(function (r) {
            var parts = r.matchedFields.map(function (f) { return numericFieldLabel(f, r) || f; });
            return { path: r.path, subject: r.subject, fromAddr: r.fromAddr, snippet: 'matched: ' + parts.join(', ') };
          });
          ctx.searchResultsList.setItems(ctx.currentResults);
          updateSearchSelectionBar();
          var warningNote = res.warnings && res.warnings.length ? ('  ⚠ ' + res.warnings[0]) : '';
          // Only shown when the query actually touches attachment.ocr: -- that's the one field whose
          // coverage is sparse/opportunistic by design (see searchIndex.js's addOcrText), so an honest
          // "not exhaustive" note belongs right where those results are, not on every search.
          var ocrNote = /attachment\.ocr\s*:/i.test(query)
            ? ('  (OCR coverage: ' + searchIdx.ocrStats().coveredCount.toLocaleString() + ' email(s) OCR-indexed so far — not exhaustive)')
            : '';
          var cov = searchIdx.textCoverage();
          var covNote = cov.total > cov.retained
            ? '  ⚠ substring search inside body/headers covers ' + cov.retained.toLocaleString() + '/' + cov.total.toLocaleString() + ' emails (memory limit) — others match whole words; Raw search finds any substring'
            : '';
          els.search_status.textContent = res.results.length.toLocaleString() + ' match(es)' +
            (res.truncated ? ' (showing top ' + res.results.length + ' of ' + res.total.toLocaleString() + ')' : '') +
            ' — ' + (searchIdx.stats().indexed).toLocaleString() + '/' + (searchIdx.stats().total).toLocaleString() + ' emails indexed so far' +
            warningNote + ocrNote + covNote;
        }).catch(function (err) {
          if (!stillCurrent()) return;
          els.btn_search_cancel.style.display = 'none';
          els.search_status.textContent = 'Search failed: ' + (err && err.message || err);
        });
      } else {
        els.search_status.textContent = 'Scanning raw files…';
        rawSearchObj.search(state.workspace, query, {
          isRegex: isToggleActive(els.search_regex),
          caseSensitive: isToggleActive(els.search_case),
          include: pathFilterOpts.include,
          exclude: pathFilterOpts.exclude,
          onMatches: function (matches) {
            if (!stillCurrent()) return;
            matches.forEach(function (m) {
              ctx.currentResults.push({ path: m.path, subject: m.path, fromAddr: '', snippet: m.count + ' match(es): ' + (m.snippets[0] ? m.snippets[0].snippet : '') });
            });
            ctx.searchResultsList.setItems(ctx.currentResults.slice());
            updateSearchSelectionBar();
            els.search_status.textContent = ctx.currentResults.length.toLocaleString() + ' file(s) with matches so far…';
          },
          onProgress: function (done, total) {
            if (!stillCurrent()) return;
            els.search_status.textContent = ctx.currentResults.length.toLocaleString() + ' file(s) with matches — scanned ' + done.toLocaleString() + '/' + total.toLocaleString();
          }
        }).then(function (result) {
          if (!stillCurrent()) return;
          els.btn_search_cancel.style.display = 'none';
          els.search_status.textContent = ctx.currentResults.length.toLocaleString() + ' file(s) with matches' + (result.cancelled ? ' (stopped)' : ' (complete)');
        });
      }
    }

    els.btn_search.addEventListener('click', runSearch);

    els.search_input.addEventListener('keydown', function (e) { if (e.key === 'Enter') runSearch(); });

    // Autocomplete for the grammar (field names, the folder's real header names, closed value sets).
    // Decoded search only, and not in Use Regex mode, where the whole box is one pattern.
    var suggestTagNames = [];

    function refreshSuggestTagNames() {
      EV.tags.getAll().then(function (records) {
        var seen = {};
        records.forEach(function (r) { (r.tags || []).forEach(function (t) { seen[t] = true; }); });
        suggestTagNames = Object.keys(seen).sort();
      }).catch(function () {});
    }

    refreshSuggestTagNames();

    // The same list feeds every tag box (render.js's per-email "+ add tag" asks for it through this).
    EV.getTagNames = function () { return suggestTagNames; };

    EV.searchSuggest.attachTagInput(els.bulk_tag_input, EV.getTagNames);

    EV.searchSuggest.attachTagInput(els.rule_tag, EV.getTagNames); // accepting fires 'input', which marks the tag as hand-edited

    // Rule expression editor: facts, helpers, and the open folder's real header names for f.getHeader('…').
    EV.ruleSuggest.attach(els.rule_expression, function () { return searchIdx.headerNames(); });

    searchSuggest = EV.searchSuggest.attach(els.search_input, {
      isEnabled: function () { return els.search_mode.value === 'decoded' && !isToggleActive(els.search_regex); },
      getContext: function () {
        return { headerNames: searchIdx.headerNames(), attExts: searchIdx.attachmentExts(), tagNames: suggestTagNames, categories: searchIdx.categoryNames() };
      }
    });

    els.btn_search_cancel.addEventListener('click', function () {
      searchIdx.cancel();
      rawSearchObj.cancel();
      els.btn_search_cancel.style.display = 'none';
    });

    function csvCell(v) {
      v = String(v);
      return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    }

    /** Export IOCs scopes to whatever the Search tab is currently showing: an explicit multi-selection
     * first, else the current search/rule/tag results, else (nothing shown) the whole indexed folder. */
    function iocExportScope() {
      if (state.searchSelectedPaths.size) return { pathSet: new Set(state.searchSelectedPaths), label: state.searchSelectedPaths.size.toLocaleString() + ' selected email(s)' };
      if (ctx.currentResults.length) return { pathSet: new Set(ctx.currentResults.map(function (r) { return r.path; })), label: ctx.currentResults.length.toLocaleString() + ' search result(s)' };
      return { pathSet: null, label: 'the whole open folder' };
    }

    function updateExportIocsLabel() {
      els.btn_export_iocs.title = 'Export sender domains, URL/link domains, attachment extensions, and financial-indicator types as one CSV — currently scoped to ' + iocExportScope().label + '.';
    }

    updateExportIocsLabel();

    els.btn_export_iocs.addEventListener('click', function () {
      if (!state.workspace) { EV.alertDialog('Open a folder first.'); return; }
      var scope = iocExportScope();
      var summary = searchIdx.iocSummary(scope.pathSet);
      var rows = [['type', 'value', 'email_count']];
      summary.senderDomains.forEach(function (r) { rows.push(['sender_domain', r.value, r.count]); });
      summary.connectingIps.forEach(function (r) { rows.push(['connecting_ip', r.value, r.count]); });
      summary.originIps.forEach(function (r) { rows.push(['origin_ip', r.value, r.count]); });
      summary.urlDomains.forEach(function (r) { rows.push(['url_domain', r.value, r.count]); });
      summary.attachmentExtensions.forEach(function (r) { rows.push(['attachment_extension', r.value, r.count]); });
      summary.financialIndicatorTypes.forEach(function (r) { rows.push(['financial_indicator', r.value, r.count]); });
      summary.domainCategories.forEach(function (r) { rows.push(['domain_category', r.value, r.count]); });
      if (summary.senderAnomalyCount) rows.push(['sender_anomaly_summary', 'emails_with_display_name_or_lookalike_domain_flag', summary.senderAnomalyCount]);
      if (rows.length === 1) { EV.alertDialog('Nothing indexed yet — wait for indexing to finish, or there are no domains/attachments to report.'); return; }
      var csv = rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
      var blob = new Blob([csv], { type: 'text/csv' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'mantiz-eml-analyzer-iocs-' + new Date().toISOString().slice(0, 10) + '.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    });

  };
})(typeof self !== 'undefined' ? self : this);
