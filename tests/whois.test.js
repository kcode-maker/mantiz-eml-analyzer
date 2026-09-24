/**
 * whois.test.js — regression coverage for js/core/whois.js's
 * _normalizeRdapResponse: maps a real RDAP domain response into
 * {registrar, createdDate, ageDays}, tolerates a response missing the
 * fields it looks for (no throw, fields just come back null), and computes
 * a sane ageDays from a known registration date. The actual fetch() path
 * in EV.whois.lookup() is browser-only (needs a live network + a real
 * global fetch/AbortController) and is verified live instead. Run via
 * tests/run-all.sh, or directly: jsc tests/whois.test.js (from the repo
 * root).
 */
var EV = {};
this.EV = EV;
load('js/core/whois.js');

var pass = 0, fail = 0;
function assert(cond, label) { if (cond) pass++; else { fail++; print('FAIL: ' + label); } }

// ---- a realistic RDAP domain response ----
(function () {
  var json = {
    objectClassName: 'domain',
    ldhName: 'EXAMPLE.COM',
    events: [
      { eventAction: 'registration', eventDate: '1995-08-14T04:00:00Z' },
      { eventAction: 'expiration', eventDate: '2025-08-13T04:00:00Z' }
    ],
    entities: [
      { objectClassName: 'entity', handle: '292', roles: ['registrar'],
        vcardArray: ['vcard', [['version', {}, 'text', '4.0'], ['fn', {}, 'text', 'Example Registrar Inc.']]] }
    ]
  };
  var data = EV.whois._normalizeRdapResponse(json);
  assert(data.registrar === 'Example Registrar Inc.', 'normalizeRdapResponse: extracts registrar name from vcardArray (got ' + JSON.stringify(data.registrar) + ')');
  assert(data.createdDate === '1995-08-14T04:00:00Z', 'normalizeRdapResponse: extracts the registration event date (got ' + JSON.stringify(data.createdDate) + ')');
  assert(typeof data.ageDays === 'number' && data.ageDays > 10000, 'normalizeRdapResponse: computes a plausible ageDays for a 1995 registration (got ' + data.ageDays + ')');
})();

// ---- registrar entity with no vcardArray fn -- falls back to handle ----
(function () {
  var json = {
    events: [{ eventAction: 'registration', eventDate: '2020-01-01T00:00:00Z' }],
    entities: [{ roles: ['registrar'], handle: 'REG-999' }]
  };
  var data = EV.whois._normalizeRdapResponse(json);
  assert(data.registrar === 'REG-999', 'normalizeRdapResponse: falls back to entity handle when vcardArray has no fn (got ' + JSON.stringify(data.registrar) + ')');
})();

// ---- missing/malformed fields never throw, just come back null ----
(function () {
  var data = EV.whois._normalizeRdapResponse({});
  assert(data.registrar === null && data.createdDate === null && data.ageDays === null,
    'normalizeRdapResponse: empty object -> all null, no throw (' + JSON.stringify(data) + ')');
})();
(function () {
  var data;
  try { data = EV.whois._normalizeRdapResponse(null); } catch (e) { fail++; print('FAIL: normalizeRdapResponse threw on null input: ' + e); return; }
  assert(data.registrar === null && data.createdDate === null, 'normalizeRdapResponse: null input -> all null, no throw');
})();
(function () {
  var json = { events: [{ eventAction: 'registration', eventDate: 'not-a-real-date' }] };
  var data = EV.whois._normalizeRdapResponse(json);
  assert(data.createdDate === 'not-a-real-date' && data.ageDays === null,
    'normalizeRdapResponse: an unparseable event date leaves ageDays null instead of NaN/throwing (' + JSON.stringify(data) + ')');
})();

// ---- an entity with a non-registrar role is ignored ----
(function () {
  var json = { entities: [{ roles: ['technical'], handle: 'TECH-1' }] };
  var data = EV.whois._normalizeRdapResponse(json);
  assert(data.registrar === null, 'normalizeRdapResponse: a non-registrar entity role is ignored (' + JSON.stringify(data) + ')');
})();

// ---- EV.whois.lookup with an empty domain resolves (never throws/rejects) to an error state ----
// (async -- chained explicitly so it's guaranteed to run, and be counted, before the final report;
// see tags.test.js's header comment for why jsc needs this manual chain rather than async/await.)
EV.whois.lookup('').then(function (res) {
  assert(res.status === 'error' && !!res.message, 'lookup: empty domain resolves to an explicit error state, not a throw (' + JSON.stringify(res) + ')');
}).then(function () {
  print('---');
  print('PASS: ' + pass + '  FAIL: ' + fail);
  if (fail > 0) throw new Error(fail + ' test(s) failed');
});
