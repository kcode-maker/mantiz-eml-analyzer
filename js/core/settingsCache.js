/**
 * settingsCache.js — synchronous copies of the Settings lists that rendering needs (domain categories, trusted domains, the
 * organization's own domains). Settings are IndexedDB-backed and async, but the Preview renders synchronously, so each list is
 * loaded once at start and refreshed whenever the Settings page changes it (EV.settingsCache.refresh*), instead of doing an
 * async round-trip on every render. Getters return the last loaded list ([] until the first load finishes).
 */
(function (g) {
  'use strict';
  var EV = g.EV || (g.EV = {});
  var categories = [], trusted = [], internal = [];

  EV.settingsCache = {
    domainCategories: function () { return categories; },
    trustedDomains: function () { return trusted; },
    internalDomains: function () { return internal; },
    refreshDomainCategories: function () { return EV.settings.domainCategories().then(function (d) { categories = d; }); },
    refreshTrustedDomains: function () { return EV.settings.trustedDomains().then(function (d) { trusted = d; }); },
    refreshInternalDomains: function () { return EV.settings.internalDomains().then(function (d) { internal = d; }); },
    refreshAll: function () {
      return Promise.all([EV.settingsCache.refreshDomainCategories(), EV.settingsCache.refreshTrustedDomains(), EV.settingsCache.refreshInternalDomains()]);
    }
  };
  // Needs EV.settings (js/core/settings.js), which loads first.
  if (EV.settings) EV.settingsCache.refreshAll();
})(typeof self !== 'undefined' ? self : this);
