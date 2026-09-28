/**
 * pathFilter.test.js — regression coverage for js/indexing/pathFilter.js, the pure module shared
 * identically by Decoded search (searchIndex.js) and Raw search (rawSearch.js) for the VSCode-style
 * "files to include/exclude" filter fields. Loads the real module (dependency-free, no DOM). Run via
 * tests/run-all.sh, or directly: jsc tests/pathFilter.test.js (from the repo root).
 */
var EV = {};
this.EV = EV;
load('js/indexing/pathFilter.js');

var pass = 0, fail = 0;
function assert(cond, label) { if (cond) pass++; else { fail++; print('FAIL: ' + label); } }

// ---- parsePathPatternList ----
assert(JSON.stringify(EV.parsePathPatternList('')) === '[]', 'parsePathPatternList: empty input -> empty array');
assert(JSON.stringify(EV.parsePathPatternList(null)) === '[]', 'parsePathPatternList: null input -> empty array');
assert(JSON.stringify(EV.parsePathPatternList('a.eml\nb.eml')) === JSON.stringify(['a.eml', 'b.eml']),
  'parsePathPatternList: splits on newline');
assert(JSON.stringify(EV.parsePathPatternList('a.eml, b.eml,c.eml')) === JSON.stringify(['a.eml', 'b.eml', 'c.eml']),
  'parsePathPatternList: splits on comma within a line');
assert(JSON.stringify(EV.parsePathPatternList('  spam folder/*  \n\n *.tmp ')) === JSON.stringify(['spam folder/*', '*.tmp']),
  'parsePathPatternList: trims whitespace, drops blank lines, but keeps internal spaces in a folder name');

// ---- compilePathPattern ----
assert(EV.compilePathPattern('') === null, 'compilePathPattern: empty pattern -> null');
assert(EV.compilePathPattern('   ') === null, 'compilePathPattern: whitespace-only pattern -> null');
assert(EV.compilePathPattern('invoices/report.eml').test('folder/invoices/report.eml') === true,
  'compilePathPattern: literal substring match, unanchored');
assert(EV.compilePathPattern('INVOICES').test('invoices/report.eml') === true,
  'compilePathPattern: case-insensitive');
assert(EV.compilePathPattern('*.exe').test('malware.exe') === true, 'compilePathPattern: "*" wildcard matches any run');
assert(EV.compilePathPattern('*.exe').test('malware.exee') === true, 'compilePathPattern: unanchored "*.exe" still matches within a longer string (documents current substring semantics)');
assert(EV.compilePathPattern('report?.eml').test('report1.eml') === true, 'compilePathPattern: "?" matches exactly one character');
assert(EV.compilePathPattern('report?.eml').test('report12.eml') === false, 'compilePathPattern: "?" does not match two characters');
assert(EV.compilePathPattern('a.b(c)').test('a.b(c)') === true, 'compilePathPattern: regex metacharacters are escaped and matched literally');
assert(EV.compilePathPattern('a.b(c)').test('aXbYcZ') === false, 'compilePathPattern: escaped metacharacters do not act as regex syntax');

// ---- compilePathFilters / matchesPathFilters ----
var noFilters = EV.compilePathFilters('', '');
assert(EV.matchesPathFilters('anything/here.eml', noFilters) === true, 'matchesPathFilters: empty include+exclude matches everything');

var includeOnly = EV.compilePathFilters('invoices/*', '');
assert(EV.matchesPathFilters('invoices/jan.eml', includeOnly) === true, 'matchesPathFilters: matches an include pattern');
assert(EV.matchesPathFilters('spam/jan.eml', includeOnly) === false, 'matchesPathFilters: non-empty include list rejects a non-matching path');

var excludeOnly = EV.compilePathFilters('', 'spam/*');
assert(EV.matchesPathFilters('invoices/jan.eml', excludeOnly) === true, 'matchesPathFilters: empty include + non-matching exclude -> match');
assert(EV.matchesPathFilters('spam/jan.eml', excludeOnly) === false, 'matchesPathFilters: exclude drops a matching path');

var both = EV.compilePathFilters('invoices/*', 'invoices/draft*');
assert(EV.matchesPathFilters('invoices/jan.eml', both) === true, 'matchesPathFilters: matches include, does not match exclude -> match');
assert(EV.matchesPathFilters('invoices/draft1.eml', both) === false,
  'matchesPathFilters: exclude wins even though the same path also matches include');

// A raw, unescaped "[" is an unterminated character class and would throw as a bare RegExp -- confirms
// compilePathPattern's metacharacter-escaping keeps it a literal, matchable character instead of null.
var bracketPattern = EV.compilePathFilters('report[1].eml', '');
assert(EV.matchesPathFilters('folder/report[1].eml', bracketPattern) === true,
  'matchesPathFilters: a literal "[" in a pattern is escaped, not treated as regex syntax or left unparseable');

print('---');
print('PASS: ' + pass + '  FAIL: ' + fail);
if (fail > 0) throw new Error(fail + ' test(s) failed');
