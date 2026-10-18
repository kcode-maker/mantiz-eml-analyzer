/**
 * tagNames.test.js — tag-name rules and the "delete a tag everywhere" feature:
 *   - EV.tags.normalizeName / sanitizeLegacy (lowercase a-z, 0-9, - and _, max 40, no spaces)
 *   - addTag refuses invalid manual names, converts a rule's
 *   - deleteTag + undo, including the exact "set1 / set2 / set3" scenario that motivated it
 *   - removeManualTagFromMany (the multi-select bar's "Remove tag"), tagCounts
 *   - converting old tags on startup (migrateLegacyNames) and on import (importJsonDetailed)
 *   - rulesStore.slugify / migrateTagNames
 * Run via tests/run-all.sh, or directly: jsc tests/tagNames.test.js (from the repo root).
 */
var EV = {};
this.EV = EV;
var __stores = { tags: {}, rules: {} };
function clone(o) { return JSON.parse(JSON.stringify(o)); }
EV.db = {
  get: function (st, id) { var r = __stores[st][id]; return Promise.resolve(r ? clone(r) : undefined); },
  getAll: function (st) { return Promise.resolve(Object.keys(__stores[st]).map(function (k) { return clone(__stores[st][k]); })); },
  put: function (st, rec) { __stores[st][rec.id] = clone(rec); return Promise.resolve(); },
  delete: function (st, id) { delete __stores[st][id]; return Promise.resolve(); },
  getAllByIndex: function () { return Promise.resolve([]); }
};
load('js/core/tags.js');
load('js/rules/rulesStore.js');

var pass = 0, fail = 0;
function assert(cond, label) { if (cond) pass++; else { fail++; print('FAIL: ' + label); } }
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
var chain = Promise.resolve();
function step(fn) { chain = chain.then(fn); }
function reset() { __stores.tags = {}; __stores.rules = {}; }
function tagsOf(id) { return EV.tags.get(id).then(function (r) { return r ? r.tags.slice().sort() : []; }); }

// ---- normalizeName ----
var N = EV.tags.normalizeName;
assert(N('set1').ok && N('set1').name === 'set1', 'digits are allowed: set1');
assert(N('PHISH').ok && N('PHISH').name === 'phish', 'uppercase is folded to lowercase, not rejected');
assert(N('  x  ').name === 'x' && N('  x  ').ok, 'surrounding whitespace is trimmed');
assert(N('a_b-c').ok, 'underscore and hyphen are allowed');
var sp = N('set 1');
assert(!sp.ok && /space/i.test(sp.error), 'a space is refused, with a message about spaces (' + sp.error + ')');
assert(!N('a.b').ok && !N('a/b').ok && !N('café').ok && !N('a,b').ok && !N('a:b').ok && !N('a"b').ok, 'other characters are refused');
assert(!N('').ok && !N('   ').ok && !N(null).ok, 'empty is refused');
assert(N(new Array(41).join('a')).ok && !N(new Array(42).join('a')).ok, '40 characters OK, 41 refused');
assert(!N('a\tb').ok && !N('a\nb').ok, 'tabs and newlines count as spaces');

// ---- sanitizeLegacy ----
var L = EV.tags.sanitizeLegacy;
assert(L('Needs Review') === 'needs-review', 'old "Needs Review" -> needs-review');
assert(L('a   b') === 'a-b' && L('Set 1!') === 'set-1', 'runs of invalid characters become one hyphen');
assert(L('set_1-a') === 'set_1-a' && L('a--b') === 'a--b', 'an already-valid name is left exactly as is');
assert(L('!!!') === 'untagged' && L('') === 'untagged', 'never returns an empty name');
assert(L(new Array(60).join('a')).length === 40, 'long names are cut to 40');
assert(L('ünïcode') === 'n-code', 'non-ASCII letters are not kept');
assert(N(L('Any THING at all?!')).ok, 'sanitizeLegacy output always passes normalizeName');

// ---- addTag ----
step(function () { reset(); return EV.tags.addTag('m1', 'bad name').then(function () { assert(false, 'addTag should reject an invalid manual name'); }, function (e) { assert(/space/i.test(e.message), 'addTag rejects an invalid manual name with the reason (' + e.message + ')'); }); });
step(function () { return EV.tags.addTag('m1', 'Set1'); });
step(function () { return tagsOf('m1').then(function (t) { assert(eq(t, ['set1']), 'addTag stores the lowercased name (' + t + ')'); }); });
step(function () { return EV.tags.addTag('m1', 'Odd Rule Tag', { type: 'rule', ruleId: 'r9' }); });
step(function () { return tagsOf('m1').then(function (t) { assert(eq(t, ['odd-rule-tag', 'set1']), 'a rule\'s tag is converted, never rejected (' + t + ')'); }); });
step(function () { return EV.db.get('tags', 'nope').then(function (r) { assert(r === undefined, 'a rejected add wrote nothing'); }); });

// ---- the user's scenario: 10 x set1, 5 of those x set2, 2 of those x set3 ----
step(function () {
  reset();
  var ops = Promise.resolve();
  for (var i = 1; i <= 10; i++) (function (i) {
    ops = ops.then(function () { return EV.tags.addTag('s' + i, 'set1'); });
    if (i <= 5) ops = ops.then(function () { return EV.tags.addTag('s' + i, 'set2'); });
    if (i <= 2) ops = ops.then(function () { return EV.tags.addTag('s' + i, 'set3'); });
  })(i);
  return ops;
});
step(function () { return EV.tags.tagCounts().then(function (c) { assert(c.set1 === 10 && c.set2 === 5 && c.set3 === 2, 'tagCounts: 10 / 5 / 2 (' + JSON.stringify(c) + ')'); }); });
var undoSet2;
step(function () {
  return EV.tags.deleteTag('set2').then(function (res) {
    assert(res.count === 5, 'deleting set2 reports 5 emails');
    undoSet2 = res.undo;
    return EV.tags.tagCounts();
  }).then(function (c) {
    assert(c.set1 === 10 && c.set3 === 2 && c.set2 === undefined, 'set1 and set3 untouched, set2 gone from the counts (' + JSON.stringify(c) + ')');
  });
});
step(function () { return tagsOf('s1').then(function (t) { assert(eq(t, ['set1', 'set3']), 's1 had all three, now keeps set1+set3 (' + t + ')'); }); });
step(function () { return tagsOf('s4').then(function (t) { assert(eq(t, ['set1']), 's4 (set1+set2) keeps only set1 (' + t + ')'); }); });
step(function () { return tagsOf('s8').then(function (t) { assert(eq(t, ['set1']), 's8 (set1 only) is untouched (' + t + ')'); }); });
step(function () { return EV.tags.deleteTag('set2').then(function (r) { assert(r.count === 0, 'deleting a tag nobody has is a harmless 0'); }); });
step(function () { return undoSet2(); });
step(function () {
  return EV.tags.tagCounts().then(function (c) { assert(c.set1 === 10 && c.set2 === 5 && c.set3 === 2, 'undo restores 10 / 5 / 2 (' + JSON.stringify(c) + ')'); })
    .then(function () { return tagsOf('s1'); }).then(function (t) { assert(eq(t, ['set1', 'set2', 'set3']), 'undo puts set2 back on exactly the same emails (s1: ' + t + ')'); })
    .then(function () { return tagsOf('s6'); }).then(function (t) { assert(eq(t, ['set1']), 'undo does not add set2 anywhere it was not (s6: ' + t + ')'); });
});

// ---- deleting SEVERAL tags that share emails, then undoing (a live test caught a lost-update here) ----
step(function () {
  reset();
  var ops = Promise.resolve();
  for (var i = 1; i <= 6; i++) (function (i) {
    ops = ops.then(function () { return EV.tags.addTag('m' + i, 'set1'); });
    if (i <= 3) ops = ops.then(function () { return EV.tags.addTag('m' + i, 'set2'); });
  })(i);
  return ops;
});
var undoBoth;
step(function () {
  return EV.tags.deleteTags(['set1', 'set2']).then(function (res) {
    assert(res.results.length === 2 && res.results[0].count === 6 && res.results[1].count === 3, 'deleteTags reports each tag\'s count (' + JSON.stringify(res.results) + ')');
    undoBoth = res.undo;
    return EV.tags.tagCounts();
  }).then(function (c) { assert(Object.keys(c).length === 0, 'both tags gone'); });
});
step(function () { return undoBoth(); });
step(function () {
  return EV.tags.tagCounts().then(function (c) { assert(c.set1 === 6 && c.set2 === 3, 'undo of a multi-tag delete restores BOTH tags on every email, none lost (' + JSON.stringify(c) + ')'); });
});

// ---- provenance + notes through delete/undo ----
step(function () {
  reset();
  return EV.tags.addTag('p1', 'x')                                         // manual only
    .then(function () { return EV.tags.addTag('p2', 'x', { type: 'rule', ruleId: 'r1' }); })   // rule only
    .then(function () { return EV.tags.addTag('p3', 'x'); })
    .then(function () { return EV.tags.addTag('p3', 'x', { type: 'rule', ruleId: 'r1' }); })   // both
    .then(function () { return EV.tags.addTag('p3', 'keep'); })
    .then(function () { return EV.tags.setNote('p1', 'my note'); });
});
var undoX;
step(function () {
  return EV.tags.deleteTag('x').then(function (r) { assert(r.count === 3, 'delete strips manual-owned, rule-owned and both (' + r.count + ')'); undoX = r.undo; return EV.db.getAll('tags'); })
    .then(function (all) {
      var ids = all.map(function (r) { return r.id; }).sort();
      assert(eq(ids, ['p1', 'p3']), 'p2 (rule-only, no note) is pruned; p1 survives for its note, p3 for "keep" (' + ids + ')');
    });
});
step(function () { return undoX(); });
step(function () {
  return EV.db.get('tags', 'p2').then(function (r) { assert(r && eq(r.ruleTagOwners, { x: ['r1'] }) && eq(r.manualTags, []), 'undo restores a rule-owned claim as rule-owned, not manual (' + JSON.stringify(r) + ')'); })
    .then(function () { return EV.db.get('tags', 'p3'); }).then(function (r) { assert(eq(r.manualTags.slice().sort(), ['keep', 'x']) && eq(r.ruleTagOwners, { x: ['r1'] }), 'undo restores both claims on p3 and keeps its other tag'); })
    .then(function () { return EV.db.get('tags', 'p1'); }).then(function (r) { assert(r.note === 'my note' && eq(r.manualTags, ['x']), 'the note survived delete and undo'); });
});

// ---- removeManualTagFromMany (multi-select "Remove tag") ----
step(function () {
  reset();
  return EV.tags.addTag('a', 'set2').then(function () { return EV.tags.addTag('a', 'keep'); })
    .then(function () { return EV.tags.addTag('b', 'set2'); })
    .then(function () { return EV.tags.addTag('c', 'set2', { type: 'rule', ruleId: 'r1' }); })
    .then(function () { return EV.tags.addTag('d', 'other'); })
    .then(function () { return EV.tags.addTag('outside', 'set2'); });
});
step(function () {
  return EV.tags.removeManualTagFromMany(['a', 'b', 'c', 'd', 'unknown'], 'set2').then(function (r) {
    assert(r.removed === 2 && r.ruleOwned === 1 && r.absent === 2, 'removed 2, 1 is rule-applied, 2 never had it (' + JSON.stringify(r) + ')');
    return tagsOf('a');
  }).then(function (t) { assert(eq(t, ['keep']), 'only the named tag is removed from a selected email (' + t + ')'); return tagsOf('c'); })
    .then(function (t) { assert(eq(t, ['set2']), 'a rule-applied tag is left alone (' + t + ')'); return tagsOf('outside'); })
    .then(function (t) { assert(eq(t, ['set2']), 'an email NOT selected keeps the tag (' + t + ')'); return EV.db.get('tags', 'b'); })
    .then(function (r) { assert(r === undefined, 'an email left with nothing is pruned'); });
});

// ---- converting old tags ----
step(function () {
  reset();
  __stores.tags['o1'] = { id: 'o1', tags: ['Needs Review', 'ok'] };                                       // old flat format
  __stores.tags['o2'] = { id: 'o2', manualTags: ['needs-review', 'Foo'], ruleTagOwners: { 'Bad Rule Tag': ['r1'], 'foo': ['r2'] } };
  __stores.tags['o3'] = { id: 'o3', manualTags: ['fine'], ruleTagOwners: {} };
  return EV.tags.migrateLegacyNames();
});
step(function () {
  return EV.tags.migrateLegacyNames().then(function (second) { assert(second.records === 0 && !Object.keys(second.renames).length, 'running the conversion again changes nothing (idempotent)'); });
});
step(function () {
  return EV.db.get('tags', 'o1').then(function (r) { assert(eq(r.manualTags, ['needs-review', 'ok']) && !r.tags, 'old flat record converted ("Needs Review" -> needs-review)'); })
    .then(function () { return EV.db.get('tags', 'o2'); }).then(function (r) {
      assert(eq(r.manualTags, ['needs-review', 'foo']), 'names that collapse together are merged, no duplicates (' + r.manualTags + ')');
      assert(eq(Object.keys(r.ruleTagOwners).sort(), ['bad-rule-tag', 'foo']), 'rule-owner keys converted (' + Object.keys(r.ruleTagOwners) + ')');
    })
    .then(function () { return EV.tags.allTagNames(); }).then(function (n) { assert(eq(n, ['bad-rule-tag', 'fine', 'foo', 'needs-review', 'ok']), 'every tag name is now valid (' + n + ')'); });
});
step(function () {
  reset();
  __stores.tags['o1'] = { id: 'o1', manualTags: ['Keep Me'], ruleTagOwners: {} };
  return EV.tags.migrateLegacyNames().then(function (res) { assert(res.records === 1 && res.renames['Keep Me'] === 'keep-me', 'renames map reports old -> new (' + JSON.stringify(res.renames) + ')'); });
});

// ---- import ----
step(function () {
  reset();
  var json = JSON.stringify({ version: 2, records: [
    { id: 'i1', manualTags: ['Phish Kit', 'ok'], ruleTagOwners: { 'Rule One': ['r1'] }, note: 'n' },
    { id: 'i2', tags: ['UPPER'] },
    { bad: true }
  ] });
  return EV.tags.importJsonDetailed(json).then(function (res) {
    assert(res.records === 3, 'record count includes everything in the file (' + res.records + ')');
    assert(res.renamed['Phish Kit'] === 'phish-kit' && res.renamed['Rule One'] === 'rule-one' && res.renamed['UPPER'] === 'upper', 'renames are reported (' + JSON.stringify(res.renamed) + ')');
    return EV.tags.allTagNames();
  }).then(function (n) { assert(eq(n, ['ok', 'phish-kit', 'rule-one', 'upper']), 'imported names are stored in the valid format (' + n + ')'); return EV.tags.importJson('{"records":[{"id":"i9","manualTags":["z"]}]}'); })
    .then(function (count) { assert(count === 1, 'importJson still resolves to the plain record count'); });
});

// ---- rulesStore ----
var RS = EV.rulesStore;
assert(RS.slugify('Sender / Reply-To domain mismatch') === 'sender-reply-to-domain-mismatch', 'slugify: spaces and slashes become hyphens');
assert(RS.slugify('my_tag') === 'my_tag', 'slugify keeps underscores');
assert(RS.slugify('A - B') === 'a-b', 'slugify collapses repeated hyphens');
assert(RS.slugify('!!!') === 'rule', 'slugify never returns empty');
assert(RS.slugify(new Array(80).join('ab ')).length <= 40 && !/-$/.test(RS.slugify(new Array(80).join('ab '))), 'slugify cuts to 40 without a trailing hyphen');
assert(N(RS.slugify('Anything GOES here / 123')).ok, 'slugify output always passes normalizeName');
step(function () {
  reset();
  __stores.rules['r1'] = { id: 'r1', name: 'A', tag: 'Foo Bar', expression: 'true', enabled: true, createdAt: 1 };
  __stores.rules['r2'] = { id: 'r2', name: 'B', tag: 'foo-bar', expression: 'true', enabled: true, createdAt: 2 };
  __stores.rules['r3'] = { id: 'r3', name: 'C', tag: 'fine_tag', expression: 'true', enabled: false, createdAt: 3 };
  return RS.migrateTagNames();
});
step(function () {
  return RS.list().then(function (rules) {
    var by = {}; rules.forEach(function (r) { by[r.id] = r; });
    assert(by.r2.tag === 'foo-bar' && by.r3.tag === 'fine_tag', 'already-valid rule tags are untouched');
    assert(by.r1.tag === 'foo-bar-2', 'a converted rule tag that would collide gets a suffix (' + by.r1.tag + ')');
    assert(by.r3.enabled === false && by.r1.expression === 'true', 'nothing else about the rules changed');
    return RS.migrateTagNames();
  }).then(function (n) { assert(n === 0, 'rule-tag conversion is idempotent'); });
});
step(function () {
  reset();
  return RS.importJson(JSON.stringify({ rules: [{ name: 'X', tag: 'Bad Tag', expression: 'true', enabled: true }] })).then(function (res) {
    assert(res.imported === 1, 'a rule with an old-style tag still imports');
    return RS.list();
  }).then(function (rules) { assert(rules[0].tag === 'bad-tag', 'its tag was converted on the way in (' + rules[0].tag + ')'); });
});

// ---- rules whose tag was deleted are blocked until given a different tag ----
function ruleById(id) { return EV.db.get('rules', id); }
step(function () {
  reset();
  __stores.rules['a'] = { id: 'a', name: 'On rule', tag: 'set2', expression: 'true', enabled: true, createdAt: 1 };
  __stores.rules['b'] = { id: 'b', name: 'Off rule', tag: 'set2', expression: 'true', enabled: false, createdAt: 2 };
  __stores.rules['c'] = { id: 'c', name: 'Other', tag: 'set1', expression: 'true', enabled: true, createdAt: 3 };
  return RS.blockRulesForDeletedTag('set2').then(function (hit) {
    assert(hit.length === 2 && hit.filter(function (h) { return h.wasEnabled; }).length === 1, 'every rule using the tag is blocked; wasEnabled records which were running (' + hit.length + ')');
    return Promise.all([ruleById('a'), ruleById('b'), ruleById('c')]);
  }).then(function (r) {
    assert(r[0].enabled === false && r[0].blockedTag === 'set2' && r[1].enabled === false && r[1].blockedTag === 'set2', 'both are off and marked with the deleted tag');
    assert(r[2].enabled === true && !r[2].blockedTag, 'a rule using a different tag is untouched');
  });
});
step(function () {
  return RS.update('a', { enabled: true }).then(function () { assert(false, 'enabling a blocked rule must be refused'); }, function (e) { assert(/set2/.test(e.message) && /different tag/.test(e.message), 'enabling a blocked rule is refused with an explanation (' + e.message + ')'); });
});
step(function () {
  return RS.update('a', { name: 'Renamed', tag: 'set2', enabled: false }).then(function (r) { assert(r.blockedTag === 'set2' && r.enabled === false, 'saving it again with the SAME tag, still off, keeps it blocked'); });
});
step(function () {
  return RS.update('a', { tag: 'set2', enabled: true }).then(function () { assert(false, 'same tag + enabled must be refused'); }, function () { assert(true, 'same tag + enabled is refused (the editor path)'); });
});
step(function () {
  return RS.update('a', { tag: 'brand-new', enabled: true }).then(function (r) { assert(r.enabled === true && !r.blockedTag && r.tag === 'brand-new', 'giving it a different tag lifts the block and it can be enabled'); });
});
step(function () {
  return RS.update('b', { tag: 'other-tag', enabled: false }).then(function (r) { assert(!r.blockedTag && r.enabled === false, 'a different tag lifts the block even if left off'); return RS.update('b', { enabled: true }); })
    .then(function (r) { assert(r.enabled === true, '... and it can then be switched on normally'); });
});
step(function () {
  __stores.rules['d'] = { id: 'd', name: 'D', tag: 'x1', expression: 'true', enabled: true, createdAt: 4 };
  return RS.blockRulesForDeletedTag('x1').then(function () { return RS.unblockRule('d'); }).then(function (r) { assert(!r.blockedTag && r.enabled === false, 'undo lifts the block (caller re-enables)'); return RS.update('d', { enabled: true }); })
    .then(function (r) { assert(r.enabled === true, 'an unblocked rule can be re-enabled by undo'); });
});

chain.then(function () {
  print('---');
  print('PASS: ' + pass + '  FAIL: ' + fail);
  if (fail > 0) throw new Error(fail + ' test(s) failed');
});
