/**
 * tags.test.js — regression coverage for js/core/tags.js's tag-provenance model:
 * a rule and a manually-typed tag sharing the same name stay independent
 * (disabling the rule doesn't strip the manual one), a rule-only tag is
 * fully retracted and its record pruned, pre-existing {id,tags:[...]}
 * records are read as if every entry were manual (the safe migration
 * default), and export/import round-trips ownership correctly. Run via
 * tests/run-all.sh, or directly: jsc tests/tags.test.js (from the repo root).
 */
// Minimal in-memory mock of EV.db so tags.js can run standalone under jsc.
var EV = {};
this.EV = EV;
var __store = {};
EV.db = {
  get: function (storeName, id) { return Promise.resolve(__store[id] ? JSON.parse(JSON.stringify(__store[id])) : undefined); },
  getAll: function () { return Promise.resolve(Object.keys(__store).map(function (k) { return JSON.parse(JSON.stringify(__store[k])); })); },
  put: function (storeName, record) { __store[record.id] = JSON.parse(JSON.stringify(record)); return Promise.resolve(); },
  delete: function (storeName, id) { delete __store[id]; return Promise.resolve(); }
};

load('js/core/tags.js');

var pass = 0, fail = 0;
function assert(cond, label) { if (cond) pass++; else { fail++; print('FAIL: ' + label); } }

// jsc's queueMicrotask/Promise resolution needs draining between async steps;
// use a manual promise chain instead of async/await for jsc portability.
var chain = Promise.resolve();
function step(fn) { chain = chain.then(fn); }

step(function () { return EV.tags.addTag('mid:1', 'shared-name', { type: 'manual' }); });
step(function () { return EV.tags.addTag('mid:1', 'shared-name', { type: 'rule', ruleId: 'r1' }); });
step(function () {
  return EV.tags.get('mid:1').then(function (rec) {
    assert(rec.tags.length === 1 && rec.tags[0] === 'shared-name', 'manual+rule same name -> one visible tag (' + JSON.stringify(rec.tags) + ')');
  });
});
step(function () { return EV.tags.removeTag('mid:1', 'shared-name', { type: 'rule', ruleId: 'r1' }); });
step(function () {
  return EV.tags.get('mid:1').then(function (rec) {
    assert(rec && rec.tags.length === 1 && rec.tags[0] === 'shared-name',
      'disabling the rule does NOT strip the identically-named manual tag (' + JSON.stringify(rec && rec.tags) + ')');
  });
});
step(function () { return EV.tags.removeTag('mid:1', 'shared-name', { type: 'manual' }); });
step(function () {
  return EV.tags.get('mid:1').then(function (rec) {
    assert(!rec, 'removing the manual tag too leaves no record (record: ' + JSON.stringify(rec) + ')');
  });
});

// rule-only tag: disabling removes it entirely and prunes the record
step(function () { return EV.tags.addTag('mid:2', 'rule-only', { type: 'rule', ruleId: 'r2' }); });
step(function () {
  return EV.tags.get('mid:2').then(function (rec) {
    assert(rec.tags.length === 1 && rec.tags[0] === 'rule-only', 'rule-only tag visible before disable');
  });
});
step(function () { return EV.tags.removeTag('mid:2', 'rule-only', { type: 'rule', ruleId: 'r2' }); });
step(function () {
  return EV.tags.get('mid:2').then(function (rec) {
    assert(!rec, 'rule-only tag fully retracted and record pruned (' + JSON.stringify(rec) + ')');
  });
});

// old-format record migration: pre-existing {id, tags:[...]} treated as manual
step(function () {
  __store['mid:3'] = { id: 'mid:3', tags: ['legacy-tag'], updatedAt: 1 };
  return null;
});
step(function () {
  return EV.tags.get('mid:3').then(function (rec) {
    assert(rec.tags.length === 1 && rec.tags[0] === 'legacy-tag', 'old-format record reads correctly (' + JSON.stringify(rec.tags) + ')');
  });
});
step(function () { return EV.tags.addTag('mid:3', 'legacy-tag', { type: 'rule', ruleId: 'r3' }); });
step(function () { return EV.tags.removeTag('mid:3', 'legacy-tag', { type: 'rule', ruleId: 'r3' }); });
step(function () {
  return EV.tags.get('mid:3').then(function (rec) {
    assert(rec && rec.tags.length === 1 && rec.tags[0] === 'legacy-tag',
      'a pre-existing (old-format) tag is treated as manual, survives a same-named rule retracting its own claim (' + JSON.stringify(rec && rec.tags) + ')');
  });
});

// export/import roundtrip preserves manual vs rule ownership
step(function () {
  __store = {};
  return EV.tags.addTag('mid:4', 'manual-x', { type: 'manual' }).then(function () {
    return EV.tags.addTag('mid:4', 'rule-y', { type: 'rule', ruleId: 'r4' });
  });
});
step(function () { return EV.tags.exportJson(); });
step(function (json) {
  var parsed = JSON.parse(json);
  __store = {}; // simulate a fresh browser profile
  return EV.tags.importJson(json).then(function () { return parsed; });
});
step(function () {
  return EV.tags.get('mid:4').then(function (rec) {
    assert(rec.tags.indexOf('manual-x') !== -1 && rec.tags.indexOf('rule-y') !== -1, 'import restores both tags (' + JSON.stringify(rec.tags) + ')');
  });
});
step(function () { return EV.tags.removeTag('mid:4', 'rule-y', { type: 'rule', ruleId: 'r4' }); });
step(function () {
  return EV.tags.get('mid:4').then(function (rec) {
    assert(rec && rec.tags.length === 1 && rec.tags[0] === 'manual-x',
      'import preserved rule ownership -- retracting r4 after import removes only rule-y (' + JSON.stringify(rec && rec.tags) + ')');
  });
});

step(function () {
  print('---');
  print('PASS: ' + pass + '  FAIL: ' + fail);
  if (fail > 0) throw new Error(fail + ' test(s) failed');
});
