/**
 * app.js — bootstraps the page: wires the toolbar, folder ingestion, tree,
 * tabs, search panel and status bar together. This is the only file that
 * reaches into the DOM structure of index.html directly.
 */
(function () {
  'use strict';
  var EV = window.EV;

  // Bump alongside CHANGELOG.md when shipping a notable batch of changes —
  // there's no build step/package.json to derive this from automatically.
  EV.VERSION = '1.1.0';

  function fmtBytesShort(n) {
    if (n == null) return '?';
    if (n < 1024) return n + 'B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + 'KB';
    return (n / (1024 * 1024)).toFixed(1) + 'MB';
  }

  var els = {};
  ['ev-btn-open-folder', 'ev-btn-open-files', 'ev-btn-resume', 'ev-search-options-row', 'ev-search-mode',
    'ev-search-input', 'ev-search-regex', 'ev-search-case', 'ev-search-options-hint',
    'ev-btn-search', 'ev-btn-search-cancel', 'ev-btn-search-help', 'ev-search-help', 'ev-btn-export-iocs', 'ev-btn-export-tags', 'ev-btn-import-tags', 'ev-import-tags-input', 'ev-btn-export-report', 'ev-version-marker',
    'ev-btn-save-tags-sidecar', 'ev-tags-sidecar-banner', 'ev-tags-sidecar-text', 'ev-btn-load-tags-sidecar', 'ev-btn-dismiss-tags-sidecar',
    'ev-resume-banner', 'ev-demo-banner', 'ev-btn-load-demo', 'ev-demo-always-show', 'ev-btn-dismiss-demo',
    'ev-sidebar', 'ev-tree-root-label', 'ev-btn-collapse-all', 'ev-btn-expand-all',
    'ev-tree-sort', 'ev-file-filter-mode', 'ev-tree-filter', 'ev-tree-container', 'ev-search-status', 'ev-btn-clear-search',
    'ev-parse-errors', 'ev-parse-errors-count', 'ev-parse-errors-list',
    'ev-bulk-tag-bar', 'ev-bulk-tag-count', 'ev-bulk-tag-input', 'ev-btn-bulk-tag-apply', 'ev-btn-bulk-tag-clear',
    'ev-search-results', 'ev-tag-filter-list', 'ev-splitter', 'ev-right-pane', 'ev-tab-strip',
    'ev-path-bar', 'ev-subtab-nav', 'ev-loading', 'ev-content', 'ev-empty-state', 'ev-status-files', 'ev-status-index',
    'ev-status-progress', 'ev-status-progress-bar', 'ev-status-selected', 'ev-status-mode', 'ev-main',
    'ev-btn-new-rule', 'ev-btn-run-all-rules', 'ev-btn-stop-rules', 'ev-btn-stop-indexing', 'ev-rules-status', 'ev-rules-list',
    'ev-btn-export-rules', 'ev-btn-import-rules', 'ev-import-rules-input',
    'ev-rule-modal-overlay', 'ev-rule-modal-title', 'ev-rule-name', 'ev-rule-tag', 'ev-rule-expression',
    'ev-rule-help-toggle', 'ev-rule-help', 'ev-rule-template-select', 'ev-rule-enabled', 'ev-btn-test-rule',
    'ev-rule-test-result', 'ev-rule-error', 'ev-btn-cancel-rule', 'ev-btn-save-rule',
    'ev-trusted-domains-list', 'ev-trusted-domain-input', 'ev-btn-add-trusted-domain', 'ev-btn-reset-trusted-domains',
    'ev-domain-categories-list', 'ev-btn-add-domain-category', 'ev-btn-reset-domain-categories',
    'ev-btn-settings', 'ev-view-settings'
  ].forEach(function (id) { els[id.replace(/^ev-/, '').replace(/-/g, '_')] = document.getElementById(id); });

  var pool = EV.createWorkerPool('js/indexing/worker.js');
  var searchIdx = EV.createSearchIndex(pool);
  var rawSearchObj = EV.createRawSearch(pool);
  var rulesEngine = EV.createRulesEngine(pool);

  var state = {
    workspace: null,
    pathToEntry: new Map(),
    visibleRows: [],
    treeFilter: '',
    tagFilter: new Set(),
    tagDotCache: new Map(), // path -> [tagNames]
    sortDirection: 'asc',
    selectedPath: null,
    indexStart: 0,
    multiSelectedPaths: new Set(),
    lastClickedPath: null
  };

  els.version_marker.textContent = 'v' + EV.VERSION;
  els.status_mode.textContent = pool.isUsingWorkers()
    ? ('Workers: ' + pool.poolSize() + (window.crypto && window.crypto.subtle ? ' · hashing on' : ' · hashing off (serve over http/https)'))
    : 'Single-threaded (serve via http/https for background parsing)';

  // ---------- tree ----------

  var treeList = EV.createVirtualList(els.tree_container, {
    rowHeight: 22,
    renderRow: renderTreeRow
  });

  function flattenVisible(node, depth, out, filterLower) {
    if (node.type === 'folder') {
      var anyChildMatches = filterLower ? folderHasMatch(node, filterLower) : true;
      if (!anyChildMatches) return;
      out.push({ node: node, depth: depth });
      if (node.expanded) {
        node.children.forEach(function (c) { flattenVisible(c, depth + 1, out, filterLower); });
      }
    } else {
      if (filterLower && node.name.toLowerCase().indexOf(filterLower) === -1) return;
      if (state.tagFilter.size > 0) {
        var tags = state.tagDotCache.get(node.path) || [];
        var hasAny = tags.some(function (t) { return state.tagFilter.has(t); });
        if (!hasAny) return;
      }
      out.push({ node: node, depth: depth });
    }
  }

  var matchCache = new WeakMap();
  function folderHasMatch(folder, filterLower) {
    for (var i = 0; i < folder.children.length; i++) {
      var c = folder.children[i];
      if (c.type === 'file') {
        if (c.name.toLowerCase().indexOf(filterLower) !== -1) return true;
      } else if (folderHasMatch(c, filterLower)) return true;
    }
    return false;
  }

  function rebuildVisibleRows() {
    var out = [];
    var filterLower = state.treeFilter.trim().toLowerCase() || null;
    if (state.workspace) {
      state.workspace.root.children.forEach(function (c) { flattenVisible(c, 0, out, filterLower); });
    }
    state.visibleRows = out;
    treeList.setItems(out);
  }

  /** Expands ancestor folders and scrolls the tree so `path` is visible — mirrors "reveal in explorer". */
  function revealInTree(path) {
    if (!state.workspace) return;
    var parts = path.split('/');
    var node = state.workspace.root;
    var changedExpansion = false;
    for (var i = 0; i < parts.length - 1; i++) {
      var seg = parts[i];
      var child = null;
      for (var j = 0; j < node.children.length; j++) {
        if (node.children[j].type === 'folder' && node.children[j].name === seg) { child = node.children[j]; break; }
      }
      if (!child) return;
      if (!child.expanded) { child.expanded = true; changedExpansion = true; }
      node = child;
    }
    if (changedExpansion) rebuildVisibleRows();
    var idx = state.visibleRows.findIndex(function (r) { return r.node.path === path; });
    if (idx !== -1) treeList.scrollToIndex(idx);
  }

  function renderTreeRow(row, rowEl) {
    if (!row) return;
    var node = row.node;
    rowEl.className = 'ev-tree-row';
    for (var g = 0; g < row.depth; g++) {
      rowEl.appendChild(document.createElement('span')).className = 'ev-tree-guide';
    }
    if (node.type === 'folder') {
      rowEl.classList.add('ev-tree-folder');
      var caret = document.createElement('span');
      caret.className = 'ev-tree-caret';
      caret.textContent = node.expanded ? '▾' : '▸';
      rowEl.appendChild(caret);
      var icon = EV.iconEl('folder', 'ev-tree-icon');
      rowEl.appendChild(icon);
      rowEl.appendChild(document.createTextNode(node.name));
      rowEl.onclick = function () {
        node.expanded = !node.expanded;
        rebuildVisibleRows();
      };
    } else {
      var isEml = EV.isEmlFile(node.name);
      rowEl.classList.add(isEml ? 'ev-tree-file' : 'ev-tree-file-other');
      if (node.path === state.selectedPath) rowEl.classList.add('selected');
      if (state.multiSelectedPaths.has(node.path)) rowEl.classList.add('multi-selected');
      var ficon = EV.iconEl(isEml ? 'mail' : 'file', 'ev-tree-icon');
      rowEl.appendChild(ficon);
      rowEl.appendChild(document.createTextNode(node.name));
      var tags = state.tagDotCache.get(node.path);
      if (tags && tags.length) {
        var dots = document.createElement('span');
        dots.className = 'ev-tag-dots';
        tags.slice(0, 5).forEach(function (t) {
          var d = document.createElement('span');
          d.className = 'ev-tag-dot';
          d.style.background = EV.tagColor(t);
          d.title = t;
          dots.appendChild(d);
        });
        rowEl.appendChild(dots);
      }
      rowEl.onclick = function (e) {
        if (!isEml) return;
        if (e.shiftKey && state.lastClickedPath) {
          var visPaths = state.visibleRows.map(function (r) { return r.node.path; });
          var a = visPaths.indexOf(state.lastClickedPath);
          var b = visPaths.indexOf(node.path);
          if (a !== -1 && b !== -1) {
            var lo = Math.min(a, b), hi = Math.max(a, b);
            for (var i = lo; i <= hi; i++) {
              var rn = state.visibleRows[i].node;
              if (rn.type === 'file' && EV.isEmlFile(rn.name)) state.multiSelectedPaths.add(rn.path);
            }
            updateBulkTagBar();
            treeList.setItems(state.visibleRows);
            return;
          }
        }
        if (e.metaKey || e.ctrlKey) {
          if (state.multiSelectedPaths.has(node.path)) state.multiSelectedPaths.delete(node.path);
          else state.multiSelectedPaths.add(node.path);
          state.lastClickedPath = node.path;
          updateBulkTagBar();
          treeList.setItems(state.visibleRows);
          return;
        }
        if (state.multiSelectedPaths.size) { state.multiSelectedPaths.clear(); updateBulkTagBar(); }
        state.lastClickedPath = node.path;
        openTab(node.entry);
      };
      rowEl.oncontextmenu = function (e) {
        if (!isEml) return;
        e.preventDefault();
        var targetPaths = (state.multiSelectedPaths.has(node.path) && state.multiSelectedPaths.size > 1)
          ? Array.from(state.multiSelectedPaths)
          : [node.path];
        showFileActionMenu(e.clientX, e.clientY, targetPaths);
      };
      rowEl.title = node.path;
    }
  }

  function updateBulkTagBar() {
    var n = state.multiSelectedPaths.size;
    if (n === 0) { els.bulk_tag_bar.style.display = 'none'; return; }
    els.bulk_tag_bar.style.display = 'flex';
    els.bulk_tag_count.textContent = n.toLocaleString() + ' selected';
  }

  els.tree_filter.addEventListener('input', function () {
    state.treeFilter = els.tree_filter.value;
    rebuildVisibleRows();
  });

  els.btn_collapse_all.addEventListener('click', function () {
    if (!state.workspace) return;
    EV.setAllExpanded(state.workspace.root, false);
    rebuildVisibleRows();
  });
  els.btn_expand_all.addEventListener('click', function () {
    if (!state.workspace) return;
    EV.setAllExpanded(state.workspace.root, true);
    rebuildVisibleRows();
  });
  els.tree_sort.addEventListener('change', function () {
    state.sortDirection = els.tree_sort.value;
    if (!state.workspace) return;
    EV.sortTree(state.workspace.root, state.sortDirection);
    rebuildVisibleRows();
  });
  els.file_filter_mode.addEventListener('change', function () {
    EV.fileFilterMode = els.file_filter_mode.value;
    rebuildVisibleRows();
    updateFilesStatus();
    if (state.workspace) startIndexing(); // which files count as emails changed -- re-index against the new set
  });

  function clearMultiSelection() {
    state.multiSelectedPaths.clear();
    updateBulkTagBar();
    rebuildVisibleRows();
  }
  els.btn_bulk_tag_clear.addEventListener('click', clearMultiSelection);
  els.btn_bulk_tag_apply.addEventListener('click', function () {
    var tagName = els.bulk_tag_input.value.trim();
    if (!tagName) return;
    var paths = Array.from(state.multiSelectedPaths);
    Promise.all(paths.map(function (path) {
      var eid = searchIdx.emailIdForPath(path);
      return eid ? EV.tags.addTag(eid, tagName) : Promise.resolve();
    })).then(function () {
      els.bulk_tag_input.value = '';
      window.EV.onTagsChanged();
    });
  });
  els.bulk_tag_input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') els.btn_bulk_tag_apply.click();
  });

  // ---------- file operations: delete / move / copy (context menu) ----------

  var activeContextMenu = null;
  function closeContextMenu() {
    if (!activeContextMenu) return;
    activeContextMenu.remove();
    activeContextMenu = null;
    document.removeEventListener('click', closeContextMenu, true);
    document.removeEventListener('keydown', onContextMenuKeydown, true);
  }
  function onContextMenuKeydown(e) { if (e.key === 'Escape') closeContextMenu(); }
  function showContextMenu(x, y, items) {
    closeContextMenu();
    var menu = document.createElement('div');
    menu.className = 'ev-context-menu';
    items.forEach(function (item) {
      if (item.separator) { menu.appendChild(el('div', 'ev-context-menu-sep')); return; }
      var btn = document.createElement('button');
      btn.className = 'ev-context-menu-item' + (item.danger ? ' danger' : '');
      btn.disabled = !!item.disabled;
      if (item.title) btn.title = item.title;
      var icon = el('span', 'ev-context-menu-icon');
      icon.innerHTML = item.icon || '';
      var label = el('span', null, item.label);
      btn.appendChild(icon);
      btn.appendChild(label);
      btn.onclick = function () { closeContextMenu(); if (item.onClick) item.onClick(); };
      menu.appendChild(btn);
    });
    document.body.appendChild(menu);
    var rect = menu.getBoundingClientRect();
    var left = Math.min(x, window.innerWidth - rect.width - 8);
    var top = Math.min(y, window.innerHeight - rect.height - 8);
    menu.style.left = Math.max(4, left) + 'px';
    menu.style.top = Math.max(4, top) + 'px';
    activeContextMenu = menu;
    setTimeout(function () {
      document.addEventListener('click', closeContextMenu, true);
      document.addEventListener('keydown', onContextMenuKeydown, true);
    }, 0);
  }

  function el(tag, className, text) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function pathsToEntries(paths) {
    return paths.map(function (p) { return state.pathToEntry.get(p); }).filter(Boolean);
  }

  function reloadWorkspaceFromHandle() {
    return EV.resumeFromDirHandle(state.workspace.dirHandle).then(function (ws) { setWorkspace(ws); });
  }

  function reportFileOpResult(verb, result) {
    var msg = verb + ' ' + result.succeeded.length + ' email(s).';
    if (result.failed.length) {
      msg += ' ' + result.failed.length + ' failed: ' + result.failed.map(function (f) { return f.path + ' (' + f.error + ')'; }).join('; ');
    }
    alert(msg);
  }

  var WRITE_UNAVAILABLE_TITLE = 'Only available when this folder was opened via "Open Folder" in Chrome/Edge, with write access granted.';

  function performDelete(paths) {
    if (!confirm('Move ' + paths.length + ' email(s) to .deleted?\n\nThey\'ll be removed from this folder\'s view (tree, search, rules) but not permanently deleted — recover them from the .deleted folder on disk any time.')) return;
    var dirHandle = state.workspace.dirHandle;
    EV.ensureWritePermission(dirHandle).then(function (granted) {
      if (!granted) { alert('Write permission was not granted — nothing was changed.'); return null; }
      return EV.deleteEntries(pathsToEntries(paths), dirHandle).then(function (result) {
        reportFileOpResult('Deleted', result);
        return reloadWorkspaceFromHandle();
      });
    }).catch(function (err) { alert('Delete failed: ' + (err && err.message || err)); });
  }

  function performMoveCopy(paths, folderPath, mode) {
    var dirHandle = state.workspace.dirHandle;
    EV.ensureWritePermission(dirHandle).then(function (granted) {
      if (!granted) { alert('Write permission was not granted — nothing was changed.'); return null; }
      return EV.resolveFolderPath(dirHandle, folderPath).then(function (destHandle) {
        return EV.copyOrMoveEntries(pathsToEntries(paths), destHandle, mode === 'move').then(function (result) {
          reportFileOpResult(mode === 'move' ? 'Moved' : 'Copied', result);
          return reloadWorkspaceFromHandle();
        });
      });
    }).catch(function (err) { alert((mode === 'move' ? 'Move' : 'Copy') + ' failed: ' + (err && err.message || err)); });
  }

  function openMoveCopyDialog(paths, mode) {
    var overlay = el('div', 'ev-modal-overlay');
    var modal = el('div', 'ev-modal');
    var countLabel = paths.length === 1 ? '1 email' : paths.length + ' emails';
    modal.appendChild(el('h3', null, (mode === 'move' ? 'Move ' : 'Copy ') + countLabel + ' to folder'));

    modal.appendChild(el('label', 'ev-form-label', 'Existing folder'));
    var select = document.createElement('select');
    select.className = 'ev-form-input';
    var noneOpt = el('option', null, '— none, type a new name below —');
    noneOpt.value = '';
    select.appendChild(noneOpt);
    EV.listExistingFolders(state.workspace.root).forEach(function (f) {
      var o = el('option', null, f);
      o.value = f;
      select.appendChild(o);
    });
    modal.appendChild(select);

    modal.appendChild(el('label', 'ev-form-label', 'Or new folder name'));
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'ev-form-input';
    input.placeholder = 'e.g. campaign-invoice-fraud';
    modal.appendChild(input);

    select.addEventListener('change', function () { if (select.value) input.value = ''; });
    input.addEventListener('input', function () { if (input.value) select.value = ''; });

    var actions = el('div', 'ev-modal-actions');
    var cancelBtn = el('button', 'ev-btn', 'Cancel');
    var okBtn = el('button', 'ev-btn ev-btn-primary', mode === 'move' ? 'Move' : 'Copy');
    cancelBtn.onclick = function () { overlay.remove(); };
    okBtn.onclick = function () {
      var folderPath = select.value || EV.sanitizeFolderName(input.value);
      if (!folderPath) { alert('Pick an existing folder, or type a new folder name.'); return; }
      overlay.remove();
      performMoveCopy(paths, folderPath, mode);
    };
    actions.appendChild(cancelBtn);
    actions.appendChild(okBtn);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    input.focus();
  }

  /** Builds the right-click menu for one or more selected email paths. Shared by the tree, and (later) Tags/Rules bulk actions. */
  function showFileActionMenu(x, y, paths) {
    var writable = EV.hasWriteCapableWorkspace(state.workspace);
    var label = paths.length === 1 ? '1 email' : paths.length + ' emails';
    showContextMenu(x, y, [
      {
        label: 'Delete ' + label + ' (to .deleted)', icon: EV.iconSvg('trash'), danger: true, disabled: !writable,
        title: writable ? 'Moves to a hidden .deleted folder — reversible, never shown by this app again.' : WRITE_UNAVAILABLE_TITLE,
        onClick: function () { performDelete(paths); }
      },
      {
        label: 'Move ' + label + ' to folder…', icon: EV.iconSvg('folderArrow'), disabled: !writable,
        title: writable ? null : WRITE_UNAVAILABLE_TITLE,
        onClick: function () { openMoveCopyDialog(paths, 'move'); }
      },
      {
        label: 'Copy ' + label + ' to folder…', icon: EV.iconSvg('copy'), disabled: !writable,
        title: writable ? null : WRITE_UNAVAILABLE_TITLE,
        onClick: function () { openMoveCopyDialog(paths, 'copy'); }
      }
    ]);
  }
  EV.showFileActionMenu = showFileActionMenu;

  // ---------- tabs / right pane ----------

  var tabMgr = EV.createTabManager(els.tab_strip, {
    onActivate: onTabActivate,
    onChange: saveSession,
    getTagsForPath: function (path) { return state.tagDotCache.get(path); }
  });

  function openTab(entry) {
    tabMgr.open(entry);
  }

  var settingsOpen = false;
  function closeSettingsView() {
    settingsOpen = false;
    els.view_settings.style.display = 'none';
    els.btn_settings.classList.remove('active');
    els.content.style.display = '';
  }
  function openSettingsView() {
    settingsOpen = true;
    els.empty_state.style.display = 'none';
    els.subtab_nav.style.display = 'none';
    els.content.style.display = 'none';
    els.view_settings.style.display = 'flex';
    els.btn_settings.classList.add('active');
    renderSettingsView();
  }
  els.btn_settings.addEventListener('click', function () {
    if (settingsOpen) { closeSettingsView(); onTabActivate(tabMgr.getActive()); }
    else openSettingsView();
  });

  function onTabActivate(tab) {
    if (settingsOpen) closeSettingsView();
    els.empty_state.style.display = tab ? 'none' : 'flex';
    els.subtab_nav.style.display = tab ? 'flex' : 'none';
    state.selectedPath = tab ? tab.path : null;
    treeList.refresh();
    if (!tab) {
      els.content.innerHTML = '';
      els.path_bar.innerHTML = '';
      els.status_selected.textContent = '';
      return;
    }
    els.status_selected.textContent = tab.path;
    renderPathBar(tab.path);
    EV.renderTab(tab, { subtabNav: els.subtab_nav, content: els.content, loading: els.loading, onParsed: function () { tabMgr.renderStrip(); } });
    saveSession();
    revealInTree(tab.path);
  }
  function renderPathBar(relPath) {
    els.path_bar.innerHTML = '';
    var root = document.createElement('span');
    root.className = 'ev-path-seg ev-path-root';
    root.textContent = '📂 ' + (state.workspace ? state.workspace.name : '');
    els.path_bar.appendChild(root);
    (relPath || '').split('/').forEach(function (part) {
      els.path_bar.appendChild(Object.assign(document.createElement('span'), { className: 'ev-path-sep', textContent: '/' }));
      els.path_bar.appendChild(Object.assign(document.createElement('span'), { className: 'ev-path-seg', textContent: part }));
    });
  }

  onTabActivate(null);

  window.EV.onTagsChanged = function () {
    refreshTagDotCache().then(function () {
      rebuildVisibleRows();
      tabMgr.renderStrip();
    });
    renderTagFilterList();
  };

  // ---------- folder opening ----------

  var hiddenDirInput = document.createElement('input');
  hiddenDirInput.type = 'file';
  hiddenDirInput.webkitdirectory = true;
  hiddenDirInput.multiple = true;
  hiddenDirInput.style.display = 'none';
  document.body.appendChild(hiddenDirInput);
  hiddenDirInput.addEventListener('change', function () {
    if (!hiddenDirInput.files.length) return;
    var ws = EV.buildTreeFromFileList(hiddenDirInput.files);
    if (ws) setWorkspace(ws);
    hiddenDirInput.value = '';
  });

  // ---------- sample-emails demo ----------

  /** Fetches the bundled sample-emails/ folder (same-origin static files) and feeds it through the
   * exact same fallback ingestion path as a real folder pick (hiddenDirInput's own 'change' handler)
   * — not a parallel code path. Only works when served over http(s); a plain file:// open can't
   * fetch() its own sibling files due to the browser's file:// CORS restrictions, so that failure is
   * caught and reported rather than silently doing nothing. */
  function loadSampleEmails() {
    return fetch('sample-emails/manifest.json').then(function (resp) {
      if (!resp.ok) throw new Error('manifest not found (' + resp.status + ')');
      return resp.json();
    }).then(function (relPaths) {
      return Promise.all(relPaths.map(function (rel) {
        var fullPath = 'sample-emails/' + rel;
        return fetch(fullPath).then(function (r) {
          if (!r.ok) throw new Error(fullPath + ': ' + r.status);
          return r.blob();
        }).then(function (blob) {
          var file = new File([blob], rel.split('/').pop(), { type: 'message/rfc822' });
          Object.defineProperty(file, 'webkitRelativePath', { value: fullPath });
          return file;
        });
      }));
    }).then(function (files) {
      var dt = new DataTransfer();
      files.forEach(function (f) { dt.items.add(f); });
      hiddenDirInput.files = dt.files;
      hiddenDirInput.dispatchEvent(new Event('change', { bubbles: true }));
    }).catch(function (err) {
      alert('Could not load the sample emails automatically (' + err.message + ').\n\n' +
        'This only works when the app is served over http(s) — e.g. via scripts/run.sh — not when ' +
        'opened directly as a file. You can still browse to the "sample-emails" folder yourself with ' +
        'Open Folder.');
    });
  }

  function initDemoBanner() {
    EV.settings.demoState().then(function (demo) {
      if (demo.dismissedOnce && !demo.alwaysShow) return;
      els.demo_always_show.checked = !!demo.alwaysShow;
      els.demo_banner.style.display = 'flex';
      // Marks it seen the moment it's actually shown, not only when the user interacts with it --
      // otherwise a first-time user who ignores the banner and just clicks "Open Folder" instead
      // would see it again on every future run (not "first time only") until they explicitly ticked
      // "show this again next time".
      if (!demo.dismissedOnce) EV.settings.setDemoState({ dismissedOnce: true });
    });
  }
  els.btn_load_demo.addEventListener('click', function () {
    EV.settings.setDemoState({ dismissedOnce: true, alwaysShow: els.demo_always_show.checked });
    els.demo_banner.style.display = 'none';
    loadSampleEmails();
  });
  els.btn_dismiss_demo.addEventListener('click', function () {
    EV.settings.setDemoState({ dismissedOnce: true, alwaysShow: els.demo_always_show.checked });
    els.demo_banner.style.display = 'none';
  });

  var hiddenFilesInput = document.createElement('input');
  hiddenFilesInput.type = 'file';
  hiddenFilesInput.accept = '.eml';
  hiddenFilesInput.multiple = true;
  hiddenFilesInput.style.display = 'none';
  document.body.appendChild(hiddenFilesInput);
  hiddenFilesInput.addEventListener('change', function () {
    if (!hiddenFilesInput.files.length) return;
    var ws = EV.buildTreeFromFlatFiles(hiddenFilesInput.files);
    setWorkspace(ws);
    hiddenFilesInput.value = '';
  });

  els.btn_open_folder.addEventListener('click', async function () {
    if (EV.hasDirectoryPicker()) {
      try {
        var ws = await EV.openFolderWithDirectoryPicker();
        setWorkspace(ws);
      } catch (e) {
        if (e && e.name !== 'AbortError') {
          console.error(e);
          hiddenDirInput.click();
        }
      }
    } else {
      hiddenDirInput.click();
    }
  });
  els.btn_open_files.addEventListener('click', function () { hiddenFilesInput.click(); });

  ['dragover', 'drop'].forEach(function (evt) {
    document.addEventListener(evt, function (e) { e.preventDefault(); });
  });
  document.addEventListener('drop', async function (e) {
    if (!e.dataTransfer || !e.dataTransfer.items || !e.dataTransfer.items.length) return;
    try {
      var ws = await EV.buildTreeFromDataTransferItems(e.dataTransfer.items);
      if (ws) setWorkspace(ws);
    } catch (err) {
      console.error('Drop failed', err);
    }
  });

  function setWorkspace(ws) {
    if (tabMgr) tabMgr.closeAll();
    clearSearchResults();
    state.multiSelectedPaths.clear();
    state.lastClickedPath = null;
    updateBulkTagBar();
    state.workspace = ws;
    if (state.sortDirection !== 'asc') EV.sortTree(ws.root, state.sortDirection);
    state.pathToEntry = new Map();
    EV.flattenFileNodes(ws.root).forEach(function (n) { state.pathToEntry.set(n.path, n.entry); });
    state.treeFilter = '';
    els.tree_filter.value = '';
    state.tagFilter.clear();
    rebuildVisibleRows();
    updateFilesStatus();
    updateTagsSidecarButtonState();
    checkForTagsSidecar(ws);
    saveSession();
    startIndexing();
  }

  function updateFilesStatus() {
    var n = state.workspace ? EV.flattenFileNodes(state.workspace.root).filter(function (f) { return EV.isEmlFile(f.name); }).length : 0;
    els.status_files.textContent = state.workspace ? (state.workspace.name + ' — ' + n.toLocaleString() + ' .eml files') : 'No folder open';
    els.tree_root_label.textContent = state.workspace ? ('📂 ' + state.workspace.name) : 'No folder open';
  }

  // ---------- indexing ----------

  function updateParseErrorsPanel() {
    var skipped = searchIdx.skippedFiles();
    els.parse_errors_count.textContent = skipped.length;
    els.parse_errors_list.innerHTML = '';
    if (skipped.length === 0) { els.parse_errors.style.display = 'none'; return; }
    els.parse_errors.style.display = '';
    skipped.slice(0, 500).forEach(function (s) {
      var row = document.createElement('div');
      row.className = 'ev-muted-small';
      row.style.padding = '2px 0';
      row.title = s.path + ' — ' + s.reason;
      row.textContent = s.path + ' — ' + s.reason;
      els.parse_errors_list.appendChild(row);
    });
    if (skipped.length > 500) {
      var more = document.createElement('div');
      more.className = 'ev-muted-small';
      more.textContent = '… and ' + (skipped.length - 500).toLocaleString() + ' more';
      els.parse_errors_list.appendChild(more);
    }
  }

  function startIndexing() {
    searchIdx.cancel();
    els.parse_errors.style.display = 'none';
    els.status_progress.style.display = 'flex';
    els.btn_stop_indexing.style.display = 'inline-block';
    els.btn_stop_indexing.onclick = function () { searchIdx.cancel(); };
    var startTs = Date.now();
    els.status_index.textContent = 'Indexing…';
    // If the user opens another folder before this one finishes indexing,
    // searchIndex.js's own epoch guard keeps this run's data out of the new
    // run's arrays — but without this check, this run's completion handler
    // would still fire and stomp the progress bar / status text / rule-run
    // trigger for whichever folder is now actually current.
    var indexingWorkspace = state.workspace;
    Promise.all([EV.settings.trustedDomains(), EV.settings.domainCategories()]).then(function (res) {
      if (state.workspace !== indexingWorkspace) return;
      return searchIdx.startIndexing(state.workspace, {
        trustedDomains: res[0],
        domainCategories: res[1],
        onProgress: function (done, total) {
          if (state.workspace !== indexingWorkspace) return;
          var pct = total ? Math.round((done / total) * 100) : 0;
          els.status_progress_bar.style.width = pct + '%';
          var rate = Math.round(done / Math.max(0.5, (Date.now() - startTs) / 1000));
          els.status_index.textContent = 'Indexing ' + done.toLocaleString() + ' / ' + total.toLocaleString() + ' (' + rate.toLocaleString() + '/s)';
        }
      }).then(function (result) {
        if (state.workspace !== indexingWorkspace) return;
        els.status_progress.style.display = 'none';
        els.btn_stop_indexing.style.display = 'none';
        els.status_index.textContent = result.cancelled ? 'Indexing stopped' : ('Indexed ' + result.indexed.toLocaleString() + ' emails, ready to search');
        refreshTagDotCache().then(rebuildVisibleRows);
        updateParseErrorsPanel();
        if (!result.cancelled) runAllEnabledRules();
      });
    });
  }

  function refreshTagDotCache() {
    return EV.tags.getAll().then(function (records) {
      state.tagDotCache = new Map();
      if (!state.workspace) return;
      var pathsByEmailId = searchIdx.pathsByEmailId();
      records.forEach(function (r) {
        if (!r.tags || !r.tags.length) return;
        var paths = pathsByEmailId.get(r.id);
        if (paths) paths.forEach(function (p) { state.tagDotCache.set(p, r.tags); });
      });
    });
  }

  function renderTagFilterList() {
    EV.tags.allTagNames().then(function (names) {
      els.tag_filter_list.innerHTML = '';
      if (!names.length) {
        els.tag_filter_list.appendChild(Object.assign(document.createElement('div'), { className: 'ev-muted-small', textContent: 'No tags yet — add one from an open email.' }));
        return;
      }
      names.forEach(function (name) {
        var label = document.createElement('label');
        label.className = 'ev-tag-filter-item';
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = state.tagFilter.has(name);
        cb.onchange = function () {
          if (cb.checked) state.tagFilter.add(name); else state.tagFilter.delete(name);
          rebuildVisibleRows();
        };
        var dot = document.createElement('span');
        dot.className = 'ev-tag-dot';
        dot.style.background = EV.tagColor(name);
        label.appendChild(cb);
        label.appendChild(dot);
        var nameSpan = el('span', 'ev-tag-filter-name', name);
        label.appendChild(nameSpan);
        var menuBtn = document.createElement('button');
        menuBtn.type = 'button';
        menuBtn.className = 'ev-mini-btn ev-tag-menu-btn';
        menuBtn.textContent = '⋯';
        menuBtn.title = 'Move, copy, or delete every email carrying this tag';
        menuBtn.onclick = function (e) {
          e.preventDefault();
          e.stopPropagation();
          resolvePathsForTag(name).then(function (paths) {
            if (!paths.length) { alert('No indexed emails currently carry this tag.'); return; }
            showFileActionMenu(e.clientX, e.clientY, paths);
          });
        };
        label.appendChild(menuBtn);
        els.tag_filter_list.appendChild(label);
      });
    });
  }

  /** All indexed emails' paths that currently carry the given tag — feeds the Tags panel's bulk Move/Copy/Delete menu. */
  function resolvePathsForTag(tagName) {
    return searchIdx.search('tag:"' + tagName + '"', { limit: 1000000 }).then(function (res) {
      return res.results.map(function (r) { return r.path; });
    });
  }

  // ---------- settings ----------

  function renderTrustedDomainsList() {
    EV.settings.trustedDomains().then(function (domains) {
      els.trusted_domains_list.innerHTML = '';
      if (!domains.length) {
        els.trusted_domains_list.appendChild(el('div', 'ev-muted-small', 'No trusted domains configured.'));
        return;
      }
      domains.slice().sort().forEach(function (domain) {
        var chip = document.createElement('span');
        chip.className = 'ev-trusted-domain-chip' + (EV.ruleHelpers.isRegexTrustedEntry(domain) ? ' ev-trusted-domain-regex' : '');
        chip.title = EV.ruleHelpers.isRegexTrustedEntry(domain) ? 'Regex pattern — matches any domain it tests true against' : domain;
        chip.appendChild(document.createTextNode(domain));
        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.textContent = '×';
        removeBtn.title = 'Remove ' + domain;
        removeBtn.onclick = function () {
          EV.settings.setTrustedDomains(domains.filter(function (d) { return d !== domain; })).then(renderTrustedDomainsList);
        };
        chip.appendChild(removeBtn);
        els.trusted_domains_list.appendChild(chip);
      });
    });
  }

  /** Parses a bulk-paste textarea the same way the trusted-domains one does: newline-first, then
   * comma/space within a line, entries deduped by setDomainCategories itself. */
  function parseKeywordInput(raw) {
    var out = [];
    (raw || '').split(/\r?\n/).forEach(function (line) {
      line.trim().split(/[\s,]+/).forEach(function (k) { if (k) out.push(k); });
    });
    return out;
  }

  function saveDomainCategories(categories) {
    return EV.settings.setDomainCategories(categories).then(function () {
      EV.refreshDomainCategoriesCache();
      return renderDomainCategoriesList();
    });
  }

  function renderDomainCategoriesList() {
    EV.settings.domainCategories().then(function (categories) {
      els.domain_categories_list.innerHTML = '';
      categories.forEach(function (cat) {
        var card = el('div', 'ev-domain-category-card');
        var head = el('div', 'ev-domain-category-head');
        head.appendChild(el('strong', null, cat.name));
        var deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'ev-mini-btn ev-domain-category-delete';
        deleteBtn.textContent = 'Delete category';
        deleteBtn.onclick = function () {
          saveDomainCategories(categories.filter(function (c) { return c.name !== cat.name; }));
        };
        head.appendChild(deleteBtn);
        card.appendChild(head);

        var chipsWrap = el('div', 'ev-domain-category-keywords');
        cat.keywords.slice().sort().forEach(function (kw) {
          var chip = document.createElement('span');
          chip.className = 'ev-trusted-domain-chip';
          chip.appendChild(document.createTextNode(kw));
          var removeBtn = document.createElement('button');
          removeBtn.type = 'button';
          removeBtn.textContent = '×';
          removeBtn.title = 'Remove ' + kw;
          removeBtn.onclick = function () {
            saveDomainCategories(categories.map(function (c) {
              return c.name !== cat.name ? c : Object.assign({}, c, { keywords: c.keywords.filter(function (k) { return k !== kw; }) });
            }));
          };
          chip.appendChild(removeBtn);
          chipsWrap.appendChild(chip);
        });
        card.appendChild(chipsWrap);

        var addRow = el('div', 'ev-settings-row');
        var input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'add keyword(s) — comma/space/newline separated, or .tld for a suffix match';
        var addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'ev-mini-btn';
        addBtn.textContent = '+ Add';
        addBtn.onclick = function () {
          var newKeywords = parseKeywordInput(input.value);
          if (!newKeywords.length) return;
          saveDomainCategories(categories.map(function (c) {
            return c.name !== cat.name ? c : Object.assign({}, c, { keywords: c.keywords.concat(newKeywords) });
          }));
        };
        addRow.appendChild(input);
        addRow.appendChild(addBtn);
        card.appendChild(addRow);

        els.domain_categories_list.appendChild(card);
      });
    });
  }

  els.btn_add_domain_category.addEventListener('click', function () {
    if (document.getElementById('ev-new-domain-category-card')) return; // already open
    var card = el('div', 'ev-domain-category-card');
    card.id = 'ev-new-domain-category-card';
    var nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'Category name, e.g. "Crypto exchange"';
    card.appendChild(nameInput);
    var kwInput = document.createElement('textarea');
    kwInput.rows = 3;
    kwInput.placeholder = 'Keywords — comma/space/newline separated, e.g. coinbase.com, binance.com';
    card.appendChild(kwInput);
    var row = el('div', 'ev-settings-row');
    var saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'ev-mini-btn';
    saveBtn.textContent = 'Save category';
    saveBtn.onclick = function () {
      var name = nameInput.value.trim();
      var keywords = parseKeywordInput(kwInput.value);
      if (!name || !keywords.length) return;
      EV.settings.domainCategories().then(function (existing) {
        return saveDomainCategories(existing.concat([{ name: name, keywords: keywords }]));
      });
    };
    var cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'ev-mini-btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = function () { card.remove(); };
    row.appendChild(saveBtn);
    row.appendChild(cancelBtn);
    card.appendChild(row);
    els.domain_categories_list.appendChild(card);
    nameInput.focus();
  });
  els.btn_reset_domain_categories.addEventListener('click', function () {
    EV.settings.resetDomainCategoriesToDefault().then(function () {
      EV.refreshDomainCategoriesCache();
      return renderDomainCategoriesList();
    });
  });

  function renderSettingsView() {
    renderTrustedDomainsList();
    renderDomainCategoriesList();
  }

  els.btn_add_trusted_domain.addEventListener('click', function () {
    // Accepts a whole pasted list at once, not just one at a time; setTrustedDomains itself dedupes
    // (case/whitespace-insensitive for plain domains), so a repeated entry never shows up twice.
    // Split on newlines first, then on comma/space WITHIN a line -- but never split inside a line
    // that's a whole regex entry (e.g. "/\.corp\.example\.com$/i"), since a regex can legitimately
    // contain a comma (a {2,4}-style quantifier) that must not be treated as a list separator.
    var newDomains = [];
    els.trusted_domain_input.value.split(/\r?\n/).forEach(function (line) {
      line = line.trim();
      if (!line) return;
      if (EV.ruleHelpers.isRegexTrustedEntry(line)) { newDomains.push(line); return; }
      line.split(/[\s,]+/).forEach(function (d) { if (d) newDomains.push(d); });
    });
    if (!newDomains.length) return;
    EV.settings.trustedDomains().then(function (existing) {
      return EV.settings.setTrustedDomains(existing.concat(newDomains));
    }).then(function () {
      els.trusted_domain_input.value = '';
      renderTrustedDomainsList();
    });
  });
  els.btn_reset_trusted_domains.addEventListener('click', function () {
    EV.settings.resetTrustedDomainsToDefault().then(renderTrustedDomainsList);
  });

  // ---------- rules ----------

  var RULE_FIELD_HELP_HTML =
    '<table>' +
    '<tr><td>f.subject</td><td>string</td></tr>' +
    '<tr><td>f.from</td><td>{name,address,domain} or null</td></tr>' +
    '<tr><td>f.to / f.cc / f.bcc</td><td>array of {name,address,domain}</td></tr>' +
    '<tr><td>f.recipientCount</td><td>unique To+Cc+Bcc recipient count</td></tr>' +
    '<tr><td>f.replyTo</td><td>{name,address,domain} or null (Reply-To header)</td></tr>' +
    '<tr><td>f.returnPath</td><td>{name,address,domain} or null (Return-Path header)</td></tr>' +
    '<tr><td>f.date</td><td>JS Date or null</td></tr>' +
    '<tr><td>f.spf / f.dkim / f.dmarc</td><td>"pass" / "fail" / "none" / "softfail" / null</td></tr>' +
    '<tr><td>f.bodyText</td><td>combined plain-text body (HTML stripped as fallback)</td></tr>' +
    '<tr><td>f.urls</td><td>array of URL strings found in the body</td></tr>' +
    '<tr><td>f.urlDomains</td><td>array of unique hostnames from those URLs</td></tr>' +
    '<tr><td>f.attachments</td><td>array of {filename,mimeType,size,isInline,ext}</td></tr>' +
    '<tr><td>f.attachmentCount / f.size</td><td>numbers (size = raw byte length)</td></tr>' +
    '<tr><td>f.getHeader(name)</td><td>raw value of any header, case-insensitive</td></tr>' +
    '<tr><td>f.getHeaderAll(name)</td><td>array — for repeated headers like Received</td></tr>' +
    '<tr><td>f.trustedDomains</td><td>your Settings-configured trusted-domains list (literal + regex entries)</td></tr>' +
    '<tr><td>f.domainIsTrusted</td><td>true if f.from.domain is covered by a trusted-domains entry (exact, subdomain, or regex)</td></tr>' +
    '<tr><td>f.nameMismatch</td><td>true if the display name names a known brand but f.from.domain isn\'t that brand\'s domain</td></tr>' +
    '<tr><td>f.lookalikeDomain</td><td>true if f.from.domain is a likely typosquat of a trusted domain</td></tr>' +
    '<tr><td>f.punycodeSender</td><td>true if f.from.domain uses IDN/punycode (xn--) encoding</td></tr>' +
    '<tr><td>f.urgencyScore</td><td>count of distinct urgency/pressure phrases found in the body (e.g. "urgent", "wire transfer", "asap")</td></tr>' +
    '<tr><td>f.financialIndicators</td><td>array of financial-indicator types found, e.g. [\'iban\',\'gift_card_request\']</td></tr>' +
    '<tr><td>f.domainCategories</td><td>Settings-configured category names matched by any domain in this email (sender, URLs, headers, attachment names), e.g. [\'URL Shortener\']</td></tr>' +
    '<tr><td>h.domainsMatch(a,b)</td><td>case-insensitive domain equality</td></tr>' +
    '<tr><td>h.looksLikeDomain(a,b,maxDist)</td><td>typosquat check (edit distance, default ≤2)</td></tr>' +
    '<tr><td>h.looksLikeAnyDomain(a,list,maxDist)</td><td>same, against a list</td></tr>' +
    '<tr><td>h.domainsAlign(a,b)</td><td>same organizational domain (DMARC-style relaxed alignment) -- mail.example.com aligns with support.example.com</td></tr>' +
    '<tr><td>h.registrableDomain(hostname)</td><td>the organizational-domain reduction domainsAlign uses, e.g. "mail.example.co.uk" -&gt; "example.co.uk"</td></tr>' +
    '<tr><td>h.isDomainTrusted(domain,list)</td><td>exact/subdomain/regex match against a trusted-domains-style list</td></tr>' +
    '<tr><td>h.isPunycodeDomain(domain)</td><td>true if any label is IDN/punycode (xn--) encoded</td></tr>' +
    '<tr><td>h.includesAny(str,words)</td><td>true if str contains any of a list of words (case-insensitive)</td></tr>' +
    '<tr><td>h.COMMON_BRANDS</td><td>small built-in list of common brand domains</td></tr>' +
    '<tr><td>h.equals(a,b,caseSensitive?)</td><td>exact match — works on subject, sender name, domain, any header value…</td></tr>' +
    '<tr><td>h.contains(a,b,caseSensitive?)</td><td>substring match, same uses as above</td></tr>' +
    '<tr><td>h.startsWith / h.endsWith(a,b,caseSensitive?)</td><td>prefix / suffix match</td></tr>' +
    '<tr><td>h.matches(value,pattern,flags?)</td><td>regex match — pattern can be /literal/ or a plain string; never throws</td></tr>' +
    '<tr><td>h.attachmentExtIn(f.attachments,list)</td><td>true if any attachment extension is in the list, e.g. [".exe",".scr"]</td></tr>' +
    '<tr><td>h.anyAttachment(f.attachments,predicate)</td><td>true if any attachment satisfies a(a)=&gt;bool</td></tr>' +
    '<tr><td>h.countAttachments(f.attachments,predicate?)</td><td>count matching attachments (or all, if predicate omitted)</td></tr>' +
    '<tr><td>h.hasDualExtension(filename)</td><td>true for "invoice.pdf.exe"-style double extensions</td></tr>' +
    '<tr><td>h.hasHiddenUnicode(str,threshold?)</td><td>true if str has more than threshold (default 0) zero-width/invisible chars</td></tr>' +
    '<tr><td>h.shannonEntropy(str)</td><td>bits/char — higher means more random-looking</td></tr>' +
    '<tr><td>h.looksRandom(str,minLen?,entropyThreshold?)</td><td>true if str is long + high-entropy (default len≥12, entropy&gt;3.5) — flags generated IDs/tokens</td></tr>' +
    '</table>' +
    '<div class="ev-muted-small" style="margin-top:6px">Examples: <code>h.contains(f.subject,\'invoice\')</code> · ' +
    '<code>h.equals(f.from.domain,\'paypal.com\')</code> · <code>h.matches(f.getHeader(\'x-mailer\'),/outlook/i)</code> · ' +
    '<code>f.attachmentCount &gt; 3</code></div>';

  // RULE_TEMPLATES lives in js/rules/ruleTemplates.js (EV.RULE_TEMPLATES) — a DOM-free module so
  // tests/ruleTemplates.test.js can compile-check every template under jsc.
  var RULE_TEMPLATES = EV.RULE_TEMPLATES;

  var editingRuleId = null;
  var tagManuallyEdited = false;

  function renderRulesList() {
    EV.rulesStore.list().then(function (rules) {
      els.rules_list.innerHTML = '';
      if (!rules.length) {
        els.rules_list.appendChild(Object.assign(document.createElement('div'), {
          className: 'ev-muted-small', textContent: 'No rules yet. Click "+ New Rule" to create one — e.g. flag emails where the sender domain doesn\'t match the Reply-To domain.'
        }));
        return;
      }
      rules.forEach(function (rule) {
        var card = document.createElement('div');
        card.className = 'ev-rule-card' + (rule.enabled ? '' : ' disabled');

        var head = document.createElement('div');
        head.className = 'ev-rule-head';

        var switchLabel = document.createElement('label');
        switchLabel.className = 'ev-switch';
        var switchInput = document.createElement('input');
        switchInput.type = 'checkbox';
        switchInput.checked = rule.enabled;
        switchInput.onchange = function () { toggleRule(rule, switchInput.checked); };
        var slider = document.createElement('span');
        slider.className = 'ev-switch-slider';
        switchLabel.appendChild(switchInput);
        switchLabel.appendChild(slider);
        head.appendChild(switchLabel);

        head.appendChild(Object.assign(document.createElement('span'), { className: 'ev-rule-name', textContent: rule.name }));
        var tagChip = document.createElement('span');
        tagChip.className = 'ev-rule-tag-chip';
        tagChip.style.background = EV.tagColor(rule.tag);
        tagChip.textContent = rule.tag;
        head.appendChild(tagChip);
        card.appendChild(head);

        card.appendChild(Object.assign(document.createElement('div'), { className: 'ev-rule-expr', textContent: rule.expression, title: rule.expression }));

        var statsEl = document.createElement('div');
        statsEl.className = 'ev-rule-stats';
        if (rule.lastRun && rule.lastRun.error) {
          statsEl.classList.add('has-error');
          statsEl.textContent = 'Error: ' + rule.lastRun.error;
        } else if (rule.lastRun && rule.lastRun.matched != null && rule.lastRun.total != null) {
          statsEl.textContent = 'Matched ' + rule.lastRun.matched.toLocaleString() + ' of ' + rule.lastRun.total.toLocaleString() + ' emails' +
            (rule.lastRun.errorCount ? ' (' + rule.lastRun.errorCount + ' evaluation error(s))' : '') +
            ' — ' + new Date(rule.lastRun.ranAt).toLocaleString();
        } else if (rule.lastRun) {
          // Rule was disabled/deleted mid-scan during a multi-rule run, so its stats couldn't be
          // completed -- never crash rendering over this, just say so.
          statsEl.textContent = 'Was disabled during its last run — matches not updated.';
        } else {
          statsEl.textContent = rule.enabled ? 'Not run yet — open a folder or click Run all' : 'Disabled';
        }
        card.appendChild(statsEl);

        var actions = document.createElement('div');
        actions.className = 'ev-rule-actions';
        var runBtn = document.createElement('button');
        runBtn.textContent = 'Run now';
        runBtn.onclick = function () { runSingleRule(rule); };
        var editBtn = document.createElement('button');
        editBtn.textContent = 'Edit';
        editBtn.onclick = function () { openRuleModal(rule); };
        var delBtn = document.createElement('button');
        delBtn.className = 'danger';
        delBtn.textContent = 'Delete';
        delBtn.onclick = function () { deleteRule(rule); };
        var menuBtn = document.createElement('button');
        menuBtn.textContent = '⋯';
        menuBtn.title = 'Move, copy, or delete every email this rule has matched';
        menuBtn.onclick = function (e) {
          resolvePathsForRule(rule).then(function (paths) {
            if (!paths.length) { alert('This rule has no recorded matches yet — run it first.'); return; }
            showFileActionMenu(e.clientX, e.clientY, paths);
          });
        };
        actions.appendChild(runBtn);
        actions.appendChild(editBtn);
        actions.appendChild(delBtn);
        actions.appendChild(menuBtn);
        card.appendChild(actions);

        els.rules_list.appendChild(card);
      });
    });
  }

  /** All indexed emails' paths this rule currently has tagged — feeds the Rules panel's bulk Move/Copy/Delete menu. */
  function resolvePathsForRule(rule) {
    return EV.rulesStore.getMatchesForRule(rule.id).then(function (emailIds) {
      var byId = searchIdx.pathsByEmailId();
      var paths = [];
      emailIds.forEach(function (eid) { (byId.get(eid) || []).forEach(function (p) { paths.push(p); }); });
      return paths;
    });
  }

  function toggleRule(rule, enabled) {
    EV.rulesStore.update(rule.id, { enabled: enabled }).then(function (updated) {
      if (!enabled) {
        els.rules_status.textContent = 'Disabling "' + rule.name + '"…';
        return rulesEngine.disableRule(updated).then(function () {
          els.rules_status.textContent = 'Disabled "' + rule.name + '" — removed its tag from every email it had tagged.';
          return EV.rulesStore.setLastRun(rule.id, null);
        });
      } else if (state.workspace) {
        return runSingleRule(updated);
      }
    }).then(function () {
      renderRulesList();
      window.EV.onTagsChanged();
    }).catch(function (err) {
      els.rules_status.textContent = 'Could not update "' + rule.name + '": ' + (err && err.message || err);
      renderRulesList();
    });
  }

  function deleteRule(rule) {
    if (!confirm('Delete rule "' + rule.name + '"? Its tag will be removed from every email it tagged.')) return;
    els.rules_status.textContent = 'Deleting "' + rule.name + '"…';
    rulesEngine.disableRule(rule).then(function () {
      return EV.rulesStore.remove(rule.id);
    }).then(function () {
      els.rules_status.textContent = 'Deleted "' + rule.name + '".';
      renderRulesList();
      window.EV.onTagsChanged();
    }).catch(function (err) {
      els.rules_status.textContent = 'Could not delete "' + rule.name + '": ' + (err && err.message || err);
      renderRulesList();
    });
  }

  var rulesRunCancelled = false;
  // Guards against two rule runs firing at once (e.g. clicking a per-rule
  // "Run" then "Run all" before the first scan finishes) — both would share
  // the single rulesRunCancelled flag and worker pool, and their completion
  // handlers would race to overwrite each other's status text/last-run stats.
  var rulesRunActive = false;

  function showRulesStopButton(show) {
    els.btn_stop_rules.style.display = show ? 'inline-block' : 'none';
  }
  els.btn_stop_rules.addEventListener('click', function () { rulesRunCancelled = true; });

  function runSingleRule(rule) {
    if (!state.workspace) {
      els.rules_status.textContent = 'Open a folder first.';
      return Promise.resolve();
    }
    if (rulesRunActive) {
      els.rules_status.textContent = 'A rule run is already in progress — stop it first.';
      return Promise.resolve();
    }
    rulesRunCancelled = false;
    rulesRunActive = true;
    showRulesStopButton(true);
    els.rules_status.textContent = 'Running "' + rule.name + '"…';
    return rulesEngine.runRules(state.workspace, [rule], {
      isCancelled: function () { return rulesRunCancelled; },
      onProgress: function (done, total) {
        els.rules_status.textContent = 'Running "' + rule.name + '"… ' + done.toLocaleString() + ' / ' + total.toLocaleString();
      }
    }).then(function (result) {
      if (result.cancelled) {
        var s = result.statsByRule[rule.id];
        els.rules_status.textContent = 'Stopped — checked ' + s.checked.toLocaleString() + ' of ' + s.total.toLocaleString() + ' emails; tags left unchanged.';
        return;
      }
      var stats = result.statsByRule[rule.id];
      // The rule may have been disabled/deleted (via its own toggle, which already called
      // setLastRun(id, null)) while this very scan was running -- don't overwrite that with a
      // stale matched:null snapshot, and don't format a null count into the status line.
      if (stats.matched == null) {
        els.rules_status.textContent = 'Rule "' + rule.name + '" was disabled while running — matches not updated.';
        renderRulesList();
        return;
      }
      return EV.rulesStore.setLastRun(rule.id, stats).then(function () {
        els.rules_status.textContent = 'Rule "' + rule.name + '" matched ' + stats.matched.toLocaleString() + ' of ' + stats.total.toLocaleString() + ' emails.';
        renderRulesList();
        window.EV.onTagsChanged();
      });
    }).catch(function (err) {
      els.rules_status.textContent = 'Rule run failed: ' + (err && err.message || err);
    }).then(function () {
      rulesRunActive = false;
      showRulesStopButton(false);
    });
  }

  function runAllEnabledRules() {
    if (rulesRunActive) {
      els.rules_status.textContent = 'A rule run is already in progress — stop it first.';
      return;
    }
    EV.rulesStore.list().then(function (rules) {
      var enabled = rules.filter(function (r) { return r.enabled; });
      if (!enabled.length || !state.workspace) return;
      rulesRunCancelled = false;
      rulesRunActive = true;
      showRulesStopButton(true);
      els.rules_status.textContent = 'Running ' + enabled.length + ' enabled rule(s)…';
      return rulesEngine.runRules(state.workspace, enabled, {
        isCancelled: function () { return rulesRunCancelled; },
        onProgress: function (done, total) {
          els.rules_status.textContent = 'Running ' + enabled.length + ' rule(s)… ' + done.toLocaleString() + ' / ' + total.toLocaleString();
        }
      }).then(function (result) {
        if (result.cancelled) {
          var s0 = Object.values(result.statsByRule)[0];
          els.rules_status.textContent = 'Stopped — checked ' + (s0 ? s0.checked.toLocaleString() : '0') + ' of ' + result.total.toLocaleString() + ' emails; tags left unchanged.';
          return;
        }
        // A rule the user disabled/deleted while this scan was running has matched:null here
        // (rulesEngine already re-checked live state) -- its own toggle/delete handler already
        // called setLastRun(id, null) for it, so skip re-persisting this stale snapshot over that.
        return Promise.all(enabled.map(function (r) {
          var stats = result.statsByRule[r.id];
          if (stats.matched == null) return Promise.resolve();
          return EV.rulesStore.setLastRun(r.id, stats);
        })).then(function () {
          els.rules_status.textContent = 'Ran ' + enabled.length + ' rule(s) across ' + result.total.toLocaleString() + ' emails.';
          renderRulesList();
          window.EV.onTagsChanged();
        });
      }).catch(function (err) {
        els.rules_status.textContent = 'Rule run failed: ' + (err && err.message || err);
      }).then(function () {
        rulesRunActive = false;
        showRulesStopButton(false);
      });
    }).catch(function (err) {
      rulesRunActive = false;
      showRulesStopButton(false);
      els.rules_status.textContent = 'Rule run failed: ' + (err && err.message || err);
    });
  }
  els.btn_run_all_rules.addEventListener('click', runAllEnabledRules);
  els.btn_new_rule.addEventListener('click', function () { openRuleModal(null); });

  function openRuleModal(rule) {
    editingRuleId = rule ? rule.id : null;
    tagManuallyEdited = !!rule;
    els.rule_modal_title.textContent = rule ? 'Edit Rule' : 'New Rule';
    els.rule_name.value = rule ? rule.name : '';
    els.rule_tag.value = rule ? rule.tag : '';
    els.rule_expression.value = rule ? rule.expression : '';
    els.rule_enabled.checked = rule ? rule.enabled : true;
    els.rule_test_result.textContent = '';
    els.rule_error.style.display = 'none';
    els.rule_help.style.display = 'none';
    els.rule_template_select.value = '';
    els.rule_modal_overlay.style.display = 'flex';
    els.rule_name.focus();
  }
  function closeRuleModal() { els.rule_modal_overlay.style.display = 'none'; }
  els.btn_cancel_rule.addEventListener('click', closeRuleModal);
  els.rule_modal_overlay.addEventListener('click', function (e) { if (e.target === els.rule_modal_overlay) closeRuleModal(); });

  els.rule_name.addEventListener('input', function () {
    if (!tagManuallyEdited) els.rule_tag.value = EV.rulesStore.slugify(els.rule_name.value);
  });
  els.rule_tag.addEventListener('input', function () { tagManuallyEdited = true; });

  els.rule_help_toggle.addEventListener('click', function () {
    if (els.rule_help.style.display === 'none') {
      els.rule_help.innerHTML = RULE_FIELD_HELP_HTML;
      els.rule_help.style.display = 'block';
    } else {
      els.rule_help.style.display = 'none';
    }
  });

  RULE_TEMPLATES.forEach(function (t, i) {
    var opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = t.name;
    els.rule_template_select.appendChild(opt);
  });
  els.rule_template_select.addEventListener('change', function () {
    if (els.rule_template_select.value === '') return;
    var t = RULE_TEMPLATES[Number(els.rule_template_select.value)];
    els.rule_name.value = t.name;
    els.rule_tag.value = t.tag;
    tagManuallyEdited = true;
    els.rule_expression.value = t.expression;
  });

  els.btn_test_rule.addEventListener('click', function () {
    if (!state.workspace) { els.rule_test_result.textContent = 'Open a folder first to test against real emails.'; return; }
    var expr = els.rule_expression.value.trim();
    if (!expr) { els.rule_test_result.textContent = 'Write an expression first.'; return; }
    els.rule_test_result.textContent = 'Testing…';
    els.rule_error.style.display = 'none';
    rulesEngine.testRule(state.workspace, expr).then(function (r) {
      if (r.error) {
        els.rule_error.style.display = 'block';
        els.rule_error.textContent = 'Error while evaluating: ' + r.error;
        els.rule_test_result.textContent = '';
        return;
      }
      els.rule_test_result.textContent = 'Matched ' + r.matched.toLocaleString() + ' of ' + r.checked.toLocaleString() +
        (r.truncated ? ' (checked first ' + r.checked.toLocaleString() + ' only)' : ' loaded emails') +
        (r.samplePaths.length ? '  —  e.g. ' + r.samplePaths.slice(0, 3).join(', ') : '');
    });
  });

  els.btn_save_rule.addEventListener('click', function () {
    var name = els.rule_name.value.trim();
    var expression = els.rule_expression.value.trim();
    var desiredTag = els.rule_tag.value.trim() || name;
    if (!name || !expression) {
      els.rule_error.style.display = 'block';
      els.rule_error.textContent = 'Name and expression are both required.';
      return;
    }
    EV.rulesStore.uniqueTag(desiredTag, editingRuleId).then(function (tag) {
      var enabled = els.rule_enabled.checked;
      var savePromise = editingRuleId
        ? EV.rulesStore.update(editingRuleId, { name: name, tag: tag, expression: expression, enabled: enabled })
        : EV.rulesStore.create({ name: name, tag: tag, expression: expression, enabled: enabled });
      return savePromise.then(function (rule) {
        closeRuleModal();
        renderRulesList();
        if (enabled && state.workspace) return runSingleRule(rule);
        if (!enabled) return rulesEngine.disableRule(rule).then(function () { return EV.rulesStore.setLastRun(rule.id, null); }).then(renderRulesList);
      });
    }).catch(function (err) {
      els.rule_error.style.display = 'block';
      els.rule_error.textContent = String(err && err.message || err);
    });
  });

  // ---------- sidebar view switching ----------

  function showSidebarView(view) {
    document.querySelectorAll('.ev-sidebar-tab').forEach(function (b) { b.classList.toggle('active', b.dataset.view === view); });
    document.querySelectorAll('.ev-sidebar-view').forEach(function (v) { v.classList.toggle('active', v.id === 'ev-view-' + view); });
    if (view === 'tags') renderTagFilterList();
    if (view === 'rules') renderRulesList();
  }

  document.querySelectorAll('.ev-sidebar-tab').forEach(function (btn) {
    btn.addEventListener('click', function () { showSidebarView(btn.dataset.view); });
  });

  // ---------- search ----------

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

  function updateSearchOptionsHint() {
    var raw = els.search_mode.value === 'raw';
    var caseSensitive = isToggleActive(els.search_case);
    var isRegex = isToggleActive(els.search_regex);
    if (raw || (!caseSensitive && !isRegex)) { els.search_options_hint.textContent = ''; return; }
    els.search_options_hint.textContent = isRegex
      ? 'Regex mode matches subject/from/to/attachment only — use Raw search to regex the body.'
      : 'Case-sensitive verifies subject/from/to/attachment only — body/header matches are unaffected.';
  }

  els.search_mode.addEventListener('change', function () {
    var raw = els.search_mode.value === 'raw';
    els.search_input.placeholder = raw
      ? 'Grep the raw bytes of every file…  e.g. X-Mailer or a base64 fragment'
      : 'Search all emails…  e.g. from:paypal "verify your account" attachments:>3';
    updateSearchOptionsHint();
  });

  var SEARCH_HELP_HTML =
    '<table>' +
    '<tr><td>from: to: subject:</td><td>substring match on that field, e.g. <code>from:paypal</code></td></tr>' +
    '<tr><td>attachment:</td><td>substring match on attachment filenames</td></tr>' +
    '<tr><td>meta: (or header:)</td><td>substring match across all header values</td></tr>' +
    '<tr><td>tag:</td><td>exact match on a tag name, e.g. <code>tag:phish</code></td></tr>' +
    '<tr><td>"exact phrase"</td><td>quoted phrase (verified exactly for subject/from/to)</td></tr>' +
    '<tr><td>-term</td><td>exclude a word; also works on any field:, e.g. <code>-tag:reviewed</code></td></tr>' +
    '<tr><td>OR / ( )</td><td>OR (all-caps only) binds looser than the implicit AND, and parentheses group: <code>(from:paypal OR from:ebay) attachments:&gt;0</code> · <code>-(from:paypal OR from:ebay)</code> negates a whole group. Lowercase <code>or</code> is just a word.</td></tr>' +
    '<tr><td colspan="2" style="padding-top:6px;color:var(--fg-dim)">Numeric fields — glue a comparison operator directly onto the value, no space:</td></tr>' +
    '<tr><td>attachments:</td><td><code>attachments:3</code> (exact) · <code>attachments:&gt;3</code> · <code>attachments:&gt;=3</code> · <code>attachments:&lt;2</code></td></tr>' +
    '<tr><td>size:</td><td><code>size:&gt;5mb</code> · <code>size:&lt;100kb</code> (accepts b / kb / mb / gb)</td></tr>' +
    '<tr><td>urls:</td><td>number of links found in the body, e.g. <code>urls:&gt;=10</code></td></tr>' +
    '<tr><td>recipients:</td><td>unique To/Cc/Bcc count, e.g. <code>recipients:&gt;20</code></td></tr>' +
    '<tr><td>duplicates:</td><td>how many indexed files share this one\'s Message-ID/content id, e.g. <code>duplicates:&gt;1</code> finds every file that\'s part of a repeated/bulk-sent batch</td></tr>' +
    '<tr><td colspan="2" style="padding-top:6px;color:var(--fg-dim)">Regex — on subject/from/to/attachment only (not meta/body — use Raw search for those):</td></tr>' +
    '<tr><td>field:/…/</td><td><code>attachment:/\\.(exe|scr)$/i</code> · <code>subject:/^re:.*invoice/i</code></td></tr>' +
    '<tr><td colspan="2" style="padding-top:6px;color:var(--fg-dim)"><b>Aa</b> / <b>.*</b> toggle buttons below Search:</td></tr>' +
    '<tr><td><b>Aa</b> Match Case</td><td>verifies exact case for quoted phrases and any term, but only against subject/from/to/attachment (the fields with retained raw text) — body/header matches are unaffected</td></tr>' +
    '<tr><td><b>.*</b> Use Regex</td><td>treats the whole search box as one regex pattern against subject/from/to/attachment, ignoring field:/phrase/tag syntax — same one-pattern model as Raw search\'s own regex toggle, so use Raw search to regex the body</td></tr>' +
    '</table>' +
    '<div class="ev-muted-small" style="margin-top:6px">Combine freely: <code>from:paypal attachments:&gt;3 -tag:reviewed</code>. ' +
    'A term or field value that’s too short/unparseable matches nothing rather than everything, and a note explains why.</div>';

  els.btn_search_help.addEventListener('click', function () {
    showSidebarView('search');
    if (els.search_help.style.display === 'none') {
      els.search_help.innerHTML = SEARCH_HELP_HTML;
      els.search_help.style.display = 'block';
    } else {
      els.search_help.style.display = 'none';
    }
  });

  var searchResultsList = EV.createVirtualList(els.search_results, { rowHeight: 46, renderRow: renderSearchResultRow });
  var currentResults = [];

  function renderSearchResultRow(item, rowEl) {
    if (!item) return;
    rowEl.className = 'ev-result-row';
    var top = document.createElement('div');
    top.className = 'ev-result-top';
    top.textContent = item.subject || item.path;
    var bottom = document.createElement('div');
    bottom.className = 'ev-result-bottom';
    bottom.textContent = item.path + (item.snippet ? '  —  ' + item.snippet : (item.fromAddr ? '  —  ' + item.fromAddr : ''));
    rowEl.appendChild(top);
    rowEl.appendChild(bottom);
    rowEl.title = item.path;
    rowEl.onclick = function () {
      var entry = state.pathToEntry.get(item.path);
      if (entry) openTab(entry);
    };
  }

  function clearSearchResults() {
    searchIdx.cancel();
    rawSearchObj.cancel();
    currentResults = [];
    searchResultsList.setItems([]);
    els.search_status.textContent = '';
    els.btn_search_cancel.style.display = 'none';
    els.btn_clear_search.style.display = 'none';
  }
  els.btn_clear_search.addEventListener('click', clearSearchResults);

  function runSearch() {
    var query = els.search_input.value.trim();
    if (!query || !state.workspace) return;
    showSidebarView('search');
    currentResults = [];
    searchResultsList.setItems([]);
    els.btn_search_cancel.style.display = 'inline-block';
    els.btn_clear_search.style.display = 'inline-block';
    // Captured so a slow search's results/progress never get applied to the
    // UI after the user has since opened a different folder.
    var searchedWorkspace = state.workspace;
    function stillCurrent() { return state.workspace === searchedWorkspace; }

    if (els.search_mode.value === 'decoded') {
      els.search_status.textContent = 'Searching…';
      searchIdx.search(query, { isRegex: isToggleActive(els.search_regex), caseSensitive: isToggleActive(els.search_case) }).then(function (res) {
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
        currentResults = res.results.map(function (r) {
          var parts = r.matchedFields.map(function (f) { return numericFieldLabel(f, r) || f; });
          return { path: r.path, subject: r.subject, fromAddr: r.fromAddr, snippet: 'matched: ' + parts.join(', ') };
        });
        searchResultsList.setItems(currentResults);
        var warningNote = res.warnings && res.warnings.length ? ('  ⚠ ' + res.warnings[0]) : '';
        els.search_status.textContent = res.results.length.toLocaleString() + ' match(es)' +
          (res.truncated ? ' (showing top ' + res.results.length + ' of ' + res.total.toLocaleString() + ')' : '') +
          ' — ' + (searchIdx.stats().indexed).toLocaleString() + '/' + (searchIdx.stats().total).toLocaleString() + ' emails indexed so far' +
          warningNote;
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
        onMatches: function (matches) {
          if (!stillCurrent()) return;
          matches.forEach(function (m) {
            currentResults.push({ path: m.path, subject: m.path, fromAddr: '', snippet: m.count + ' match(es): ' + (m.snippets[0] ? m.snippets[0].snippet : '') });
          });
          searchResultsList.setItems(currentResults.slice());
          els.search_status.textContent = currentResults.length.toLocaleString() + ' file(s) with matches so far…';
        },
        onProgress: function (done, total) {
          if (!stillCurrent()) return;
          els.search_status.textContent = currentResults.length.toLocaleString() + ' file(s) with matches — scanned ' + done.toLocaleString() + '/' + total.toLocaleString();
        }
      }).then(function (result) {
        if (!stillCurrent()) return;
        els.btn_search_cancel.style.display = 'none';
        els.search_status.textContent = currentResults.length.toLocaleString() + ' file(s) with matches' + (result.cancelled ? ' (stopped)' : ' (complete)');
      });
    }
  }

  els.btn_search.addEventListener('click', runSearch);
  els.search_input.addEventListener('keydown', function (e) { if (e.key === 'Enter') runSearch(); });
  els.btn_search_cancel.addEventListener('click', function () {
    searchIdx.cancel();
    rawSearchObj.cancel();
    els.btn_search_cancel.style.display = 'none';
  });

  function csvCell(v) {
    v = String(v);
    return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }

  els.btn_export_iocs.addEventListener('click', function () {
    if (!state.workspace) { alert('Open a folder first.'); return; }
    var summary = searchIdx.iocSummary();
    var rows = [['type', 'value', 'email_count']];
    summary.senderDomains.forEach(function (r) { rows.push(['sender_domain', r.value, r.count]); });
    summary.urlDomains.forEach(function (r) { rows.push(['url_domain', r.value, r.count]); });
    summary.attachmentExtensions.forEach(function (r) { rows.push(['attachment_extension', r.value, r.count]); });
    summary.financialIndicatorTypes.forEach(function (r) { rows.push(['financial_indicator', r.value, r.count]); });
    summary.domainCategories.forEach(function (r) { rows.push(['domain_category', r.value, r.count]); });
    if (summary.senderAnomalyCount) rows.push(['sender_anomaly_summary', 'emails_with_display_name_or_lookalike_domain_flag', summary.senderAnomalyCount]);
    if (rows.length === 1) { alert('Nothing indexed yet — wait for indexing to finish, or there are no domains/attachments to report.'); return; }
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

  // ---------- tag export/import ----------

  els.btn_export_tags.addEventListener('click', function () {
    EV.tags.exportJson().then(function (json) {
      var blob = new Blob([json], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'mantiz-eml-analyzer-tags-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    });
  });
  els.btn_import_tags.addEventListener('click', function () { els.import_tags_input.click(); });
  els.import_tags_input.addEventListener('change', function () {
    var file = els.import_tags_input.files[0];
    if (!file) return;
    file.text().then(function (text) {
      return EV.tags.importJson(text);
    }).then(function (count) {
      alert('Imported tag data for ' + count + ' email(s).');
      window.EV.onTagsChanged();
    }).catch(function (err) {
      alert('Import failed: ' + err.message);
    });
    els.import_tags_input.value = '';
  });

  // ---------- tags sidecar file (portable, travels with the folder itself) ----------
  // A "Save to folder" button writes the same JSON EV.tags.exportJson() already produces as
  // mantiz-tags.json at the workspace root; opening that folder again later (even on a different
  // machine/browser) detects it and offers to load it back in -- fixes "switching machines loses
  // tags" without ever writing anything automatically (constraint #1: only an explicit user click).

  function updateTagsSidecarButtonState() {
    var writable = EV.hasWriteCapableWorkspace(state.workspace);
    els.btn_save_tags_sidecar.disabled = !writable;
    els.btn_save_tags_sidecar.title = writable
      ? 'Save all tags/notes as mantiz-tags.json in this folder, so they travel with it (e.g. to another machine/browser).'
      : WRITE_UNAVAILABLE_TITLE;
  }

  els.btn_save_tags_sidecar.addEventListener('click', function () {
    var dirHandle = state.workspace.dirHandle;
    EV.ensureWritePermission(dirHandle).then(function (granted) {
      if (!granted) { alert('Write permission was not granted — nothing was saved.'); return null; }
      return EV.tags.exportJson().then(function (json) { return EV.saveTagsSidecar(dirHandle, json); }).then(function () {
        alert('Saved tags to "' + EV.TAGS_SIDECAR_NAME + '" in this folder.');
      });
    }).catch(function (err) { alert('Save failed: ' + (err && err.message || err)); });
  });

  function checkForTagsSidecar(ws) {
    els.tags_sidecar_banner.style.display = 'none';
    if (!ws || ws.mode !== 'fsAccess' || !ws.dirHandle) return;
    EV.loadTagsSidecar(ws.dirHandle).then(function (text) {
      if (!text || state.workspace !== ws) return; // folder switched again before this resolved
      var count;
      try { count = (JSON.parse(text).records || []).length; } catch (e) { return; } // corrupt/foreign file -- ignore rather than offer a broken load
      els.tags_sidecar_text.textContent = 'Found saved tags in this folder (' + EV.TAGS_SIDECAR_NAME + ', ' + count + ' email' + (count === 1 ? '' : 's') + ') — load them?';
      els.tags_sidecar_banner.style.display = 'flex';
      els.btn_load_tags_sidecar.onclick = function () {
        EV.tags.importJson(text).then(function (imported) {
          els.tags_sidecar_banner.style.display = 'none';
          window.EV.onTagsChanged();
          alert('Loaded tag data for ' + imported + ' email(s) from this folder.');
        }).catch(function (err) { alert('Load failed: ' + (err && err.message || err)); });
      };
    });
  }
  els.btn_dismiss_tags_sidecar.addEventListener('click', function () { els.tags_sidecar_banner.style.display = 'none'; });

  // ---------- rule export/import ----------

  els.btn_export_rules.addEventListener('click', function () {
    EV.rulesStore.exportJson().then(function (json) {
      var blob = new Blob([json], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'mantiz-eml-analyzer-rules-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    });
  });
  els.btn_import_rules.addEventListener('click', function () { els.import_rules_input.click(); });
  els.import_rules_input.addEventListener('change', function () {
    var file = els.import_rules_input.files[0];
    if (!file) return;
    file.text().then(function (text) {
      return EV.rulesStore.importJson(text);
    }).then(function (result) {
      var msg = 'Imported ' + result.imported + ' rule(s).';
      if (result.skipped) msg += ' Skipped ' + result.skipped + ' (tag already in use by an existing rule, or missing required fields).';
      alert(msg);
      renderRulesList();
    }).catch(function (err) {
      alert('Import failed: ' + err.message);
    });
    els.import_rules_input.value = '';
  });

  // ---------- case report export ----------

  function fmtDateShort(ms) { return ms ? new Date(ms).toISOString().slice(0, 10) : ''; }
  function mdEscape(s) { return String(s || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' '); }

  els.btn_export_report.addEventListener('click', function () {
    if (!state.workspace) { alert('Open a folder first.'); return; }
    EV.tags.allTagNames().then(function (tagNames) {
      if (!tagNames.length) { alert('No tagged emails yet — tag some emails or run a rule first.'); return null; }
      var chain = Promise.resolve();
      var sections = [];
      var totalEmails = new Set();
      tagNames.forEach(function (tagName) {
        chain = chain.then(function () {
          // Reuses the same tag: clause the search box itself uses, rather
          // than a second path for cross-referencing tags to email metadata.
          return searchIdx.search('tag:"' + tagName + '"', { limit: 5000 }).then(function (res) {
            res.results.forEach(function (r) { totalEmails.add(r.path); });
            sections.push({ tag: tagName, results: res.results });
          });
        });
      });
      return chain.then(function () { return { sections: sections, totalEmails: totalEmails.size }; });
    }).then(function (data) {
      if (!data) return;
      var lines = [];
      lines.push('# Mantiz-EML-Analyzer — Case Report');
      lines.push('');
      lines.push('- **Folder:** ' + state.workspace.name);
      lines.push('- **Generated:** ' + new Date().toISOString());
      lines.push('- **Tagged emails:** ' + data.totalEmails + ' across ' + data.sections.length + ' tag(s)');
      lines.push('');
      data.sections.sort(function (a, b) { return b.results.length - a.results.length; }).forEach(function (section) {
        lines.push('## ' + section.tag + ' (' + section.results.length + ')');
        lines.push('');
        lines.push('| Subject | From | Date | Path |');
        lines.push('|---|---|---|---|');
        section.results.forEach(function (r) {
          lines.push('| ' + mdEscape(r.subject) + ' | ' + mdEscape(r.fromAddr) + ' | ' + fmtDateShort(r.dateMs) + ' | ' + mdEscape(r.path) + ' |');
        });
        lines.push('');
      });
      var md = lines.join('\n');
      var blob = new Blob([md], { type: 'text/markdown' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'mantiz-eml-analyzer-case-report-' + new Date().toISOString().slice(0, 10) + '.md';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    }).catch(function (err) {
      alert('Report generation failed: ' + err.message);
    });
  });

  // ---------- resizable splitter ----------

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

  // ---------- keyboard shortcuts ----------

  document.addEventListener('keydown', function (e) {
    var mod = e.metaKey || e.ctrlKey;
    if (mod && e.shiftKey && (e.key === 'f' || e.key === 'F')) {
      e.preventDefault();
      showSidebarView('search');
      els.search_input.focus();
    } else if (e.altKey && e.key === 'ArrowRight') {
      tabMgr.next();
    } else if (e.altKey && e.key === 'ArrowLeft') {
      tabMgr.prev();
    } else if (mod && e.key === 'b') {
      e.preventDefault();
      els.sidebar.style.display = els.sidebar.style.display === 'none' ? 'flex' : 'none';
    } else if (e.altKey && (e.key === 'w' || e.key === 'W')) {
      // Ctrl/Cmd+W is reserved by every browser to close the actual browser
      // tab and can't be safely overridden, so Alt+W is the reliable "close
      // active email tab" shortcut here (the × on the tab always works too).
      e.preventDefault();
      var active = tabMgr.getActive();
      if (active) tabMgr.close(active.id);
    }
  });

  // ---------- session persistence ----------

  function saveSession() {
    if (!state.workspace) return;
    var active = tabMgr.getActive();
    EV.session.saveDebounced({
      folderName: state.workspace.name,
      mode: state.workspace.mode,
      dirHandle: state.workspace.mode === 'fsAccess' ? state.workspace.dirHandle : undefined,
      openTabPaths: tabMgr.list().map(function (t) { return t.path; }),
      activeTabPath: active ? active.path : null
    });
  }

  function tryResumeSession() {
    EV.session.load().then(function (data) {
      if (!data) return;
      els.btn_resume.style.display = 'inline-block';
      els.btn_resume.textContent = '↻ Resume "' + data.folderName + '"';
      els.btn_resume.onclick = async function () {
        try {
          var ws;
          if (data.mode === 'fsAccess' && data.dirHandle) {
            ws = await EV.resumeFromDirHandle(data.dirHandle);
          } else {
            alert('Please re-select the "' + data.folderName + '" folder to resume — this browser can\'t reopen it automatically.');
            els.btn_open_folder.click();
            return;
          }
          setWorkspace(ws);
          (data.openTabPaths || []).forEach(function (p) {
            var entry = state.pathToEntry.get(p);
            if (entry) openTab(entry);
          });
          if (data.activeTabPath) {
            var t = tabMgr.list().filter(function (t) { return t.path === data.activeTabPath; })[0];
            if (t) tabMgr.activate(t.id);
          }
          els.btn_resume.style.display = 'none';
        } catch (e) {
          alert('Could not resume: ' + e.message);
        }
      };
    });
  }

  refreshTagDotCache().then(rebuildVisibleRows);
  updateFilesStatus();
  updateTagsSidecarButtonState();
  tryResumeSession();
  initDemoBanner();
  // One-off cleanup for empty tag/note records left over from before disabling
  // a rule (or removing a tag) properly deleted them instead of leaving a husk.
  EV.tags.pruneEmpty();
})();
