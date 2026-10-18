/**
 * app.js — the composition root. Builds the long-lived objects (worker pool, search index, rules engine, state), looks up the page's
 * elements, creates each feature module from js/ui/features/ with one shared `ctx`, and starts the app. Everything feature-specific
 * lives in those modules (explorer, fileOps, tabsView, pages, folderLocation, workspace, tagsPanel, settingsPage, rulesPanel,
 * searchPanel, exportsPanel, session); shared UI primitives are in js/ui/overlays.js and js/ui/uiKit.js. This is the only file
 * that knows the whole list of modules.
 */
(function () {
  'use strict';

  var EV = window.EV;

  // Bump alongside CHANGELOG.md when shipping a notable batch of changes —
  // there's no build step/package.json to derive this from automatically.
  EV.VERSION = '1.2.0';

  var els = {};

  ['ev-btn-open-folder', 'ev-btn-open-files', 'ev-btn-resume', 'ev-search-options-row', 'ev-search-mode',
    'ev-search-input', 'ev-search-regex', 'ev-search-case', 'ev-search-options-hint',
    'ev-search-include', 'ev-search-exclude',
    'ev-search-select-bar', 'ev-search-select-all-checkbox', 'ev-search-select-count', 'ev-btn-clear-search-select',
    'ev-btn-search', 'ev-btn-search-cancel', 'ev-btn-search-help', 'ev-search-help', 'ev-btn-export-iocs', 'ev-btn-export-tags', 'ev-btn-import-tags', 'ev-import-tags-input', 'ev-btn-export-report', 'ev-version-marker',
    'ev-btn-save-tags-sidecar', 'ev-tags-sidecar-banner', 'ev-tags-sidecar-text', 'ev-btn-load-tags-sidecar', 'ev-btn-dismiss-tags-sidecar',
    'ev-resume-banner', 'ev-demo-banner', 'ev-btn-load-demo', 'ev-demo-always-show', 'ev-btn-dismiss-demo',
    'ev-sidebar', 'ev-tree-root-label', 'ev-btn-refresh-explorer', 'ev-btn-collapse-all', 'ev-btn-expand-all',
    'ev-tree-sort', 'ev-file-filter-mode', 'ev-tree-filter', 'ev-tree-container', 'ev-search-status', 'ev-btn-clear-search',
    'ev-parse-errors', 'ev-parse-errors-count', 'ev-parse-errors-list',
    'ev-bulk-tag-bar', 'ev-bulk-tag-count', 'ev-bulk-tag-input', 'ev-btn-bulk-tag-apply', 'ev-btn-bulk-tag-remove', 'ev-tag-actions-hint', 'ev-btn-tag-view', 'ev-btn-tag-remove', 'ev-btn-tag-delete', 'ev-btn-tag-files', 'ev-btn-bulk-tag-clear',
    'ev-search-results', 'ev-tag-filter-list', 'ev-splitter', 'ev-right-pane', 'ev-tab-strip',
    'ev-path-bar', 'ev-subtab-nav', 'ev-loading', 'ev-content', 'ev-empty-state', 'ev-status-files', 'ev-status-index',
    'ev-status-progress', 'ev-status-progress-bar', 'ev-status-ocr', 'ev-btn-stop-ocr', 'ev-status-selected', 'ev-status-remote', 'ev-status-mode', 'ev-main',
    'ev-btn-new-rule', 'ev-btn-run-all-rules', 'ev-btn-stop-rules', 'ev-btn-stop-indexing', 'ev-rules-status', 'ev-rules-list',
    'ev-btn-export-rules', 'ev-btn-import-rules', 'ev-import-rules-input',
    'ev-rule-modal-overlay', 'ev-rule-modal-title', 'ev-rule-name', 'ev-rule-tag', 'ev-rule-expression',
    'ev-rule-help-toggle', 'ev-rule-help', 'ev-rule-template-select', 'ev-rule-enabled', 'ev-btn-test-rule',
    'ev-rule-test-result', 'ev-rule-error', 'ev-btn-cancel-rule', 'ev-btn-save-rule',
    'ev-max-open-tabs', 'ev-server-port-value',
    'ev-internal-domains-list', 'ev-internal-domain-input', 'ev-btn-add-internal-domain',
    'ev-trusted-domains-list', 'ev-trusted-domain-input', 'ev-btn-add-trusted-domain', 'ev-btn-reset-trusted-domains',
    'ev-domain-categories-list', 'ev-btn-add-domain-category', 'ev-btn-reset-domain-categories',
    'ev-btn-settings', 'ev-view-settings', 'ev-btn-overview', 'ev-view-overview'
  ].forEach(function (id) { els[id.replace(/^ev-/, '').replace(/-/g, '_')] = document.getElementById(id); });

  var pool = EV.createWorkerPool('js/indexing/worker.js');

  var searchIdx = EV.createSearchIndex(pool);

  var rawSearchObj = EV.createRawSearch(pool);

  var rulesEngine = EV.createRulesEngine(pool);

  var state = {
    workspace: null,
    folderBase: '', // the opened folder's full on-disk path, found by scripts/serve.py and verified (browsers never expose it) -- '' = unknown
    folderLocateNote: '',
    pathToEntry: new Map(),
    visibleRows: [],
    treeFilter: '',
    tagFilter: new Set(),
    tagDotCache: new Map(), // path -> [tagNames]
    sortDirection: 'asc',
    selectedPath: null,
    indexStart: 0,
    multiSelectedPaths: new Set(),
    lastClickedPath: null,
    searchSelectedPaths: new Set(),
    lastClickedSearchPath: null,
    openTabPaths: new Set() // every path currently open as a tab in the right pane, not just the active one
  };

  els.version_marker.textContent = 'v' + EV.VERSION;

  els.status_mode.textContent = pool.isUsingWorkers()
    ? ('Workers: ' + pool.poolSize() + (window.crypto && window.crypto.subtle ? ' · hashing on' : ' · hashing off (serve over http/https)'))
    : 'Single-threaded (serve via http/https for background parsing)';

  // The one object every feature module shares: the long-lived objects above, plus whatever each feature exports for the others
  // (ctx.openTab, ctx.renderRulesList, ...). Features only reach each other through it, and only when a user action runs.
  var ctx = { state: state, els: els, pool: pool, searchIdx: searchIdx, rawSearchObj: rawSearchObj, rulesEngine: rulesEngine };
  var showToast = EV.ui.showToast;

  function showSidebarView(view) {
    document.querySelectorAll('.ev-sidebar-tab').forEach(function (b) { b.classList.toggle('active', b.dataset.view === view); });
    document.querySelectorAll('.ev-sidebar-view').forEach(function (v) { v.classList.toggle('active', v.id === 'ev-view-' + view); });
    if (view === 'tags') ctx.renderTagFilterList();
    if (view === 'rules') ctx.renderRulesList();
  }

  document.querySelectorAll('.ev-sidebar-tab').forEach(function (btn) {
    btn.addEventListener('click', function () { showSidebarView(btn.dataset.view); });
  });
  ctx.showSidebarView = showSidebarView;

  // Feature modules (js/ui/features/*.js), created in dependency order. Creating one only defines its functions and wires its own
  // controls; nothing in a module's creation calls into another module, so the order matters only for readability.
  ['explorer', 'fileOps', 'tabsView', 'pages', 'folderLocation', 'workspace', 'tagsPanel', 'settingsPage', 'rulesPanel', 'searchPanel',
    'exportsPanel', 'session'].forEach(function (name) { EV.ui.features[name](ctx); });

  (function () {
    var dragging = false;
    els.splitter.addEventListener('mousedown', function () { dragging = true; document.body.style.cursor = 'col-resize'; });
    window.addEventListener('mouseup', function () { dragging = false; document.body.style.cursor = ''; });
    window.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      var mainRect = els.main.getBoundingClientRect();
      var w = Math.max(180, Math.min(600, e.clientX - mainRect.left));
      els.sidebar.style.width = w + 'px';
    });
  })();

  document.addEventListener('keydown', function (e) {
    var mod = e.metaKey || e.ctrlKey;
    if (mod && e.shiftKey && (e.key === 'f' || e.key === 'F')) {
      e.preventDefault();
      showSidebarView('search');
      els.search_input.focus();
    } else if (e.altKey && e.key === 'ArrowRight') {
      ctx.tabMgr.next();
    } else if (e.altKey && e.key === 'ArrowLeft') {
      ctx.tabMgr.prev();
    } else if (mod && e.key === 'b') {
      e.preventDefault();
      els.sidebar.style.display = els.sidebar.style.display === 'none' ? 'flex' : 'none';
    } else if (e.altKey && (e.key === 'w' || e.key === 'W')) {
      // Ctrl/Cmd+W is reserved by every browser to close the actual browser
      // tab and can't be safely overridden, so Alt+W is the reliable "close
      // active email tab" shortcut here (the × on the tab always works too).
      e.preventDefault();
      var active = ctx.tabMgr.getActive();
      if (active) ctx.tabMgr.close(active.id);
    }
  });

  ctx.refreshTagDotCache().then(ctx.rebuildVisibleRows);

  ctx.updateFilesStatus();

  ctx.updateTagsSidecarButtonState();

  /**
   * Tells scripts/serve.py this tab is still open, so the server can exit by itself once the last
   * tab closes (instead of leaving a stale process holding the port). Same-origin requests to the
   * local server only -- never leaves the machine -- and only started on localhost/127.0.0.1, so a
   * hosted copy (e.g. GitHub Pages) makes no extra requests at all. Harmless if the server is an
   * older copy or `--keep-running`: pings just go unused.
   */
  function startLocalServerHeartbeat() {
    if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return;
    var id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    function ping() { fetch('__mantiz/ping?id=' + id, { cache: 'no-store' }).catch(function () {}); }
    ping();
    setInterval(ping, 5000);
    window.addEventListener('pagehide', function () {
      if (navigator.sendBeacon) navigator.sendBeacon('__mantiz/bye?id=' + id);
    });
    window.addEventListener('pageshow', function (e) { if (e.persisted) ping(); });
  }

  ctx.tryResumeSession();

  startLocalServerHeartbeat();

  ctx.initDemoBanner();

  // One-off cleanup for empty tag/note records left over from before disabling
  // a rule (or removing a tag) properly deleted them instead of leaving a husk.
  EV.tags.pruneEmpty();

  // One-off conversion of tags (and rule tags) saved before tag names were restricted to lowercase
  // a-z, 0-9, - and _ . Idempotent: does nothing once everything already conforms.
  EV.tags.migrateLegacyNames().then(function (res) {
    return EV.rulesStore.migrateTagNames().then(function (ruleCount) {
      var olds = Object.keys(res.renames);
      if (!olds.length && !ruleCount) return;
      showToast('Converted ' + olds.length + ' old tag name' + (olds.length === 1 ? '' : 's') + ' to the new format (lowercase a\u2013z, 0\u20139, - and _)' +
        (olds.length ? ', e.g. "' + olds[0] + '" \u2192 "' + res.renames[olds[0]] + '"' : '') + '.', { duration: 7000 });
      window.EV.onTagsChanged();
    });
  }).catch(function () { /* best effort: a failed conversion just leaves old names as they were */ });
})();
