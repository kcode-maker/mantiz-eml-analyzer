/**
 * icsParser.test.js — regression coverage for js/icsParser.js's dependency-
 * free RFC 5545 (iCalendar) VEVENT parser: a well-formed invite with every
 * field present, RFC 5545 §3.1 line-unfolding, backslash-unescaping in
 * DESCRIPTION, UTC vs TZID-qualified local DTSTART, multiple ATTENDEEs,
 * METHOD:REQUEST vs METHOD:CANCEL, and defensive handling of malformed/
 * truncated input (never throws). Run via tests/run-all.sh, or directly:
 * jsc tests/icsParser.test.js (from the repo root).
 */
load('js/parsing/icsParser.js');

var EV = this.EV;
var pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; }
  else { fail++; print('FAIL: ' + label); }
}

// ---- 1. Well-formed VEVENT, all fields present ----
(function () {
  var ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    'UID:abc123@example.com',
    'SUMMARY:Quarterly Planning Sync',
    'LOCATION:Conference Room 4B',
    'DESCRIPTION:Agenda: budget review',
    'DTSTART:20260115T140000Z',
    'DTEND:20260115T150000Z',
    'ORGANIZER;CN=Alice Example:mailto:alice@example.com',
    'ATTENDEE;CN=Bob Example:mailto:bob@example.com',
    'ATTENDEE;CN=Carol Example:mailto:carol@example.com',
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');

  var result = EV.parseIcs(ics);
  assert(result && result.ok === true, 'well-formed VEVENT: parses ok (' + JSON.stringify(result) + ')');
  if (result && result.ok) {
    var ev = result.event;
    assert(result.method === 'REQUEST', 'well-formed VEVENT: METHOD captured as REQUEST (' + result.method + ')');
    assert(ev.summary === 'Quarterly Planning Sync', 'well-formed VEVENT: SUMMARY extracted (' + ev.summary + ')');
    assert(ev.location === 'Conference Room 4B', 'well-formed VEVENT: LOCATION extracted (' + ev.location + ')');
    assert(ev.description === 'Agenda: budget review', 'well-formed VEVENT: DESCRIPTION extracted (' + ev.description + ')');
    assert(ev.status === 'CONFIRMED', 'well-formed VEVENT: STATUS extracted (' + ev.status + ')');
    assert(ev.dtstart && ev.dtstart.isUtc === true, 'well-formed VEVENT: DTSTART recognized as UTC');
    assert(ev.dtstart && ev.dtstart.date && ev.dtstart.date.getUTCFullYear() === 2026, 'well-formed VEVENT: DTSTART decodes to a real Date (' + (ev.dtstart && ev.dtstart.date) + ')');
    assert(ev.dtend && ev.dtend.isUtc === true, 'well-formed VEVENT: DTEND recognized as UTC');
    assert(ev.organizer && ev.organizer.name === 'Alice Example' && ev.organizer.email === 'alice@example.com',
      'well-formed VEVENT: ORGANIZER CN + mailto both extracted (' + JSON.stringify(ev.organizer) + ')');
    assert(ev.attendees && ev.attendees.length === 2, 'well-formed VEVENT: both ATTENDEEs collected (' + JSON.stringify(ev.attendees) + ')');
  }
})();

// ---- 2. Line-unfolding: SUMMARY/DESCRIPTION wrapped per RFC 5545 folding ----
(function () {
  var ics = [
    'BEGIN:VCALENDAR',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    'SUMMARY:This is a long summary that has been',
    '  folded across two physical lines', // 2 leading spaces: 1 is the mandatory RFC 5545 fold marker (stripped), 1 is real content
    'DESCRIPTION:Line one of the description\\nLine two continues',
    '\ton a folded physical line',
    'DTSTART:20260101T090000Z',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');

  var result = EV.parseIcs(ics);
  assert(result && result.ok === true, 'line-unfolding: parses ok');
  if (result && result.ok) {
    assert(result.event.summary === 'This is a long summary that has been folded across two physical lines',
      'line-unfolding: SUMMARY reassembled across a space-folded continuation (' + result.event.summary + ')');
    assert(result.event.description.indexOf('on a folded physical line') !== -1,
      'line-unfolding: DESCRIPTION reassembled across a tab-folded continuation (' + result.event.description + ')');
  }
})();

// ---- 3. Backslash-unescaping in DESCRIPTION (\n, \,, \;) ----
(function () {
  var ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'SUMMARY:Escape test',
    'DESCRIPTION:Line one\\nLine two\\, with a comma\\; and a semicolon',
    'DTSTART:20260101T090000Z',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');

  var result = EV.parseIcs(ics);
  assert(result && result.ok === true, 'unescaping: parses ok');
  if (result && result.ok) {
    var expected = 'Line one\nLine two, with a comma; and a semicolon';
    assert(result.event.description === expected,
      'unescaping: \\n/\\,/\\; all correctly unescaped (' + JSON.stringify(result.event.description) + ')');
  }
})();

// ---- 4. UTC DTSTART vs TZID-qualified local DTSTART ----
(function () {
  var utcIcs = [
    'BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'SUMMARY:UTC event',
    'DTSTART:20260601T120000Z', 'END:VEVENT', 'END:VCALENDAR'
  ].join('\n'); // also exercises bare-LF line endings, not just CRLF
  var utcResult = EV.parseIcs(utcIcs);
  assert(utcResult && utcResult.ok === true, 'UTC DTSTART: parses ok under bare-LF endings');
  assert(utcResult.event.dtstart.isUtc === true && utcResult.event.dtstart.tzid === null,
    'UTC DTSTART: flagged isUtc with no tzid (' + JSON.stringify(utcResult.event.dtstart) + ')');

  var localIcs = [
    'BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'SUMMARY:Local event',
    'DTSTART;TZID=America/New_York:20260601T083000', 'END:VEVENT', 'END:VCALENDAR'
  ].join('\r\n');
  var localResult = EV.parseIcs(localIcs);
  assert(localResult && localResult.ok === true, 'TZID DTSTART: parses ok');
  assert(localResult.event.dtstart.isUtc === false && localResult.event.dtstart.tzid === 'America/New_York',
    'TZID DTSTART: raw local time + TZID surfaced, no timezone-DB conversion attempted (' + JSON.stringify(localResult.event.dtstart) + ')');
  assert(localResult.event.dtstart.display.indexOf('America/New_York') !== -1,
    'TZID DTSTART: display string includes the TZID (' + localResult.event.dtstart.display + ')');
})();

// ---- 5. Multiple ATTENDEEs collected, not just the first ----
(function () {
  var ics = [
    'BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'SUMMARY:Group meeting', 'DTSTART:20260101T090000Z',
    'ATTENDEE;CN=Person One:mailto:one@example.com',
    'ATTENDEE;CN=Person Two:mailto:two@example.com',
    'ATTENDEE;CN=Person Three:mailto:three@example.com',
    'END:VEVENT', 'END:VCALENDAR'
  ].join('\r\n');
  var result = EV.parseIcs(ics);
  assert(result && result.ok === true, 'multiple attendees: parses ok');
  assert(result.event.attendees.length === 3, 'multiple attendees: all 3 collected (' + result.event.attendees.length + ')');
  var emails = result.event.attendees.map(function (a) { return a.email; });
  assert(emails.indexOf('one@example.com') !== -1 && emails.indexOf('two@example.com') !== -1 && emails.indexOf('three@example.com') !== -1,
    'multiple attendees: every email present (' + JSON.stringify(emails) + ')');
})();

// ---- 6. METHOD:CANCEL vs METHOD:REQUEST distinguishable ----
(function () {
  var reqIcs = ['BEGIN:VCALENDAR', 'METHOD:REQUEST', 'BEGIN:VEVENT', 'SUMMARY:X', 'DTSTART:20260101T090000Z', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  var cancelIcs = ['BEGIN:VCALENDAR', 'METHOD:CANCEL', 'BEGIN:VEVENT', 'SUMMARY:X', 'DTSTART:20260101T090000Z', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  var reqResult = EV.parseIcs(reqIcs);
  var cancelResult = EV.parseIcs(cancelIcs);
  assert(reqResult.method === 'REQUEST', 'METHOD: REQUEST captured (' + reqResult.method + ')');
  assert(cancelResult.method === 'CANCEL', 'METHOD: CANCEL captured (' + cancelResult.method + ')');
  assert(reqResult.method !== cancelResult.method, 'METHOD: REQUEST and CANCEL are distinguishable');
})();

// ---- 7. Malformed/truncated input never throws ----
(function () {
  var truncated = ['BEGIN:VCALENDAR', 'METHOD:REQUEST', 'BEGIN:VEVENT', 'SUMMARY:Never finishes', 'DTSTART:20260101T090000Z'].join('\r\n');
  var result;
  try {
    result = EV.parseIcs(truncated);
  } catch (e) {
    fail++; print('FAIL: truncated input threw an exception: ' + e);
    result = null;
  }
  if (result) assert(result.ok === false && typeof result.reason === 'string', 'truncated input: returns {ok:false, reason} instead of throwing (' + JSON.stringify(result) + ')');

  var noEvent = ['BEGIN:VCALENDAR', 'METHOD:REQUEST', 'END:VCALENDAR'].join('\r\n');
  var noEventResult;
  try { noEventResult = EV.parseIcs(noEvent); } catch (e) { fail++; print('FAIL: missing-VEVENT input threw: ' + e); noEventResult = null; }
  if (noEventResult) assert(noEventResult.ok === false, 'no VEVENT block: returns ok:false (' + JSON.stringify(noEventResult) + ')');

  var garbage = '\x00\x01�� not calendar data at all {{{ %%% ' + Array(50).join('junk;garbage:colons:everywhere ');
  var garbageResult;
  try { garbageResult = EV.parseIcs(garbage); } catch (e) { fail++; print('FAIL: garbage input threw: ' + e); garbageResult = null; }
  if (garbageResult) assert(garbageResult.ok === false, 'garbage bytes: returns ok:false rather than throwing (' + JSON.stringify(garbageResult) + ')');

  var results = [
    EV.parseIcs(''), EV.parseIcs(null), EV.parseIcs(undefined), EV.parseIcs(12345), EV.parseIcs({})
  ];
  var allSafe = results.every(function (r) { return r && r.ok === false && typeof r.reason === 'string'; });
  assert(allSafe, 'non-string/empty input: every variant returns a safe ok:false result (' + JSON.stringify(results) + ')');
})();

// ---- 8. A non-calendar-shaped plain text body never produces a false positive ----
(function () {
  var plain = 'Hi,\n\nJust checking in about tomorrow.\n\nThanks,\nJane';
  var result = EV.parseIcs(plain);
  assert(result && result.ok === false, 'ordinary plain-text body: correctly reported as not parseable (' + JSON.stringify(result) + ')');
})();

print('---');
print('PASS: ' + pass + '  FAIL: ' + fail);
if (fail > 0) throw new Error(fail + ' test(s) failed');
