/**
 * securityCard.js — the Preview's "Security checks" card: four headline metric tiles (hidden characters, look-alikes, envelope,
 * attachments) above the Header / Body / Attachments / Language checklist. Pure presentation of EV.analyzeAnomalies
 * (js/indexing/anomalies.js) — the one definition shared with search and rules — plus the cached Settings lists it needs.
 */
(function (g) {
  'use strict';
  var EV = g.EV || (g.EV = {});
  EV.ui = EV.ui || {};
  var el = EV.ui.el;

  // ---------- Security checks (the Header / Body / Language checklist) ----------
  var CHECK_ICON = { ok: 'check', flag: 'alert', note: 'info', na: 'minus' };
  var CHECK_STATUS_TITLE = { ok: 'Checked: nothing wrong', flag: 'Flag: worth a look', note: 'Note: informational or a weak signal', na: 'Not applicable' };
  var CHECK_GROUPS = [['header', 'Header'], ['body', 'Body'], ['attachments', 'Attachments'], ['language', 'Language (script)']];

  /** The four headline metrics above the checklist: hidden characters, look-alikes, the From / Return-Path / Reply-To envelope and
   * attachments. Read straight from the checklist's own result (never recomputed), coloured by its flags, and -- when an email has
   * the issue -- a click searches the whole folder for it (meta.flag:), so a finding turns into "show me every other one". */
  function renderCheckMetrics(res) {
    var m = res.metrics || {}, has = function (f) { return res.flags.indexOf(f) !== -1; };
    var byId = {}; res.checks.forEach(function (c) { byId[c.id] = c; });
    var tiles = [];
    var hiddenTotal = ((m.hidden && m.hidden.zeroWidth) || 0) + ((m.hidden && m.hidden.bidi) || 0);
    var hiddenFlags = ['invisible-chars', 'bidi-override', 'attachment-filename-spoof', 'hidden-css-text'].filter(has);
    tiles.push({ label: 'Hidden characters', value: String(hiddenTotal), sub: 'zero-width ' + ((m.hidden && m.hidden.zeroWidth) || 0) + ' \u00B7 direction ' + ((m.hidden && m.hidden.bidi) || 0) + ((m.hidden && m.hidden.cssBlocks) ? ' \u00B7 css-hidden ' + m.hidden.cssBlocks : ''),
      status: hiddenFlags.some(function (f) { return f !== 'hidden-css-text'; }) ? 'flag' : (hiddenTotal || hiddenFlags.length ? 'note' : 'ok'), flags: hiddenFlags });
    var lookFlags = ['homoglyph-subject', 'homoglyph-name', 'homoglyph-body', 'homoglyph-links', 'confusable-domain'].filter(has);
    tiles.push({ label: 'Look-alikes', value: String(((m.lookalikes && m.lookalikes.fields) || 0) + ((m.lookalikes && m.lookalikes.domain) ? 1 : 0)),
      sub: lookFlags.length ? lookFlags.map(function (f) { return f.replace('homoglyph-', 'mixed-script ').replace('confusable-domain', 'look-alike domain'); }).join(', ') : 'no mixed-script words',
      status: lookFlags.length ? 'flag' : 'ok', flags: lookFlags });
    var env = (m.envelope || []);
    var envFlag = env.some(function (e) { return e.status === 'flag'; }), envNote = env.some(function (e) { return e.status === 'note'; });
    var envFlags = ['returnpath-mismatch', 'replyto-mismatch'].filter(has);
    tiles.push({ label: 'Envelope', value: envFlag ? 'Mismatch' : (envNote ? 'Mailing service' : 'Aligned'),
      sub: env.map(function (e) { return e.label + ' ' + (e.status === 'ok' ? (/none|empty/.test(e.detail) ? '\u2014' : '\u2713') : (e.status === 'note' ? '~' : '\u2717')); }).join(' \u00B7 '),
      status: envFlag ? 'flag' : (envNote ? 'note' : 'ok'), flags: envFlags });
    var att = m.attachments || { total: 0, risky: 0 };
    var attFlags = (byId['attachment-risk'] ? byId['attachment-risk'].flags : []);
    tiles.push({ label: 'Attachments', value: att.total ? att.risky + ' / ' + att.total : '0', sub: att.total ? 'risky of ' + att.total : 'none attached',
      status: byId['attachment-risk'] ? (byId['attachment-risk'].status === 'na' ? 'na' : byId['attachment-risk'].status) : 'na', flags: attFlags });
    var strip = el('div', 'ev-metrics');
    tiles.forEach(function (t) {
      var clickable = t.flags.length > 0;
      var tile = el(clickable ? 'button' : 'div', 'ev-metric ev-metric-' + t.status);
      if (clickable) {
        tile.type = 'button';
        tile.title = 'Find every email in this folder with: ' + t.flags.join(', ');
        tile.addEventListener('click', function () {
          if (window.EV.searchFor) window.EV.searchFor(t.flags.length === 1 ? 'meta.flag:' + t.flags[0] : '(' + t.flags.map(function (f) { return 'meta.flag:' + f; }).join(' OR ') + ')');
        });
      }
      tile.appendChild(el('span', 'ev-metric-label', t.label));
      tile.appendChild(el('span', 'ev-metric-value', t.value));
      tile.appendChild(el('span', 'ev-metric-sub', t.sub));
      strip.appendChild(tile);
    });
    return strip;
  }

  /** Fills the "Security checks" card from EV.analyzeAnomalies (js/indexing/anomalies.js) -- the same function the
   * search index and rule facts use, so what you read here is exactly what meta.flag: / script.*: find. */
  function renderSecurityChecks(card, parsed) {
    var res = EV.analyzeAnomalies(parsed, { internalDomains: EV.settingsCache.internalDomains(), trustedDomains: EV.settingsCache.trustedDomains(), domainCategories: EV.settingsCache.domainCategories() });
    var flags = 0, notes = 0;
    res.checks.forEach(function (c) { if (c.status === 'flag') flags++; else if (c.status === 'note') notes++; });
    var summary = el('span', 'ev-checks-summary' + (flags ? ' has-flags' : ''),
      flags || notes ? (flags ? flags + ' flagged' : '') + (flags && notes ? ' \u00B7 ' : '') + (notes ? notes + ' note' + (notes === 1 ? '' : 's') : '') : 'all clear');
    card.header.appendChild(summary);
    card.body.appendChild(renderCheckMetrics(res));
    CHECK_GROUPS.forEach(function (g) {
      var col = el('div', 'ev-check-group');
      col.appendChild(el('div', 'ev-card-sub', g[1]));
      var list = el('div', 'ev-check-list');
      list.setAttribute('role', 'list');
      res.checks.filter(function (c) { return c.group === g[0]; }).forEach(function (c) {
        var r = el('div', 'ev-check ev-check-' + c.status);
        r.setAttribute('role', 'listitem');
        r.title = CHECK_STATUS_TITLE[c.status] + (c.flags.length ? '  [meta.flag:' + c.flags.join(' / ') + ']' : '');
        var ic = EV.iconEl(CHECK_ICON[c.status], 'ev-check-icon', 13);
        ic.setAttribute('aria-label', CHECK_STATUS_TITLE[c.status]);
        r.appendChild(ic);
        r.appendChild(el('span', 'ev-check-label', c.label));
        r.appendChild(el('span', 'ev-check-detail', c.detail));
        list.appendChild(r);
      });
      col.appendChild(list);
      card.body.appendChild(col);
    });
  }

  EV.ui.renderSecurityChecks = renderSecurityChecks;
})(typeof self !== 'undefined' ? self : this);
