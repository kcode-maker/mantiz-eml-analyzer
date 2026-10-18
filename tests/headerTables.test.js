/**
 * headerTables.test.js — js/parsing/headerTables.js: Authentication-Results and Received parsed into structured rows
 * for the Headers tab's tables, tolerant of the many real-world formats (Google, Microsoft, Postfix, ARC, "none",
 * comments containing semicolons, IPv6) and bounded on hostile input. Run via tests/run-all.sh, or directly:
 * jsc tests/headerTables.test.js (from the repo root).
 */
load('tests/helpers/textdecoder_polyfill.js');
load('js/parsing/emlParser.js');
load('js/parsing/headerTables.js');
var EV = this.EV;
var pass = 0, fail = 0;
function assert(cond, label) { if (cond) pass++; else { fail++; print('FAIL: ' + label); } }
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function res(r, method) { return r.results.filter(function (x) { return x.method === method; })[0]; }
function prop(r, key) { var p = r.props.filter(function (x) { return x.key === key; })[0]; return p && p.value; }

// ================= Authentication-Results =================
var fx = 'mx.example.org; spf=fail smtp.mailfrom=security@paypa1-verify.example; dkim=fail (bad signature) header.d=paypa1-verify.example; dmarc=fail (p=REJECT sp=REJECT) header.from=paypa1-verify.example';
var a = EV.parseAuthResults(fx);
assert(a.authservId === 'mx.example.org' && a.results.length === 3, 'the fixture header: server id + three results (' + a.results.length + ')');
assert(res(a, 'spf').result === 'fail' && prop(res(a, 'spf'), 'smtp.mailfrom') === 'security@paypa1-verify.example', 'spf=fail with its smtp.mailfrom property');
assert(res(a, 'dkim').result === 'fail' && res(a, 'dkim').comment === 'bad signature' && prop(res(a, 'dkim'), 'header.d') === 'paypa1-verify.example', 'dkim=fail keeps its (bad signature) comment and header.d');
assert(res(a, 'dmarc').comment === 'p=REJECT sp=REJECT' && prop(res(a, 'dmarc'), 'header.from') === 'paypa1-verify.example', 'dmarc=fail keeps the policy comment and header.from');
assert(a.raw === fx, 'the raw text is always kept');

var google = 'mx.google.com; dkim=pass header.i=@example.com header.s=sel1 header.b=AbCdEf12; spf=pass (google.com: domain of bob@example.com designates 203.0.113.5 as permitted sender) smtp.mailfrom=bob@example.com; dmarc=pass (p=NONE sp=NONE dis=NONE) header.from=example.com';
a = EV.parseAuthResults(google);
assert(a.results.length === 3 && eq(a.results.map(function (r) { return r.method; }), ['dkim', 'spf', 'dmarc']) && a.results.every(function (r) { return r.result === 'pass'; }), 'a Google-style header: three passes in order');
assert(prop(res(a, 'dkim'), 'header.s') === 'sel1' && res(a, 'spf').comment.indexOf('designates 203.0.113.5') !== -1, 'properties and the long spf comment are kept');

a = EV.parseAuthResults('mx.example.net; spf=softfail (sender policy: probably not permitted; mx.example.net: transitioning) smtp.mailfrom=a@b.c; dkim=none');
assert(a.results.length === 2 && res(a, 'spf').result === 'softfail' && /transitioning/.test(res(a, 'spf').comment), 'a semicolon INSIDE a comment does not split the result');
assert(res(a, 'dkim').result === 'none', 'dkim=none');
a = EV.parseAuthResults('mx.example.net; dkim=fail reason="signature verification failed; body hash did not verify" header.d=x.com');
assert(res(a, 'dkim').result === 'fail' && prop(res(a, 'dkim'), 'reason') === 'signature verification failed; body hash did not verify' && prop(res(a, 'dkim'), 'header.d') === 'x.com', 'a quoted reason with a semicolon is one property');
a = EV.parseAuthResults('mx.example.net 1; spf=pass smtp.mailfrom=x@y.z');
assert(a.authservId === 'mx.example.net' && a.version === '1', 'the optional version number after the server id');
a = EV.parseAuthResults('mx.example.net; none');
assert(a.authservId === 'mx.example.net' && a.results.length === 1 && a.results[0].method === '' && a.results[0].result === 'none', '"none" becomes a single readable row');
a = EV.parseAuthResults('i=2; mx.google.com; arc=pass; spf=pass smtp.remote-ip=1.2.3.4');
assert(a.instance === 2 && a.authservId === 'mx.google.com' && res(a, 'arc').result === 'pass' && prop(res(a, 'spf'), 'smtp.remote-ip') === '1.2.3.4', 'ARC-Authentication-Results: the i=N instance tag is understood');
a = EV.parseAuthResults('MX.EXAMPLE.ORG;   SPF=Pass   smtp.mailfrom=a@b.c  ;  DKIM=PASS ');
assert(res(a, 'spf').result === 'pass' && res(a, 'dkim').result === 'pass', 'method and result are case-insensitive, extra spaces tolerated');
a = EV.parseAuthResults('mx.example.net; this is not a result at all; spf=pass');
assert(a.results.length === 2 && a.results[0].result === 'this is not a result at all' && res(a, 'spf').result === 'pass', 'unparseable segments are kept as text, never dropped');
a = EV.parseAuthResults('');
assert(a.results.length === 0 && a.raw === '', 'an empty value is fine');
var noThrow = true; try { EV.parseAuthResults(null); EV.parseAuthResults(undefined); EV.parseAuthResults('((((;;;;====\"\"\"'); EV.parseAuthResults('x; ' + 'spf=pass;'.repeat(5000)); } catch (e) { noThrow = false; }
assert(noThrow, 'null, undefined, garbage and a 5000-segment header never throw');
assert(EV.parseAuthResults('x; ' + 'spf=pass;'.repeat(5000)).results.length <= 65, 'a hostile header is bounded to a fixed number of rows');
assert(EV.authResultClass('pass') === 'ok' && EV.authResultClass('FAIL') === 'flag' && EV.authResultClass('hardfail') === 'flag', 'pass is ok, fail is a flag');
assert(['softfail', 'neutral', 'none', 'policy', 'temperror', 'permerror', 'weird'].every(function (r) { return EV.authResultClass(r) === 'note'; }), 'everything else is a note');

// ================= Received =================
var r = EV.parseReceived('from spoofed-relay.badnet.example (unknown [198.51.100.77]) by mx.example.org with ESMTP id hop2; Fri, 16 Feb 2024 03:22:10 -0500');
assert(r.from === 'spoofed-relay.badnet.example' && r.fromIp === '198.51.100.77' && r.by === 'mx.example.org' && r.with === 'ESMTP' && r.id === 'hop2', 'a basic hop: from / ip / by / with / id');
assert(r.dateMs === Date.parse('Fri, 16 Feb 2024 03:22:10 -0500') && r.dateText === 'Fri, 16 Feb 2024 03:22:10 -0500', 'the date after the last semicolon is parsed');
r = EV.parseReceived('from mail-out.example (mail-out.example [192.0.2.55]) by relay.example with SMTP id hop1 for <victim@example.org>; Fri, 16 Feb 2024 03:22:05 -0500');
assert(r.fromIp === '192.0.2.55' && r.forAddr === 'victim@example.org' && r.with === 'SMTP', '"for <addr>" is captured');
r = EV.parseReceived('from BN8PR12MB1234.namprd12.prod.outlook.com (2603:10b6:408:1::2) by CH2PR12MB5555.namprd12.prod.outlook.com with Microsoft SMTP Server (version=TLS1_2, cipher=TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384) id 15.20.7339.22; Mon, 1 Jan 2024 10:00:00 +0000');
assert(r.from === 'BN8PR12MB1234.namprd12.prod.outlook.com' && r.with === 'Microsoft SMTP Server' && r.id === '15.20.7339.22' && r.fromIp === '2603:10b6:408:1::2', 'a Microsoft-style hop keeps "Microsoft SMTP Server" and finds the bare IPv6 in the comment');
r = EV.parseReceived('from mail-wr1-f41.google.com (mail-wr1-f41.google.com [209.85.221.41]) by mx.example.org (Postfix) with ESMTPS id 4F2A1; Mon, 1 Jan 2024 10:00:00 +0000');
assert(r.from === 'mail-wr1-f41.google.com' && r.fromIp === '209.85.221.41' && r.with === 'ESMTPS' && r.by === 'mx.example.org', 'a Postfix hop with a (Postfix) comment after "by"');
r = EV.parseReceived('by 2002:a05:6a10:1 with SMTP id abc123; Mon, 1 Jan 2024 10:00:00 +0000');
assert(r.from === '' && r.by === '2002:a05:6a10:1' && r.with === 'SMTP' && r.id === 'abc123', 'a hop with no "from" (the originating server) still parses');
r = EV.parseReceived('from x ([IPv6:2001:db8::1]) by y with ESMTP; Mon, 1 Jan 2024 10:00:00 +0000');
assert(r.fromIp === '2001:db8::1', 'bracketed IPv6');
r = EV.parseReceived('totally unparseable text');
assert(r.from === '' && r.by === '' && r.dateMs === null && r.raw === 'totally unparseable text', 'garbage keeps its raw text and parses to empty fields');
r = EV.parseReceived('from a by b; not a date at all');
assert(r.dateMs === null && r.dateText === 'not a date at all', 'an unparseable date keeps the text, with no timestamp');
assert(EV.parseReceived(null).raw === '' && EV.parseReceived(undefined).from === '', 'null / undefined are safe');

// ---- chain order and delays ----
function parsed(h) { return EV.parseEml(new Uint8Array(h.join('\r\n').split('').map(function (c) { return c.charCodeAt(0) & 255; })).buffer); }
var p = parsed(['Received: from c by d; Mon, 1 Jan 2024 10:00:30 +0000', 'Received: from b by c; Mon, 1 Jan 2024 10:00:10 +0000', 'Received: from a by b; Mon, 1 Jan 2024 10:00:00 +0000', 'From: x@y.z', 'Subject: s', '', 'body']);
var chain = EV.receivedChain(p.headers);
assert(chain.length === 3 && eq(chain.map(function (h) { return h.from; }), ['a', 'b', 'c']), 'the chain is shown ORIGIN FIRST (headers are newest-first)');
assert(eq(chain.map(function (h) { return h.index; }), [1, 2, 3]), 'hops are numbered from the origin');
assert(chain[0].delayMs === null && chain[1].delayMs === 10000 && chain[2].delayMs === 20000, 'each hop carries its delay since the previous one (' + chain.map(function (h) { return h.delayMs; }).join(',') + ')');
p = parsed(['Received: from c by d; Mon, 1 Jan 2024 10:00:00 +0000', 'Received: from b by c; Mon, 1 Jan 2024 11:30:00 +0000', 'Received: from a by b; Mon, 1 Jan 2024 09:00:00 +0000', 'From: x@y.z', '', 'b']);
chain = EV.receivedChain(p.headers);
assert(chain[2].delayMs === -5400000 && EV.formatDelay(chain[2].delayMs) === '-1h 30m', 'a hop earlier than the one before it has a NEGATIVE delay (time travel): ' + EV.formatDelay(chain[2].delayMs));
assert(EV.receivedChain([]).length === 0 && EV.receivedChain(null).length === 0, 'no Received headers -> empty chain');
var many = []; for (var i = 0; i < 300; i++) many.push('Received: from h' + i + ' by h' + (i + 1) + '; Mon, 1 Jan 2024 10:00:00 +0000');
assert(EV.receivedChain(parsed(many.concat(['From: a@b.c', '', 'x'])).headers).length === 100, 'a 300-hop chain is bounded to 100 rows');

// ---- chain integrity: is each hop's "from" the previous hop's "by"? ----
function chainOf(hops) { return EV.analyzeChain(EV.receivedChain(parsed(hops.concat(['From: x@y.z', '', 'b'])).headers)); }
var intact = chainOf([
  'Received: from mail.example.com (mail.example.com [198.51.100.5]) by mx.recipient.org with ESMTPS id 2; Mon, 1 Jan 2024 10:00:02 +0000',
  'Received: from client.example.com (client.example.com [203.0.113.9]) by mail.example.com with ESMTPSA id 1; Mon, 1 Jan 2024 10:00:00 +0000']);
assert(intact.links.length === 1 && intact.links[0].handoff === 'ok' && !intact.links[0].timeTravel && intact.broken === 0 && intact.timeTravel === 0, 'an intact two-hop chain: the second hop received from the first hop\'s receiver');
assert(intact.totalMs === 2000 && intact.links[0].delayMs === 2000 && intact.links[0].from === 1 && intact.links[0].to === 2, 'links carry their hop numbers, delay and the chain a total transit time');
var broken = chainOf([
  'Received: from mail.evil.org (mail.evil.org [1.2.3.4]) by mx.recipient.org with ESMTP id 2; Mon, 1 Jan 2024 10:00:05 +0000',
  'Received: from client.example.com (client.example.com [203.0.113.9]) by relay.alpha.net with ESMTPSA id 1; Mon, 1 Jan 2024 10:00:00 +0000']);
assert(broken.links[0].handoff === 'broken' && broken.broken === 1 && /relay\.alpha\.net/.test(broken.links[0].reasons[0]) && /mail\.evil\.org/.test(broken.links[0].reasons[0]), 'a hop that received from a host unrelated to the previous receiver is BROKEN, and says why: ' + broken.links[0].reasons[0]);
var unrelatedButSameOrg = chainOf([
  'Received: from mail-out.google.com (mail-out.google.com [209.85.1.1]) by mx.recipient.org with ESMTPS id 2; Mon, 1 Jan 2024 10:00:05 +0000',
  'Received: from client.example.com (client.example.com [203.0.113.9]) by smtp.google.com with ESMTPSA id 1; Mon, 1 Jan 2024 10:00:00 +0000']);
assert(unrelatedButSameOrg.links[0].handoff === 'ok', 'different hostnames in the same organisation (smtp.google.com -> mail-out.google.com) are NOT broken');
var viaComment = chainOf([
  'Received: from unknown (HELO mx1.example.org) ([192.0.2.7]) by final.recipient.net with SMTP id 2; Mon, 1 Jan 2024 10:00:05 +0000',
  'Received: from client.other.net (client.other.net [203.0.113.9]) by mx1.example.org with ESMTP id 1; Mon, 1 Jan 2024 10:00:00 +0000']);
assert(viaComment.links[0].handoff === 'ok', 'a useless "from unknown" is fine when the previous receiver is named in the (comment)');
var unknownLocal = chainOf([
  'Received: from mx.recipient.org (mx.recipient.org [198.51.100.5]) by final.recipient.org with ESMTP id 2; Mon, 1 Jan 2024 10:00:05 +0000',
  'Received: from client.example.com (client.example.com [203.0.113.9]) by localhost with ESMTPSA id 1; Mon, 1 Jan 2024 10:00:00 +0000']);
assert(unknownLocal.links[0].handoff === 'unknown' && unknownLocal.broken === 0, 'a hop that delivered to "localhost" cannot be compared: unknown, not broken');
var noFrom = chainOf([
  'Received: by mx.recipient.org with SMTP id 2; Mon, 1 Jan 2024 10:00:05 +0000',
  'Received: by relay.alpha.net with SMTP id 1; Mon, 1 Jan 2024 10:00:00 +0000']);
assert(noFrom.links[0].handoff === 'unknown', 'hops with no "from" at all cannot be compared: unknown');
var tt = chainOf([
  'Received: from b (b.example.com [1.1.1.1]) by c.example.com; Mon, 1 Jan 2024 10:00:00 +0000',
  'Received: from a (a.example.com [2.2.2.2]) by b.example.com; Mon, 1 Jan 2024 11:30:00 +0000']);
assert(tt.links[0].timeTravel === true && tt.timeTravel === 1 && /EARLIER/.test(tt.links[0].reasons.join(' ')), 'a hop stamped before the previous one is time travel');
var skew = chainOf([
  'Received: from b (b.example.com [1.1.1.1]) by c.example.com; Mon, 1 Jan 2024 10:00:00 +0000',
  'Received: from a (a.example.com [2.2.2.2]) by b.example.com; Mon, 1 Jan 2024 10:02:00 +0000']);
assert(skew.links[0].timeTravel === false, 'two minutes of clock skew is not time travel');
assert(chainOf([]).links.length === 0 && chainOf(['Received: from a by b; Mon, 1 Jan 2024 10:00:00 +0000']).links.length === 0, 'no hops or one hop: no links');
assert(EV.hopsConnect(null, null) === 'unknown' && EV.hopsConnect({}, {}) === 'unknown', 'missing data is unknown, never an exception');

// ---- delay formatting ----
assert(EV.formatDelay(0) === '+0s' && EV.formatDelay(5000) === '+5s' && EV.formatDelay(-5000) === '-5s', 'seconds');
assert(EV.formatDelay(123000) === '+2m 3s' && EV.formatDelay(3840000) === '+1h 4m', 'minutes and hours');
assert(EV.formatDelay(90000000) === '+1d 1h' && EV.formatDelay(null) === '' && EV.formatDelay(NaN) === '', 'days, and unknown');


// ================= forged-header evidence: must find real forgeries AND stay silent on real-world layouts =================
function H(lines) { // header lines top-to-bottom -> the parser's header objects
  return lines.map(function (l) { var i = l.indexOf(':'); var n = l.slice(0, i); return { name: n, lower: n.toLowerCase(), value: l.slice(i + 1).trim() }; });
}
function ids(lines) { return EV.analyzeHeaderForgery(H(lines)).findings.map(function (f) { return f.id; }); }

// no authserv-id (Exchange Online style) is not mistaken for one
a = EV.parseAuthResults('spf=pass (sender IP is 1.2.3.4) smtp.mailfrom=a.com; dkim=pass (signature was verified) header.d=a.com; dmarc=pass action=none header.from=a.com');
assert(a.authservId === '' && a.results.length === 3 && res(a, 'spf').result === 'pass', 'Authentication-Results with no server id: three results, empty id');

// FALSE-POSITIVE GUARDS
assert(eq(ids(['Authentication-Results: mx.google.com; spf=pass smtp.mailfrom=a@b.com; dmarc=pass', 'Received: from mail-sor-f41.google.com (mail-sor-f41.google.com. [209.85.220.41]) by mx.google.com with SMTPS; Mon, 1 Jan 2024 10:00:00 +0000']), []), 'a normal single Authentication-Results above the Received is silent');
assert(eq(ids(['Received: from mail-sor-f41.google.com (mail-sor-f41.google.com. [209.85.220.41]) by mx.google.com with SMTPS; Mon, 1 Jan 2024 10:00:00 +0000', 'Authentication-Results: mx.google.com; spf=pass smtp.mailfrom=a@b.com']), []), 'Gmail layout (Authentication-Results just under the Received it belongs to) is silent: its id is the hop\'s receiver');
assert(eq(ids(['Authentication-Results: spf=pass smtp.mailfrom=a.com; dkim=pass', 'Received: from x (x.y.com [1.2.3.4]) by z.outlook.com; Mon, 1 Jan 2024 10:00:00 +0000', 'Authentication-Results: spf=fail smtp.mailfrom=a.com']), []), 'headers without a server id are never judged');
assert(eq(ids(['Authentication-Results: mx.a.com; spf=pass', 'Received: from x (x.q.org [1.1.1.1]) by mx.a.com; Mon, 1 Jan 2024 10:00:00 +0000', 'Authentication-Results: mx.b.org; spf=fail', 'Received: from y (y.q.org [2.2.2.2]) by mx.b.org; Mon, 1 Jan 2024 09:59:00 +0000']), []), 'different servers with different results (forwarding) are NOT a conflict');
assert(eq(ids(['Received: from a by b.example.com; Mon, 1 Jan 2024 10:00:00 +0000']), []) && eq(ids([]), []), 'no auth headers / no headers: nothing');
assert(eq(ids(['Authentication-Results: mx.recv.net; spf=pass', 'Authentication-Results: mx.recv.net; spf=pass']), []), 'two identical headers from one server do not disagree: not reported');

// REAL FORGERIES
assert(eq(ids(['Authentication-Results: mx.recv.net; spf=fail smtp.mailfrom=a.com; dmarc=fail', 'Authentication-Results: mx.recv.net; spf=pass smtp.mailfrom=a.com; dmarc=pass']), ['auth-results-conflict']), 'one server, two disagreeing results: conflict');
var planted = EV.analyzeHeaderForgery(H([
  'Received: from relay.q.org (relay.q.org [1.2.3.4]) by mx.recv.net; Mon, 1 Jan 2024 10:00:00 +0000',
  'Authentication-Results: mx.recv.net; spf=fail',
  'From: x@y.com',
  'Authentication-Results: mx.trusted-bank.com; spf=pass; dkim=pass; dmarc=pass'])).findings;
assert(planted.length === 1 && planted[0].id === 'auth-results-planted' && /trusted-bank\.com/.test(planted[0].title), 'an Authentication-Results below the oldest Received naming a server no hop was received by: planted');
assert(eq(ids(['Received: from a by mx.recv.net; Mon, 1 Jan 2024 10:00:00 +0000', 'Authentication-Results: mail.recv.net; spf=pass']), []), 'below the Received but the same organization as a receiving hop: not reported');

// ================= private IPs + internal/external =================
assert(['10.1.2.3', '172.16.0.1', '172.31.255.1', '192.168.1.1', '127.0.0.1', '169.254.1.1', '::1', 'fd12:3456::1', 'fe80::1'].every(EV.isPrivateIp), 'private/loopback/link-local/ULA addresses');
assert(['8.8.8.8', '172.32.0.1', '172.15.0.1', '203.0.113.9', '2001:db8::1', '', null].every(function (x) { return !EV.isPrivateIp(x); }), 'public and empty are not private');

function mailOf(lines) { return { headers: H(lines), from: [{ address: (/^From:.*<(.+)>/m.exec(lines.join('\n')) || [])[1] || 'ceo@corp.example' }] }; }
var mine = ['corp.example', 'corp.net'];
function origin(lines, list) { return EV.classifyOrigin(mailOf(lines), list === undefined ? mine : list).state; }
var F = 'From: CEO <ceo@corp.example>';
assert(origin([F], []) === 'unconfigured', 'no organization domains: no verdict');
assert(origin(['From: P <p@paypal.com>', 'Received: from a (a.paypal.com [64.4.1.1]) by mx.corp.example; Mon, 1 Jan 2024 10:00:00 +0000']) === 'external', 'a sender outside your domains is external');
assert(origin([F, 'Received: from mail.corp.example (mail.corp.example [10.0.0.5]) by mx.corp.example; Mon, 1 Jan 2024 10:00:00 +0000', 'Received: from pc1 (pc1.corp.example [10.0.0.77]) by mail.corp.example; Mon, 1 Jan 2024 09:59:58 +0000']) === 'internal', 'sender is yours and the first hop is a private address: internal');
assert(origin([F]) === 'unverified', 'your domain but no Received headers: cannot confirm');
assert(origin([F, 'Received: from evil (evil.example.ru [185.220.1.1]) by mx.corp.example; Mon, 1 Jan 2024 10:00:00 +0000']) === 'claims-internal', 'your domain, first hop a public foreign address, nothing authenticates it: claims-internal');
assert(origin([F, 'Authentication-Results: mx.corp.example; dmarc=pass header.from=corp.example', 'Received: from sa1.protection.outlook.com (sa1.protection.outlook.com [40.107.1.1]) by mx.corp.example; Mon, 1 Jan 2024 10:00:00 +0000']) === 'internal', 'cloud mail from a public IP that passes DMARC for your domain stays internal (no false alarm)');
assert(origin([F, 'X-MS-Exchange-Organization-AuthAs: Internal', 'Received: from sa1.protection.outlook.com (sa1.protection.outlook.com [40.107.1.1]) by mx.corp.example; Mon, 1 Jan 2024 10:00:00 +0000']) === 'internal', 'Exchange AuthAs=Internal stays internal');
assert(origin([F, 'Received: from relay.corp.net (relay.corp.net [203.0.113.7]) by mx.corp.example; Mon, 1 Jan 2024 10:00:00 +0000']) === 'internal', 'a first hop named under your own domain is yours even on a public address');
assert(origin(['From: S <s@sub.corp.example>', 'Received: from pc (pc [192.168.0.9]) by mx.corp.example; Mon, 1 Jan 2024 10:00:00 +0000']) === 'internal', 'a subdomain of your domain counts');
assert(origin(['From: S <s@notcorp.example>', 'Received: from pc (pc [192.168.0.9]) by mx.corp.example; Mon, 1 Jan 2024 10:00:00 +0000']) === 'external', 'a look-alike that merely ends with the same letters is not yours');
assert(EV.classifyOrigin(null, mine).state === 'external' && EV.classifyOrigin({}, null).state === 'unconfigured', 'bad input never throws');


// ================= sender IPs, timing and the hop table =================
function hopsOf(lines) { return EV.receivedChain(parsed(lines.concat(['From: x@y.z', '', 'b'])).headers); }
var R = function (from, ip, by, time) { return 'Received: from ' + from + ' (' + from + ' [' + ip + ']) by ' + by + '; ' + time; };
var T = function (s) { return 'Mon, 1 Jan 2024 10:00:' + (s < 10 ? '0' : '') + s + ' +0000'; };
var o = EV.originOf(hopsOf([R('mx.b.org', '198.51.100.7', 'in.c.net', T(9)), R('mail.a.com', '203.0.113.9', 'mx.b.org', T(5))]));
assert(o.origin.ip === '203.0.113.9' && o.origin.hop === 1 && o.connecting.ip === '198.51.100.7' && o.connecting.hop === 2 && !o.internalOnly, 'origin = earliest public IP, connecting = newest public IP (the one the receiving side recorded)');
o = EV.originOf(hopsOf([R('a.example.com', '203.0.113.9', 'b.example.com', T(5))]));
assert(o.origin.ip === '203.0.113.9' && o.connecting.ip === '203.0.113.9', 'a single public hop is both');
o = EV.originOf(hopsOf([R('mail.example.org', '198.51.100.7', 'in.corp.example', T(9)), R('pc.corp.example', '192.168.1.20', 'mail.example.org', T(5))]));
assert(o.origin.ip === '198.51.100.7' && o.connecting.ip === '198.51.100.7', 'a private first hop (the sender\'s own LAN) is skipped: the origin is the first public address');
o = EV.originOf(hopsOf([R('relay.corp.example', '10.0.0.5', 'mx.corp.example', T(9)), R('pc.corp.example', '10.0.0.77', 'relay.corp.example', T(5))]));
assert(o.origin === null && o.connecting === null && o.internalOnly === true, 'every hop private: no public IP, flagged as internal-only');
o = EV.originOf(hopsOf(['Received: from a by b; ' + T(5)]));
assert(o.origin === null && o.connecting === null && o.internalOnly === false, 'hops without any IP: nothing to report');
o = EV.originOf(hopsOf([R('x.example.com', '2001:db8::25', 'mx.example.net', T(5))]));
assert(o.origin.ip === '2001:db8::25', 'an IPv6 address counts');
o = EV.originOf(hopsOf([R('loop.example.com', '::1', 'mx.example.net', T(5))]));
assert(o.origin === null && o.internalOnly === true, 'IPv6 loopback is private');
assert(EV.originOf([]).origin === null && EV.originOf(null).origin === null && EV.originOf([{ fromIp: 'unknown-host' }]).origin === null, 'empty / null / non-IP text never throws and reports nothing');

var tm = EV.chainTiming(EV.analyzeChain(hopsOf([R('c.org', '198.51.100.3', 'd.org', T(30)), R('b.org', '198.51.100.2', 'c.org', T(12)), R('a.org', '198.51.100.1', 'b.org', T(10))])));
assert(tm.links.length === 2 && tm.links[0].ms === 2000 && tm.links[1].ms === 18000 && tm.slowest.from === 2 && tm.slowest.to === 3 && tm.maxMs === 18000 && tm.negatives === 0, 'timing lists each gap and names the slowest');
var day = EV.chainTiming(EV.analyzeChain(hopsOf(['Received: from b.org (b.org [198.51.100.2]) by c.org; Tue, 2 Jan 2024 12:00:00 +0000', 'Received: from a.org (a.org [198.51.100.1]) by b.org; Mon, 1 Jan 2024 10:00:00 +0000'])));
assert(day.maxMs === 26 * 3600 * 1000 && EV.formatDelay(day.maxMs) === '+1d 2h', 'a 26-hour hold is 26 hours (days are kept, not dropped)');
var neg = EV.chainTiming(EV.analyzeChain(hopsOf([R('b.org', '198.51.100.2', 'c.org', T(1)), R('a.org', '198.51.100.1', 'b.org', T(50))])));
assert(neg.negatives === 1 && neg.links[0].ms === -49000 && neg.slowest === null, 'a hop stamped before the one it follows stays NEGATIVE (not clamped to zero) and is never "slowest"');
assert(EV.chainTiming(null).links.length === 0 && EV.chainTiming({}).slowest === null, 'no analysis: empty, no throw');
var undated = EV.chainTiming(EV.analyzeChain(hopsOf(['Received: from b.org (b.org [198.51.100.2]) by c.org', 'Received: from a.org (a.org [198.51.100.1]) by b.org'])));
assert(undated.links.length === 0, 'hops without timestamps produce no timing');

var tsv = EV.hopTableText(hopsOf([R('mx.b.org', '198.51.100.7', 'in.c.net', T(9)), R('mail.a.com', '203.0.113.9', 'mx.b.org', T(5))])).split('\n');
assert(tsv.length === 3 && tsv[0] === '#\tFrom\tIP\tBy\tWith\tTime\tDelay' && /^1\tmail\.a\.com\t203\.0\.113\.9\tmx\.b\.org\t/.test(tsv[1]) && /\t\+4s$/.test(tsv[2]), 'the hop table is TSV, oldest hop first, with the delay');
assert(EV.hopTableText([]) === '#\tFrom\tIP\tBy\tWith\tTime\tDelay' && !/\t\t\t\t\t\t\t/.test(EV.hopTableText(null)), 'an empty chain is just the header row');
assert(EV.hopTableText([{ index: 1, from: 'a\tb\nc', fromIp: '1.2.3.4' }]).split('\n')[1].split('\t').length === 7, 'tabs/newlines inside a value cannot break the columns');

print('---');
print('PASS: ' + pass + '  FAIL: ' + fail);
if (fail > 0) throw new Error(fail + ' test(s) failed');
