/**
 * detections.test.js — regression coverage for the sender-spoofing helpers
 * added to js/indexing/indexLogic.js's EV.ruleHelpers: isPunycodeDomain,
 * displayNameBrandMismatch (built-in brands + user-added trusted domains,
 * including subdomain coverage), isDomainTrusted (literal exact/subdomain
 * match plus regex-entry support), and isRegexTrustedEntry — plus
 * EV.urgencyScore and EV.extractFinancialIndicators (the always-on
 * urgency-lexicon/financial-indicator signals). Loads the real
 * indexLogic.js — these helpers are pure and don't need emlParser.js/
 * urlExtract.js loaded, since this test never calls buildIndexDoc/
 * buildRuleFacts/evalRulesForFile. Run via tests/run-all.sh, or directly:
 * jsc tests/detections.test.js (from the repo root).
 */
var EV = {};
this.EV = EV;
load('js/indexing/indexLogic.js');

var pass = 0, fail = 0;
function assert(cond, label) { if (cond) pass++; else { fail++; print('FAIL: ' + label); } }
var h = EV.ruleHelpers;

// ---- isPunycodeDomain ----
assert(h.isPunycodeDomain('xn--pypal-4ve.com') === true, 'isPunycodeDomain: true for an xn-- labeled domain');
assert(h.isPunycodeDomain('mail.xn--80ak6aa92e.com') === true, 'isPunycodeDomain: true when the xn-- label is not the first one');
assert(h.isPunycodeDomain('paypal.com') === false, 'isPunycodeDomain: false for a plain domain');
assert(h.isPunycodeDomain('') === false, 'isPunycodeDomain: false for empty/falsy input');

// ---- isRegexTrustedEntry ----
assert(h.isRegexTrustedEntry('/\\.mycompany\\.com$/') === true, 'isRegexTrustedEntry: true for /pattern/');
assert(h.isRegexTrustedEntry('/\\.mycompany\\.com$/i') === true, 'isRegexTrustedEntry: true for /pattern/flags');
assert(h.isRegexTrustedEntry('mycompany.com') === false, 'isRegexTrustedEntry: false for a plain domain');

// ---- isDomainTrusted ----
assert(h.isDomainTrusted('mycompany.com', ['mycompany.com']) === true, 'isDomainTrusted: exact literal match');
assert(h.isDomainTrusted('mail.mycompany.com', ['mycompany.com']) === true, 'isDomainTrusted: subdomain of a literal entry');
assert(h.isDomainTrusted('notmycompany.com', ['mycompany.com']) === false, 'isDomainTrusted: a domain that merely ends with the string but is not a real subdomain is rejected');
assert(h.isDomainTrusted('evil.com', ['mycompany.com']) === false, 'isDomainTrusted: unrelated domain not trusted');
assert(h.isDomainTrusted('foo.corp.mycompany.com', ['/\\.corp\\.mycompany\\.com$/']) === true, 'isDomainTrusted: regex entry matches');
assert(h.isDomainTrusted('foo.other.com', ['/\\.corp\\.mycompany\\.com$/']) === false, 'isDomainTrusted: regex entry does not over-match');
assert(h.isDomainTrusted('anything.com', ['/[/']) === false, 'isDomainTrusted: a malformed regex entry never throws, just fails to match');
assert(h.isDomainTrusted('x.com', []) === false, 'isDomainTrusted: empty trusted list -> false');
assert(h.isDomainTrusted('', ['x.com']) === false, 'isDomainTrusted: empty domain -> false');

// ---- displayNameBrandMismatch (built-in COMMON_BRANDS keyword map) ----
assert(h.displayNameBrandMismatch('PayPal Support', 'randomguy123.com') === true,
  'displayNameBrandMismatch: brand keyword in name + wrong domain -> mismatch');
assert(h.displayNameBrandMismatch('PayPal Support', 'paypal.com') === false,
  'displayNameBrandMismatch: brand keyword in name + the real brand domain -> no mismatch');
assert(h.displayNameBrandMismatch('PayPal Support', 'notices.paypal.com') === false,
  'displayNameBrandMismatch: a real subdomain of the brand domain -> no mismatch');
assert(h.displayNameBrandMismatch('Jane Doe', 'example.com') === false,
  'displayNameBrandMismatch: no brand keyword mentioned -> no mismatch');
assert(h.displayNameBrandMismatch('', 'example.com') === false, 'displayNameBrandMismatch: empty name -> false');
assert(h.displayNameBrandMismatch('PayPal Support', '') === false, 'displayNameBrandMismatch: empty domain -> false');

// ---- displayNameBrandMismatch with a user-supplied (Settings-derived) brand-keyword map ----
(function () {
  var keywords = EV.buildBrandKeywords(['mycompany.com']);
  assert(h.displayNameBrandMismatch('MyCompany IT Support', 'evil-lookalike.com', keywords) === true,
    "displayNameBrandMismatch: user's own trusted domain participates in the keyword map -- wrong domain flagged");
  assert(h.displayNameBrandMismatch('MyCompany IT Support', 'mycompany.com', keywords) === false,
    "displayNameBrandMismatch: user's own real domain -- no mismatch");
  assert(h.displayNameBrandMismatch('MyCompany IT Support', 'helpdesk.mycompany.com', keywords) === false,
    "displayNameBrandMismatch: subdomain of the user's own domain -- no mismatch");
})();

// ---- buildBrandKeywords skips regex-shaped trusted-domain entries (no sensible keyword to derive) ----
(function () {
  var keywords = EV.buildBrandKeywords(['/\\.corp\\.mycompany\\.com$/', 'mycompany.com']);
  assert(Object.keys(keywords).indexOf('/\\.corp\\.mycompany\\.com$/') === -1 && keywords.mycompany === 'mycompany.com',
    'buildBrandKeywords: regex entry contributes no keyword, literal entry still does (' + JSON.stringify(keywords) + ')');
})();

// ---- literalTrustedDomains excludes regex entries but keeps COMMON_BRANDS ----
(function () {
  var list = EV.literalTrustedDomains(['mycompany.com', '/\\.corp\\.mycompany\\.com$/']);
  assert(list.indexOf('mycompany.com') !== -1 && list.indexOf('/\\.corp\\.mycompany\\.com$/') === -1 && list.indexOf('paypal.com') !== -1,
    'literalTrustedDomains: keeps literal + COMMON_BRANDS, drops regex entries (' + JSON.stringify(list) + ')');
})();

// ---- EV.urgencyScore ----
assert(EV.urgencyScore('Just a normal message about the weekly report.') === 0, 'urgencyScore: clean text scores 0');
assert(EV.urgencyScore('This is URGENT, please act now.') === 2, 'urgencyScore: case-insensitive, counts distinct keywords ("urgent", "act now") (got ' + EV.urgencyScore('This is URGENT, please act now.') + ')');
assert(EV.urgencyScore('urgent urgent urgent urgent') === 1, 'urgencyScore: repeating the same keyword does not inflate the score past 1 for it');
(function () {
  var many = 'urgent immediately action required account suspended verify your account wire transfer wire funds gift card confidential kindly asap act now final notice';
  var score = EV.urgencyScore(many);
  assert(score >= 10, 'urgencyScore: counts many distinct keywords when present (got ' + score + ')');
})();
(function () {
  var padding = new Array(25000).fill('x').join('');
  var text = padding + ' urgent wire transfer';
  assert(EV.urgencyScore(text) === 0, 'urgencyScore: a keyword past the ~20000-char scan limit is not counted (bounds cost regardless of body length)');
})();

// ---- EV.extractFinancialIndicators ----
assert(EV.extractFinancialIndicators('Just a normal message.').length === 0, 'extractFinancialIndicators: clean text finds nothing');
assert(EV.extractFinancialIndicators('IBAN: GB29NWBK60161331926819').indexOf('iban') !== -1, 'extractFinancialIndicators: finds an IBAN-shaped token');
assert(EV.extractFinancialIndicators('SWIFT code: DEUTDEFF500').indexOf('swift_bic') !== -1, 'extractFinancialIndicators: finds a labeled SWIFT/BIC code');
assert(EV.extractFinancialIndicators('DEUTDEFF500 appears with no label nearby').indexOf('swift_bic') === -1, 'extractFinancialIndicators: an unlabeled SWIFT-shaped code is NOT flagged (avoids false positives on bare ALL-CAPS runs)');
assert(EV.extractFinancialIndicators('Routing number: 021000021').indexOf('routing_number') !== -1, 'extractFinancialIndicators: finds a labeled routing number');
assert(EV.extractFinancialIndicators('here are 9 digits 123456789 with no label').indexOf('routing_number') === -1, 'extractFinancialIndicators: an unlabeled 9-digit run is NOT flagged (avoids false positives on phone/order numbers)');
assert(EV.extractFinancialIndicators('send to 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa').indexOf('crypto_wallet_btc') !== -1, 'extractFinancialIndicators: finds a legacy BTC address');
assert(EV.extractFinancialIndicators('send to bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq').indexOf('crypto_wallet_btc') !== -1, 'extractFinancialIndicators: finds a bech32 BTC address');
assert(EV.extractFinancialIndicators('send to 0x742d35Cc6634C0532925a3b844Bc454e4438f44e').indexOf('crypto_wallet_eth') !== -1, 'extractFinancialIndicators: finds an ETH address');
assert(EV.extractFinancialIndicators('please buy an Amazon gift card').indexOf('gift_card_request') !== -1, 'extractFinancialIndicators: finds a gift-card-brand mention');
(function () {
  var found = EV.extractFinancialIndicators('IBAN: GB29NWBK60161331926819 and please buy an Amazon gift card');
  assert(found.length === 2 && found.indexOf('iban') !== -1 && found.indexOf('gift_card_request') !== -1,
    'extractFinancialIndicators: finds multiple distinct indicator types in one body (' + JSON.stringify(found) + ')');
})();

// ---- registrableDomain / domainsAlign (DMARC-style organizational-domain alignment) ----
assert(h.registrableDomain('example.com') === 'example.com', 'registrableDomain: a bare 2-label domain is unchanged');
assert(h.registrableDomain('mail.example.com') === 'example.com', 'registrableDomain: strips a subdomain down to the registrable domain');
assert(h.registrableDomain('a.b.c.example.com') === 'example.com', 'registrableDomain: strips multiple levels of subdomain');
assert(h.registrableDomain('mail.example.co.uk') === 'example.co.uk', 'registrableDomain: recognizes a two-label public suffix (co.uk) and keeps 3 labels');
assert(h.registrableDomain('example.co.uk') === 'example.co.uk', 'registrableDomain: a bare 3-label co.uk domain is unchanged');
assert(h.registrableDomain('') === '', 'registrableDomain: empty input -> empty string, no throw');
assert(h.domainsAlign('mail.example.com', 'support.example.com') === true, 'domainsAlign: two different subdomains of the same domain align');
assert(h.domainsAlign('mail.example.co.uk', 'billing.example.co.uk') === true, 'domainsAlign: subdomains of a co.uk domain align');
assert(h.domainsAlign('example.com', 'example.com') === true, 'domainsAlign: identical domains align');
assert(h.domainsAlign('example.com', 'evil-example.com') === false, 'domainsAlign: a different registered domain does not align, even if it looks similar');
assert(h.domainsAlign('mail.example.com', 'mail.example.co.uk') === false, 'domainsAlign: same subdomain label but different registered domain does not align');
assert(h.domainsAlign('', 'example.com') === false, 'domainsAlign: empty input on either side -> false, no throw');
assert(h.domainsAlign(null, null) === false, 'domainsAlign: null input -> false, no throw');

// ---- matchesCategoryKeyword ----
assert(h.matchesCategoryKeyword('bit.ly', 'bit.ly') === true, 'matchesCategoryKeyword: exact substring match');
assert(h.matchesCategoryKeyword('sub.bit.ly', 'bit.ly') === true, 'matchesCategoryKeyword: substring match works on a subdomain too');
assert(h.matchesCategoryKeyword('BIT.LY', 'bit.ly') === true, 'matchesCategoryKeyword: case-insensitive');
assert(h.matchesCategoryKeyword('example.com', 'bit.ly') === false, 'matchesCategoryKeyword: no match when the keyword is absent');
assert(h.matchesCategoryKeyword('evil.xyz', '.xyz') === true, 'matchesCategoryKeyword: a "." prefixed keyword matches as a TLD/suffix');
assert(h.matchesCategoryKeyword('xyz-corp.com', '.xyz') === false, 'matchesCategoryKeyword: a "." prefixed keyword does NOT match a mere substring elsewhere in the domain');
assert(h.matchesCategoryKeyword('', 'bit.ly') === false, 'matchesCategoryKeyword: empty domain -> false, no throw');
assert(h.matchesCategoryKeyword('example.com', '') === false, 'matchesCategoryKeyword: empty keyword -> false, no throw');

// Regression for a real shipped bug: a domain-shaped keyword (contains a ".") must be anchored
// (exact domain or a real subdomain of it), not a raw substring match -- "t.co" as a plain substring
// check "matched" microsoft.com/target.com/walmart.com/etc, since they all happen to contain the four
// characters "t.co" right before their own ".com". A bare (no ".") keyword keeps substring semantics.
assert(h.matchesCategoryKeyword('microsoft.com', 't.co') === false, 'matchesCategoryKeyword: domain-shaped keyword "t.co" no longer false-positives on microsoft.com');
assert(h.matchesCategoryKeyword('target.com', 't.co') === false, 'matchesCategoryKeyword: domain-shaped keyword "t.co" no longer false-positives on target.com');
assert(h.matchesCategoryKeyword('walmart.com', 't.co') === false, 'matchesCategoryKeyword: domain-shaped keyword "t.co" no longer false-positives on walmart.com');
assert(h.matchesCategoryKeyword('t.co', 't.co') === true, 'matchesCategoryKeyword: exact domain-shaped keyword still matches itself');
assert(h.matchesCategoryKeyword('sub.t.co', 't.co') === true, 'matchesCategoryKeyword: domain-shaped keyword still matches a real subdomain');
assert(h.matchesCategoryKeyword('mailbox.com', 'box.com') === false, 'matchesCategoryKeyword: domain-shaped keyword "box.com" no longer false-positives on mailbox.com');
assert(h.matchesCategoryKeyword('inbox.com', 'box.com') === false, 'matchesCategoryKeyword: domain-shaped keyword "box.com" no longer false-positives on inbox.com');
assert(h.matchesCategoryKeyword('box.com', 'box.com') === true, 'matchesCategoryKeyword: exact domain-shaped keyword "box.com" still matches itself');
assert(h.matchesCategoryKeyword('files.box.com', 'box.com') === true, 'matchesCategoryKeyword: domain-shaped keyword "box.com" still matches a real subdomain');
assert(h.matchesCategoryKeyword('myinvoice.com', 'invoice') === true, 'matchesCategoryKeyword: a bare (no ".") keyword keeps plain substring matching');

// ---- domainCategoriesFor ----
(function () {
  var categories = [
    { name: 'URL Shortener', keywords: ['bit.ly', 'tinyurl.com'] },
    { name: 'Suspicious TLD', keywords: ['.xyz'] }
  ];
  assert(JSON.stringify(h.domainCategoriesFor('bit.ly', categories)) === JSON.stringify(['URL Shortener']),
    'domainCategoriesFor: matches the right single category');
  assert(JSON.stringify(h.domainCategoriesFor('phish.xyz', categories)) === JSON.stringify(['Suspicious TLD']),
    'domainCategoriesFor: matches a TLD-style category');
  assert(JSON.stringify(h.domainCategoriesFor('example.com', categories)) === JSON.stringify([]),
    'domainCategoriesFor: no match -> empty array');
  assert(JSON.stringify(h.domainCategoriesFor('', categories)) === JSON.stringify([]), 'domainCategoriesFor: empty domain -> empty array, no throw');
})();

// ---- EV.extractDomainLikeTokens ----
(function () {
  var found = EV.extractDomainLikeTokens('Please visit example.com or mail.example.co.uk for details, not a bare word.');
  assert(found.indexOf('example.com') !== -1 && found.indexOf('mail.example.co.uk') !== -1,
    'extractDomainLikeTokens: finds multiple distinct domain-like tokens in free text (' + JSON.stringify(found) + ')');
  assert(EV.extractDomainLikeTokens('').length === 0, 'extractDomainLikeTokens: empty input -> empty array');
  assert(EV.extractDomainLikeTokens('just some ordinary words with no domains').length === 0,
    'extractDomainLikeTokens: plain text with no dots -> empty array');
})();

// ---- EV.categorizeEmailDomains ----
(function () {
  var categories = [{ name: 'URL Shortener', keywords: ['bit.ly'] }, { name: 'Social Media', keywords: ['facebook.com'] }];
  var matched = EV.categorizeEmailDomains(['bit.ly', 'unrelated.com'], categories);
  assert(JSON.stringify(matched) === JSON.stringify(['URL Shortener']), 'categorizeEmailDomains: matches from a list of domain sources (' + JSON.stringify(matched) + ')');
  var none = EV.categorizeEmailDomains(['unrelated.com'], categories);
  assert(none.length === 0, 'categorizeEmailDomains: no matches -> empty array');
  var empty = EV.categorizeEmailDomains(['bit.ly'], []);
  assert(empty.length === 0, 'categorizeEmailDomains: empty category list -> empty array, no throw');
  var deduped = EV.categorizeEmailDomains(['bit.ly', 'sub.bit.ly'], categories);
  assert(JSON.stringify(deduped) === JSON.stringify(['URL Shortener']), 'categorizeEmailDomains: a category matched by multiple domains appears only once (' + JSON.stringify(deduped) + ')');
})();

print('---');
print('PASS: ' + pass + '  FAIL: ' + fail);
if (fail > 0) throw new Error(fail + ' test(s) failed');
