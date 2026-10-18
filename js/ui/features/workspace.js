/**
 * workspace.js — opening a folder (picker, drag-and-drop, loose files, the sample emails), the workspace lifecycle (setWorkspace, refresh from disk, reload after file operations), the parse-errors panel and starting the indexing run.
 */
(function (g) {
  'use strict';
  var EV = g.EV || (g.EV = {});
  EV.ui = EV.ui || {};
  EV.ui.features = EV.ui.features || {};

  EV.ui.features.workspace = function createWorkspace(ctx) {
    var state = ctx.state, els = ctx.els, searchIdx = ctx.searchIdx;
    var showToast = EV.ui.showToast;
    // Exported to the other features (function declarations are hoisted, so these are valid before their definitions).
    ctx.initDemoBanner = initDemoBanner;
    ctx.reloadWorkspaceFromHandle = reloadWorkspaceFromHandle;
    ctx.setWorkspace = setWorkspace;
    ctx.startIndexing = startIndexing;

    els.btn_refresh_explorer.addEventListener('click', refreshExplorerFromDisk);

    function reloadWorkspaceFromHandle() {
      return EV.resumeFromDirHandle(state.workspace.dirHandle).then(function (ws) { setWorkspace(ws); });
    }

    /**
     * VS Code-style Explorer "Refresh" — re-reads the open folder from disk to pick up files
     * added/removed/renamed by something other than this app (Finder, another tool, a sync client),
     * since browsers have no live filesystem-watch API to do this automatically. Deliberately does
     * NOT reuse setWorkspace() (which the Delete/Move/Copy reload path does use) -- that closes every
     * open tab and resets the tree/tag filters, which is right after a destructive file op but would
     * be a surprising side effect of what's meant to be a lightweight "just refresh the listing"
     * action, same expectation VS Code's own Explorer refresh sets (it never closes open editors
     * either). Only closes tabs whose file no longer exists in the fresh listing; an already-open tab
     * for a file that changed on disk keeps showing what it last read -- this app has no filesystem-
     * watcher to detect that kind of staleness, in-app or out, so it's no different from reopening the
     * same tab today. Only meaningful for a folder opened via the native directory picker (mode
     * 'fsAccess') -- the webkitdirectory/drag-and-drop/flat-file-list/sample-emails fallbacks only
     * ever hand over inert File snapshots with nothing on disk to re-read from.
     */
    function refreshExplorerFromDisk() {
      if (!state.workspace) return;
      if (!(state.workspace.mode === 'fsAccess' && state.workspace.dirHandle)) {
        showToast('Refresh isn’t available for this folder — use Open Folder again to pick up changes.');
        return;
      }
      if (els.btn_refresh_explorer.disabled) return;
      els.btn_refresh_explorer.disabled = true;
      EV.resumeFromDirHandle(state.workspace.dirHandle).then(function (ws) {
        state.workspace = ws;
        if (state.sortDirection !== 'asc') EV.sortTree(ws.root, state.sortDirection);
        state.pathToEntry = new Map();
        EV.flattenFileNodes(ws.root).forEach(function (n) { state.pathToEntry.set(n.path, n.entry); });
        ctx.tabMgr.list().forEach(function (t) {
          if (!state.pathToEntry.has(t.path)) ctx.tabMgr.close(t.id);
        });
        ctx.clearSearchResults(); // the previous result set no longer matches the rebuilt index
        state.multiSelectedPaths.clear();
        ctx.updateBulkTagBar();
        ctx.rebuildVisibleRows();
        ctx.updateFilesStatus();
        ctx.updateTagsSidecarButtonState();
        ctx.checkForTagsSidecar(ws);
        ctx.saveSession();
        startIndexing();
        showToast('Explorer refreshed.');
      }).catch(function (err) {
        EV.alertDialog('Refresh failed: ' + (err && err.message || err));
      }).then(function () {
        els.btn_refresh_explorer.disabled = false;
      });
    }

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


    /** Fetches the bundled sample-emails/ folder (same-origin static files) and feeds it through the
     * exact same fallback ingestion path as a real folder pick (hiddenDirInput's own 'change' handler)
     * — not a parallel code path. Only works when served over http(s); a plain file:// open can't
     * fetch() its own sibling files due to the browser's file:// CORS restrictions, so that failure is
     * caught and reported rather than silently doing nothing. */
    var loadingSample = false;

    function loadSampleEmails() {
      return fetch('sample-emails/manifest.json').then(function (resp) {
        if (!resp.ok) throw new Error('manifest not found (' + resp.status + ')');
        return resp.json();
      }).then(function (relPaths) {
        return Promise.all(relPaths.map(function (rel) {
          var samplePath = 'sample-emails/' + rel;
          return fetch(samplePath).then(function (r) {
            if (!r.ok) throw new Error(samplePath + ': ' + r.status);
            return r.blob();
          }).then(function (blob) {
            var file = new File([blob], rel.split('/').pop(), { type: 'message/rfc822' });
            Object.defineProperty(file, 'webkitRelativePath', { value: samplePath });
            return file;
          });
        }));
      }).then(function (files) {
        var dt = new DataTransfer();
        files.forEach(function (f) { dt.items.add(f); });
        hiddenDirInput.files = dt.files;
        loadingSample = true;
        hiddenDirInput.dispatchEvent(new Event('change', { bubbles: true }));
      }).catch(function (err) {
        EV.alertDialog('Could not load the sample emails automatically (' + err.message + ').\n\n' +
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
      // The Resume button is only ever meaningful in the "nothing open yet" moment right after a
      // fresh page load (see tryResumeSession, below) -- it's a one-time snapshot of whatever was
      // saved at boot, never re-rendered afterward. Without this, opening a DIFFERENT folder here
      // (Open Folder, drag-and-drop, the sample-emails demo -- anything other than clicking Resume
      // itself) correctly updates the underlying saved session (saveSession(), below) but leaves the
      // visible button frozen on stale text forever, since nothing else ever hides or refreshes it.
      els.btn_resume.style.display = 'none';
      EV.remoteContent.set(false); // a new folder is a new case: remote content goes back to the safe default (off)
      if (ctx.tabMgr) ctx.tabMgr.closeAll();
      ctx.clearSearchResults();
      state.multiSelectedPaths.clear();
      state.lastClickedPath = null;
      ctx.updateBulkTagBar();
      state.workspace = ws;
      state.folderBase = '';
      var sampleFolder = loadingSample; loadingSample = false; // the bundled demo is served from the app's own folder: nothing to locate
      state.folderLocateNote = '';
      if (!sampleFolder) ctx.resolveFolderLocation(ws);
      if (state.sortDirection !== 'asc') EV.sortTree(ws.root, state.sortDirection);
      state.pathToEntry = new Map();
      EV.flattenFileNodes(ws.root).forEach(function (n) { state.pathToEntry.set(n.path, n.entry); });
      state.treeFilter = '';
      els.tree_filter.value = '';
      state.tagFilter.clear();
      ctx.rebuildVisibleRows();
      ctx.updateFilesStatus();
      ctx.updateTagsSidecarButtonState();
      ctx.checkForTagsSidecar(ws);
      ctx.saveSession();
      startIndexing();
    }

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
      Promise.all([EV.settings.trustedDomains(), EV.settings.domainCategories(), EV.settings.internalDomains()]).then(function (res) {
        if (state.workspace !== indexingWorkspace) return;
        return searchIdx.startIndexing(state.workspace, {
          trustedDomains: res[0],
          domainCategories: res[1],
          internalDomains: res[2],
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
          ctx.refreshTagDotCache().then(ctx.rebuildVisibleRows);
          updateParseErrorsPanel();
          if (!result.cancelled) ctx.runAllEnabledRules();
        });
      });
    }
  };
})(typeof self !== 'undefined' ? self : this);
