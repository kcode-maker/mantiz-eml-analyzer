/**
 * headersView.js — the Headers sub-tab, as three separate sections: parsed Authentication-Results, the Received chain drawn from
 * the sender to the recipient (broken / backwards hops marked), and every header in a filterable table, decoded for reading.
 * Pure presentation of js/parsing/headerTables.js and EV.decodeHeaderForDisplay.
 */
(function (g) {
  'use strict';
  var EV = g.EV || (g.EV = {});
  EV.ui = EV.ui || {};
  var el = EV.ui.el, copyBtn = EV.ui.copyBtn, fmtAddr = EV.ui.fmtAddr;

  // ---------- sub-tab: Headers ----------

  // Three sections, top to bottom: the authentication results as a table, the Received chain drawn from the
  // sender to you (with a broken-link symbol wherever a hand-off does not connect), and EVERY header in a real table.
  function renderHeaders(tab, container) {
    container.innerHTML = '';
    var p = tab.parsed;
    var wrap = el('div', 'ev-headers');
    container.appendChild(wrap);

    var toolbar = el('div', 'ev-headers-toolbar');
    toolbar.appendChild(copyBtn(function () {
      return p.headers.map(function (h) { return h.name + ': ' + EV.decodeHeaderForDisplay(h.value); }).join('\n'); // decoded, like the table (the Raw tab has the original)
    }, 'Copy all headers'));
    wrap.appendChild(toolbar);

    var auth = renderAuthResultsSection(p);
    if (auth) wrap.appendChild(auth);
    wrap.appendChild(renderReceivedChainSection(p));
    wrap.appendChild(renderAllHeadersSection(p));
  }

  function hsec(iconName, title, extraCls) {
    var sec = el('section', 'ev-hsec' + (extraCls ? ' ' + extraCls : ''));
    var head = el('div', 'ev-hsec-title');
    head.appendChild(EV.iconEl(iconName, 'ev-hsec-icon', 14));
    head.appendChild(el('span', null, title));
    sec.appendChild(head);
    return { root: sec, head: head };
  }

  // ---------- Authentication-Results as a table ----------

  function renderAuthResultsSection(p) {
    var blocks = [];
    EV.getHeaderAll(p.headers, 'authentication-results').forEach(function (v) { blocks.push({ title: 'Authentication-Results', value: v }); });
    EV.getHeaderAll(p.headers, 'arc-authentication-results').forEach(function (v) { blocks.push({ title: 'ARC-Authentication-Results', value: v }); });
    if (!blocks.length) return null;
    var s = hsec('shield', 'Authentication results');
    EV.analyzeHeaderForgery(p.headers).findings.forEach(function (f) { // strong evidence only (see headerTables.js); silent otherwise
      var warn = el('div', 'ev-chain-summary bad');
      warn.appendChild(EV.iconEl('alert', 'ev-hsec-icon', 14));
      warn.appendChild(el('span', null, f.title + ' \u2014 ' + f.detail));
      s.root.appendChild(warn);
    });
    blocks.forEach(function (b) {
      var parsed = EV.parseAuthResults(b.value);
      var card = el('div', 'ev-auth-block');
      var cap = el('div', 'ev-auth-caption');
      cap.appendChild(el('span', 'ev-auth-caption-name', b.title + (parsed.instance ? ' (ARC i=' + parsed.instance + ')' : '')));
      if (parsed.authservId) cap.appendChild(el('span', 'ev-auth-caption-by', 'evaluated by ' + parsed.authservId + (parsed.version ? ' v' + parsed.version : '')));
      card.appendChild(cap);
      if (parsed.results.length) {
        var table = el('table', 'ev-auth-table');
        var thead = el('thead'); var hr = el('tr');
        ['Method', 'Result', 'Details'].forEach(function (h) { hr.appendChild(el('th', null, h)); });
        thead.appendChild(hr); table.appendChild(thead);
        var tbody = el('tbody');
        parsed.results.forEach(function (r) {
          var tr = el('tr');
          tr.appendChild(el('td', 'ev-auth-method', r.method ? r.method.toUpperCase() : '—'));
          var resultCell = el('td', 'ev-auth-result');
          resultCell.appendChild(el('span', 'ev-pill ev-pill-' + EV.authResultClass(r.result), r.result.toUpperCase()));
          tr.appendChild(resultCell);
          var det = el('td', 'ev-auth-details');
          if (r.comment) det.appendChild(el('div', 'ev-auth-comment', r.comment));
          if (r.props.length) {
            var chips = el('div', 'ev-auth-props');
            r.props.forEach(function (pr) {
              var chip = el('span', 'ev-auth-prop');
              chip.appendChild(el('span', 'ev-auth-prop-key', pr.key));
              chip.appendChild(el('span', 'ev-auth-prop-val', pr.value));
              chips.appendChild(chip);
            });
            det.appendChild(chips);
          }
          if (!r.comment && !r.props.length) det.appendChild(el('span', 'ev-muted', '—'));
          tr.appendChild(det);
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        card.appendChild(table);
      } else {
        card.appendChild(el('div', 'ev-header-value-block', b.value || '(empty)'));
      }
      var raw = el('details', 'ev-raw-toggle');
      raw.appendChild(el('summary', null, 'raw header'));
      raw.appendChild(el('div', 'ev-header-value-block', b.value));
      card.appendChild(raw);
      s.root.appendChild(card);
    });
    return s.root;
  }

  // ---------- Received chain: sender -> hops -> you ----------

  var CHAIN_ICON = { ok: 'chain', broken: 'chainBroken', time: 'clock', unknown: 'help', start: 'chain' };

  function shortDate(text) { return text ? String(text).replace(/\s*\([^)]*\)\s*$/, '') : ''; }

  function chainNode(kind, iconName, title, rows, rawText) {
    var li = el('li', 'ev-chain-node ev-chain-' + kind);
    var marker = el('span', 'ev-chain-marker');
    marker.appendChild(EV.iconEl(iconName, null, 14));
    li.appendChild(marker);
    var card = el('div', 'ev-chain-card');
    card.appendChild(el('div', 'ev-chain-title', title));
    rows.forEach(function (r) {
      if (!r[1]) return;
      var line = el('div', 'ev-chain-row');
      line.appendChild(el('span', 'ev-chain-key', r[0]));
      line.appendChild(el('span', 'ev-chain-val', r[1]));
      card.appendChild(line);
    });
    if (rawText) {
      var raw = el('details', 'ev-raw-toggle');
      raw.appendChild(el('summary', null, 'raw header'));
      raw.appendChild(el('div', 'ev-header-value-block', rawText));
      card.appendChild(raw);
    }
    li.appendChild(card);
    return li;
  }

  function chainLink(state, label, detail) {
    var li = el('li', 'ev-chain-link ev-link-' + state);
    var marker = el('span', 'ev-chain-marker ev-chain-marker-sm');
    marker.appendChild(EV.iconEl(CHAIN_ICON[state] || 'chain', null, 13));
    li.appendChild(marker);
    var txt = el('div', 'ev-chain-link-text');
    txt.appendChild(el('span', 'ev-chain-link-label', label));
    if (detail) txt.appendChild(el('span', 'ev-chain-link-detail', detail));
    li.appendChild(txt);
    li.title = (label + (detail ? ' — ' + detail : ''));
    return li;
  }

  /** The two sender IPs, with a Copy button each: the one the receiving side recorded (cannot be forged by the sender) and the
   * earliest public one (what the sender's own hops claim). Private addresses never count. */
  function renderSenderIps(hops) {
    var o = EV.originOf(hops);
    var strip = el('div', 'ev-ip-strip');
    function chip(label, info, help) {
      var c = el('div', 'ev-ip-chip');
      c.title = help;
      c.appendChild(el('span', 'ev-ip-label', label));
      if (info) {
        c.appendChild(el('span', 'ev-ip-val', info.ip));
        c.appendChild(el('span', 'ev-ip-sub', 'hop ' + info.hop + (info.host && info.host.toLowerCase() !== String(info.ip).toLowerCase() ? ' \u00B7 ' + info.host : '')));
        c.appendChild(copyBtn(function () { return info.ip; }, 'Copy'));
      } else {
        c.appendChild(el('span', 'ev-ip-none', o.internalOnly ? 'none \u2014 every hop is on a private address' : 'none found'));
      }
      return c;
    }
    strip.appendChild(chip('Connected to the receiving side from', o.connecting, 'The newest public IP in the chain, recorded by the receiving side rather than the sender, so the sender cannot forge it. The one to block or hunt for.'));
    if (!o.origin || !o.connecting || o.origin.ip !== o.connecting.ip) {
      strip.appendChild(chip('Earliest public IP', o.origin, 'The oldest public IP in the chain: where the message claims it started. Hops below the first server you trust were written by the sender, so this can be fabricated.'));
    }
    return strip;
  }

  /** "Where the time went": one bar per hop-to-hop gap (plus Sent -> hop 1 when the Date header allows), the slowest marked. Negative
   * gaps (a hop stamped before the one it follows) are shown, not clamped to zero. Bars are scaled to the largest gap. */
  function renderDelayChart(p, hops, analysis) {
    var timing = EV.chainTiming(analysis);
    var rows = [];
    var sentMs = p.date ? p.date.getTime() : null;
    if (hops[0] && hops[0].dateMs != null && sentMs != null) rows.push({ label: 'Sent \u2192 hop 1', ms: hops[0].dateMs - sentMs, note: 'from the Date header' });
    timing.links.forEach(function (l) { rows.push({ label: 'Hop ' + l.from + ' \u2192 ' + l.to, ms: l.ms, slowest: timing.slowest === null ? false : (timing.slowest.from === l.from && timing.slowest.to === l.to) }); });
    if (!rows.length) return null;
    var maxMs = 0;
    rows.forEach(function (r) { if (r.ms > maxMs) maxMs = r.ms; });
    var box = el('div', 'ev-delay-chart');
    var head = el('div', 'ev-delay-head');
    head.appendChild(el('span', 'ev-delay-title', 'Where the time went'));
    if (timing.slowest && timing.maxMs >= 60000) head.appendChild(el('span', 'ev-delay-slow', 'slowest: hop ' + timing.slowest.from + ' \u2192 ' + timing.slowest.to + ' (' + EV.formatDelay(timing.maxMs).replace('+', '') + ')'));
    box.appendChild(head);
    rows.forEach(function (r) {
      var line = el('div', 'ev-delay-row' + (r.ms < 0 ? ' neg' : '') + (r.slowest && timing.maxMs >= 60000 ? ' slow' : ''));
      line.appendChild(el('span', 'ev-delay-label', r.label));
      var track = el('span', 'ev-delay-track');
      var bar = el('span', 'ev-delay-bar');
      bar.style.width = (r.ms > 0 && maxMs > 0 ? Math.max(2, Math.round(r.ms / maxMs * 100)) : (r.ms < 0 ? 100 : 0)) + '%';
      track.appendChild(bar);
      line.appendChild(track);
      line.appendChild(el('span', 'ev-delay-val', EV.formatDelay(r.ms)));
      if (r.note) line.title = r.note;
      box.appendChild(line);
    });
    return box;
  }

  function renderReceivedChainSection(p) {
    var s = hsec('chain', 'Received chain — from the sender to you', 'ev-chain-sec');
    var hops = EV.receivedChain(p.headers);
    var analysis = EV.analyzeChain(hops);
    var broken = hops.length ? analysis.broken > 0 : true; // no Received headers at all: nothing connects sender to you

    // summary strip
    var sum = el('div', 'ev-chain-summary' + (broken || analysis.timeTravel ? ' bad' : ''));
    var sumIcon = EV.iconEl(broken ? 'chainBroken' : (analysis.timeTravel ? 'clock' : 'chain'), 'ev-chain-sum-icon', 15);
    sum.appendChild(sumIcon);
    var text;
    if (!hops.length) text = 'No Received headers — nothing shows how this message travelled';
    else {
      text = hops.length + ' hop' + (hops.length === 1 ? '' : 's') +
        (analysis.totalMs != null ? ' · ' + EV.formatDelay(analysis.totalMs).replace('+', '') + ' in transit' : '') + ' · ' +
        (analysis.broken ? analysis.broken + ' broken link' + (analysis.broken === 1 ? '' : 's') : (analysis.timeTravel ? 'hand-offs connect' : 'chain intact')) +
        (analysis.timeTravel ? ' · timestamps go backwards' : '');
    }
    sum.appendChild(el('span', null, text));
    s.root.appendChild(sum);
    if (hops.length) {
      s.head.appendChild(copyBtn(function () { return EV.hopTableText(hops); }, 'Copy hop table'));
      var ips = renderSenderIps(hops);
      if (ips) s.root.appendChild(ips);
      var chart = renderDelayChart(p, hops, analysis);
      if (chart) s.root.appendChild(chart);
    }

    var list = el('ol', 'ev-chain-list');
    list.setAttribute('aria-label', 'Received chain, sender first');

    // START: the sender
    var from = p.from && p.from[0];
    var first = hops[0];
    list.appendChild(chainNode('start', 'user', 'Start — the sender', [
      ['From', from ? fmtAddr(from) : ''],
      ['Sent', shortDate(p.dateRaw)],
      ['First hop saw', first && (first.from || first.fromIp) ? (first.from || '') + (first.fromIp ? ' [' + first.fromIp + ']' : '') : '']
    ]));

    if (!hops.length) {
      list.appendChild(chainLink('broken', 'Broken — no Received headers', 'No server recorded handling this message, so there is no evidence of the path between the sender and you.'));
    } else {
      // sender -> first server: informational delay from the Date header
      var sentMs = p.date ? p.date.getTime() : null;
      list.appendChild(chainLink('start', first.dateMs != null && sentMs != null ? EV.formatDelay(first.dateMs - sentMs) + ' after the Date header' : 'handed to the first server', ''));
      hops.forEach(function (h, i) {
        if (i > 0) {
          var l = analysis.links[i - 1];
          var state = l.handoff === 'broken' ? 'broken' : (l.timeTravel ? 'time' : (l.handoff === 'unknown' ? 'unknown' : 'ok'));
          var label = state === 'broken' ? 'Broken link' : state === 'time' ? 'Time goes backwards ' + EV.formatDelay(l.delayMs)
            : state === 'unknown' ? 'Hand-off cannot be verified' : (l.delayMs != null ? EV.formatDelay(l.delayMs) : 'connected');
          var detail = l.reasons.join('. ') || (state === 'unknown' ? 'One side has no comparable host name (for example localhost), so the link is neither confirmed nor refuted.' : '');
          list.appendChild(chainLink(state, label, detail));
        }
        list.appendChild(chainNode('hop', 'server', 'Hop ' + h.index + (h.by ? ' — ' + h.by : ''), [
          ['Received from', (h.from || '') + (h.fromIp ? ' [' + h.fromIp + ']' : '') || ''],
          ['Protocol', h.with],
          ['Time', shortDate(h.dateText)],
          ['For', h.forAddr],
          ['Id', h.id]
        ], h.raw));
      });
      list.appendChild(chainLink('ok', 'delivered', ''));
    }

    // END: you
    var last = hops.length ? hops[hops.length - 1] : null;
    var delivered = EV.getHeader(p.headers, 'delivered-to');
    var to = (p.to && p.to[0]) ? fmtAddr(p.to[0]) : '';
    list.appendChild(chainNode('end', 'inbox', 'End — you (the recipient)', [
      ['To', delivered || to],
      ['Delivered by', last ? last.by : ''],
      ['Delivered', last ? shortDate(last.dateText) : '']
    ]));
    s.root.appendChild(list);
    return s.root;
  }

  // ---------- every header, as a table ----------

  function renderAllHeadersSection(p) {
    var total = p.headers.length;
    var s = hsec('file', 'All headers (' + total + ')', 'ev-allheaders');
    var filterBox = el('input', 'ev-hfilter');
    filterBox.type = 'search';
    filterBox.placeholder = 'Filter headers…';
    filterBox.setAttribute('aria-label', 'Filter headers by name or value');
    s.head.appendChild(el('span', 'ev-hnote', 'every header, including Received and Authentication-Results'));
    var countEl = el('span', 'ev-hcount', '');
    s.head.appendChild(countEl);
    s.head.appendChild(filterBox);

    var counts = {}, seen = {};
    p.headers.forEach(function (h) { counts[h.lower] = (counts[h.lower] || 0) + 1; });
    var table = el('table', 'ev-htable');
    var thead = el('thead'); var hr = el('tr');
    [['#', 'ev-h-num'], ['Header', 'ev-h-name'], ['Value', 'ev-h-val'], ['', 'ev-h-act']].forEach(function (c) { hr.appendChild(el('th', c[1], c[0])); });
    thead.appendChild(hr); table.appendChild(thead);
    var tbody = el('tbody');
    var rows = [];
    p.headers.forEach(function (h, i) {
      seen[h.lower] = (seen[h.lower] || 0) + 1;
      var tr = el('tr', 'ev-hrow' + (/^(authentication-results|arc-authentication-results|received-spf|dkim-signature|received)$/.test(h.lower) ? ' ev-hrow-sec' : ''));
      tr.appendChild(el('td', 'ev-h-num', String(i + 1)));
      var nameCell = el('td', 'ev-h-name');
      nameCell.appendChild(el('span', 'ev-h-name-text', h.name));
      if (counts[h.lower] > 1) nameCell.appendChild(el('span', 'ev-h-rep', seen[h.lower] + '/' + counts[h.lower]));
      // Shown decoded (RFC 2047 words, RFC 2231 parameters, raw UTF-8); the Raw tab has the original bytes.
      var shown = EV.decodeHeaderForDisplay(h.value);
      if (shown !== h.value) nameCell.appendChild(el('span', 'ev-h-dec', 'decoded')).title = 'This header was encoded in the message; the decoded text is shown. The Raw tab has the original.';
      tr.appendChild(nameCell);
      tr.appendChild(el('td', 'ev-h-val', shown));
      var act = el('td', 'ev-h-act');
      act.appendChild(copyBtn(function () { return shown; }, 'Copy'));
      tr.appendChild(act);
      tbody.appendChild(tr);
      rows.push({ tr: tr, hay: (h.name + ' ' + shown + ' ' + (shown !== h.value ? h.value : '')).toLowerCase() }); // the filter finds either form
    });
    table.appendChild(tbody);
    var empty = el('div', 'ev-muted ev-hempty', 'No header matches.');
    empty.style.display = 'none';
    s.root.appendChild(table);
    s.root.appendChild(empty);

    function applyFilter() {
      var q = filterBox.value.trim().toLowerCase(), shown = 0;
      rows.forEach(function (r) { var show = !q || r.hay.indexOf(q) !== -1; r.tr.style.display = show ? '' : 'none'; if (show) shown++; });
      countEl.textContent = q ? shown + ' of ' + total + ' shown' : '';
      empty.style.display = shown ? 'none' : '';
    }
    filterBox.addEventListener('input', applyFilter);
    return s.root;
  }

  EV.ui.renderHeaders = renderHeaders;
})(typeof self !== 'undefined' ? self : this);
