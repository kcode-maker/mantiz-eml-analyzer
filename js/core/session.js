/**
 * session.js — persists "what was open" so the app can offer to resume
 * where you left off, IDE-style. Thin by design: app.js owns the actual
 * resume flow (re-walking the folder, reopening tabs); this module just
 * saves/loads/clears the small state blob in IndexedDB.
 *
 * In Chrome/Edge the blob can include the real FileSystemDirectoryHandle
 * (structured-clonable, IndexedDB-storable per spec), enabling a true one-
 * click resume after re-granting permission. Elsewhere it's folder
 * metadata only, used to prompt "re-open this folder to relink your tabs".
 */
(function (g) {
  'use strict';
  var EV = g.EV || (g.EV = {});
  var STORE = 'session';
  var KEY = 'current';
  var saveTimer = null;

  EV.session = {
    saveNow: function (data) {
      data.savedAt = Date.now();
      return EV.db.put(STORE, data, KEY);
    },
    saveDebounced: function (data) {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(function () { EV.session.saveNow(data); }, 400);
    },
    load: function () {
      return EV.db.get(STORE, KEY);
    },
    clear: function () {
      return EV.db.delete(STORE, KEY);
    }
  };
})(typeof self !== 'undefined' ? self : this);
