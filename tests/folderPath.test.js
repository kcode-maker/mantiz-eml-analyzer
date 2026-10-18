/**
 * folderPath.test.js — js/core/folderPath.js: validating a pasted folder location and joining it with a relative path
 * (macOS/Linux, Windows drive and UNC paths), plus the settings store that remembers it per folder name.
 * Run via tests/run-all.sh, or directly: jsc tests/folderPath.test.js (from the repo root).
 */
var EV = {}; this.EV = EV;
var __store = {};
EV.db = {
  get: function (s, id) { return Promise.resolve(__store[id] ? JSON.parse(JSON.stringify(__store[id])) : undefined); },
  getAll: function () { return Promise.resolve([]); },
  put: function (s, r) { __store[r.service] = JSON.parse(JSON.stringify(r)); return Promise.resolve(); },
  delete: function (s, id) { delete __store[id]; return Promise.resolve(); }
};
EV.ruleHelpers = { COMMON_BRANDS: [] };
load('js/core/settings.js');
load('js/core/folderPath.js');
var pass = 0, fail = 0;
function assert(c, l) { if (c) pass++; else { fail++; print('FAIL: ' + l); } }
var FP = EV.folderPath;

// ---- fingerprint ----
function nodes(n, size) { var a = []; for (var i = 0; i < n; i++) a.push({ path: 'd' + (i % 5) + '/f' + i + '.eml', entry: { size: size === undefined ? 100 + i : size } }); return a; }
var f = FP.fingerprint(nodes(100));
assert(f.length <= 12 && f.length >= 8, 'a big folder sends only about a dozen files (' + f.length + ')');
assert(new Set(f.map(function (x) { return x.p; })).size === f.length, 'no file twice');
assert(f.some(function (x) { return /^d0\//.test(x.p); }) && f.some(function (x) { return /^d4\//.test(x.p); }), 'files from different sub-folders are covered');
assert(f.every(function (x) { return x.s > 0 && typeof x.p === 'string'; }), 'each item is {p, s}');
assert(FP.fingerprint(nodes(3)).length === 3, 'a small folder sends all its files');
assert(FP.fingerprint(nodes(5, 0)).length === 0 && FP.fingerprint([]).length === 0 && FP.fingerprint(null).length === 0, 'empty files / empty folder / null: nothing to match on');
assert(FP.fingerprint([{ path: 'a', entry: null }, null, { entry: { size: 5 } }]).length === 0, 'malformed nodes are ignored');

// ---- join ----
assert(FP.join('/Users/me/sample-emails', '11-lure/a.eml') === '/Users/me/sample-emails/11-lure/a.eml', 'unix join');
assert(FP.join('C:\\Users\\me\\sample-emails', '11-lure/a.eml') === 'C:\\Users\\me\\sample-emails\\11-lure\\a.eml', 'Windows join uses backslashes throughout');
assert(FP.join('/Users/me/sample-emails/', 'a.eml') === '/Users/me/sample-emails/a.eml', 'no doubled separator');
assert(FP.join('', 'a/b.eml') === 'a/b.eml' && FP.join(undefined, 'a/b.eml') === 'a/b.eml', 'unknown location: the relative path is returned unchanged');
assert(FP.join('/x/y', '') === '/x/y', 'empty relative path gives the folder itself');
assert(FP.sepOf('C:\\a') === '\\' && FP.sepOf('/a') === '/' && FP.sepOf('') === '/', 'separator detection');

// ---- remembered per folder name ----
var chain = Promise.resolve();
function step(fn) { chain = chain.then(fn); }
step(function () { return EV.settings.folderLocation('sample-emails').then(function (v) { assert(v === undefined, 'never asked -> undefined'); }); });
step(function () { return EV.settings.setFolderLocation('sample-emails', '/Users/me/sample-emails'); });
step(function () { return EV.settings.folderLocation('sample-emails').then(function (v) { assert(v === '/Users/me/sample-emails', 'saved location is returned'); }); });
step(function () { return EV.settings.setFolderLocation('other', ''); });
step(function () { return EV.settings.folderLocation('other').then(function (v) { assert(v === '', 'a skip is remembered as empty (so we do not ask again)'); return EV.settings.folderLocation('sample-emails'); }).then(function (v) { assert(v === '/Users/me/sample-emails', 'folders are independent'); }); });
step(function () { return EV.settings.setFolderLocation('other', undefined); });
step(function () { return EV.settings.folderLocation('other').then(function (v) { assert(v === undefined, 'forgetting returns it to "never asked"'); }); });
step(function () {
  var p = Promise.resolve();
  for (var i = 0; i < 205; i++) (function (n) { p = p.then(function () { return EV.settings.setFolderLocation('f' + n, '/p/f' + n); }); })(i);
  return p.then(function () { return EV.settings.get('folderLocations'); }).then(function (rec) { assert(Object.keys(rec.map).length <= 200, 'the remembered list is bounded (' + Object.keys(rec.map).length + ')'); });
});
step(function () { print('---'); print('PASS: ' + pass + '  FAIL: ' + fail); if (fail > 0) throw new Error(fail + ' test(s) failed'); });
