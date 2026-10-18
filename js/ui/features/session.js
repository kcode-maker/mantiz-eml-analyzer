/**
 * session.js — remembering the session: saving open tabs and the folder handle, and offering to resume them on the next start.
 */
(function (g) {
  'use strict';
  var EV = g.EV || (g.EV = {});
  EV.ui = EV.ui || {};
  EV.ui.features = EV.ui.features || {};

  EV.ui.features.session = function createSession(ctx) {
    var state = ctx.state, els = ctx.els;
    // Exported to the other features (function declarations are hoisted, so these are valid before their definitions).
    ctx.saveSession = saveSession;
    ctx.tryResumeSession = tryResumeSession;

    function saveSession() {
      if (!state.workspace) return;
      var active = ctx.tabMgr.getActive();
      EV.session.saveDebounced({
        folderName: state.workspace.name,
        mode: state.workspace.mode,
        dirHandle: state.workspace.mode === 'fsAccess' ? state.workspace.dirHandle : undefined,
        openTabPaths: ctx.tabMgr.list().map(function (t) { return t.path; }),
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
              EV.alertDialog('Please re-select the "' + data.folderName + '" folder to resume — this browser can\'t reopen it automatically.');
              els.btn_open_folder.click();
              return;
            }
            ctx.setWorkspace(ws);
            (data.openTabPaths || []).forEach(function (p) {
              var entry = state.pathToEntry.get(p);
              if (entry) ctx.openTab(entry);
            });
            if (data.activeTabPath) {
              var t = ctx.tabMgr.list().filter(function (t) { return t.path === data.activeTabPath; })[0];
              if (t) ctx.tabMgr.activate(t.id);
            }
            // setWorkspace(ws) above already hid this button -- see its own comment.
          } catch (e) {
            EV.alertDialog('Could not resume: ' + e.message);
          }
        };
      });
    }
  };
})(typeof self !== 'undefined' ? self : this);
