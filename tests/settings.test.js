/**
 * settings.test.js — regression coverage for js/core/settings.js: trusted-domains
 * seeds itself from the built-in brand list on first read (never silently
 * empty), setTrustedDomains dedupes/lowercases/trims, resetTrustedDomainsToDefault
 * restores the built-in list, domainCategories seeds/dedupes/resets the same
 * way, and demoState defaults/persists correctly for the sample-emails
 * onboarding banner. Run via tests/run-all.sh, or directly:
 * jsc tests/settings.test.js (from the repo root).
 */
// Minimal in-memory mock of EV.db + EV.ruleHelpers so settings.js can run standalone under jsc.
var EV = {};
this.EV = EV;
var __store = {};
EV.db = {
  get: function (storeName, id) { return Promise.resolve(__store[id] ? JSON.parse(JSON.stringify(__store[id])) : undefined); },
  getAll: function () { return Promise.resolve(Object.keys(__store).map(function (k) { return JSON.parse(JSON.stringify(__store[k])); })); },
  put: function (storeName, record) { __store[record.service] = JSON.parse(JSON.stringify(record)); return Promise.resolve(); },
  delete: function (storeName, id) { delete __store[id]; return Promise.resolve(); }
};
EV.ruleHelpers = { COMMON_BRANDS: ['paypal.com', 'microsoft.com', 'google.com'] };
EV.DEFAULT_DOMAIN_CATEGORIES = [
  { name: 'URL Shortener', keywords: ['bit.ly', 'tinyurl.com'] },
  { name: 'Social Media', keywords: ['facebook.com'] }
];

load('js/core/settings.js');

var pass = 0, fail = 0;
function assert(cond, label) { if (cond) pass++; else { fail++; print('FAIL: ' + label); } }

var chain = Promise.resolve();
function step(fn) { chain = chain.then(fn); }

// first read seeds from COMMON_BRANDS, never silently empty
step(function () {
  return EV.settings.trustedDomains().then(function (domains) {
    assert(domains.length === 3 && domains.indexOf('paypal.com') !== -1,
      'first read seeds from COMMON_BRANDS (' + JSON.stringify(domains) + ')');
  });
});
step(function () {
  return EV.settings.trustedDomains().then(function (domains) {
    assert(domains.length === 3, 'second read returns the now-persisted seed, not seeded again (' + JSON.stringify(domains) + ')');
  });
});

// setTrustedDomains dedupes/lowercases/trims
step(function () {
  return EV.settings.setTrustedDomains(['MyCompany.com', ' mycompany.com ', 'Other.org', 'other.org']).then(function (domains) {
    assert(domains.length === 2 && domains.indexOf('mycompany.com') !== -1 && domains.indexOf('other.org') !== -1,
      'setTrustedDomains dedupes case/whitespace variants (' + JSON.stringify(domains) + ')');
  });
});
step(function () {
  return EV.settings.trustedDomains().then(function (domains) {
    assert(domains.length === 2, 'persisted list reflects the dedup, not the seed (' + JSON.stringify(domains) + ')');
  });
});

// reset restores the built-in default list
step(function () { return EV.settings.resetTrustedDomainsToDefault(); });
step(function () {
  return EV.settings.trustedDomains().then(function (domains) {
    assert(domains.length === 3 && domains.indexOf('google.com') !== -1, 'reset restores COMMON_BRANDS (' + JSON.stringify(domains) + ')');
  });
});

// demoState defaults to "not yet seen", then honors a partial patch without clobbering the other field
step(function () {
  return EV.settings.demoState().then(function (demo) {
    assert(demo.dismissedOnce === false && demo.alwaysShow === false, 'demoState defaults before any config (' + JSON.stringify(demo) + ')');
  });
});
step(function () { return EV.settings.setDemoState({ dismissedOnce: true }); });
step(function () {
  return EV.settings.demoState().then(function (demo) {
    assert(demo.dismissedOnce === true && demo.alwaysShow === false,
      'setDemoState patch updates one field, leaves the default for the other (' + JSON.stringify(demo) + ')');
  });
});
step(function () { return EV.settings.setDemoState({ alwaysShow: true }); });
step(function () {
  return EV.settings.demoState().then(function (demo) {
    assert(demo.dismissedOnce === true && demo.alwaysShow === true,
      'a later patch does not clobber a previously-set field (' + JSON.stringify(demo) + ')');
  });
});

// domainCategories seeds from DEFAULT_DOMAIN_CATEGORIES, never silently empty (and never the same
// array reference as the default, so mutating one doesn't corrupt the other)
step(function () {
  return EV.settings.domainCategories().then(function (categories) {
    assert(categories.length === 2 && categories[0].name === 'URL Shortener' && categories[0].keywords.length === 2,
      'domainCategories: first read seeds from DEFAULT_DOMAIN_CATEGORIES (' + JSON.stringify(categories) + ')');
  });
});
step(function () {
  return EV.settings.domainCategories().then(function (categories) {
    assert(categories.length === 2, 'domainCategories: second read returns the persisted seed, not seeded again');
  });
});

// setDomainCategories dedupes keywords within a category, trims/lowercases, and drops a category
// left with no keywords
step(function () {
  return EV.settings.setDomainCategories([
    { name: ' My Category ', keywords: ['Foo.com', ' foo.com ', 'Bar.com'] },
    { name: 'Empty Category', keywords: [] },
    { name: '', keywords: ['x.com'] }
  ]).then(function (categories) {
    assert(categories.length === 1, 'setDomainCategories: drops categories with no name or no keywords (' + JSON.stringify(categories) + ')');
    assert(categories[0].name === 'My Category' && categories[0].keywords.length === 2 &&
      categories[0].keywords.indexOf('foo.com') !== -1 && categories[0].keywords.indexOf('bar.com') !== -1,
      'setDomainCategories: trims name, dedupes/lowercases keywords (' + JSON.stringify(categories) + ')');
  });
});

// reset restores the default set
step(function () { return EV.settings.resetDomainCategoriesToDefault(); });
step(function () {
  return EV.settings.domainCategories().then(function (categories) {
    assert(categories.length === 2 && categories[1].name === 'Social Media',
      'resetDomainCategoriesToDefault: restores DEFAULT_DOMAIN_CATEGORIES (' + JSON.stringify(categories) + ')');
  });
});

// "default should come with the latest tool": a NEW default category added in a later version of
// the app (simulated by mutating DEFAULT_DOMAIN_CATEGORIES after the user already has a saved
// record) merges in automatically on the next read, without duplicating what the user already has.
step(function () {
  EV.DEFAULT_DOMAIN_CATEGORIES.push({ name: 'Crypto Exchange', keywords: ['coinbase.com'] });
  return EV.settings.domainCategories().then(function (categories) {
    assert(categories.length === 3 && categories.some(function (c) { return c.name === 'Crypto Exchange' && c.keywords.indexOf('coinbase.com') !== -1; }),
      'domainCategories: a newly-added default category merges in for an existing user (' + JSON.stringify(categories) + ')');
  });
});
step(function () {
  return EV.settings.domainCategories().then(function (categories) {
    assert(categories.length === 3, 'domainCategories: the newly-merged default is not merged in a second time on the next read');
  });
});

// a default category the user explicitly deleted is NOT resurrected on a later read (even though
// its name still exists in DEFAULT_DOMAIN_CATEGORIES) -- it was already in syncedDefaultNames
step(function () {
  return EV.settings.domainCategories().then(function (categories) {
    return EV.settings.setDomainCategories(categories.filter(function (c) { return c.name !== 'Social Media'; }));
  });
});
step(function () {
  return EV.settings.domainCategories().then(function (categories) {
    assert(categories.length === 2 && !categories.some(function (c) { return c.name === 'Social Media'; }),
      'domainCategories: a user-deleted default category is not resurrected on a later read (' + JSON.stringify(categories) + ')');
  });
});

// a legacy record saved before this update-syncing existed (no syncedDefaultNames field at all)
// does not resurrect any of today's defaults -- only a genuinely new one (added after this
// migration runs) would merge in from here on
step(function () {
  __store.domainCategories = { service: 'domainCategories', categories: [{ name: 'URL Shortener', keywords: ['bit.ly'] }] };
  return EV.settings.domainCategories().then(function (categories) {
    assert(categories.length === 1 && categories[0].name === 'URL Shortener',
      'domainCategories: a legacy record (no syncedDefaultNames) does not resurrect other current defaults (' + JSON.stringify(categories) + ')');
  });
});
step(function () {
  EV.DEFAULT_DOMAIN_CATEGORIES.push({ name: 'Yet Another New Default', keywords: ['example-new.com'] });
  return EV.settings.domainCategories().then(function (categories) {
    assert(categories.length === 2 && categories.some(function (c) { return c.name === 'Yet Another New Default'; }),
      'domainCategories: after the legacy migration, a subsequent new default still merges in correctly (' + JSON.stringify(categories) + ')');
  });
});

step(function () {
  print('---');
  print('PASS: ' + pass + '  FAIL: ' + fail);
  if (fail > 0) throw new Error(fail + ' test(s) failed');
});
