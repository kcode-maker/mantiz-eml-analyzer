/**
 * fileops.test.js — regression coverage for js/ui/fileTree.js's Delete/Move/Copy
 * logic: the .deleted folder is excluded from the walk and from
 * listExistingFolders, sanitizeFolderName strips illegal path characters,
 * resolveFolderPath creates nested folders, copy leaves the original alone,
 * move removes the original from its real (possibly nested) parent handle
 * rather than always the root, repeated copies auto-rename instead of
 * colliding, delete moves into .deleted, and one failing entry in a batch
 * doesn't abort the rest. Also covers the tags-sidecar save/load pair
 * (mantiz-tags.json): it round-trips real text, is excluded from the tree
 * walk exactly like .deleted, and loading a missing sidecar resolves to
 * null rather than throwing. Run via tests/run-all.sh, or directly:
 * jsc tests/fileops.test.js (from the repo root).
 */
// Mock File System Access API (FileSystemDirectoryHandle/FileSystemFileHandle)
// good enough to exercise fileTree.js's write-side logic under jsc.
function MockFileHandle(name, content) {
  this.kind = 'file';
  this.name = name;
  this._content = content || '';
}
MockFileHandle.prototype.getFile = function () {
  var self = this;
  return Promise.resolve({
    name: self.name,
    arrayBuffer: function () {
      var s = self._content;
      var buf = new ArrayBuffer(s.length);
      var view = new Uint8Array(buf);
      for (var i = 0; i < s.length; i++) view[i] = s.charCodeAt(i) & 0xff;
      return Promise.resolve(buf);
    },
    // Real File objects also have .text() (used by EV.loadTagsSidecar) -- not just arrayBuffer().
    text: function () { return Promise.resolve(self._content); }
  });
};
MockFileHandle.prototype.createWritable = function () {
  var self = this;
  var chunks = [];
  return Promise.resolve({
    write: function (data) {
      if (data && typeof data.arrayBuffer === 'function') {
        return data.arrayBuffer().then(function (buf) { chunks.push(buf); });
      }
      chunks.push(data);
      return Promise.resolve();
    },
    // Real FileSystemWritableFileStream.write() accepts either a Blob/File (used by copy/move
    // above) or a plain string (used by the tags-sidecar save below, which writes JSON text
    // directly, not a Blob) -- this mock supports both rather than assuming every write is bytes.
    close: function () {
      var data = chunks[0];
      if (data === undefined) { self._content = ''; return Promise.resolve(); }
      if (typeof data === 'string') { self._content = data; return Promise.resolve(); }
      var view = new Uint8Array(data);
      var s = '';
      for (var i = 0; i < view.length; i++) s += String.fromCharCode(view[i]);
      self._content = s;
      return Promise.resolve();
    }
  });
};
function notFound() { var e = new Error('NotFoundError'); e.name = 'NotFoundError'; return e; }
function MockDirHandle(name) {
  this.kind = 'directory';
  this.name = name;
  this._children = {};
}
MockDirHandle.prototype.getFileHandle = function (name, opts) {
  var existing = this._children[name];
  if (existing && existing.kind === 'file') return Promise.resolve(existing);
  if (!existing && opts && opts.create) { var fh = new MockFileHandle(name, ''); this._children[name] = fh; return Promise.resolve(fh); }
  return Promise.reject(notFound());
};
MockDirHandle.prototype.getDirectoryHandle = function (name, opts) {
  var existing = this._children[name];
  if (existing && existing.kind === 'directory') return Promise.resolve(existing);
  if (!existing && opts && opts.create) { var dh = new MockDirHandle(name); this._children[name] = dh; return Promise.resolve(dh); }
  return Promise.reject(notFound());
};
MockDirHandle.prototype.removeEntry = function (name) {
  if (!(name in this._children)) return Promise.reject(notFound());
  delete this._children[name];
  return Promise.resolve();
};
MockDirHandle.prototype.queryPermission = function () { return Promise.resolve('granted'); };
MockDirHandle.prototype.requestPermission = function () { return Promise.resolve('granted'); };
MockDirHandle.prototype.entries = function () {
  var self = this;
  var keys = Object.keys(this._children);
  var idx = 0;
  var iterator = { next: function () {
    if (idx >= keys.length) return Promise.resolve({ done: true });
    var k = keys[idx++];
    return Promise.resolve({ done: false, value: [k, self._children[k]] });
  } };
  var asyncIterable = {};
  asyncIterable[Symbol.asyncIterator] = function () { return iterator; };
  return asyncIterable;
};

load('js/ui/fileTree.js');
var EV = this.EV;

var pass = 0, fail = 0;
function assert(cond, label) { if (cond) pass++; else { fail++; print('FAIL: ' + label); } }

var chain = Promise.resolve();
function step(fn) { chain = chain.then(fn); }

var root = new MockDirHandle('myroot');
root._children['a.eml'] = new MockFileHandle('a.eml', 'AAA');
root._children['b.eml'] = new MockFileHandle('b.eml', 'BBB');
var sub = new MockDirHandle('sub');
sub._children['c.eml'] = new MockFileHandle('c.eml', 'CCC');
root._children['sub'] = sub;
var oldDeleted = new MockDirHandle('.deleted');
oldDeleted._children['old.eml'] = new MockFileHandle('old.eml', 'OLD');
root._children['.deleted'] = oldDeleted;

var tree, entries;
step(function () { return EV.resumeFromDirHandle(root); });
step(function (ws) {
  tree = ws;
  entries = EV.flattenFileNodes(ws.root).map(function (n) { return n.entry; });
  var names = entries.map(function (e) { return e.path; }).sort();
  assert(names.length === 3, '.deleted folder and its contents excluded from the walk (found ' + names.length + ': ' + JSON.stringify(names) + ')');
  assert(names.indexOf('a.eml') !== -1 && names.indexOf('b.eml') !== -1 && names.indexOf('sub/c.eml') !== -1,
    'expected files present (' + JSON.stringify(names) + ')');
});

// listExistingFolders should show "sub" but never ".deleted"
step(function () {
  var folders = EV.listExistingFolders(tree.root);
  assert(folders.indexOf('sub') !== -1 && folders.indexOf('.deleted') === -1,
    'listExistingFolders shows sub, hides .deleted (' + JSON.stringify(folders) + ')');
});

// sanitizeFolderName strips illegal path characters
step(function () {
  assert(EV.sanitizeFolderName('a/b\\c:d*e?f"g<h>i|j') === 'a_b_c_d_e_f_g_h_i_j', 'sanitizeFolderName strips illegal chars');
});

// resolveFolderPath creates nested folders
step(function () { return EV.resolveFolderPath(root, 'campaign-a/wave1'); });
step(function (dh) {
  assert(dh && dh.kind === 'directory' && dh.name === 'wave1', 'resolveFolderPath created the leaf folder');
  assert(root._children['campaign-a'] && root._children['campaign-a']._children['wave1'], 'resolveFolderPath created the intermediate folder too');
});

// COPY: original stays, destination gets a copy
step(function () {
  var entryA = entries.filter(function (e) { return e.path === 'a.eml'; })[0];
  return EV.copyOrMoveEntries([entryA], root._children['campaign-a'], false);
});
step(function (result) {
  assert(result.succeeded.length === 1 && result.failed.length === 0, 'copy: 1 succeeded, 0 failed');
  assert(!!root._children['a.eml'], 'copy: original a.eml still present in source');
  assert(!!root._children['campaign-a']._children['a.eml'], 'copy: a.eml now present in destination');
});

// MOVE: destination gets it, original is removed -- including from a nested subfolder's own handle
step(function () {
  var entryC = entries.filter(function (e) { return e.path === 'sub/c.eml'; })[0];
  return EV.copyOrMoveEntries([entryC], root._children['campaign-a'], true);
});
step(function (result) {
  assert(result.succeeded.length === 1 && result.failed.length === 0, 'move: 1 succeeded, 0 failed');
  assert(!sub._children['c.eml'], 'move: original c.eml removed from its real parent (sub), not root');
  assert(!!root._children['campaign-a']._children['c.eml'], 'move: c.eml now present in destination');
});

// Name-collision safety: copying the same file twice into one destination auto-renames, never overwrites
step(function () {
  var entryB = entries.filter(function (e) { return e.path === 'b.eml'; })[0];
  return EV.copyOrMoveEntries([entryB], root._children['campaign-a'], false).then(function () {
    return EV.copyOrMoveEntries([entryB], root._children['campaign-a'], false);
  });
});
step(function (result) {
  var destNames = Object.keys(root._children['campaign-a']._children).sort();
  assert(destNames.indexOf('b.eml') !== -1 && destNames.indexOf('b-2.eml') !== -1,
    'copying the same file twice auto-renames the second instead of overwriting (' + JSON.stringify(destNames) + ')');
});

// DELETE = move into .deleted at the workspace root; original removed from its real parent
step(function () {
  var entryB = entries.filter(function (e) { return e.path === 'b.eml'; })[0];
  return EV.deleteEntries([entryB], root);
});
step(function (result) {
  assert(result.succeeded.length === 1, 'delete: succeeded');
  assert(!root._children['b.eml'], 'delete: b.eml removed from its original location');
  assert(root._children['.deleted'] && root._children['.deleted']._children['b.eml'], 'delete: b.eml now sitting in .deleted');
});

// Best-effort semantics: one bad entry doesn't abort the rest of the batch
step(function () {
  var fakeEntry = { path: 'ghost.eml', name: 'ghost.eml', parentDirHandle: root, getFile: function () { return Promise.reject(new Error('boom')); } };
  var entryA2 = entries.filter(function (e) { return e.path === 'a.eml'; })[0];
  return EV.copyOrMoveEntries([fakeEntry, entryA2], root._children['sub'], false);
});
step(function (result) {
  assert(result.failed.length === 1 && result.failed[0].path === 'ghost.eml', 'one failing entry is reported, not thrown');
  assert(result.succeeded.length === 1 && result.succeeded[0] === 'a.eml', 'the other entry in the same batch still succeeds');
});

// ---------- tags sidecar (mantiz-tags.json) ----------

// no sidecar yet -- loadTagsSidecar resolves to null, not a thrown error
step(function () { return EV.loadTagsSidecar(root); });
step(function (text) {
  assert(text === null, 'loadTagsSidecar: resolves to null when this folder has no sidecar yet (' + JSON.stringify(text) + ')');
});

// save writes real text, and it round-trips exactly
var sidecarJson = JSON.stringify({ version: 2, records: [{ id: 'mid:1@x', manualTags: ['phish'] }] });
step(function () { return EV.saveTagsSidecar(root, sidecarJson); });
step(function () { return EV.loadTagsSidecar(root); });
step(function (text) {
  assert(text === sidecarJson, 'saveTagsSidecar/loadTagsSidecar round-trip the exact text (' + JSON.stringify(text) + ')');
  assert(!!root._children[EV.TAGS_SIDECAR_NAME], 'the sidecar file exists at the workspace root under its reserved name');
});

// re-saving overwrites rather than erroring on an existing file
var sidecarJson2 = JSON.stringify({ version: 2, records: [] });
step(function () { return EV.saveTagsSidecar(root, sidecarJson2); });
step(function () { return EV.loadTagsSidecar(root); });
step(function (text) {
  assert(text === sidecarJson2, 'saving again overwrites the previous sidecar content (' + JSON.stringify(text) + ')');
});

// excluded from the walk at the root, exactly like .deleted
step(function () { return EV.resumeFromDirHandle(root); });
step(function (ws) {
  var names = EV.flattenFileNodes(ws.root).map(function (n) { return n.entry.path; });
  assert(names.indexOf(EV.TAGS_SIDECAR_NAME) === -1, 'the tags sidecar never appears as a tree/index entry (' + JSON.stringify(names) + ')');
});

step(function () {
  print('---');
  print('PASS: ' + pass + '  FAIL: ' + fail);
  if (fail > 0) throw new Error(fail + ' test(s) failed');
});
