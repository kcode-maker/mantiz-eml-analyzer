/**
 * settings.js — small per-service config store (IndexedDB), mirroring the
 * tags.js CRUD pattern exactly. Holds things a user opts into rather than
 * per-email data: the user-editable "trusted domains" list used by the
 * spoof-detection helpers, and the user-editable "domain categories" list
 * ("what type of domain is this?" — CDN, URL shortener, payment processor,
 * ...) used by the domain-classification helpers. Both are pre-filled from
 * a small built-in default set so they're never silently empty, and both
 * are entirely user-editable/extendable from there — everything a user
 * adds lives only in this browser's IndexedDB, never in the repo's source.
 * (The WHOIS lookup feature needs no settings here — it only ever calls the
 * free public RDAP service, no API key or configuration involved.)
 */
(function (g) {
  'use strict';
  var EV = g.EV || (g.EV = {});
  var STORE = 'settings';

  function rawGet(service) {
    return EV.db.get(STORE, service);
  }

  function put(service, patch) {
    return rawGet(service).then(function (rec) {
      rec = Object.assign({ service: service }, rec || {}, patch);
      return EV.db.put(STORE, rec).then(function () { return rec; });
    });
  }

  EV.settings = {
    get: rawGet,

    /** Always resolves to a non-empty array — seeds from the built-in brand list on first read. */
    trustedDomains: function () {
      return rawGet('trustedDomains').then(function (rec) {
        if (rec && Array.isArray(rec.domains)) return rec.domains;
        var defaults = (EV.ruleHelpers && EV.ruleHelpers.COMMON_BRANDS || []).slice();
        return put('trustedDomains', { domains: defaults }).then(function (r) { return r.domains; });
      });
    },
    /** Dedupes/trims every entry; lowercases plain domains (comparisons are always case-insensitive
     * anyway) but leaves a regex entry's (`/pattern/flags`) case untouched, since its own flags —
     * not this normalization — control whether it matches case-sensitively. */
    setTrustedDomains: function (list) {
      var isRegex = EV.ruleHelpers && EV.ruleHelpers.isRegexTrustedEntry;
      var deduped = Array.from(new Set((list || []).map(function (d) {
        d = String(d).trim();
        return (isRegex && isRegex(d)) ? d : d.toLowerCase();
      }).filter(Boolean)));
      return put('trustedDomains', { domains: deduped }).then(function (r) { return r.domains; });
    },
    resetTrustedDomainsToDefault: function () {
      var defaults = (EV.ruleHelpers && EV.ruleHelpers.COMMON_BRANDS || []).slice();
      return put('trustedDomains', { domains: defaults }).then(function (r) { return r.domains; });
    },

    /**
     * "What type of domain is this?" categories (CDN, URL shortener, payment processor, ...), each a
     * {name, keywords} pair — checked against sender/reply-to/return-path, every URL domain, and
     * domain-like tokens in headers/attachment filenames. Seeded from a small independently-curated
     * starter set (EV.DEFAULT_DOMAIN_CATEGORIES) — entirely user-editable/extendable from there,
     * stored only in this browser, never in the repo's source.
     *
     * A newer version of the app can ship *additional* default categories after a user has already
     * been using this feature. On every read, any default category the user doesn't already have
     * (by name) AND hasn't previously been offered gets merged in automatically — "default should
     * come with the latest tool" — without resurrecting one the user deliberately deleted (tracked
     * via the hidden `syncedDefaultNames` list) or touching one they've already customized.
     */
    domainCategories: function () {
      return rawGet('domainCategories').then(function (rec) {
        var defaults = EV.DEFAULT_DOMAIN_CATEGORIES || [];
        var defaultNames = defaults.map(function (c) { return c.name; });

        if (!rec || !Array.isArray(rec.categories)) {
          // First-ever read: seed everything, and remember every default name shipped as of now.
          var seeded = defaults.map(function (c) { return { name: c.name, keywords: c.keywords.slice() }; });
          return put('domainCategories', { categories: seeded, syncedDefaultNames: defaultNames }).then(function (r) { return r.categories; });
        }

        // A record saved before this update-syncing existed has no syncedDefaultNames at all --
        // treat today's defaults as already-known for it, so this one-time migration can't
        // resurrect a default category this user may have deliberately deleted already. Only a
        // genuinely new default added in some FUTURE version will merge in from here on.
        var syncedNames = rec.syncedDefaultNames || defaultNames;
        var existingNames = {};
        rec.categories.forEach(function (c) { existingNames[c.name] = true; });
        var newOnes = defaults.filter(function (c) { return syncedNames.indexOf(c.name) === -1 && !existingNames[c.name]; });

        if (!newOnes.length && rec.syncedDefaultNames) return rec.categories;

        var merged = rec.categories.concat(newOnes.map(function (c) { return { name: c.name, keywords: c.keywords.slice() }; }));
        var updatedSynced = Array.from(new Set(syncedNames.concat(newOnes.map(function (c) { return c.name; }))));
        return put('domainCategories', { categories: merged, syncedDefaultNames: updatedSynced }).then(function (r) { return r.categories; });
      });
    },
    /** Dedupes keywords within each category (case-insensitive), drops a category left with no
     * keywords, and trims/lowercases every keyword and name. */
    setDomainCategories: function (categories) {
      var cleaned = (categories || []).map(function (c) {
        var keywords = Array.from(new Set((c.keywords || []).map(function (k) { return String(k).trim().toLowerCase(); }).filter(Boolean)));
        return { name: String(c.name || '').trim(), keywords: keywords };
      }).filter(function (c) { return c.name && c.keywords.length; });
      return put('domainCategories', { categories: cleaned }).then(function (r) { return r.categories; });
    },
    resetDomainCategoriesToDefault: function () {
      var defaults = (EV.DEFAULT_DOMAIN_CATEGORIES || []);
      var seeded = defaults.map(function (c) { return { name: c.name, keywords: c.keywords.slice() }; });
      return put('domainCategories', { categories: seeded, syncedDefaultNames: defaults.map(function (c) { return c.name; }) }).then(function (r) { return r.categories; });
    },

    /** Whether/how to offer the "load sample emails" banner. `dismissedOnce` is set the first time
     * the banner is closed or used, so it defaults to appearing only on the very first run;
     * `alwaysShow` (the banner's own "show this again next time" checkbox) overrides that and keeps
     * it appearing on every future startup regardless. */
    demoState: function () {
      return rawGet('demo').then(function (rec) {
        return Object.assign({ dismissedOnce: false, alwaysShow: false }, rec || {});
      });
    },
    setDemoState: function (patch) {
      return put('demo', patch);
    },

    /** Max number of email tabs kept open at once before the least-recently-viewed one is evicted
     * to make room for a new one (see js/ui/tabs.js). User-configurable 1-100, default 10. */
    maxOpenTabs: function () {
      return rawGet('ideConfig').then(function (rec) {
        return (rec && Number.isInteger(rec.maxOpenTabs)) ? rec.maxOpenTabs : 10;
      });
    },
    setMaxOpenTabs: function (n) {
      n = Math.round(Number(n));
      if (!Number.isFinite(n)) n = 10; // e.g. NaN/undefined input, not a valid 0
      n = Math.max(1, Math.min(100, n));
      return put('ideConfig', { maxOpenTabs: n }).then(function () { return n; });
    }
  };
})(typeof self !== 'undefined' ? self : this);
