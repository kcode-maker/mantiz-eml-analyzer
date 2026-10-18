/**
 * pages.js — the full-width pages that replace the email view in the right pane (Folder overview, Settings). Only one page shows at a time, and opening any email closes it.
 */
(function (g) {
  'use strict';
  var EV = g.EV || (g.EV = {});
  EV.ui = EV.ui || {};
  EV.ui.features = EV.ui.features || {};

  EV.ui.features.pages = function createPages(ctx) {
    var state = ctx.state, els = ctx.els, searchIdx = ctx.searchIdx;
    var el = EV.ui.el;
    // Exported to the other features (function declarations are hoisted, so these are valid before their definitions).
    ctx.closeOverviewView = closeOverviewView;
    ctx.closeSettingsView = closeSettingsView;

    // A one-screen summary of the whole folder: how many emails carry each security flag (the same ids meta.flag: searches),
    // grouped, with the four headline metrics on top. Read from per-file arrays the index already holds; a click on any row or
    // tile runs that search. Mirrors the Settings page's open/close so only one right-pane page is ever showing.
    ctx.overviewOpen = false;

    var OVERVIEW_TILES = [
      ['Hidden characters', ['invisible-chars', 'bidi-override', 'attachment-filename-spoof']],
      ['Look-alikes', ['homoglyph-subject', 'homoglyph-name', 'homoglyph-body', 'homoglyph-links', 'confusable-domain', 'lookalike', 'punycode', 'name-mismatch', 'forged-display-name']],
      ['Envelope & sender', ['returnpath-mismatch', 'replyto-mismatch', 'claims-internal', 'sender-ip-literal', 'auth-results-conflict', 'auth-results-planted']],
      ['Risky attachments', ['attachment-executable', 'attachment-double-ext', 'attachment-disguised', 'attachment-filename-spoof']],
      ['Chain problems', ['no-received', 'received-broken', 'received-time-travel']]
    ];

    var OVERVIEW_GROUP_TITLES = { header: 'Header', body: 'Body', attachments: 'Attachments', language: 'Language (script)', sender: 'Sender look-alikes' };

    function closeOverviewView() {
      ctx.overviewOpen = false;
      els.view_overview.style.display = 'none';
      els.btn_overview.classList.remove('active');
      els.content.style.display = '';
    }

    function openOverviewView() {
      if (ctx.settingsOpen) closeSettingsView();
      ctx.overviewOpen = true;
      els.empty_state.style.display = 'none';
      els.subtab_nav.style.display = 'none';
      els.content.style.display = 'none';
      els.view_overview.style.display = 'flex';
      els.btn_overview.classList.add('active');
      renderOverviewView();
    }

    function renderOverviewView() {
      var host = els.view_overview;
      host.innerHTML = '';
      host.appendChild(el('h2', null, 'Folder overview'));
      if (!state.workspace) { host.appendChild(el('div', 'ev-ov-empty', 'Open a folder to see how many of its emails carry each security flag.')); return; }
      var groups = {};
      OVERVIEW_TILES.forEach(function (t) { groups[t[0]] = t[1]; });
      var fc = searchIdx.flagCounts(groups), st = searchIdx.stats();
      host.appendChild(el('div', 'ev-ov-sub', state.workspace.name + ' \u2014 ' + fc.indexed.toLocaleString() + ' of ' + (st.total || fc.indexed).toLocaleString() + ' emails indexed' +
        (st.skipped ? ' (' + st.skipped.toLocaleString() + ' could not be parsed)' : '') + (st.total && fc.indexed < st.total ? ' \u2014 still indexing, counts will grow; reopen this page to refresh' : '')));
      function searchFlag(ids) {
        EV.searchFor(ids.length === 1 ? 'meta.flag:' + ids[0] : '(' + ids.map(function (f) { return 'meta.flag:' + f; }).join(' OR ') + ')');
        closeOverviewView(); ctx.onTabActivate(ctx.tabMgr.getActive());
      }
      var tiles = el('div', 'ev-ov-tiles');
      OVERVIEW_TILES.forEach(function (t) {
        var n = fc.groups[t[0]] || 0;
        var present = t[1].filter(function (id) { return fc.counts[id]; });
        var tile = el(n ? 'button' : 'div', 'ev-metric ev-metric-' + (n ? 'flag' : 'ok'));
        if (n) { tile.type = 'button'; tile.title = 'Find these emails: ' + present.join(', '); tile.addEventListener('click', function () { searchFlag(present); }); }
        tile.appendChild(el('span', 'ev-metric-label', t[0]));
        tile.appendChild(el('span', 'ev-metric-value', n.toLocaleString()));
        tile.appendChild(el('span', 'ev-metric-sub', n ? (n === 1 ? 'email' : 'emails') : 'none found'));
        tiles.appendChild(tile);
      });
      host.appendChild(tiles);

      // every flag that occurs, grouped by where it shows on the Security checks card, strongest and most common first
      var groupOf = {};
      (EV.ANOMALY_CHECKS || []).forEach(function (c) { c.flags.forEach(function (f) { groupOf[f] = c.group; }); });
      ['name-mismatch', 'lookalike', 'punycode'].forEach(function (f) { groupOf[f] = 'sender'; });
      var note = {}; (EV.ANOMALY_NOTE_FLAGS || []).forEach(function (f) { note[f] = true; });
      var ids = Object.keys(fc.counts);
      if (!ids.length) { host.appendChild(el('div', 'ev-ov-empty', fc.indexed ? 'No flags in this folder \u2014 nothing on the Security checks card fired for any indexed email.' : 'Nothing indexed yet.')); return; }
      ['header', 'sender', 'body', 'attachments', 'language'].forEach(function (g) {
        var inGroup = ids.filter(function (id) { return groupOf[id] === g; }).sort(function (a, b) { return (note[a] ? 1 : 0) - (note[b] ? 1 : 0) || fc.counts[b] - fc.counts[a] || (a < b ? -1 : 1); });
        if (!inGroup.length) return;
        var box = el('div', 'ev-ov-group');
        box.appendChild(el('div', 'ev-ov-group-title', OVERVIEW_GROUP_TITLES[g]));
        inGroup.forEach(function (id) {
          var row = el('button', 'ev-ov-row'); row.type = 'button';
          row.title = 'Search: meta.flag:' + id;
          row.appendChild(el('span', 'ev-ov-dot' + (note[id] ? ' note' : '')));
          row.appendChild(el('span', 'ev-ov-id', id));
          row.appendChild(el('span', 'ev-ov-help', (EV.ANOMALY_FLAG_HELP && EV.ANOMALY_FLAG_HELP[id]) || ({ 'name-mismatch': 'display name claims a brand the domain is not', lookalike: 'sender domain is a near-copy of a trusted domain', punycode: 'sender domain uses punycode (xn--)' }[id] || '')));
          row.appendChild(el('span', 'ev-ov-count', fc.counts[id].toLocaleString()));
          row.addEventListener('click', function () { searchFlag([id]); });
          box.appendChild(row);
        });
        host.appendChild(box);
      });
    }

    els.btn_overview.addEventListener('click', function () {
      if (ctx.overviewOpen) { closeOverviewView(); ctx.onTabActivate(ctx.tabMgr.getActive()); }
      else openOverviewView();
    });

    ctx.settingsOpen = false;

    function closeSettingsView() {
      ctx.settingsOpen = false;
      els.view_settings.style.display = 'none';
      els.btn_settings.classList.remove('active');
      els.content.style.display = '';
    }

    function openSettingsView() {
      if (ctx.overviewOpen) closeOverviewView();
      ctx.settingsOpen = true;
      els.empty_state.style.display = 'none';
      els.subtab_nav.style.display = 'none';
      els.content.style.display = 'none';
      els.view_settings.style.display = 'flex';
      els.btn_settings.classList.add('active');
      ctx.renderSettingsView();
    }

    els.btn_settings.addEventListener('click', function () {
      if (ctx.settingsOpen) { closeSettingsView(); ctx.onTabActivate(ctx.tabMgr.getActive()); }
      else openSettingsView();
    });
  };
})(typeof self !== 'undefined' ? self : this);
