/**
 * folderPath.js — helpers for showing the opened folder's full on-disk path.
 *
 * No browser lets a page read the real location of a folder the user picked (Chrome's directory picker, webkitdirectory
 * and drag-and-drop only expose the folder's NAME and paths relative to it). scripts/serve.py -- the local process that
 * serves this app -- can see the disk, so the app sends it the folder's name plus a small fingerprint and gets the real
 * path back (see locateFolderOnDisk in app.js and scripts/folder_locator.py). These pure helpers build that fingerprint
 * and join the found folder path with a relative path using the right separator.
 *
 *   EV.folderPath.fingerprint(fileNodes, max) -> [{p: 'sub/a.eml', s: 1234}, ...]  evenly spread through the folder
 *   EV.folderPath.join(base, relPath)         -> full path ('' base returns relPath unchanged)
 *   EV.folderPath.sepOf(base)                 -> '/' or '\\'
 */
(function (g) {
  'use strict';
  var EV = g.EV || (g.EV = {});

  function sepOf(base) { return /\\/.test(base || '') && !/\//.test(base) ? '\\' : '/'; }

  EV.folderPath = {
    sepOf: sepOf,

    /** Up to `max` files with their sizes, spread evenly through the list (so a folder with a hundred thousand files still sends a
     * tiny request, and files from different sub-folders are covered). Empty files are skipped: their size says nothing. */
    fingerprint: function (fileNodes, max) {
      max = max || 12;
      var usable = (fileNodes || []).filter(function (n) { return n && n.entry && n.entry.size > 0 && n.path; });
      if (!usable.length) return [];
      var out = [], step = Math.max(1, Math.floor(usable.length / max));
      for (var i = 0; i < usable.length && out.length < max; i += step) out.push({ p: usable[i].path, s: usable[i].entry.size });
      return out;
    },

    join: function (base, relPath) {
      var rel = String(relPath == null ? '' : relPath);
      if (!base) return rel;
      if (!rel) return base;
      var sep = sepOf(base);
      return base.replace(/[\\\/]+$/, '') + sep + rel.split('/').join(sep);
    }
  };
})(typeof self !== 'undefined' ? self : this);
