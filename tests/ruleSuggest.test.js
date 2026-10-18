/**
 * ruleSuggest.test.js — the pure half of js/ui/ruleSuggest.js (rule-expression autocomplete) and the
 * tag-box suggestions in js/ui/searchSuggest.js. Also the drift guards: the fact catalogue must equal
 * the keys of a REAL EV.buildRuleFacts result, and the helper catalogue must equal the keys of the
 * real EV.ruleHelpers — so a fact/helper added to (or removed from) the engine without updating the
 * editor's suggestions fails here. The dropdown DOM is verified in a real browser instead.
 * Run via tests/run-all.sh, or directly: jsc tests/ruleSuggest.test.js (from the repo root).
 */
load('tests/helpers/textdecoder_polyfill.js');
load('js/parsing/emlParser.js');
load('js/parsing/urlExtract.js');
load('js/indexing/pathFilter.js');
load('js/parsing/headerTables.js');
load('js/indexing/anomalies.js');
load('js/indexing/indexLogic.js');
load('js/indexing/searchIndex.js');
load('js/ui/searchSuggest.js');
load('js/ui/ruleSuggest.js');

var EV = this.EV;
var R = EV.ruleSuggest;
var S = EV.searchSuggest;
var pass = 0, fail = 0;
function assert(cond, label) { if (cond) pass++; else { fail++; print('FAIL: ' + label); } }
function labels(r) { return r ? r.items.map(function (i) { return i.label; }) : null; }
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function at(text, ctx, force) { return R.compute(text, text.length, ctx || {}, force); }

// ---- drift guards against the real engine ----
var raw = readFile('test-fixtures/auth_headers_sample.eml');
var bytes = new Uint8Array(raw.length);
for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i) & 255;
var facts = EV.buildRuleFacts(EV.parseEml(bytes.buffer), {});
var factKeys = Object.keys(facts).sort();
var catFacts = R.FACTS.map(function (f) { return f.name; }).sort();
assert(eq(factKeys, catFacts), 'fact catalogue === keys of a real buildRuleFacts result' +
  (eq(factKeys, catFacts) ? '' : ' (engine only: ' + JSON.stringify(factKeys.filter(function (k) { return catFacts.indexOf(k) === -1; })) +
  ', catalogue only: ' + JSON.stringify(catFacts.filter(function (k) { return factKeys.indexOf(k) === -1; })) + ')'));
R.FACTS.forEach(function (f) {
  if (f.type === 'fn') assert(typeof facts[f.name] === 'function', 'fact ' + f.name + ' is a function in the engine');
});

var helperKeys = Object.keys(EV.ruleHelpers).sort();
var catHelpers = R.HELPERS.map(function (h) { return h.name; }).sort();
assert(eq(helperKeys, catHelpers), 'helper catalogue === keys of EV.ruleHelpers' +
  (eq(helperKeys, catHelpers) ? '' : ' (engine only: ' + JSON.stringify(helperKeys.filter(function (k) { return catHelpers.indexOf(k) === -1; })) +
  ', catalogue only: ' + JSON.stringify(catHelpers.filter(function (k) { return helperKeys.indexOf(k) === -1; })) + ')'));
R.HELPERS.forEach(function (h) {
  var isFn = typeof EV.ruleHelpers[h.name] === 'function';
  assert(isFn === !h.constant, 'helper ' + h.name + ': function-ness matches the catalogue (constant flag)');
  if (isFn) assert(!!h.sig, 'helper ' + h.name + ' has a signature');
});

// ---- f. / h. ----
var r = at('f.');
assert(r && r.mode === 'member' && r.items.length === R.FACTS.length && r.from === 2 && r.to === 2, '"f." lists every fact (' + (r && r.items.length) + ')');
assert(labels(r)[0] === 'f.subject', 'facts keep their catalogue order');
assert(r.items.filter(function (i) { return i.label === 'f.from'; })[0].detail === 'addr · {name, address, domain} or null', 'a fact row shows its type and meaning');
r = at('f.sub');
assert(eq(labels(r), ['f.subject', 'f.subjectScripts']) && r.from === 2 && r.to === 5, '"f.sub" narrows to the facts starting with it and replaces just the typed part');
assert(labels(at('f.ur')).slice(0, 3).join() === 'f.urls,f.urlDomains,f.urgencyScore', 'prefix matches come first, in catalogue order');
assert(at('f.mailer') === null && at('f.qz') === null, 'names that do not contain the typed text are not offered');
assert(labels(at('f.Id')).indexOf('f.messageId') !== -1, 'matching is case-insensitive and also finds names containing the text (lower-ranked)');
r = at('h.');
assert(r.items.length === R.HELPERS.length && labels(r)[0] === 'h.equals', '"h." lists every helper');
var ct = at('h.cont').items;
assert(ct[0].label === 'h.contains' && ct[0].fn === true && ct[0].detail.indexOf('(a, b, caseSensitive?)') === 0, 'a helper row shows its signature and is marked as a function');
assert(at('h.COMMON').items[0].fn === false, 'a constant is not marked as a function');
assert(at('f.recipientCount') === null, 'a fact typed out completely (no members) offers nothing more');
assert(at('f.from') === null, 'a fact typed out completely offers nothing (typing "." continues into its members)');

// ---- nested ----
r = at('f.from.');
assert(eq(labels(r), ['f.from.name', 'f.from.address', 'f.from.domain']), '"f.from." offers the address parts');
assert(eq(labels(at('f.replyTo.do')), ['f.replyTo.domain']), 'same for replyTo');
assert(labels(at('f.subject.')).indexOf('f.subject.includes') !== -1 && labels(at('f.subject.')).indexOf('f.subject.length') !== -1, 'a string fact offers string members');
assert(labels(at('f.urls.')).indexOf('f.urls.some') !== -1, 'an array fact offers array members');
assert(labels(at('f.to.')).indexOf('f.to.some') !== -1 && labels(at('f.to.')).indexOf('f.to.name') === -1, 'a recipient list is an array, not an address');
assert(labels(at('f.date.')).indexOf('f.date.getFullYear') !== -1, 'a date offers date methods');
assert(at('f.size.') === null && at('f.urgencyScore.') === null, 'numbers/booleans have no members');
assert(at('f.nothing.') === null && at('f.from.domain.') === null && at('h.contains.') === null, 'unknown or too-deep paths offer nothing');
assert(at('x.') === null && at('a.si') === null, 'other objects (arrow-function parameters etc.) are left alone');

// ---- bare words ----
r = at('', {}, true);
assert(r && labels(r)[0] === 'f' && labels(r)[1] === 'h', 'forced with nothing typed offers the f / h namespaces');
assert(at('') === null, 'nothing typed, not forced: nothing');
r = at('f');
assert(r && labels(r)[0] === 'f' && r.items[0].insert === 'f.' && r.items[0].chain === true, '"f" offers "f." and chains straight into the fact list');
assert(at('s') === null, 'a single letter (other than f/h) does not pop up');
r = at('cont');
assert(r && r.items[0].label === 'h.contains' && r.items[0].insert === 'h.contains' && r.from === 0, 'a bare word finds helpers by name and inserts the full h.<name>');
r = at('atta');
assert(labels(r).indexOf('f.attachments') !== -1 && labels(r).indexOf('h.attachmentExtIn') !== -1, 'a bare word finds both facts and helpers');
assert(at('42') === null && at('true') === null, 'numbers and unrelated words offer nothing');

// ---- context: operators, parens, mid-expression ----
r = at('f.from && h.con');
assert(r && labels(r)[0] === 'h.contains' && r.from === 12, 'completes the last word of a longer expression');
r = at('!f.sub');
assert(r && labels(r)[0] === 'f.subject' && r.from === 3, 'works after a unary operator');
r = at('h.contains(f.su');
assert(r && labels(r)[0] === 'f.subject', 'works inside call arguments');
r = at('f.from.domain === "x"\n&& f.att');
assert(r && labels(r).join() === 'f.attachments,f.attachmentCount', 'works on a later line');
r = R.compute('f.subject', 3, {});
assert(r && r.mode === 'member' && labels(r).indexOf('f.subject') !== -1, 'caret mid-word completes the word being edited');
assert(R.compute('f.subject', 3, {}).to === 9, '... and replaces the whole word, including the part after the caret');
assert(at('f.from.address.') === null, 'no third-level members');
assert(R.compute(').fo', 4, {}) === null, 'a property chained after a closing bracket is not completed');

// ---- header names inside f.getHeader('…') ----
var hctx = { headerNames: [{ name: 'received', count: 40 }, { name: 'x-mailer', count: 3 }, { name: 'x-originating-ip', count: 1 }] };
r = at("f.getHeader('", hctx);
assert(r && r.mode === 'header' && eq(labels(r), ['received', 'x-mailer', 'x-originating-ip']) && r.items[0].detail === '40 emails', 'f.getHeader(\' lists the real headers, most common first');
assert(r.items[2].detail === '1 email', 'singular count');
r = at("f.getHeader('x-", hctx);
assert(eq(labels(r), ['x-mailer', 'x-originating-ip']) && r.from === 13, 'typing narrows, and the range covers only the typed part');
r = at('f.getHeaderAll("rec', hctx);
assert(r && eq(labels(r), ['received']), 'getHeaderAll and double quotes work too');
assert(at("f.getHeader('zzz", hctx) === null, 'no header match: no popup');
assert(at("f.getHeader('received", hctx) === null, 'a header already fully typed offers nothing');
assert(at("h.contains(f.subject, 'x-m", hctx) === null, 'inside any other string literal: silent');
assert(at("f.getHeader('x-mailer') && h.contains('rec", hctx) === null, 'a later, unrelated string is not mistaken for the getHeader argument');
assert(at("f.getHeader('", {}) === null, 'no folder open (no header names): nothing, never an error');
r = R.compute("f.getHeader('x-m')", 15, hctx);
assert(r && r.from === 13 && r.to === 16, 'caret in the middle of a header name replaces the whole name');

// ---- applying ----
function acc(text, caret, pick, ctx) {
  var res = R.compute(text, caret, ctx || hctx);
  var item = res.items.filter(function (i) { return i.label === pick; })[0];
  return R.apply(text, { from: res.from, to: res.to }, item);
}
var out = acc('h.cont', 6, 'h.contains');
assert(out.text === 'h.contains(' && out.caret === 11, 'accepting a function adds "(" and puts the caret inside');
out = acc('h.cont(f.subject)', 6, 'h.contains');
assert(out.text === 'h.contains(f.subject)' && out.caret === 10, 'no second "(" when one already follows');
out = acc('f.sub', 5, 'f.subject');
assert(out.text === 'f.subject' && out.caret === 9, 'accepting a plain fact inserts just its name');
out = acc('f.from && f.su', 14, 'f.subject');
assert(out.text === 'f.from && f.subject', 'only the last word is replaced');
out = acc('cont', 4, 'h.contains');
assert(out.text === 'h.contains(', 'a bare-word match is replaced by the full dotted name');
out = acc('f.from.do', 9, 'f.from.domain');
assert(out.text === 'f.from.domain' && out.caret === 13, 'nested member completes the final segment only');
out = acc('f.subject.inc', 13, 'f.subject.includes');
assert(out.text === 'f.subject.includes(', 'a string method gets "("');
out = acc('f', 1, 'f');
assert(out.text === 'f.' && out.caret === 2, 'accepting the f namespace inserts "f."');
out = acc("f.getHeader('x-m", 16, 'x-mailer');
assert(out.text === "f.getHeader('x-mailer'" && out.caret === 22, 'a header name gets its closing quote, caret after it');
out = acc("f.getHeader('x-m')", 16, 'x-mailer');
assert(out.text === "f.getHeader('x-mailer')" && out.caret === 22, 'an existing closing quote is stepped over, not doubled');
out = acc('f.getHea', 8, 'f.getHeader');
assert(out.text === 'f.getHeader(', 'getHeader itself completes with "(" ready for the quote');

// ---- bounded & fast ----
var t0 = Date.now();
for (var k = 0; k < 3000; k++) { at('f.from && h.co'); at('f.'); at('at'); }
assert(Date.now() - t0 < 2000, '9000 keystrokes of suggestions take well under 2s (' + (Date.now() - t0) + 'ms)');
assert(at('f.', {}).items.length <= 40 && at('', {}, true).items.length <= 40, 'output is capped');

// ---- tag boxes ----
var tctx = { tagNames: ['phish', 'phish-kit', 'invoice', 'Needs Review'], exclude: [] };
r = S.computeTag('ph', 2, tctx);
assert(r && r.from === 0 && r.to === 2 && eq(labels(r), ['phish', 'phish-kit']), 'tag box: prefix matches');
r = S.computeTag('view', 4, tctx);
assert(eq(labels(r), ['Needs Review']), 'tag box: also matches inside a name, case-insensitively');
r = S.computeTag('', 0, tctx);
assert(r && labels(r).length === 4, 'tag box: an empty box lists every existing tag');
assert(S.computeTag('phish', 5, { tagNames: ['phish'] }) === null, 'tag box: nothing to offer once the name is exactly typed');
assert(eq(labels(S.computeTag('phish', 5, tctx)), ['phish-kit']), 'tag box: an exact match is dropped but longer names are still offered');
assert(S.computeTag('zzz', 3, tctx) === null && S.computeTag('x', 1, {}) === null, 'tag box: no match / no tags yet: nothing, never an error');
r = S.computeTag('p', 1, { tagNames: ['phish', 'invoice'], exclude: ['PHISH'] });
assert(r === null, 'tag box: tags this email already has are not offered again (case-insensitive)');
r = S.computeTag('  pHi ', 6, tctx);
assert(r && labels(r)[0] === 'phish' && r.to === 6, 'tag box: surrounding whitespace and case are ignored; the whole box is replaced');
out = S.applyTag('ph', { from: 0, to: 2 }, r.items[0]);
assert(out.text === 'phish' && out.caret === 5, 'tag box: accepting puts the exact stored tag name in the box');
out = S.applyTag('x', { from: 0, to: 1 }, S.computeTag('need', 4, tctx).items[0]);
assert(out.text === 'Needs Review', 'tag box: keeps the stored capitalization');
var big = []; for (var j = 0; j < 500; j++) big.push('tag-' + j);
assert(S.computeTag('tag', 3, { tagNames: big }).items.length <= 40, 'tag box: large tag sets are capped');

print('---');
print('PASS: ' + pass + '  FAIL: ' + fail);
if (fail > 0) throw new Error(fail + ' test(s) failed');
