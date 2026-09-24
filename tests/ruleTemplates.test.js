/**
 * ruleTemplates.test.js — regression coverage for js/rules/ruleTemplates.js
 * (EV.RULE_TEMPLATES). Closes a longstanding coverage gap: these 17 starter
 * templates were previously only hand-verified once, never part of the
 * automated suite, because they lived inline in app.js (which needs a DOM).
 * Loads the real js/indexing/indexLogic.js for EV.ruleHelpers (the `h`
 * rule expressions see) — its helper functions are pure and don't need
 * emlParser.js/urlExtract.js loaded, since this test never calls
 * buildIndexDoc/buildRuleFacts/evalRulesForFile themselves, only compiles
 * and runs each template's raw expression against a hand-built synthetic
 * facts object mirroring buildRuleFacts's real shape.
 * Run via tests/run-all.sh, or directly: jsc tests/ruleTemplates.test.js
 * (from the repo root).
 */
var EV = {};
this.EV = EV;
load('js/indexing/indexLogic.js');
load('js/rules/ruleTemplates.js');

var pass = 0, fail = 0;
function assert(cond, label) { if (cond) pass++; else { fail++; print('FAIL: ' + label); } }

function baseFacts(overrides) {
  var f = {
    subject: 'Hello world', from: { name: 'Jane Doe', address: 'jane@example.com', domain: 'example.com' },
    to: [], cc: [], bcc: [], recipientCount: 1,
    replyTo: { name: '', address: 'jane@example.com', domain: 'example.com' },
    returnPath: { name: '', address: 'jane@example.com', domain: 'example.com' },
    date: new Date(), spf: 'pass', dkim: 'pass', dmarc: 'pass',
    bodyText: 'Just a normal message.', urls: [], urlDomains: [],
    attachments: [], attachmentCount: 0, size: 100, messageId: '<a@b>',
    trustedDomains: [], domainIsTrusted: false, nameMismatch: false, lookalikeDomain: false, punycodeSender: false,
    urgencyScore: 0, financialIndicators: [], domainCategories: [],
    getHeader: function () { return null; }, getHeaderAll: function () { return []; }
  };
  return Object.assign(f, overrides || {});
}

// 1. Every template compiles and runs without throwing against a realistic facts shape.
EV.RULE_TEMPLATES.forEach(function (t) {
  try {
    var fn = new Function('f', 'h', 'return Boolean(' + t.expression + ');');
    var result = fn(baseFacts(), EV.ruleHelpers);
    assert(typeof result === 'boolean', 'template "' + t.name + '" compiles and returns a boolean (got ' + typeof result + ')');
  } catch (e) {
    fail++; print('FAIL: template "' + t.name + '" threw: ' + e);
  }
});

// 2. Schema sanity: every template has exactly the 3 expected fields, and a non-empty tag/expression.
EV.RULE_TEMPLATES.forEach(function (t) {
  assert(t.name && t.tag && t.expression, 'template "' + (t.name || '?') + '" has name/tag/expression');
});

// 3. Correctness of the 3 new spoof-detection templates specifically: they should just mirror the
// corresponding fact flag, true or false.
function evalTemplate(tag, facts) {
  var t = EV.RULE_TEMPLATES.filter(function (r) { return r.tag === tag; })[0];
  var fn = new Function('f', 'h', 'return Boolean(' + t.expression + ');');
  return fn(facts, EV.ruleHelpers);
}
assert(evalTemplate('brand-impersonation', baseFacts({ nameMismatch: true })) === true, 'brand-impersonation true when f.nameMismatch is true');
assert(evalTemplate('brand-impersonation', baseFacts({ nameMismatch: false })) === false, 'brand-impersonation false when f.nameMismatch is false');
assert(evalTemplate('trusted-domain-lookalike', baseFacts({ lookalikeDomain: true })) === true, 'trusted-domain-lookalike true when f.lookalikeDomain is true');
assert(evalTemplate('trusted-domain-lookalike', baseFacts({ lookalikeDomain: false })) === false, 'trusted-domain-lookalike false when f.lookalikeDomain is false');
assert(evalTemplate('punycode-sender', baseFacts({ punycodeSender: true })) === true, 'punycode-sender true when f.punycodeSender is true');
assert(evalTemplate('punycode-sender', baseFacts({ punycodeSender: false })) === false, 'punycode-sender false when f.punycodeSender is false');
assert(evalTemplate('high-urgency-score', baseFacts({ urgencyScore: 3 })) === true, 'high-urgency-score true at the threshold (3)');
assert(evalTemplate('high-urgency-score', baseFacts({ urgencyScore: 2 })) === false, 'high-urgency-score false just below the threshold (2)');
assert(evalTemplate('financial-indicator', baseFacts({ financialIndicators: ['iban'] })) === true, 'financial-indicator true when at least one indicator is present');
assert(evalTemplate('financial-indicator', baseFacts({ financialIndicators: [] })) === false, 'financial-indicator false when none are present');
assert(evalTemplate('bec-combined-signal', baseFacts({ urgencyScore: 2, financialIndicators: ['iban'] })) === true, 'bec-combined-signal true when both urgency and a financial indicator are present');
assert(evalTemplate('bec-combined-signal', baseFacts({ urgencyScore: 2, financialIndicators: [] })) === false, 'bec-combined-signal false when only urgency is present');
assert(evalTemplate('bec-combined-signal', baseFacts({ urgencyScore: 0, financialIndicators: ['iban'] })) === false, 'bec-combined-signal false when only a financial indicator is present');

// Recipient-count tiers: mutually exclusive across the four thresholds -- exactly one tag applies
// per email (or none, below 25), never two at once.
var RECIPIENT_TIER_TAGS = ['many-recipients-25', 'many-recipients-75', 'many-recipients-200', 'many-recipients-500'];
function matchingTiers(count) {
  return RECIPIENT_TIER_TAGS.filter(function (tag) { return evalTemplate(tag, baseFacts({ recipientCount: count })); });
}
assert(matchingTiers(10).length === 0, 'recipient tiers: below the lowest threshold matches none (' + JSON.stringify(matchingTiers(10)) + ')');
assert(JSON.stringify(matchingTiers(50)) === JSON.stringify(['many-recipients-25']), 'recipient tiers: 50 matches only the 25-75 tier (' + JSON.stringify(matchingTiers(50)) + ')');
assert(JSON.stringify(matchingTiers(150)) === JSON.stringify(['many-recipients-75']), 'recipient tiers: 150 matches only the 75-200 tier (' + JSON.stringify(matchingTiers(150)) + ')');
assert(JSON.stringify(matchingTiers(300)) === JSON.stringify(['many-recipients-200']), 'recipient tiers: 300 matches only the 200-500 tier (' + JSON.stringify(matchingTiers(300)) + ')');
assert(JSON.stringify(matchingTiers(1000)) === JSON.stringify(['many-recipients-500']), 'recipient tiers: 1000 matches only the 500+ tier (' + JSON.stringify(matchingTiers(1000)) + ')');
// boundary exactness: the tier edges (25, 75, 200, 500) themselves fall in the LOWER tier (>, not >=)
assert(matchingTiers(25).length === 0, 'recipient tiers: exactly 25 matches no tier (strict >, ' + JSON.stringify(matchingTiers(25)) + ')');
assert(JSON.stringify(matchingTiers(75)) === JSON.stringify(['many-recipients-25']), 'recipient tiers: exactly 75 falls in the 25-75 tier, not 75-200 (' + JSON.stringify(matchingTiers(75)) + ')');
assert(JSON.stringify(matchingTiers(500)) === JSON.stringify(['many-recipients-200']), 'recipient tiers: exactly 500 falls in the 200-500 tier, not 500+ (' + JSON.stringify(matchingTiers(500)) + ')');

// Organizational-domain-mismatch templates (DMARC-style relaxed alignment): a same-org subdomain
// pair should NOT match (no false positive), a genuinely different domain SHOULD match.
assert(evalTemplate('sender-reply-to-org-mismatch', baseFacts({
  from: { name: '', address: 'a@mail.example.com', domain: 'mail.example.com' },
  replyTo: { name: '', address: 'a@support.example.com', domain: 'support.example.com' }
})) === false, 'sender-reply-to-org-mismatch: same-org subdomains do not flag');
assert(evalTemplate('sender-reply-to-org-mismatch', baseFacts({
  from: { name: '', address: 'a@example.com', domain: 'example.com' },
  replyTo: { name: '', address: 'a@evil.net', domain: 'evil.net' }
})) === true, 'sender-reply-to-org-mismatch: a genuinely different domain flags');
assert(evalTemplate('sender-return-path-org-mismatch', baseFacts({
  from: { name: '', address: 'a@mail.example.co.uk', domain: 'mail.example.co.uk' },
  returnPath: { name: '', address: 'a@billing.example.co.uk', domain: 'billing.example.co.uk' }
})) === false, 'sender-return-path-org-mismatch: same-org co.uk subdomains do not flag');
assert(evalTemplate('sender-return-path-org-mismatch', baseFacts({
  from: { name: '', address: 'a@example.com', domain: 'example.com' },
  returnPath: { name: '', address: 'a@evil.net', domain: 'evil.net' }
})) === true, 'sender-return-path-org-mismatch: a genuinely different domain flags');

assert(evalTemplate('flagged-domain-category', baseFacts({ domainCategories: ['URL Shortener'] })) === true,
  'flagged-domain-category true when at least one category matched');
assert(evalTemplate('flagged-domain-category', baseFacts({ domainCategories: [] })) === false,
  'flagged-domain-category false when no category matched');

// 4. No duplicate tags across templates (the app auto-slugifies from name but a copy/paste mistake
// here would silently collide with an existing rule's tag at save time).
(function () {
  var seen = {};
  var dupes = [];
  EV.RULE_TEMPLATES.forEach(function (t) { if (seen[t.tag]) dupes.push(t.tag); seen[t.tag] = true; });
  assert(dupes.length === 0, 'no duplicate template tags (found: ' + JSON.stringify(dupes) + ')');
})();

step_final();
function step_final() {
  print('---');
  print('PASS: ' + pass + '  FAIL: ' + fail);
  if (fail > 0) throw new Error(fail + ' test(s) failed');
}
