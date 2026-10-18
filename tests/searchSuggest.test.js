/**
 * searchSuggest.test.js — the pure half of js/ui/searchSuggest.js (the search box's autocomplete):
 * what gets suggested for a given text + caret, how accepting a suggestion rewrites the text, and
 * that the suggestion catalogue can never drift from the real query grammar (EV.SEARCH_FIELD_NAMES,
 * exported by searchIndex.js from the same tables the parser uses). The dropdown itself (keyboard,
 * mouse, positioning) is DOM and is verified in a real browser instead. Run via tests/run-all.sh, or
 * directly: jsc tests/searchSuggest.test.js (from the repo root).
 */
load('js/parsing/urlExtract.js');
load('js/indexing/pathFilter.js');
load('js/indexing/searchIndex.js');
load('js/ui/searchSuggest.js');

var EV = this.EV;
var S = EV.searchSuggest;
var pass = 0, fail = 0;
function assert(cond, label) { if (cond) pass++; else { fail++; print('FAIL: ' + label); } }
function labels(r) { return r ? r.items.map(function (i) { return i.label; }) : null; }
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

var ctx = {
  headerNames: [{ name: 'received', count: 40 }, { name: 'x-mailer', count: 3 }, { name: 'subject', count: 100 }, { name: 'from', count: 100 }],
  attExts: [{ name: '.pdf', count: 5 }, { name: '.exe', count: 1 }],
  tagNames: ['phish', 'needs review']
};

// ---- field names ----
var r = S.compute('head', 4, ctx);
assert(r && r.mode === 'field' && r.from === 0 && r.to === 4, '"head" suggests fields, replacing the typed word');
assert(labels(r)[0] === 'header.subject' && labels(r).indexOf('header.received') !== -1 && labels(r).indexOf('header.x-mailer') !== -1, '"head" lists the fixed header fields and the folder\'s real header names');
assert(labels(r).filter(function (l) { return l === 'header.subject'; }).length === 1 && labels(r).indexOf('header.from') !== -1 && labels(r).filter(function (l) { return l === 'header.from'; }).length === 1, 'a real header that already has a dedicated field (Subject, From) is not listed twice');
assert(r.items[0].insert === 'header.subject:', 'accepting a field inserts name + colon');
assert(r.items.every(function (i) { return i.label.indexOf('head') === 0; }), 'prefix matches only for "head"');

r = S.compute('header.', 7, ctx);
assert(r && labels(r).length === 9 + 2 && labels(r).indexOf('header.raw') !== -1, '"header." lists every header.* field plus the dynamic header names (' + (r && labels(r).length) + ')');
var dyn = r.items.filter(function (i) { return i.label === 'header.received'; })[0];
assert(dyn && dyn.detail === 'header · 40 emails', 'dynamic header entries show how many emails have them');
assert(labels(S.compute('header.x-m', 10, ctx)).join() === 'header.x-mailer', 'typing further narrows to one header');
assert(S.compute('header.x-m', 10, ctx).items[0].matchLen === 10, 'the typed prefix is reported for highlighting');

r = S.compute('from', 4, ctx);
assert(labels(r)[0] === 'header.from', 'the part after the dot also matches: "from" suggests header.from first');
r = S.compute('oc', 2, ctx);
assert(labels(r).indexOf('attachment.ocr') !== -1, 'a fragment inside a field name still finds it (lower-ranked)');
assert(S.compute('', 0, ctx) === null, 'an empty word suggests nothing (does not pop up on its own)');
r = S.compute('', 0, ctx, true);
assert(r && r.items.length === S.FIELDS.length + 2, 'forced (Ctrl+Space) with an empty word lists every fixed field plus the folder\'s header names (' + (r && r.items.length) + ')');
assert(S.compute('paypal', 6, ctx) === null, 'an ordinary search word that matches no field shows no popup');
assert(eq(labels(S.compute('auth.', 5, ctx)), ['auth.spf', 'auth.dkim', 'auth.dmarc']), '"auth." offers the three auth fields');

// ---- values ----
r = S.compute('auth.spf:', 9, ctx);
assert(r && r.mode === 'value' && r.from === 9 && r.to === 9 && labels(r).join() === 'fail,pass,softfail,neutral,none,temperror,permerror,missing', 'auth.spf: offers the closed result set');
assert(labels(S.compute('auth.spf:so', 11, ctx)).join() === 'softfail', 'values filter by the typed prefix');
assert(S.compute('auth.spf:fail', 13, ctx) === null, 'a value already fully typed (the only candidate) closes the popup');
r = S.compute('attachment.ext:', 15, ctx);
assert(eq(labels(r), ['.pdf', '.exe']) && r.items[0].detail === '5 emails' && r.items[1].detail === '1 email', 'attachment.ext: lists the extensions actually in the folder, with counts');
assert(eq(labels(S.compute('attachment.ext:ex', 17, ctx)), ['.exe']), 'attachment.ext: accepts the extension typed without its dot');
assert(eq(labels(S.compute('attachment.ext:.p', 17, ctx)), ['.pdf']), 'attachment.ext: also matches with the dot');
r = S.compute('tag:', 4, ctx);
assert(eq(labels(r), ['phish', 'needs review']) && r.items[1].insert === '"needs review"', 'tag: lists tags; one with a space is inserted quoted');
assert(eq(labels(S.compute('tag:ne', 6, ctx)), ['needs review']), 'tag values filter by prefix');
assert(labels(S.compute('size:', 5, ctx)).indexOf('>5mb') !== -1, 'numeric fields offer example comparisons');
assert(eq(labels(S.compute('size:>5', 7, ctx)), ['>5mb']), 'numeric examples filter by the typed text');
assert(S.compute('header.received:', 16, ctx) === null && S.compute('header.subject:', 15, ctx) === null, 'free-text fields have no value list');
assert(S.compute('foo:', 4, ctx) === null, 'an unknown field name offers nothing');
assert(S.compute('tag:', 4, {}) === null && S.compute('attachment.ext:', 15, {}) === null, 'missing context (no tags/extensions yet) just means no values, never an error');

// ---- word boundaries / context ----
assert(S.compute('"head', 5, ctx) === null && S.compute('header.subject:"abc def', 23, ctx) === null, 'silent inside an open quote');
r = S.compute('-head', 5, ctx);
assert(r && r.from === 1 && r.to === 5, 'a leading minus (negation) is kept; the word after it is completed');
assert(S.apply('-head', { from: r.from, to: r.to }, r.items[0]).text === '-header.subject:', 'accepting after a minus keeps the negation');
r = S.compute('(header.from:a OR au', 20, ctx);
assert(r && eq(labels(r), ['auth.spf', 'auth.dkim', 'auth.dmarc']) && r.from === 18, 'works after a parenthesis and OR, on the last word only');
assert(S.compute('(header.from:abc)', 17, ctx) === null, 'right after a closing parenthesis there is no word to complete');

// ---- applying a suggestion ----
r = S.compute('hea der.from:x', 3, ctx);
var out = S.apply('header.from:x', { from: 0, to: 11 }, { kind: 'field', insert: 'header.subject' });
assert(out.text === 'header.subject:x' && out.caret === 15, 'completing a field name that already has a colon after it does not add a second one and steps over it (' + JSON.stringify(out) + ')');
out = S.apply('tag:ph', { from: 4, to: 6 }, { kind: 'value', insert: 'phish', space: true });
assert(out.text === 'tag:phish ' && out.caret === 10, 'accepting a value at the end adds a trailing space for the next term');
out = S.apply('tag:ph other', { from: 4, to: 6 }, { kind: 'value', insert: 'phish', space: true });
assert(out.text === 'tag:phish other' && out.caret === 10, 'no doubled space when one already follows');
out = S.apply('head', { from: 0, to: 4 }, { kind: 'field', insert: 'header.subject:' });
assert(out.text === 'header.subject:' && out.caret === 15, 'accepting a field leaves the caret right after its colon');

// ---- the mid-word case from the field-name path ----
r = S.compute('header.from:x', 3, ctx);
assert(r && r.mode === 'field' && r.to === 11 && r.items[0].insert === 'header.subject', 'caret inside a field name that already has a colon: replace just the name, insert without a colon');

// ---- bounded output & speed ----
var many = [];
for (var i = 0; i < 500; i++) many.push({ name: 'x-custom-' + i, count: i });
r = S.compute('header.', 7, { headerNames: many });
assert(r.items.length <= 60, 'a huge header list is capped (' + r.items.length + ')');
var t0 = Date.now();
for (var k = 0; k < 2000; k++) S.compute('header.x-c', 10, { headerNames: many });
var ms = Date.now() - t0;
assert(ms < 2000, '2000 keystrokes against 500 header names take well under 2s (' + ms + 'ms)');

// ---- the catalogue and the real grammar agree, both ways ----
var cat = S.FIELDS.map(function (f) { return f.name; }).sort();
var grammar = EV.SEARCH_FIELD_NAMES.slice().sort();
assert(eq(cat, grammar), 'suggestion catalogue === the parser\'s field list' +
  (eq(cat, grammar) ? '' : ' (catalogue only: ' + JSON.stringify(cat.filter(function (n) { return grammar.indexOf(n) === -1; })) +
  ', grammar only: ' + JSON.stringify(grammar.filter(function (n) { return cat.indexOf(n) === -1; })) + ')'));

print('---');
print('PASS: ' + pass + '  FAIL: ' + fail);
if (fail > 0) throw new Error(fail + ' test(s) failed');
