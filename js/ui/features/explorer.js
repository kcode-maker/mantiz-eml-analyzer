/**
 * explorer.js — the Explorer panel: the virtualized file tree (filtering, sorting, expand/collapse, tag dots, the open-in-tab marker), multi-select with the bulk tag bar, and revealing a file in the tree.
 */
(function (g) {
  'use strict';
  var EV = g.EV || (g.EV = {});
  EV.ui = EV.ui || {};
  EV.ui.features = EV.ui.features || {};

  EV.ui.features.explorer = function createExplorer(ctx) {
    var state = ctx.state, els = ctx.els, searchIdx = ctx.searchIdx;
    var showToast = EV.ui.showToast;
    // Exported to the other features (function declarations are hoisted, so these are valid before their definitions).
    ctx.rebuildVisibleRows = rebuildVisibleRows;
    ctx.revealInTree = revealInTree;
    ctx.updateBulkTagBar = updateBulkTagBar;

    ctx.treeList = EV.createVirtualList(els.tree_container, {
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
      ctx.treeList.setItems(out);
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
      if (idx !== -1) ctx.treeList.scrollToIndex(idx);
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
        var nameEl = document.createElement('span');
        nameEl.className = 'ev-tree-name';
        nameEl.textContent = node.name;
        nameEl.title = node.name; // full name on hover when the row has to cut it with an ellipsis
        rowEl.appendChild(nameEl);
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
        // Deliberately placed right after the icon (its own slot), not mixed in with the tag-dots
        // cluster after the filename -- a ring, not a filled circle, so it can never be confused with
        // a tag's filled color dot even when a tag's hash-assigned color happens to also be green
        // (TAG_COLORS in tags.js includes an olive-green, #98c379, which otherwise looks identical at
        // a glance to a plain filled green dot).
        if (isEml && state.openTabPaths.has(node.path)) {
          var openDot = document.createElement('span');
          openDot.className = 'ev-open-marker-dot';
          openDot.title = 'Open in a tab right now';
          rowEl.appendChild(openDot);
        }
        var fileNameEl = document.createElement('span');
        fileNameEl.className = 'ev-tree-name';
        fileNameEl.textContent = node.name;
        fileNameEl.title = node.name; // full name on hover when the row has to cut it with an ellipsis
        rowEl.appendChild(fileNameEl);
        var tags = state.tagDotCache.get(node.path);
        if (tags && tags.length) {
          var dots = document.createElement('span');
          dots.className = 'ev-tag-dots';
          tags.slice(0, 5).forEach(function (t) {
            var d = document.createElement('span');
            d.className = 'ev-tag-dot';
            d.style.background = EV.tagColor(t);
            d.title = 'Tag: ' + t;
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
              ctx.treeList.setItems(state.visibleRows);
              return;
            }
          }
          if (e.metaKey || e.ctrlKey) {
            if (state.multiSelectedPaths.has(node.path)) state.multiSelectedPaths.delete(node.path);
            else state.multiSelectedPaths.add(node.path);
            state.lastClickedPath = node.path;
            updateBulkTagBar();
            ctx.treeList.setItems(state.visibleRows);
            return;
          }
          if (state.multiSelectedPaths.size) { state.multiSelectedPaths.clear(); updateBulkTagBar(); }
          state.lastClickedPath = node.path;
          ctx.openTab(node.entry);
        };
        rowEl.oncontextmenu = function (e) {
          if (!isEml) return;
          e.preventDefault();
          var targetPaths = (state.multiSelectedPaths.has(node.path) && state.multiSelectedPaths.size > 1)
            ? Array.from(state.multiSelectedPaths)
            : [node.path];
          ctx.showFileActionMenu(e.clientX, e.clientY, targetPaths);
        };
        rowEl.title = node.path;
      }
    }

    function updateBulkTagBar() {
      var n = state.multiSelectedPaths.size;
      if (n === 0) { els.bulk_tag_bar.style.display = 'none'; EV.tagInput.hideNote(); return; }
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
      ctx.updateFilesStatus();
      if (state.workspace) ctx.startIndexing(); // which files count as emails changed -- re-index against the new set
    });

    function clearMultiSelection() {
      state.multiSelectedPaths.clear();
      updateBulkTagBar();
      rebuildVisibleRows();
    }

    els.btn_bulk_tag_clear.addEventListener('click', clearMultiSelection);

    var bulkTagCheck = EV.tagInput.bind(els.bulk_tag_input);

    els.btn_bulk_tag_apply.addEventListener('click', function () {
      var tagName = bulkTagCheck.check();
      if (!tagName) return;
      var paths = Array.from(state.multiSelectedPaths);
      Promise.all(paths.map(function (path) {
        var eid = searchIdx.emailIdForPath(path);
        return eid ? EV.tags.addTag(eid, tagName) : Promise.resolve();
      })).then(function () {
        els.bulk_tag_input.value = '';
        bulkTagCheck.reset();
        showToast('Tagged ' + paths.length.toLocaleString() + ' email(s) with "' + tagName + '".');
        window.EV.onTagsChanged();
      }).catch(function (err) { showToast('Could not tag the files: ' + (err && err.message || err), { duration: 4000 }); });
    });

    // Untags just the selected emails. (To delete a tag from EVERY email, use the Tags tab.)
    els.btn_bulk_tag_remove.addEventListener('click', function () {
      var tagName = bulkTagCheck.check();
      if (!tagName) return;
      ctx.untagSelectedEmails([tagName]).then(function () { els.bulk_tag_input.value = ''; bulkTagCheck.reset(); });
    });

    els.bulk_tag_input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') els.btn_bulk_tag_apply.click();
    });

  };
})(typeof self !== 'undefined' ? self : this);
