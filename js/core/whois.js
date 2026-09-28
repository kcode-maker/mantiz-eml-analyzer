/**
 * whois.js — an explicit, per-click domain-age (WHOIS/RDAP) lookup. This is
 * the app's second deliberate exception to "nothing is ever fetched by this
 * app itself" (see ARCHITECTURE.md's Security model) — the first being the
 * VirusTotal "Scan URL" button, which only ever opens a new tab and never
 * makes its own network request. This one genuinely does: it calls the free
 * public RDAP service (no API key, no config) with only the domain string,
 * on explicit user click — never automatically, never in bulk across a
 * folder.
 *
 * Always resolves (never rejects) to one of three states so the UI never
 * shows a silent blank: {status:'found', data, message} — the registry has
 * a record; {status:'not_found', message} — the registry has no record for
 * this domain (a real, meaningful signal for a newly-registered or
 * never-registered domain, not an error); {status:'error', message} — the
 * lookup itself failed (network/timeout/malformed response).
 */
(function (g) {
  'use strict';
  var EV = g.EV || (g.EV = {});

  var LOOKUP_TIMEOUT_MS = 8000;

  /** Maps RDAP's real JSON shape to a common {registrar, createdDate, ageDays} shape. Never throws --
   * a response missing the fields it looks for just yields fewer (or no) populated fields. */
  EV.whois = EV.whois || {};
  EV.whois._normalizeRdapResponse = function (json) {
    json = json || {};
    var registrar = null;
    (json.entities || []).some(function (e) {
      if ((e.roles || []).indexOf('registrar') === -1) return false;
      var vcard = e.vcardArray && e.vcardArray[1];
      if (Array.isArray(vcard)) {
        var fnEntry = vcard.filter(function (v) { return v[0] === 'fn'; })[0];
        if (fnEntry) registrar = fnEntry[3];
      }
      if (!registrar && e.handle) registrar = e.handle;
      return true;
    });
    var createdDate = null;
    (json.events || []).some(function (ev) {
      if (ev.eventAction === 'registration' && ev.eventDate) { createdDate = ev.eventDate; return true; }
      return false;
    });
    var ageDays = null;
    if (createdDate) {
      var created = new Date(createdDate);
      if (!isNaN(created.getTime())) ageDays = Math.max(0, Math.round((Date.now() - created.getTime()) / 86400000));
    }
    return { registrar: registrar, createdDate: createdDate, ageDays: ageDays };
  };

  /** @param {string} domain @returns {Promise<{status:'found'|'not_found'|'error', data?:object, message:string}>} */
  EV.whois.lookup = function (domain) {
    domain = String(domain || '').trim().toLowerCase();
    if (!domain) return Promise.resolve({ status: 'error', message: 'No domain given.' });

    var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, LOOKUP_TIMEOUT_MS);

    return fetch('https://rdap.org/domain/' + encodeURIComponent(domain), { signal: controller && controller.signal })
      .then(function (resp) {
        clearTimeout(timer);
        if (resp.status === 404) return { status: 'not_found', message: 'No RDAP record found for "' + domain + '" — the registry may not publish one for this TLD, or the domain may be unregistered.' };
        if (!resp.ok) return { status: 'error', message: 'RDAP lookup failed: HTTP ' + resp.status + '.' };
        return resp.json().then(function (json) {
          var data = EV.whois._normalizeRdapResponse(json);
          var msg = 'Registrar: ' + (data.registrar || 'unknown') + '. ' +
            (data.createdDate ? 'Registered ' + data.createdDate.slice(0, 10) + (data.ageDays != null ? ' (' + data.ageDays + ' days ago)' : '') + '.' : 'Registration date not published.');
          return { status: 'found', data: data, message: msg };
        }).catch(function () {
          return { status: 'error', message: 'RDAP returned a response that could not be parsed.' };
        });
      })
      .catch(function (err) {
        clearTimeout(timer);
        var aborted = err && (err.name === 'AbortError');
        return { status: 'error', message: aborted ? 'RDAP lookup timed out after ' + (LOOKUP_TIMEOUT_MS / 1000) + 's.' : 'RDAP lookup failed: ' + (err && err.message || err) + '.' };
      });
  };
})(typeof self !== 'undefined' ? self : this);
