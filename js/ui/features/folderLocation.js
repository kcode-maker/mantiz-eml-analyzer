/**
 * folderLocation.js — where the opened folder is: the names shown in the Explorer root, status bar and path bar, and the lookup that finds the folder's real on-disk path (a browser never reveals it; scripts/serve.py does, only on a verified match).
 */
(function (g) {
  'use strict';
  var EV = g.EV || (g.EV = {});
  EV.ui = EV.ui || {};
  EV.ui.features = EV.ui.features || {};

  EV.ui.features.folderLocation = function createFolderLocation(ctx) {
    var state = ctx.state, els = ctx.els;
    // Exported to the other features (function declarations are hoisted, so these are valid before their definitions).
    ctx.fullPath = fullPath;
    ctx.renderPathBar = renderPathBar;
    ctx.resolveFolderLocation = resolveFolderLocation;
    ctx.updateFilesStatus = updateFilesStatus;

    /** Full on-disk path of a path inside the opened folder (relative path when the folder's location isn't known). */
    function fullPath(rel) { return EV.folderPath.join(state.folderBase, rel); }

    function rootDisplay() { return state.folderBase || (state.workspace ? state.workspace.name : ''); }

    function renderPathBar(relPath) {
      els.path_bar.innerHTML = '';
      var root = document.createElement('span');
      root.className = 'ev-path-seg ev-path-root';
      root.textContent = '📂 ' + rootDisplay();
      root.title = state.folderBase ? 'Full path of the opened folder' : 'Opened folder (its full location on disk isn\u2019t known)';
      els.path_bar.appendChild(root);
      var sep = EV.folderPath.sepOf(state.folderBase); // backslashes after a Windows location, so the bar reads as one real path
      (relPath || '').split('/').forEach(function (part) {
        els.path_bar.appendChild(Object.assign(document.createElement('span'), { className: 'ev-path-sep', textContent: sep }));
        els.path_bar.appendChild(Object.assign(document.createElement('span'), { className: 'ev-path-seg', textContent: part }));
      });
      els.path_bar.scrollLeft = els.path_bar.scrollWidth; // a long full path keeps the file name in view
    }

    function updateFilesStatus() {
      var n = state.workspace ? EV.flattenFileNodes(state.workspace.root).filter(function (f) { return EV.isEmlFile(f.name); }).length : 0;
      els.status_files.textContent = state.workspace ? (state.workspace.name + ' — ' + n.toLocaleString() + ' .eml files') : 'No folder open';
      els.tree_root_label.textContent = state.workspace ? ('📂 ' + rootDisplay()) : 'No folder open';
      els.tree_root_label.title = !state.workspace ? '' : state.folderBase ? state.folderBase
        : state.folderLocateNote === 'searching' ? 'Looking up this folder\u2019s location on disk\u2026'
        : 'Browsers never reveal the full path of a picked folder, so only its name is shown. The full path appears when the app is run with scripts/serve.py and the folder is found on this computer.';
    }

    /** Re-draws everything that shows the folder's path (Explorer root, status bar, path bar of the open tab). */
    function refreshPathDisplays() {
      updateFilesStatus();
      var active = ctx.tabMgr && ctx.tabMgr.getActive();
      if (active) { renderPathBar(active.path); els.status_selected.textContent = fullPath(active.path); }
    }

    /** Finds the opened folder's real location on disk. A browser can never read it, but this app is served by scripts/serve.py,
     * a local process that can: the page sends it the folder's name plus a small fingerprint (some relative paths with their sizes)
     * and it returns a path only when every one of those files exists there with the same size. Same-origin request to the local
     * server only (like the heartbeat) -- nothing leaves the machine, and nothing is ever asked of the user. Hosted copies (e.g.
     * GitHub Pages) and other servers simply never get an answer, and the folder's name stays as the root. */
    function locateFolderOnDisk(ws, hint) {
      if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname) || !window.fetch) return Promise.resolve(null);
      var samples = EV.folderPath.fingerprint(EV.flattenFileNodes(ws.root));
      if (!samples.length) return Promise.resolve(null);
      var ctl = typeof AbortController === 'function' ? new AbortController() : null;
      var timer = ctl ? setTimeout(function () { ctl.abort(); }, 20000) : null;
      return fetch('/__mantiz/locate-folder', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctl ? ctl.signal : undefined,
        body: JSON.stringify({ name: ws.name, samples: samples, hint: hint || null })
      }).then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { return j && typeof j.path === 'string' && j.path ? j.path : null; })
        .catch(function () { return null; })
        .then(function (p) { if (timer) clearTimeout(timer); return p; });
    }

    function resolveFolderLocation(ws) {
      state.folderLocateNote = 'searching';
      return EV.settings.folderLocation(ws.name).then(function (hint) {
        return locateFolderOnDisk(ws, hint);
      }).then(function (found) {
        if (state.workspace !== ws) return;
        state.folderBase = found || '';
        state.folderLocateNote = found ? 'found' : 'notfound';
        refreshPathDisplays();
        if (found) return EV.settings.setFolderLocation(ws.name, found); // only a hint for next time; shown only once verified again
      });
    }

  };
})(typeof self !== 'undefined' ? self : this);
