/**
 * fileTree.js — turns "a folder the user picked" into a uniform in-memory
 * tree, regardless of how it was picked:
 *   1. window.showDirectoryPicker() (Chrome/Edge) — best: gives a handle we
 *      can persist in IndexedDB and reuse next session without re-browsing.
 *   2. <input type=file webkitdirectory multiple> (all browsers) — fallback,
 *      no reusable handle, but works everywhere including Firefox/Safari.
 *   3. Drag-and-drop of a folder onto the window (all browsers), via the
 *      legacy webkitGetAsEntry() DataTransferItem API.
 *
 * A tree node is: { type:'folder'|'file', name, path, children:[] }
 * A file node additionally carries a `entry` object shaped as:
 *   { path, name, size, ext, getBytes(): Promise<ArrayBuffer> }
 */
(function (g) {
  'use strict';
  var EV = g.EV || (g.EV = {});

  function extOf(name) {
    var i = name.lastIndexOf('.');
    return i === -1 ? '' : name.slice(i + 1).toLowerCase();
  }

  function newFolder(name, path) {
    return { type: 'folder', name: name, path: path, children: [], expanded: true };
  }

  function findOrCreateChildFolder(node, name, path) {
    for (var i = 0; i < node.children.length; i++) {
      if (node.children[i].type === 'folder' && node.children[i].name === name) return node.children[i];
    }
    var f = newFolder(name, path);
    node.children.push(f);
    return f;
  }

  function insertPath(root, parts, entry) {
    var node = root;
    for (var i = 0; i < parts.length - 1; i++) {
      var p = parts.slice(0, i + 1).join('/');
      node = findOrCreateChildFolder(node, parts[i], p);
    }
    node.children.push({ type: 'file', name: parts[parts.length - 1], path: entry.path, entry: entry });
  }

  function sortTree(node, direction) {
    var dir = direction === 'desc' ? -1 : 1;
    node.children.sort(function (a, b) {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1; // folders always first, regardless of direction
      return dir * a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });
    node.children.forEach(function (c) { if (c.type === 'folder') sortTree(c, direction); });
  }

  /** Re-sorts an already-built tree in place — used by the Explorer's sort control. */
  EV.sortTree = sortTree;

  /** Recursively sets every folder's expanded state — used by Collapse All / Expand All. */
  EV.setAllExpanded = function (node, expanded) {
    if (node.type !== 'folder') return;
    node.expanded = expanded;
    node.children.forEach(function (c) { EV.setAllExpanded(c, expanded); });
  };

  function countFiles(node) {
    if (node.type === 'file') return 1;
    return node.children.reduce(function (sum, c) { return sum + countFiles(c); }, 0);
  }

  // ---------- mode 1: File System Access API ----------

  EV.hasDirectoryPicker = function () {
    return typeof g.showDirectoryPicker === 'function';
  };

  // A file/folder literally named this, anywhere in the tree, is where
  // Delete moves files to (see EV.deleteEntries below) -- fully hidden from
  // the tree/index/search/rules, as if it doesn't exist, so deleted items
  // never resurface in triage results.
  var DELETED_FOLDER_NAME = '.deleted';

  // The portable tags/notes sidecar (see EV.saveTagsSidecar/loadTagsSidecar below) -- reserved and
  // hidden from the tree at the workspace root, same as .deleted, so it never shows up as a stray
  // non-email file to browse/index/search.
  var TAGS_SIDECAR_NAME = 'mantiz-tags.json';
  EV.TAGS_SIDECAR_NAME = TAGS_SIDECAR_NAME;

  function fileEntryFromHandle(fileHandle, path, parentDirHandle) {
    var cachedFile = null;
    return {
      path: path,
      name: fileHandle.name,
      ext: extOf(fileHandle.name),
      size: null,
      handle: fileHandle,
      parentDirHandle: parentDirHandle,
      getBytes: function () {
        return (cachedFile ? Promise.resolve(cachedFile) : fileHandle.getFile().then(function (f) {
          cachedFile = f;
          return f;
        })).then(function (f) { return f.arrayBuffer(); });
      },
      getFile: function () {
        return cachedFile ? Promise.resolve(cachedFile) : fileHandle.getFile().then(function (f) { cachedFile = f; return f; });
      }
    };
  }

  async function walkDirHandle(dirHandle, root, parentPath, onProgress) {
    for await (var [name, handle] of dirHandle.entries()) {
      if (handle.kind === 'directory' && name === DELETED_FOLDER_NAME && !parentPath) continue;
      if (handle.kind === 'file' && name === TAGS_SIDECAR_NAME && !parentPath) continue;
      var path = parentPath ? parentPath + '/' + name : name;
      if (handle.kind === 'directory') {
        var folder = findOrCreateChildFolder(root, name, path);
        await walkDirHandle(handle, folder, path, onProgress);
      } else {
        var entry = fileEntryFromHandle(handle, path, dirHandle);
        root.children.push({ type: 'file', name: name, path: path, entry: entry });
        if (onProgress) onProgress(path);
      }
    }
  }

  EV.openFolderWithDirectoryPicker = async function (onProgress) {
    var dirHandle = await g.showDirectoryPicker({ mode: 'read' });
    var root = newFolder(dirHandle.name, '');
    await walkDirHandle(dirHandle, root, '', onProgress);
    sortTree(root);
    return { name: dirHandle.name, mode: 'fsAccess', root: root, dirHandle: dirHandle, fileCount: countFiles(root) };
  };

  EV.resumeFromDirHandle = async function (dirHandle, onProgress) {
    var perm = await dirHandle.queryPermission({ mode: 'read' });
    if (perm !== 'granted') {
      perm = await dirHandle.requestPermission({ mode: 'read' });
    }
    if (perm !== 'granted') throw new Error('Permission to read the folder was not granted');
    var root = newFolder(dirHandle.name, '');
    await walkDirHandle(dirHandle, root, '', onProgress);
    sortTree(root);
    return { name: dirHandle.name, mode: 'fsAccess', root: root, dirHandle: dirHandle, fileCount: countFiles(root) };
  };

  // ---------- file operations: delete / move / copy ----------
  // Only possible at all when the workspace was opened via the native
  // directory picker (mode:'fsAccess') AND the browser grants read-write
  // permission on it -- the webkitdirectory/drag-and-drop fallbacks only ever
  // hand over inert File snapshots with no way to write back to disk.

  EV.hasWriteCapableWorkspace = function (workspace) {
    return !!(workspace && workspace.mode === 'fsAccess' && workspace.dirHandle);
  };

  /** Must be called from inside a real user-gesture handler (e.g. a click), or the browser silently denies it. */
  EV.ensureWritePermission = async function (dirHandle) {
    var perm = await dirHandle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') perm = await dirHandle.requestPermission({ mode: 'readwrite' });
    return perm === 'granted';
  };

  function sanitizeFolderName(name) {
    return String(name || '').trim().replace(/[\/\\:*?"<>|]/g, '_').slice(0, 200);
  }
  EV.sanitizeFolderName = sanitizeFolderName;

  /** Existing subfolder paths under the workspace root (any depth), excluding the reserved .deleted folder -- populates the move/copy destination picker. */
  EV.listExistingFolders = function (workspaceRoot) {
    var out = [];
    (function walk(node, prefix) {
      node.children.forEach(function (c) {
        if (c.type !== 'folder') return;
        var full = prefix ? prefix + '/' + c.name : c.name;
        out.push(full);
        walk(c, full);
      });
    })(workspaceRoot, '');
    return out;
  };

  /** Finds (creating intermediate segments as needed) the directory handle for a "a/b/c" path relative to root. */
  EV.resolveFolderPath = async function (rootDirHandle, relPath) {
    var parts = String(relPath || '').split('/').map(sanitizeFolderName).filter(Boolean);
    var dh = rootDirHandle;
    for (var i = 0; i < parts.length; i++) {
      dh = await dh.getDirectoryHandle(parts[i], { create: true });
    }
    return dh;
  };

  /** Copies one file entry's bytes into destDirHandle, auto-renaming on a name collision (never overwrites). Returns the filename actually used. */
  async function copyEntryInto(entry, destDirHandle) {
    var file = await entry.getFile();
    var name = entry.name;
    var finalName = name;
    var n = 2;
    while (true) {
      try {
        await destDirHandle.getFileHandle(finalName, { create: false });
      } catch (e) {
        break; // NotFoundError -- finalName is free, use it
      }
      var dot = name.lastIndexOf('.');
      finalName = dot === -1 ? (name + '-' + n) : (name.slice(0, dot) + '-' + n + name.slice(dot));
      n++;
    }
    var fh = await destDirHandle.getFileHandle(finalName, { create: true });
    var writable = await fh.createWritable();
    await writable.write(file);
    await writable.close();
    return finalName;
  }

  /**
   * Copies each entry into destDirHandle; if move is true, also removes the
   * original from its parent directory afterward. Best-effort per file --
   * one failure doesn't abort the rest of the batch.
   * @returns {Promise<{succeeded: string[], failed: {path:string, error:string}[]}>}
   */
  EV.copyOrMoveEntries = async function (entries, destDirHandle, move) {
    var succeeded = [];
    var failed = [];
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      try {
        await copyEntryInto(entry, destDirHandle);
        if (move) {
          if (!entry.parentDirHandle) throw new Error('original location unknown, cannot remove after copy');
          await entry.parentDirHandle.removeEntry(entry.name);
        }
        succeeded.push(entry.path);
      } catch (e) {
        failed.push({ path: entry.path, error: String(e && e.message || e) });
      }
    }
    return { succeeded: succeeded, failed: failed };
  };

  /** "Delete" = move into the reserved .deleted folder at the workspace root -- reversible on disk, and invisible to the tool from then on (see walkDirHandle above). */
  EV.deleteEntries = async function (entries, rootDirHandle) {
    var trash = await rootDirHandle.getDirectoryHandle(DELETED_FOLDER_NAME, { create: true });
    return EV.copyOrMoveEntries(entries, trash, true);
  };

  /**
   * Writes the tags/notes export (the same JSON EV.tags.exportJson() already produces) as a
   * portable sidecar file at the workspace root -- an explicit, user-clicked action (the Tags
   * panel's "Save to folder" button, gated behind the same ensureWritePermission() every other
   * write here requires), so tags travel with the folder itself instead of being stranded in one
   * browser's IndexedDB. Overwrites any previous sidecar in this folder.
   */
  EV.saveTagsSidecar = async function (rootDirHandle, jsonText) {
    var fh = await rootDirHandle.getFileHandle(TAGS_SIDECAR_NAME, { create: true });
    var writable = await fh.createWritable();
    await writable.write(jsonText);
    await writable.close();
  };

  /** Reads the sidecar back if this folder has one -- read-only, no write-permission prompt needed
   * (the 'read' mode already granted just to open the folder covers it). Returns null, not a
   * thrown error, when there's no sidecar here -- "nothing to load" is a normal, expected outcome. */
  EV.loadTagsSidecar = async function (rootDirHandle) {
    try {
      var fh = await rootDirHandle.getFileHandle(TAGS_SIDECAR_NAME, { create: false });
      var file = await fh.getFile();
      return await file.text();
    } catch (e) {
      return null;
    }
  };

  // ---------- mode 2: <input webkitdirectory> FileList ----------

  function fileEntryFromFile(file, path) {
    return {
      path: path,
      name: file.name,
      ext: extOf(file.name),
      size: file.size,
      file: file,
      getBytes: function () { return file.arrayBuffer(); },
      getFile: function () { return Promise.resolve(file); }
    };
  }

  EV.buildTreeFromFileList = function (fileList) {
    var files = Array.prototype.slice.call(fileList);
    if (files.length === 0) return null;
    var firstRel = files[0].webkitRelativePath || files[0].name;
    var rootName = firstRel.split('/')[0];
    var root = newFolder(rootName, '');
    files.forEach(function (file) {
      var rel = file.webkitRelativePath || file.name;
      var parts = rel.split('/').slice(1); // drop the root folder segment itself
      if (parts.length === 0) parts = [file.name];
      var path = parts.join('/');
      insertPath(root, parts, fileEntryFromFile(file, path));
    });
    sortTree(root);
    return { name: rootName, mode: 'fileList', root: root, fileCount: countFiles(root) };
  };

  EV.buildTreeFromFlatFiles = function (fileList) {
    var files = Array.prototype.slice.call(fileList);
    var root = newFolder('Selected files', '');
    files.forEach(function (file) {
      insertPath(root, [file.name], fileEntryFromFile(file, file.name));
    });
    sortTree(root);
    return { name: root.name, mode: 'fileList', root: root, fileCount: countFiles(root) };
  };

  // ---------- mode 3: drag & drop (webkitGetAsEntry) ----------

  function readDirEntry(dirEntry) {
    return new Promise(function (resolve, reject) {
      var reader = dirEntry.createReader();
      var all = [];
      function readBatch() {
        reader.readEntries(function (entries) {
          if (!entries.length) { resolve(all); return; }
          all = all.concat(entries);
          readBatch();
        }, reject);
      }
      readBatch();
    });
  }

  function readFileEntry(fileEntry) {
    return new Promise(function (resolve, reject) { fileEntry.file(resolve, reject); });
  }

  async function walkFsEntry(fsEntry, root, parentPath, onProgress) {
    if (fsEntry.isDirectory) {
      var folder = parentPath === '' && root.children.length === 0 ? root :
        findOrCreateChildFolder(root, fsEntry.name, parentPath ? parentPath + '/' + fsEntry.name : fsEntry.name);
      var entries = await readDirEntry(fsEntry);
      var nextPath = folder === root ? '' : folder.path;
      for (var i = 0; i < entries.length; i++) {
        await walkFsEntry(entries[i], folder, nextPath, onProgress);
      }
    } else {
      var path = parentPath ? parentPath + '/' + fsEntry.name : fsEntry.name;
      var file = await readFileEntry(fsEntry);
      root.children.push({ type: 'file', name: fsEntry.name, path: path, entry: fileEntryFromFile(file, path) });
      if (onProgress) onProgress(path);
    }
  }

  EV.buildTreeFromDataTransferItems = async function (items, onProgress) {
    var entries = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var entry = it.webkitGetAsEntry && it.webkitGetAsEntry();
      if (entry) entries.push(entry);
    }
    if (entries.length === 0) return null;
    if (entries.length === 1 && entries[0].isDirectory) {
      var root = newFolder(entries[0].name, '');
      var top = await readDirEntry(entries[0]);
      for (var j = 0; j < top.length; j++) await walkFsEntry(top[j], root, '', onProgress);
      sortTree(root);
      return { name: entries[0].name, mode: 'fileList', root: root, fileCount: countFiles(root) };
    }
    var multiRoot = newFolder('Dropped files', '');
    for (var k = 0; k < entries.length; k++) await walkFsEntry(entries[k], multiRoot, '', onProgress);
    sortTree(multiRoot);
    return { name: multiRoot.name, mode: 'fileList', root: multiRoot, fileCount: countFiles(multiRoot) };
  };

  // ---------- shared helpers ----------

  // 'emlOnly' (default) only treats .eml-suffixed files as emails everywhere
  // (tree click, indexing, search, rules). 'all' additionally treats any
  // file with NO extension, or an extension this app doesn't recognize as
  // definitely-not-email, as a candidate email — for folders where messages
  // were renamed to a content hash with no extension (real .eml bytes, just
  // no ".eml" suffix). It deliberately does NOT mean "parse literally every
  // file": a stray .json/.txt/.png/etc. sitting next to real emails in the
  // same folder is still skipped, since trying to parse a known non-email
  // file just produces a useless, empty-looking entry in the tree/search/
  // rules. Toggled from the Explorer tree toolbar; see app.js's file-filter
  // <select> wiring.
  EV.fileFilterMode = 'emlOnly';

  var KNOWN_NON_EMAIL_EXT = {
    json: 1, txt: 1, csv: 1, tsv: 1, log: 1, md: 1, xml: 1, html: 1, htm: 1,
    png: 1, jpg: 1, jpeg: 1, gif: 1, bmp: 1, webp: 1, svg: 1, ico: 1,
    zip: 1, rar: 1, '7z': 1, gz: 1, tar: 1, pdf: 1,
    doc: 1, docx: 1, xls: 1, xlsx: 1, ppt: 1, pptx: 1,
    exe: 1, dll: 1, so: 1, dylib: 1, db: 1, sqlite: 1,
    ini: 1, cfg: 1, yml: 1, yaml: 1
  };

  EV.isEmlFile = function (name) {
    if (/\.eml$/i.test(name)) return true;
    if (EV.fileFilterMode !== 'all') return false;
    var dot = name.lastIndexOf('.');
    if (dot === -1 || dot === name.length - 1) return true; // no extension at all -- the case this mode exists for
    var ext = name.slice(dot + 1).toLowerCase();
    return !KNOWN_NON_EMAIL_EXT[ext];
  };

  EV.flattenFileNodes = function (root) {
    var out = [];
    (function walk(n) {
      if (n.type === 'file') { out.push(n); return; }
      n.children.forEach(walk);
    })(root);
    return out;
  };

  EV.countFiles = countFiles;
})(typeof self !== 'undefined' ? self : this);
