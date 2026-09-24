/**
 * ruleTemplates.js — the starter rule templates offered in the rule editor's
 * "Start from a template" dropdown. Extracted into its own DOM-free module
 * (previously inline in app.js) specifically so tests/ruleTemplates.test.js
 * can compile-check every template's expression under jsc without a DOM —
 * closing a longstanding coverage gap (these were only ever hand-verified
 * once, never part of the automated suite). Each entry is a plain
 * {name, tag, expression} object; app.js just reads EV.RULE_TEMPLATES.
 */
(function (g) {
  'use strict';
  var EV = g.EV || (g.EV = {});

  EV.RULE_TEMPLATES = [
    { name: 'Sender / Reply-To domain mismatch', tag: 'sender-anomaly',
      expression: 'f.from && f.replyTo && f.from.domain !== f.replyTo.domain' },
    { name: 'Sender / Return-Path domain mismatch', tag: 'return-path-anomaly',
      expression: 'f.from && f.returnPath && f.from.domain !== f.returnPath.domain' },
    { name: 'Sender / Reply-To organizational domain mismatch (subdomain-aware)', tag: 'sender-reply-to-org-mismatch',
      expression: 'f.from && f.replyTo && !h.domainsAlign(f.from.domain, f.replyTo.domain)' },
    { name: 'Sender / Return-Path organizational domain mismatch (subdomain-aware)', tag: 'sender-return-path-org-mismatch',
      expression: 'f.from && f.returnPath && !h.domainsAlign(f.from.domain, f.returnPath.domain)' },
    { name: 'DMARC fail', tag: 'dmarc-fail', expression: "f.dmarc === 'fail'" },
    { name: 'SPF or DKIM fail', tag: 'auth-fail', expression: "f.spf === 'fail' || f.dkim === 'fail'" },
    { name: 'Sender domain looks like a common brand (typosquat)', tag: 'lookalike-domain',
      expression: 'f.from && h.looksLikeAnyDomain(f.from.domain, h.COMMON_BRANDS, 2)' },
    { name: 'Urgency language in subject', tag: 'urgency-subject',
      expression: "h.includesAny(f.subject, ['urgent','verify your account','suspended','action required','password expires'])" },
    { name: 'Executable-looking attachment', tag: 'risky-attachment',
      expression: "h.attachmentExtIn(f.attachments, ['.exe','.scr','.js','.vbs','.bat','.cmd','.jar','.ps1'])" },
    { name: 'Many attachments (possible bulk lure)', tag: 'many-attachments',
      expression: 'f.attachmentCount >= 4' },
    { name: 'Suspicious mail client / header value (regex)', tag: 'suspicious-header',
      expression: "h.matches(f.getHeader('x-mailer'), /bulk|mass ?mail|phish/i)" },
    { name: 'Nested email attachment', tag: 'nested-eml-attachment',
      expression: "h.attachmentExtIn(f.attachments, ['.eml']) || h.anyAttachment(f.attachments, a => a.mimeType === 'message/rfc822')" },
    { name: 'Possible sensitive data (PII) in body', tag: 'possible-pii',
      expression: "h.matches(f.bodyText, /\\b\\d{3}-\\d{2}-\\d{4}\\b/) || h.matches(f.bodyText, /\\b(?:\\d[ -]?){13,19}\\b/) || h.matches(f.bodyText, /\\b[2-9]\\d{3}\\s?\\d{4}\\s?\\d{4}\\b/)" },
    { name: 'Double-extension attachment (e.g. invoice.pdf.exe)', tag: 'dual-extension',
      expression: 'h.anyAttachment(f.attachments, a => h.hasDualExtension(a.filename))' },
    { name: 'Hidden/invisible characters in subject', tag: 'hidden-unicode-subject',
      expression: 'h.hasHiddenUnicode(f.subject)' },
    { name: 'Random-looking token in subject (possible auto-generated lure)', tag: 'random-subject-token',
      expression: "f.subject.split(/\\s+/).some(w => h.looksRandom(w))" },
    { name: 'Display name impersonates a known or trusted brand', tag: 'brand-impersonation',
      expression: 'f.nameMismatch' },
    { name: "Sender domain looks like a typosquat of a trusted domain (yours + common brands)", tag: 'trusted-domain-lookalike',
      expression: 'f.lookalikeDomain' },
    { name: 'Sender domain uses IDN/punycode encoding', tag: 'punycode-sender',
      expression: 'f.punycodeSender' },
    { name: 'High urgency-language score', tag: 'high-urgency-score',
      expression: 'f.urgencyScore >= 3' },
    { name: 'Contains a financial/wire-transfer indicator', tag: 'financial-indicator',
      expression: 'f.financialIndicators.length > 0' },
    { name: 'Combined: urgency language + financial indicator (strong BEC signal)', tag: 'bec-combined-signal',
      expression: 'f.urgencyScore >= 2 && f.financialIndicators.length > 0' },
    // Recipient-count tiers (mass-mail/spray detection) — mutually exclusive ranges over the
    // existing f.recipientCount fact (deduplicated across To/Cc/Bcc), so at most one of these four
    // tags out of a set of thresholds applies to any one email.
    { name: 'Many recipients (25-75)', tag: 'many-recipients-25',
      expression: 'f.recipientCount > 25 && f.recipientCount <= 75' },
    { name: 'Many recipients (75-200)', tag: 'many-recipients-75',
      expression: 'f.recipientCount > 75 && f.recipientCount <= 200' },
    { name: 'Many recipients (200-500)', tag: 'many-recipients-200',
      expression: 'f.recipientCount > 200 && f.recipientCount <= 500' },
    { name: 'Many recipients (500+)', tag: 'many-recipients-500',
      expression: 'f.recipientCount > 500' },
    { name: 'Domain matches a flagged category (Settings-configured)', tag: 'flagged-domain-category',
      expression: 'f.domainCategories.length > 0' }
  ];
})(typeof self !== 'undefined' ? self : this);
