/**
 * searchIndex.js — main-thread decoded search index.
 *
 * Metadata is kept as structure-of-arrays (one flat array per field, indexed
 * by an integer fileId) rather than 500,000 individual objects — meaningfully
 * lighter on the JS heap at large folder sizes. The inverted index itself is
 * a Map<token, number[]> per searchable field, built incrementally from
 * compact per-file docs streamed back from the worker pool (see
 * workerClient.js + indexLogic.js), so the whole folder's raw content is
 * never resident in memory at once — only the resulting postings are kept.
 *
 * Query grammar: bare words (AND), "exact phrase" (verified against the
 * stored subject/from/to text; body/meta phrase matches are "all these
 * words present", not strict adjacency — see HELP.md's Search section for why), and
 * field:value / field:"value" for field in
 * {subject,from,to,url,attachment,tag,meta,header(alias of meta)}.
 *
 * OR and parenthesized grouping are also supported: `expr := andExpr (OR
 * andExpr)*`, OR binds looser than the implicit AND, so `a OR b c` parses
 * as `a OR (b AND c)`; `(from:paypal OR from:amazon) attachments:>0` and
 * `-(from:paypal OR from:ebay)` (negate a whole group) both work. The OR
 * operator is recognized only as the literal all-caps word `OR` — lowercase
 * `or` is always an ordinary search word, never triggers OR-logic, so
 * "cash or check" behaves as a plain 3-word AND, not a surprise. Parsing
 * happens in three steps: a left-to-right tokenizer (see `tokenizeQuery`),
 * a small recursive-descent parser building an AST (`parseTokens`), and a
 * recursive evaluator (`evalNode`) that composes child id-sets via
 * intersect (AND) / union (OR) / complement-against-every-indexed-id (NOT).
 *
 * Numeric fields support comparison operators glued directly onto the
 * value (no space): attachments:>3, attachments:>=3, attachments:3 (exact),
 * size:<2mb, urls:!=0, recipients:>=5. Supported fields: attachments, size
 * (accepts b/kb/mb/gb suffixes, case-insensitive), urls, recipients,
 * duplicates (how many indexed files — including itself — share this file's
 * Message-ID/content id; duplicates:>1 finds every file that's part of a
 * repeated/bulk-sent batch).
 *
 * field:/pattern/i runs a real regex instead of tokenized substring
 * matching, on subject/from/to/attachment only (the fields whose raw text
 * is retained per file, not just its tokens — body/meta aren't, to keep
 * memory bounded at large folder sizes; use Raw search's regex mode for
 * those instead). An invalid pattern matches nothing rather than everything,
 * same as every other unresolvable clause here.
 *
 * A clause that can't be resolved (a numeric field with an unparseable
 * value, or a text term too short to tokenize) deliberately contributes
 * zero matches rather than silently matching the whole corpus — for a
 * security search tool, "found nothing" is a far safer failure mode than
 * "silently returned everything" — and is surfaced back to the caller via
 * the `warnings` array in the search() result.
 */
(function (g) {
  'use strict';
  var EV = g.EV || (g.EV = {});

  // Internal storage/token-index keys -- stable regardless of query-syntax renames (see
  // QUERY_FIELD_MAP below, which is the only place a user-facing field name is resolved).
  // 'ocr' is deliberately sparse -- populated only for attachments a user has actually clicked
  // "Extract text (OCR)" on (see addOcrText/ocrStats below), never during the eager indexing pass
  // (running real OCR against every image in a folder up front is completely incompatible with
  // this app's ~500K-file scale target). Still included in FIELDS (and therefore in a bare-word
  // "any" search) so a plain search finds OCR'd text too, per the original ask.
  var FIELDS = ['subject', 'from', 'to', 'cc', 'bcc', 'replyto', 'returnpath', 'body', 'url', 'attachment', 'meta', 'ocr'];
  var FIELD_WEIGHT = { subject: 6, from: 3, to: 3, cc: 2, bcc: 2, replyto: 3, returnpath: 3, url: 4, attachment: 3, body: 1, meta: 1, ocr: 2 };
  // User-facing query field name (as typed after a leading "field:") -> internal storage key.
  // A hard rename from the old flat names (from:/to:/attachment:/attachments:/meta:/header:) --
  // those no longer parse as fields at all once this map replaced FIELD_ALIASES.
  var QUERY_FIELD_MAP = {
    'header.subject': 'subject', 'header.from': 'from', 'header.to': 'to',
    'header.cc': 'cc', 'header.bcc': 'bcc', 'header.replyto': 'replyto', 'header.returnpath': 'returnpath',
    'header.raw': 'meta', 'attachment.filename': 'attachment', 'attachment.ocr': 'ocr',
    body: 'body', url: 'url'
  };

  // meta.* -- one searchable field per row of the Preview's Metadata card (sender / Reply-To / Return-Path
  // domains, URL domains, domain categories) plus its mismatch badges and the sender/finance signals. Each is
  // a case-insensitive SUBSTRING match against a small per-file value (the domain, not the whole address, so
  // meta.fromdomain:paypal finds paypal.evil.net but not an email that merely says "PayPal" in its display
  // name -- that is header.from's job), except meta.flag which is an exact name from FLAG_VALUES.
  var META_FIELDS = {
    'meta.fromdomain': 'the sender\'s domain', 'meta.replytodomain': 'the Reply-To domain',
    'meta.returnpathdomain': 'the Return-Path domain', 'meta.urldomain': 'any host in the email\'s links',
    'meta.originip': 'the earliest public IP in the Received chain', 'meta.connectingip': 'the IP that connected to the receiving side (cannot be forged by the sender)',
    'meta.category': 'a domain category', 'meta.flag': 'a mismatch/anomaly flag', 'meta.financial': 'a financial indicator type'
  };
  // The five sender-analysis flags indexLogic computes itself, plus every id the Security checklist can raise
  // (js/indexing/anomalies.js). replyto-/returnpath-mismatch appear in both: the checklist is their one definition.
  var LEGACY_FLAGS = ['replyto-mismatch', 'returnpath-mismatch', 'name-mismatch', 'lookalike', 'punycode'];
  var FLAG_VALUES = LEGACY_FLAGS.concat((EV.ANOMALY_FLAG_IDS || []).filter(function (id) { return LEGACY_FLAGS.indexOf(id) === -1; }));
  var SCRIPT_FIELDS = { 'script.subject': 'subjectScripts', 'script.body': 'bodyScripts' };
  var SCRIPT_VALUES = EV.SCRIPT_NAMES || [];
  var FINANCIAL_TYPES = ['iban', 'swift_bic', 'routing_number', 'crypto_wallet_btc', 'crypto_wallet_eth', 'gift_card_request'];
  EV.SEARCH_META_VALUES = { 'meta.flag': FLAG_VALUES, 'meta.financial': FINANCIAL_TYPES, 'script.subject': SCRIPT_VALUES, 'script.body': SCRIPT_VALUES };

  // field:/pattern/i — supported only on fields whose raw (untokenized)
  // string is retained per-file (checked below), since regex needs to run
  // against the real text, not word postings. Not anchored to word
  // boundaries; test it against the whole stored value for that field.
  var REGEX_VALUE_RE = /^\/(.+)\/([a-z]*)$/i;
  var REGEX_ELIGIBLE_FIELDS = { subject: 1, from: 1, to: 1, cc: 1, bcc: 1, replyto: 1, returnpath: 1, attachment: 1 };

  var SIZE_UNIT_MULTIPLIER = { b: 1, kb: 1024, mb: 1024 * 1024, gb: 1024 * 1024 * 1024 };
  // query field name -> internal per-file numeric array name
  var NUMERIC_FIELDS = { 'attachment.count': 'attCounts', size: 'sizes', urls: 'urlCounts', recipients: 'recipientCounts', duplicates: 'duplicateCounts', urgency: 'urgencyScores' };
  // Every field name the query grammar recognizes, for the search box's autocomplete (js/ui/searchSuggest.js)
  // -- derived from the same tables the parser uses, plus the special-cased clause types, so a suggestion
  // can never offer a field the parser doesn't understand (tests/searchSuggest.test.js checks both ways).
  EV.SEARCH_FIELD_NAMES = Object.keys(QUERY_FIELD_MAP).concat(Object.keys(NUMERIC_FIELDS), Object.keys(META_FIELDS), Object.keys(SCRIPT_FIELDS),
    ['tag', 'attachment.ext', 'attachment.sha256', 'header.messageid', 'auth.spf', 'auth.dkim', 'auth.dmarc']);
  var NUMERIC_VALUE_RE = /^(>=|<=|!=|>|<|=)?\s*([0-9]+(?:\.[0-9]+)?)\s*(b|kb|mb|gb)?$/i;

  EV.createSearchIndex = function (pool) {
    var paths = [];
    var subjects = [];
    var fromAddrs = [];
    var fromNames = [];
    var toStrs = [];
    var ccStrs = [];
    var bccStrs = [];
    var replyToStrs = [];
    var returnPathStrs = [];
    var messageIds = [];
    var dateMs = [];
    var sizes = [];
    var attCounts = [];
    var urlCounts = [];
    var recipientCounts = [];
    var fromDomains = [];
    var urlDomainsPerFile = [];
    var attExtsPerFile = [];
    var attSha256PerFile = [];
    var attExtCounts = new Map(); // extension -> how many emails have one, maintained as emails are ingested (feeds autocomplete)
    var attNamesRaw = [];
    var attNameLists = []; // each email's attachment filenames as a list, so a regex's ^ and $ apply to ONE filename
    var nameMismatchFlags = [];
    var lookalikeDomainFlags = [];
    var punycodeSenderFlags = [];
    var urgencyScores = [];
    var financialIndicatorsPerFile = [];
    var domainCategoriesPerFile = [];
    var replyToDomains = [];
    var returnPathDomains = [];
    var originIps = [];       // earliest public IP in each email's Received chain (meta.originip:)
    var connectingIps = [];   // newest public IP: the machine that connected to the receiving side (meta.connectingip:)
    var replyToMismatchFlags = [];
    var returnPathMismatchFlags = [];
    var categoryCounts = new Map(); // domain category -> how many emails have it (feeds autocomplete)
    var anomalyFlagsPerFile = [];   // ids of every Security-checklist flag/note per email (meta.flag:)
    var subjectScriptsPerFile = []; // scripts found in each subject / body (script.subject: / script.body:)
    var bodyScriptsPerFile = [];
    var emailIds = [];
    var skippedFileList = []; // [{path, reason}] -- files that failed to parse or were too large, surfaced in the UI instead of only folded into a count
    var authInfo = []; // { spf, dkim, dmarc }
    var fieldIndex = {};
    FIELDS.forEach(function (f) { fieldIndex[f] = new Map(); });
    var pathToFileId = new Map();
    // Decoded text kept (lowercased) so a search can match ANY substring in the body / URLs / headers
    // / OCR text, not just whole indexed words. Bounded by a total character budget: emails that
    // arrive after it's used up aren't retained and fall back to whole-word matching via the token
    // postings (textCoverage() reports how many are retained, and the search status line says so).
    var RETAINED_TEXT_BUDGET_CHARS = 300000000;
    var retainedBudget = RETAINED_TEXT_BUDGET_CHARS;
    var bodyTexts = [];
    var urlTexts = [];
    var hdrTexts = [];
    var ocrTexts = [];
    var retainedFlags = [];
    var retainedChars = 0;
    var retainedDocs = 0;
    var headerIndex = new Map(); // header name -> Map(token -> fileIds), only for emails NOT retained
    var headerNameCounts = new Map();
    var MAX_HEADER_NAMES = 300;
    // Which fileIds currently have OCR postings in fieldIndex.ocr -- see addOcrText below.
    // Sparse by design: only ever contains a fileId once a user has actually clicked
    // "Extract text (OCR)" on one of its attachments, never the whole indexed corpus.
    var ocrCoveredFileIds = new Set();
    var total = 0;
    var indexedCount = 0;
    var skippedCount = 0;
    var cancelled = false;
    var running = false;
    // Bumped on every startIndexing() call. A batch/progress/completion callback
    // from a superseded run (e.g. the user opened a second folder before the
    // first folder's background indexing finished) checks its own captured
    // epoch against this before touching shared state — otherwise stale data
    // for fileId N from the OLD folder would silently overwrite the NEW
    // folder's fileId N in the just-reset arrays.
    var epoch = 0;

    // Dispatches to whichever array CURRENTLY holds that field's per-file numeric
    // values. Written as a function (not a pre-built {name: array} map) on purpose:
    // reset() reassigns these arrays to new empty ones on every fresh index, and a
    // snapshot object built once at pool-creation time would keep pointing at the
    // old, abandoned arrays after that — this always resolves the live binding.
    function numericArrayFor(name) {
      switch (name) {
        case 'attCounts': return attCounts;
        case 'sizes': return sizes;
        case 'urlCounts': return urlCounts;
        case 'recipientCounts': return recipientCounts;
        case 'duplicateCounts': return duplicateCountArray();
        case 'urgencyScores': return urgencyScores;
        default: return null;
      }
    }

    /**
     * How many indexed files (including itself) share each file's stable
     * email id (Message-ID, or a content hash when there's none) — recomputed
     * fresh on every call rather than maintained incrementally, since
     * "duplicate of what" only makes sense once the whole corpus is known,
     * not as each file streams in from the worker pool. A single linear pass
     * over already-indexed ids is cheap even at very large folder sizes.
     */
    function duplicateCountArray() {
      var freq = new Map();
      for (var fid = 0; fid < emailIds.length; fid++) {
        var eid = emailIds[fid];
        if (!eid) continue;
        freq.set(eid, (freq.get(eid) || 0) + 1);
      }
      var out = [];
      for (var fid2 = 0; fid2 < emailIds.length; fid2++) {
        var eid2 = emailIds[fid2];
        out[fid2] = eid2 ? freq.get(eid2) : 1;
      }
      return out;
    }

    function addPosting(field, token, fileId) {
      var map = fieldIndex[field];
      var arr = map.get(token);
      if (!arr) { arr = []; map.set(token, arr); }
      arr.push(fileId);
    }

    function ingestDoc(doc) {
      paths[doc.fileId] = doc.path;
      subjects[doc.fileId] = doc.subject || '';
      fromAddrs[doc.fileId] = doc.fromAddr || '';
      fromNames[doc.fileId] = doc.fromName || '';
      toStrs[doc.fileId] = doc.toStr || '';
      ccStrs[doc.fileId] = doc.ccStr || '';
      bccStrs[doc.fileId] = doc.bccStr || '';
      replyToStrs[doc.fileId] = doc.replyToStr || '';
      returnPathStrs[doc.fileId] = doc.returnPathStr || '';
      messageIds[doc.fileId] = doc.messageId ? doc.messageId.toLowerCase() : null;
      dateMs[doc.fileId] = doc.dateMs;
      sizes[doc.fileId] = doc.size || 0;
      attCounts[doc.fileId] = doc.attCount || 0;
      urlCounts[doc.fileId] = doc.urlCount || 0;
      recipientCounts[doc.fileId] = doc.recipientCount || 0;
      fromDomains[doc.fileId] = doc.fromDomain || '';
      urlDomainsPerFile[doc.fileId] = doc.urlDomains || [];
      attExtsPerFile[doc.fileId] = doc.attExts || [];
      attSha256PerFile[doc.fileId] = doc.attSha256s || [];
      var seenExts = {};
      (doc.attExts || []).forEach(function (e) {
        if (e && e !== '(none)' && !seenExts[e]) { seenExts[e] = true; attExtCounts.set(e, (attExtCounts.get(e) || 0) + 1); }
      });
      attNamesRaw[doc.fileId] = doc.attNames || '';
      attNameLists[doc.fileId] = doc.attNameList || (doc.attNames ? [doc.attNames] : []);
      nameMismatchFlags[doc.fileId] = !!doc.nameMismatch;
      lookalikeDomainFlags[doc.fileId] = !!doc.lookalikeDomain;
      punycodeSenderFlags[doc.fileId] = !!doc.punycodeSender;
      urgencyScores[doc.fileId] = doc.urgencyScore || 0;
      financialIndicatorsPerFile[doc.fileId] = doc.financialIndicators || [];
      domainCategoriesPerFile[doc.fileId] = doc.domainCategories || [];
      (doc.domainCategories || []).forEach(function (c) { categoryCounts.set(c, (categoryCounts.get(c) || 0) + 1); });
      anomalyFlagsPerFile[doc.fileId] = doc.anomalyFlags || [];
      subjectScriptsPerFile[doc.fileId] = doc.subjectScripts || [];
      bodyScriptsPerFile[doc.fileId] = doc.bodyScripts || [];
      replyToDomains[doc.fileId] = doc.replyToDomain || '';
      returnPathDomains[doc.fileId] = doc.returnPathDomain || '';
      originIps[doc.fileId] = doc.originIp || '';
      connectingIps[doc.fileId] = doc.connectingIp || '';
      replyToMismatchFlags[doc.fileId] = !!doc.replyToMismatch;
      returnPathMismatchFlags[doc.fileId] = !!doc.returnPathMismatch;
      emailIds[doc.fileId] = doc.emailId || null;
      authInfo[doc.fileId] = { spf: doc.spf, dkim: doc.dkim, dmarc: doc.dmarc };
      pathToFileId.set(doc.path, doc.fileId);
      if (doc.skipped) {
        skippedCount++;
        skippedFileList.push({ path: doc.path, reason: doc.error || doc.subject || 'skipped' });
        return;
      }
      var hasTexts = doc.bodyLc !== undefined;
      var cost = 0;
      if (hasTexts) {
        cost = (doc.bodyLc || '').length + (doc.urlsLc || '').length;
        Object.keys(doc.headerTextsLc || {}).forEach(function (n) { cost += doc.headerTextsLc[n].length; });
      }
      // A body cut off at the per-email cap isn't retained at all (its tail would be unsearchable) -- it keeps the whole-word postings instead.
      var retained = hasTexts && !doc.bodyTruncated && retainedChars + cost <= retainedBudget;
      if (retained) {
        bodyTexts[doc.fileId] = doc.bodyLc || '';
        urlTexts[doc.fileId] = doc.urlsLc || '';
        hdrTexts[doc.fileId] = doc.headerTextsLc || {};
        retainedFlags[doc.fileId] = true;
        retainedChars += cost;
        retainedDocs++;
      }
      Object.keys(hasTexts ? (doc.headerTextsLc || {}) : (doc.headerTokens || {})).forEach(function (n) {
        if (n !== '*') headerNameCounts.set(n, (headerNameCounts.get(n) || 0) + 1);
      });
      var ft = doc.fieldTokens || {};
      FIELDS.forEach(function (field) {
        // Retained emails' body/URL text is substring-searched directly, so their word postings for
        // those two (the biggest ones) are skipped -- saves memory; non-retained emails keep them.
        if (retained && (field === 'body' || field === 'url')) return;
        (ft[field] || []).forEach(function (tok) { addPosting(field, tok, doc.fileId); });
      });
      if (!retained) {
        var ht = doc.headerTokens || {};
        Object.keys(ht).forEach(function (name) {
          var map = name === '*' ? fieldIndex.meta : headerIndex.get(name);
          if (!map) {
            if (headerIndex.size >= MAX_HEADER_NAMES) map = fieldIndex.meta;
            else { map = new Map(); headerIndex.set(name, map); }
          }
          ht[name].forEach(function (tok) {
            var arr = map.get(tok);
            if (!arr) { arr = []; map.set(tok, arr); }
            if (arr[arr.length - 1] !== doc.fileId) arr.push(doc.fileId);
          });
        });
      }
    }

    function reset() {
      paths = []; subjects = []; fromAddrs = []; fromNames = []; toStrs = [];
      ccStrs = []; bccStrs = []; replyToStrs = []; returnPathStrs = []; messageIds = [];
      dateMs = []; sizes = []; attCounts = []; urlCounts = []; recipientCounts = []; emailIds = []; authInfo = [];
      fromDomains = []; urlDomainsPerFile = []; attExtsPerFile = []; attSha256PerFile = []; attNamesRaw = []; attNameLists = []; skippedFileList = [];
      nameMismatchFlags = []; lookalikeDomainFlags = []; punycodeSenderFlags = [];
      urgencyScores = []; financialIndicatorsPerFile = []; domainCategoriesPerFile = [];
      replyToDomains = []; returnPathDomains = []; originIps = []; connectingIps = []; replyToMismatchFlags = []; returnPathMismatchFlags = []; categoryCounts = new Map();
      anomalyFlagsPerFile = []; subjectScriptsPerFile = []; bodyScriptsPerFile = [];
      FIELDS.forEach(function (f) { fieldIndex[f] = new Map(); });
      pathToFileId = new Map();
      ocrCoveredFileIds = new Set();
      bodyTexts = []; urlTexts = []; hdrTexts = []; ocrTexts = []; retainedFlags = [];
      retainedChars = 0; retainedDocs = 0; headerIndex = new Map(); headerNameCounts = new Map(); attExtCounts = new Map();
      total = 0; indexedCount = 0; skippedCount = 0; cancelled = false;
    }

    /** @param {object} workspace  from fileTree.js */
    function startIndexing(workspace, opts) {
      opts = opts || {};
      reset();
      epoch++;
      var myEpoch = epoch;
      running = true;
      var allFiles = EV.flattenFileNodes(workspace.root).filter(function (n) { return EV.isEmlFile(n.name); });
      var myTotal = allFiles.length;
      total = myTotal;
      var fileEntries = allFiles.map(function (n, i) { return { fileId: i, entry: n.entry }; });

      return EV.runOverFileEntries(pool, fileEntries, {
        taskType: 'indexBatch',
        taskOpts: { trustedDomains: opts.trustedDomains || [], domainCategories: opts.domainCategories || [], internalDomains: opts.internalDomains || [] },
        batchSize: opts.batchSize || 40,
        concurrency: opts.concurrency,
        isCancelled: function () { return cancelled || epoch !== myEpoch; },
        onBatch: function (msg) {
          if (epoch !== myEpoch) return; // superseded by a newer startIndexing() call
          (msg.docs || []).forEach(ingestDoc);
          indexedCount = paths.filter(function (x) { return x !== undefined; }).length;
        },
        onProgress: function (done, totalN) {
          if (epoch !== myEpoch) return;
          if (opts.onProgress) opts.onProgress(done, totalN);
        }
      }).then(function (result) {
        // total/indexedCount/skippedCount are shared module state, already
        // repurposed for whichever run is current by the time this fires —
        // report this run's own captured total and zero progress rather than
        // a newer run's numbers.
        if (epoch !== myEpoch) return { total: myTotal, indexed: 0, skipped: 0, cancelled: true };
        running = false;
        return { total: myTotal, indexed: indexedCount, skipped: skippedCount, cancelled: result.cancelled };
      });
    }

    function cancel() { cancelled = true; }

    /**
     * Pushes a freshly-OCR'd attachment's text into the live index's 'ocr' field, so
     * attachment.ocr: search picks it up immediately -- no re-indexing pass, no reload.
     * Called from app.js's EV.onOcrTextReady hook, itself called from render.js right after
     * EV.ocr.run(att) resolves (cache-hit or freshly-computed alike). A no-op if the path
     * isn't currently indexed (e.g. the folder was closed/reopened since), same "just don't
     * crash on stale state" posture as the rest of this file's epoch-guarded callbacks.
     */
    function addOcrText(path, text) {
      var fileId = pathToFileId.get(path);
      if (fileId === undefined || !text) return;
      EV.tokenize(text).forEach(function (tok) { addPosting('ocr', tok, fileId); });
      ocrTexts[fileId] = (ocrTexts[fileId] ? ocrTexts[fileId] + '\n' : '') + String(text).toLowerCase();
      ocrCoveredFileIds.add(fileId);
    }

    /** How many currently-indexed emails have at least one OCR'd attachment -- feeds the
     * "not exhaustive" coverage note next to attachment.ocr: search results. */
    function ocrStats() {
      return { coveredCount: ocrCoveredFileIds.size };
    }

    /** How many indexed emails carry each meta.flag: id (the Security-checklist flags plus the three sender-spoofing flags), for
     * the Folder overview. One pass over per-file arrays that already exist -- no re-reading of any email. */
    function flagCounts(groups) {
      var counts = {}, indexed = 0, grouped = {};
      groups = groups || {};
      Object.keys(groups).forEach(function (g) { grouped[g] = 0; });
      for (var fid = 0; fid < anomalyFlagsPerFile.length; fid++) {
        var flags = anomalyFlagsPerFile[fid];
        if (flags === undefined) continue;
        indexed++;
        var all = flags.slice();
        if (nameMismatchFlags[fid]) all.push('name-mismatch');
        if (lookalikeDomainFlags[fid]) all.push('lookalike');
        if (punycodeSenderFlags[fid]) all.push('punycode');
        all.forEach(function (id) { counts[id] = (counts[id] || 0) + 1; });
        // a group counts an EMAIL once, however many of its flags that email carries
        Object.keys(groups).forEach(function (g) { if (groups[g].some(function (id) { return all.indexOf(id) !== -1; })) grouped[g]++; });
      }
      return { indexed: indexed, counts: counts, groups: grouped };
    }

    // ---------- query parsing ----------
    //
    // Three stages, each a small, independently-readable piece:
    //   1. tokenizeQuery(q)  — single left-to-right pass over the raw string,
    //      producing a flat token array: 'lparen' / 'rparen' / 'or' / 'neg'
    //      (a bare '-' immediately before '(', for negating a whole group) /
    //      'leaf' (carries a `clause` object in EXACTLY the same shape the
    //      old flat `clauses` array used to hold — {field,text,negate,phrase}
    //      or {field,numeric:true,...} or {field,regex:true,pattern,flags,negate}).
    //   2. parseTokens(tokens) — recursive-descent parser building a small
    //      AST: {type:'and'|'or', children:[...]}, {type:'not', child:...},
    //      {type:'leaf', clause:...}. Any structural problem anywhere
    //      (unbalanced parens, "OR" missing an operand, ...) discards the
    //      whole parse and reports one error message — deliberately: this is
    //      simpler to reason about than partial recovery, and matches the
    //      file's "malformed input matches nothing" philosophy.
    //   3. evalNode(node, ...) — walks the AST at search() time, resolving
    //      each leaf via the SAME per-clause resolution functions used
    //      before (candidatesForClause / candidatesForNumericClause /
    //      candidatesForRegexClause), composing children via intersect (AND,
    //      already defined below) / union (OR, already defined below) /
    //      "every indexed id minus this" (NOT).

    /** Parses "<op?><number><unit?>" (e.g. ">3", ">=1.5mb", "0") into a comparator spec, or null if unparseable. */
    function parseNumericValue(raw, field) {
      var m = NUMERIC_VALUE_RE.exec(raw);
      NUMERIC_VALUE_RE.lastIndex = 0;
      if (!m) return null;
      var op = m[1] || '=';
      var num = parseFloat(m[2]);
      if (isNaN(num)) return null;
      if (field === 'size' && m[3]) num *= SIZE_UNIT_MULTIPLIER[m[3].toLowerCase()];
      return { op: op, value: num };
    }

    function numericMatches(actual, spec) {
      switch (spec.op) {
        case '>': return actual > spec.value;
        case '>=': return actual >= spec.value;
        case '<': return actual < spec.value;
        case '<=': return actual <= spec.value;
        case '!=': return actual !== spec.value;
        default: return actual === spec.value;
      }
    }

    // A field-clause's unquoted value normally stops at the first
    // whitespace/paren character (parens are always structural now — see
    // tokenizeQuery). The one exception is a field:/regex/flags value, which
    // must still be able to contain literal parens in the pattern itself
    // (e.g. subject:/^(re|fwd):/i) — so this is tried FIRST, before the
    // generic paren-stopping plain-value fallback.
    var REGEX_SHAPED_VALUE_RE = /^\/(?:\\.|[^\/\\])*\/[a-z]*/i;
    var PLAIN_VALUE_RE = /^[^\s()]+/;
    // One optional dot-segment (e.g. "header.subject", "attachment.count") -- a dot isn't in \w,
    // so this is strictly wider than the old /^\w+/, never narrower; nothing that parsed as a bare
    // word before stops doing so now.
    var FIELD_NAME_RE = /^[\w]+(?:\.[\w-]+)?/;

    /**
     * Builds the leaf-clause object for a `field:value` match (or returns
     * null if `rawFieldRaw` isn't a recognized field/numeric-field/tag —
     * the caller then falls back to treating the whole matched span as a
     * literal bare word, same as the old two-pass implementation did).
     */
    function buildFieldClause(rawFieldRaw, valueRaw, negate, isQuoted) {
      var rawField = rawFieldRaw.toLowerCase();
      if (NUMERIC_FIELDS.hasOwnProperty(rawField)) {
        var spec = parseNumericValue(valueRaw, rawField);
        return {
          field: rawField, numeric: true, negate: negate,
          invalid: !spec, op: spec && spec.op, value: spec && spec.value
        };
      }
      // attachment.ext / header.messageid are their own small clause types -- not tokenized text
      // (an extension or a Message-ID is matched as a whole value, not word-by-word), so each gets
      // resolved by its own branch in candidatesForClause rather than the generic token-index path.
      if (rawField === 'attachment.ext') {
        var extText = valueRaw.toLowerCase();
        if (extText && extText.charAt(0) !== '.') extText = '.' + extText; // "exe" and ".exe" mean the same thing (the autocomplete already accepted both)
        return { field: 'attachment.ext', extMatch: true, text: extText, negate: negate };
      }
      if (rawField === 'attachment.sha256') {
        return { field: 'attachment.sha256', sha256Match: true, text: valueRaw.trim().toLowerCase(), negate: negate };
      }
      if (rawField === 'header.messageid') {
        return { field: 'header.messageid', exactMatch: true, text: valueRaw.trim().toLowerCase(), negate: negate };
      }
      if (SCRIPT_FIELDS.hasOwnProperty(rawField)) {
        return { field: rawField, scriptMatch: SCRIPT_FIELDS[rawField], text: valueRaw.trim().toLowerCase(), negate: negate };
      }
      if (META_FIELDS.hasOwnProperty(rawField)) {
        return { field: rawField, metaMatch: rawField, text: valueRaw.trim().toLowerCase(), negate: negate };
      }
      var authM = /^auth\.(spf|dkim|dmarc)$/.exec(rawField);
      if (authM) return { field: rawField, authMatch: authM[1], text: valueRaw.trim().toLowerCase(), negate: negate };
      // header.<any other header name>: -- e.g. header.received:, header.x-mailer:, header.authentication-results:
      if (rawField.indexOf('header.') === 0 && rawField.length > 7 && !QUERY_FIELD_MAP.hasOwnProperty(rawField)) {
        return { field: rawField, headerName: rawField.slice(7), text: valueRaw, negate: negate, phrase: isQuoted };
      }
      var field = QUERY_FIELD_MAP.hasOwnProperty(rawField) ? QUERY_FIELD_MAP[rawField] : (rawField === 'tag' ? 'tag' : null);
      if (field) {
        if (!isQuoted) {
          var regexMatch = REGEX_ELIGIBLE_FIELDS[field] && REGEX_VALUE_RE.exec(valueRaw);
          if (regexMatch) {
            return { field: field, regex: true, pattern: regexMatch[1], flags: regexMatch[2] || '', negate: negate };
          }
        }
        return { field: field, text: valueRaw, negate: negate, phrase: isQuoted };
      }
      return null;
    }

    /**
     * Single left-to-right pass over the raw query string. Bare words and
     * unquoted field values stop at '(' / ')' (always structural now,
     * except inside a /regex/ value's own slashes — see REGEX_SHAPED_VALUE_RE).
     * @returns {Array<object>} flat tokens: {type:'lparen'|'rparen'|'or'|'neg'}
     *   or {type:'leaf', clause:{...}}.
     */
    function tokenizeQuery(q) {
      var tokens = [];
      var i = 0;
      var n = q.length;
      while (i < n) {
        var ch = q[i];
        if (/\s/.test(ch)) { i++; continue; }
        if (ch === '(') { tokens.push({ type: 'lparen' }); i++; continue; }
        if (ch === ')') { tokens.push({ type: 'rparen' }); i++; continue; }
        // Literal all-caps "OR" only when it stands alone (next char is
        // whitespace/paren/end-of-string) — "ORDER"/"or" fall through to a
        // plain bare word below, on purpose (see file-level doc comment).
        if (q.substr(i, 2) === 'OR' && (i + 2 >= n || /[\s()]/.test(q[i + 2]))) {
          tokens.push({ type: 'or' }); i += 2; continue;
        }
        // '-' immediately before '(' negates the whole upcoming group; the
        // '(' itself is left for the next loop iteration to tokenize normally.
        if (ch === '-' && q[i + 1] === '(') { tokens.push({ type: 'neg' }); i++; continue; }

        var negate = false;
        if (ch === '-') {
          negate = true;
          i++;
          if (i >= n || /[\s()]/.test(q[i])) continue; // lone trailing '-' — silently dropped, same as the old implementation
        }

        var c2 = q[i];
        if (c2 === '"') {
          var qend = q.indexOf('"', i + 1);
          if (qend !== -1) {
            tokens.push({ type: 'leaf', clause: { field: 'any', text: q.slice(i + 1, qend), negate: negate, phrase: true } });
            i = qend + 1;
            continue;
          }
          // no closing quote — fall through, the stray '"' becomes part of a plain bare word below
        }

        var fieldMatch = FIELD_NAME_RE.exec(q.slice(i));
        if (fieldMatch && q[i + fieldMatch[0].length] === ':') {
          var afterColon = i + fieldMatch[0].length + 1;
          // Tolerate whitespace right after the colon (e.g. "header.from: paypal") --
          // otherwise the value-parsing below sees a leading space, matches nothing, and
          // the whole "field:" span falls through to becoming its own literal (almost
          // never-matching) bare word ANDed into the rest of the query -- silently
          // zeroing out every result for a perfectly natural way to type a query, with
          // no warning explaining why. The value still stops at the next whitespace/paren
          // exactly as before -- this only skips space *before* the value starts.
          while (/\s/.test(q[afterColon] || '')) afterColon++;
          var valStr = q.slice(afterColon);
          var valueText, consumedLen = 0, isQuoted = false;
          if (valStr[0] === '"') {
            var qend2 = valStr.indexOf('"', 1);
            if (qend2 !== -1) { valueText = valStr.slice(1, qend2); consumedLen = qend2 + 1; isQuoted = true; }
          }
          if (!isQuoted) {
            var rm = REGEX_SHAPED_VALUE_RE.exec(valStr);
            if (rm) { valueText = rm[0]; consumedLen = rm[0].length; }
            else {
              var pm = PLAIN_VALUE_RE.exec(valStr);
              if (pm) { valueText = pm[0]; consumedLen = pm[0].length; }
            }
          }
          if (consumedLen > 0 || isQuoted) {
            var clause = buildFieldClause(fieldMatch[0], valueText, negate, isQuoted);
            if (clause) {
              tokens.push({ type: 'leaf', clause: clause });
              i = afterColon + consumedLen;
              continue;
            }
            // unrecognized field name (e.g. "http:") — fall back to a
            // literal bare word covering the whole "field:value" span,
            // same as the old implementation's incidental behavior.
            tokens.push({ type: 'leaf', clause: { field: 'any', text: q.slice(i, afterColon + consumedLen), negate: negate, phrase: false } });
            i = afterColon + consumedLen;
            continue;
          }
          // "field:" with nothing usable after it — fall through to plain bare-word handling below
        }

        var wm = PLAIN_VALUE_RE.exec(q.slice(i));
        var word = wm ? wm[0] : q[i];
        tokens.push({ type: 'leaf', clause: { field: 'any', text: word, negate: negate, phrase: false } });
        i += word.length || 1;
      }
      return tokens;
    }

    /**
     * Recursive-descent parser: expr := andExpr (OR andExpr)*, andExpr :=
     * term+, term := '-'? factor, factor := '(' expr ')' | leafToken. Any
     * structural error found anywhere (unbalanced parens, "OR" with an
     * empty side, an empty group, trailing unmatched tokens) discards the
     * whole result — see the "query parsing" comment above for why.
     */
    function parseTokens(tokens) {
      var pos = 0;
      var err = null;
      function fail(msg) { if (!err) err = msg; }
      function peek() { return tokens[pos]; }
      function next() { return tokens[pos++]; }

      function parseAnd() {
        var children = [];
        var t;
        while ((t = peek()) && t.type !== 'or' && t.type !== 'rparen') {
          var f = parseTerm();
          if (f) children.push(f);
        }
        if (children.length === 0) return null;
        if (children.length === 1) return children[0];
        return { type: 'and', children: children };
      }

      function parseExpr() {
        var node = parseAnd();
        if (node === null) fail('expected a search term');
        while (peek() && peek().type === 'or') {
          next();
          var rhs = parseAnd();
          if (rhs === null) { fail('"OR" needs a search term on both sides'); break; }
          var kids = (node && node.type === 'or') ? node.children.slice() : (node ? [node] : []);
          kids.push(rhs);
          node = { type: 'or', children: kids };
        }
        return node;
      }

      function parseTerm() {
        var t = peek();
        if (!t) return null;
        if (t.type === 'neg') {
          next();
          if (!peek() || peek().type !== 'lparen') { fail('"-" before a group must be immediately followed by "("'); return null; }
          next(); // consume '('
          var sub = parseExpr();
          if (peek() && peek().type === 'rparen') next();
          else fail('unbalanced parentheses — missing a closing ")"');
          if (!sub) { fail('empty parenthesized group'); return null; }
          return { type: 'not', child: sub };
        }
        if (t.type === 'lparen') {
          next();
          var sub2 = parseExpr();
          if (peek() && peek().type === 'rparen') next();
          else fail('unbalanced parentheses — missing a closing ")"');
          if (!sub2) { fail('empty parenthesized group'); return null; }
          return sub2;
        }
        if (t.type === 'leaf') { next(); return { type: 'leaf', clause: t.clause }; }
        return null; // 'or'/'rparen' — not consumable as a term, let the caller decide
      }

      var root = parseExpr();
      if (pos < tokens.length) fail('unexpected ")" — unbalanced parentheses');
      if (err) return { node: null, error: err };
      return { node: root, error: null };
    }

    function intersect(a, b) {
      var setB = new Set(b);
      return a.filter(function (x) { return setB.has(x); });
    }
    function union(arrays) {
      var set = new Set();
      arrays.forEach(function (arr) { arr.forEach(function (x) { set.add(x); }); });
      return Array.from(set);
    }

    /** Header-value postings: the shared 'meta' map plus every per-header-name map (non-retained emails only). */
    function metaPostings(token) {
      var parts = [fieldIndex.meta.get(token) || []];
      headerIndex.forEach(function (m) { var a = m.get(token); if (a) parts.push(a); });
      return parts.length === 1 ? parts[0] : union(parts);
    }
    function postingsForToken(field, token) {
      if (field === 'meta') return metaPostings(token);
      if (field === 'any') return union(FIELDS.map(function (f) { return f === 'meta' ? metaPostings(token) : (fieldIndex[f].get(token) || []); }));
      return fieldIndex[field].get(token) || [];
    }

    /** Every fileId that has actually been indexed so far (skips holes from in-progress indexing). */
    function allIndexedFileIds() {
      var out = [];
      for (var i = 0; i < paths.length; i++) if (paths[i] !== undefined) out.push(i);
      return out;
    }

    function candidatesForNumericClause(clause) {
      if (clause.invalid) return { ids: [], warning: 'couldn’t parse "' + clause.field + ':" value — use e.g. ' + clause.field + ':>3 or ' + clause.field + ':5' };
      var arr = numericArrayFor(NUMERIC_FIELDS[clause.field]);
      var spec = { op: clause.op, value: clause.value };
      var ids = allIndexedFileIds().filter(function (fid) { return numericMatches(arr[fid] || 0, spec); });
      return { ids: ids, warning: null };
    }

    // subject/from/to/cc/bcc/replyto/returnpath/attachment are the only fields whose raw
    // (untokenized) text is kept per file (body/meta aren't, to keep memory bounded at large
    // folder sizes -- see file-top doc) -- so a real regex, or verifying an exact-case match,
    // can only ever run against these.
    var RAW_TEXT_FIELDS = ['subject', 'from', 'to', 'cc', 'bcc', 'replyto', 'returnpath', 'attachment'];
    function fieldRawText(field, fid) {
      switch (field) {
        case 'subject': return subjects[fid] || '';
        case 'from': return (fromAddrs[fid] || '') + ' ' + (fromNames[fid] || '');
        case 'to': return toStrs[fid] || '';
        case 'cc': return ccStrs[fid] || '';
        case 'bcc': return bccStrs[fid] || '';
        case 'replyto': return replyToStrs[fid] || '';
        case 'returnpath': return returnPathStrs[fid] || '';
        case 'attachment': return attNamesRaw[fid] || '';
        default: return null;
      }
    }

    /** Does `re` match this email's value for a raw-text field? Attachment filenames are tested ONE AT A TIME, so
     * attachment.filename:/Inv-.*\.pdf$/ means "a filename that ends in .pdf" even when that attachment isn't the
     * email's last one; every other field is tested as its whole stored text. */
    function regexHitsField(re, field, fid) {
      if (field === 'attachment') return (attNameLists[fid] || []).some(function (name) { return re.test(name); });
      return re.test(fieldRawText(field, fid));
    }

    /** field:/pattern/i — linear-scans the field's raw stored text per indexed file (not the token index). */
    function candidatesForRegexClause(clause) {
      var re;
      try {
        re = new RegExp(clause.pattern, clause.flags.indexOf('i') !== -1 ? 'i' : '');
      } catch (e) {
        return { ids: [], warning: 'couldn’t parse the regex for "' + clause.field + ':" — ' + e.message };
      }
      if (RAW_TEXT_FIELDS.indexOf(clause.field) === -1) {
        return { ids: [], warning: 'regex isn’t supported on "' + clause.field + ':" — try header.subject/header.from/header.to/header.cc/header.bcc/header.replyto/header.returnpath/attachment.filename, or Raw search for anything else' };
      }
      var ids = allIndexedFileIds().filter(function (fid) { return regexHitsField(re, clause.field, fid); });
      return { ids: ids, warning: null };
    }

    /**
     * The "Use Regular Expression" toggle above the search box, for Decoded search: unlike
     * field:/pattern/ (an advanced per-field escape hatch that stays available either way), this
     * treats the WHOLE query box as one pattern tested against subject/from/to/attachment (OR'd)
     * -- the same fields regex has always been limited to here, and the same one-pattern model
     * Raw search's own regex toggle already uses, so the two modes behave predictably alike.
     */
    function candidatesForGlobalRegex(pattern, caseSensitive) {
      var re;
      try {
        re = new RegExp(pattern, caseSensitive ? '' : 'i');
      } catch (e) {
        return { ids: [], warning: 'Invalid regex — ' + e.message, matchedFieldsById: {} };
      }
      var ids = [];
      var matchedFieldsById = {};
      allIndexedFileIds().forEach(function (fid) {
        var hit = false;
        RAW_TEXT_FIELDS.forEach(function (f) {
          if (regexHitsField(re, f, fid)) {
            hit = true;
            var list = matchedFieldsById[fid] || (matchedFieldsById[fid] = []);
            if (list.indexOf(f) === -1) list.push(f);
          }
        });
        if (hit) ids.push(fid);
      });
      return { ids: ids, warning: null, matchedFieldsById: matchedFieldsById };
    }

    /**
     * Does this email's text for `field` contain `needle` (already lowercased) as a plain substring?
     * Covers the raw-text fields (always retained), and the decoded body / URLs / header values / OCR
     * text for emails whose text is retained (see RETAINED_TEXT_BUDGET_CHARS). `field` may also be
     * 'any' (every field) or {header: name} (one header's value).
     */
    function docContains(field, fid, needle) {
      var i;
      if (field && field.header) {
        var h = hdrTexts[fid];
        return !!(h && h[field.header] && h[field.header].indexOf(needle) !== -1);
      }
      if (field === 'any') {
        for (i = 0; i < RAW_TEXT_FIELDS.length; i++) if (fieldRawText(RAW_TEXT_FIELDS[i], fid).toLowerCase().indexOf(needle) !== -1) return true;
        return docContains('body', fid, needle) || docContains('url', fid, needle) || docContains('meta', fid, needle) || docContains('ocr', fid, needle);
      }
      if (RAW_TEXT_FIELDS.indexOf(field) !== -1) return fieldRawText(field, fid).toLowerCase().indexOf(needle) !== -1;
      if (field === 'body') return !!bodyTexts[fid] && bodyTexts[fid].indexOf(needle) !== -1;
      if (field === 'url') return !!urlTexts[fid] && urlTexts[fid].indexOf(needle) !== -1;
      if (field === 'ocr') return !!ocrTexts[fid] && ocrTexts[fid].indexOf(needle) !== -1;
      if (field === 'meta') {
        var hm = hdrTexts[fid];
        if (!hm) return false;
        for (var n in hm) if (hm.hasOwnProperty(n) && hm[n].indexOf(needle) !== -1) return true;
      }
      return false;
    }
    function substringHits(field, needle) {
      return allIndexedFileIds().filter(function (fid) { return docContains(field, fid, needle); });
    }
    /** True when every piece of text a clause on `field` could match is available for substring search for this email. */
    function fullyRetained(field, fid) {
      if (field !== 'any' && field !== 'body' && field !== 'url' && field !== 'meta' && !(field && field.header)) return true;
      return !!retainedFlags[fid];
    }

    /** Resolves one leaf clause to candidate ids -- tag clauses are handled separately by
     * evalNode (via a pre-built tagFileIdSets map), so this never actually sees field:'tag'. */
    function candidatesForClause(clause, opts) {
      opts = opts || {};
      if (clause.numeric) return candidatesForNumericClause(clause);
      if (clause.regex) return candidatesForRegexClause(clause);
      if (clause.extMatch) {
        if (!clause.text) return { ids: [], warning: '"attachment.ext:" needs a value, e.g. attachment.ext:.exe' };
        var extIds = allIndexedFileIds().filter(function (fid) {
          return (attExtsPerFile[fid] || []).indexOf(clause.text) !== -1;
        });
        return { ids: extIds, warning: null };
      }
      if (clause.sha256Match) {
        if (!clause.text) return { ids: [], warning: '"attachment.sha256:" needs a value, e.g. attachment.sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08' };
        var shaIds = allIndexedFileIds().filter(function (fid) {
          return (attSha256PerFile[fid] || []).indexOf(clause.text) !== -1;
        });
        return { ids: shaIds, warning: null };
      }
      if (clause.scriptMatch) {
        if (!clause.text) return { ids: [], warning: '"' + clause.field + ':" needs a value, e.g. ' + clause.field + ':cyrillic' };
        if (SCRIPT_VALUES.indexOf(clause.text) === -1) {
          return { ids: [], warning: '"' + clause.text + '" is not a known script. Use one of: ' + SCRIPT_VALUES.join(', ') };
        }
        var scriptLists = clause.scriptMatch === 'subjectScripts' ? subjectScriptsPerFile : bodyScriptsPerFile;
        return { ids: allIndexedFileIds().filter(function (fid) { return (scriptLists[fid] || []).indexOf(clause.text) !== -1; }), warning: null };
      }
      if (clause.metaMatch) {
        var mf = clause.metaMatch, mt = clause.text;
        var example = { 'meta.fromdomain': 'paypal', 'meta.replytodomain': 'gmail.com', 'meta.returnpathdomain': 'bounce', 'meta.urldomain': 'bit.ly',
          'meta.category': 'shortener', 'meta.flag': 'replyto-mismatch', 'meta.financial': 'iban', 'meta.originip': '203.0.113', 'meta.connectingip': '198.51.100.7' }[mf];
        if (!mt) return { ids: [], warning: '"' + mf + ':" needs a value, e.g. ' + mf + ':' + example };
        if (mf === 'meta.flag' && FLAG_VALUES.indexOf(mt) === -1) {
          return { ids: [], warning: '"' + mt + '" is not a known meta.flag. Use one of: ' + FLAG_VALUES.join(', ') };
        }
        var metaIds = allIndexedFileIds().filter(function (fid) {
          switch (mf) {
            case 'meta.fromdomain': return (fromDomains[fid] || '').indexOf(mt) !== -1;
            case 'meta.replytodomain': return (replyToDomains[fid] || '').indexOf(mt) !== -1;
            case 'meta.returnpathdomain': return (returnPathDomains[fid] || '').indexOf(mt) !== -1;
            case 'meta.originip': return (originIps[fid] || '').toLowerCase().indexOf(mt) !== -1;
            case 'meta.connectingip': return (connectingIps[fid] || '').toLowerCase().indexOf(mt) !== -1;
            case 'meta.urldomain': return (urlDomainsPerFile[fid] || []).some(function (d) { return d.indexOf(mt) !== -1; });
            case 'meta.category': return (domainCategoriesPerFile[fid] || []).some(function (c) { return c.toLowerCase().indexOf(mt) !== -1; });
            case 'meta.financial': return (financialIndicatorsPerFile[fid] || []).some(function (t) { return t.indexOf(mt.replace(/[\s-]+/g, '_')) !== -1; });
            case 'meta.flag':
              if (mt === 'replyto-mismatch') return !!replyToMismatchFlags[fid];
              if (mt === 'returnpath-mismatch') return !!returnPathMismatchFlags[fid];
              if (mt === 'name-mismatch') return !!nameMismatchFlags[fid];
              if (mt === 'lookalike') return !!lookalikeDomainFlags[fid];
              if (mt === 'punycode') return !!punycodeSenderFlags[fid];
              return (anomalyFlagsPerFile[fid] || []).indexOf(mt) !== -1; // every other id comes from the Security checklist
          }
          return false;
        });
        return { ids: metaIds, warning: null };
      }
      if (clause.exactMatch) {
        if (!clause.text) return { ids: [], warning: '"header.messageid:" needs a value' };
        var midIds = allIndexedFileIds().filter(function (fid) { return messageIds[fid] === clause.text; });
        return { ids: midIds, warning: null };
      }
      if (clause.authMatch) {
        if (!clause.text) return { ids: [], warning: '"' + clause.field + ':" needs a value, e.g. ' + clause.field + ':fail (or :pass, :softfail, :none, :missing)' };
        var skipped = new Set(skippedFileList.map(function (x) { return pathToFileId.get(x.path); }));
        var authIds = allIndexedFileIds().filter(function (fid) {
          if (skipped.has(fid)) return false;
          var a = authInfo[fid];
          var v = a && a[clause.authMatch] != null ? String(a[clause.authMatch]).toLowerCase() : null;
          return clause.text === 'missing' ? v === null : v === clause.text;
        });
        return { ids: authIds, warning: null };
      }
      if (clause.headerName) {
        var hneedle = String(clause.text || '').trim().toLowerCase();
        if (!headerNameCounts.has(clause.headerName)) {
          return { ids: [], warning: 'no indexed email has a "' + clause.headerName + '" header — matched nothing' };
        }
        if (hneedle.length < 2) {
          return { ids: [], warning: '"' + clause.text + '" is too short to search on (minimum 2 characters) — matched nothing rather than everything' };
        }
        var hits = substringHits({ header: clause.headerName }, hneedle);
        var hmap = headerIndex.get(clause.headerName);
        var htokens = EV.tokenize(clause.text);
        if (hmap && htokens.length) {
          var hsets = htokens.map(function (t) { return hmap.get(t) || []; });
          hsets.sort(function (a, b) { return a.length - b.length; });
          var hids = hsets[0];
          for (var hi = 1; hi < hsets.length; hi++) hids = intersect(hids, hsets[hi]);
          hits = union([hits, hids]);
        }
        return { ids: hits, warning: null };
      }
      var needle = String(clause.text || '').trim().toLowerCase();
      if (needle.length < 2) {
        return { ids: [], warning: '"' + clause.text + '" is too short to search on (minimum 2 characters) — matched nothing rather than everything' };
      }
      // Anything typed matches as a plain substring wherever the text is available; the token index
      // covers emails whose text isn't retained (and is the cheap exact path for the rest).
      var tokens = EV.tokenize(clause.text);
      var tokenIds = null;
      if (tokens.length) {
        var sets = tokens.map(function (t) { return postingsForToken(clause.field, t); });
        sets.sort(function (a, b) { return a.length - b.length; });
        tokenIds = sets[0] || [];
        for (var i = 1; i < sets.length; i++) tokenIds = intersect(tokenIds, sets[i]);
        // A quoted phrase needs its words adjacent: for emails whose text is retained that's checked
        // exactly by the substring pass, so only trust the looser all-words-present token match for
        // emails whose text isn't retained.
        if (clause.phrase) tokenIds = tokenIds.filter(function (fid) { return !fullyRetained(clause.field, fid); });
      }
      var result = tokenIds ? union([substringHits(clause.field, needle), tokenIds]) : substringHits(clause.field, needle);
      // Exact-case verification ("Match Case") can only be checked against the fields with retained
      // raw text -- same scope regex is limited to, above.
      var verifiableField = RAW_TEXT_FIELDS.indexOf(clause.field) !== -1 || clause.field === 'any';
      if (verifiableField && opts.caseSensitive) {
        result = result.filter(function (fid) {
          return RAW_TEXT_FIELDS.some(function (f) { return fieldRawText(f, fid).indexOf(clause.text) !== -1; });
        });
      }
      return { ids: result, warning: null };
    }

    /** Walks an AST looking for any tag: leaf, anywhere (including inside NOT/groups) — determines whether the async tags.getAll() lookup is needed at all. */
    function astHasTagLeaf(node) {
      if (!node) return false;
      if (node.type === 'leaf') return node.clause.field === 'tag';
      if (node.type === 'not') return astHasTagLeaf(node.child);
      if (node.children) return node.children.some(astHasTagLeaf);
      return false;
    }

    /**
     * Resolves every tag: leaf up front (once), synchronously, so the
     * recursive evaluator can treat tag clauses like any other leaf —
     * composable with AND/OR/NOT instead of being bolted on after the fact.
     * @returns {Map<string, Set<number>>} tag name -> Set of matching fileIds
     */
    function buildTagFileIdSets(allTagRecords) {
      var byTagEmailIds = new Map(); // tagName -> Set<emailId>
      (allTagRecords || []).forEach(function (rec) {
        (rec.tags || []).forEach(function (t) {
          var s = byTagEmailIds.get(t);
          if (!s) { s = new Set(); byTagEmailIds.set(t, s); }
          s.add(rec.id);
        });
      });
      var result = new Map();
      byTagEmailIds.forEach(function (emailIdSet, tagName) {
        var fids = new Set();
        for (var fid = 0; fid < emailIds.length; fid++) {
          if (emailIds[fid] && emailIdSet.has(emailIds[fid])) fids.add(fid);
        }
        result.set(tagName, fids);
      });
      return result;
    }

    /**
     * Recursively resolves an AST node to an array of fileIds.
     * @param {object} node
     * @param {boolean} negatedCtx  true if this node is anywhere inside a
     *   NOT (either a `-(...)` group or a leaf's own leading `-`) — used
     *   ONLY to decide whether a leaf's matches should be recorded into
     *   ctx.matchedFields (excluded-context matches shouldn't count toward
     *   "why did this result match" scoring), never to change the actual
     *   id-set math, which is self-contained at each node.
     * @param {object} ctx  { warnings: [], matchedFields: {}, tagFileIdSets: Map, opts: {caseSensitive} }
     */
    function evalNode(node, negatedCtx, ctx) {
      switch (node.type) {
        case 'and': {
          if (node.children.length === 0) return allIndexedFileIds();
          var andSets = node.children.map(function (c) { return evalNode(c, negatedCtx, ctx); });
          andSets.sort(function (a, b) { return a.length - b.length; });
          var out = andSets[0];
          for (var i = 1; i < andSets.length; i++) out = intersect(out, andSets[i]);
          return out;
        }
        case 'or': {
          var orSets = node.children.map(function (c) { return evalNode(c, negatedCtx, ctx); });
          return union(orSets);
        }
        case 'not': {
          var childIds = evalNode(node.child, !negatedCtx, ctx);
          var childSet = new Set(childIds);
          return allIndexedFileIds().filter(function (fid) { return !childSet.has(fid); });
        }
        case 'leaf': {
          var clause = node.clause;
          var ids;
          if (clause.field === 'tag') {
            var fids = ctx.tagFileIdSets.get(String(clause.text).toLowerCase()); // tag names are always lowercase
            ids = fids ? Array.from(fids) : [];
          } else {
            var resolved = candidatesForClause(clause, ctx.opts);
            ids = resolved.ids;
            if (resolved.warning) ctx.warnings.push(resolved.warning);
          }
          if (!negatedCtx && !clause.negate) {
            ids.forEach(function (fid) {
              ctx.matchedFields[fid] = ctx.matchedFields[fid] || [];
              if (ctx.matchedFields[fid].indexOf(clause.field) === -1) ctx.matchedFields[fid].push(clause.field);
            });
          }
          if (clause.negate) {
            var idSet = new Set(ids);
            return allIndexedFileIds().filter(function (fid) { return !idSet.has(fid); });
          }
          return ids;
        }
        default:
          return [];
      }
    }

    /** Shared tail: scores/sorts/truncates a candidate id list into the search() result shape. */
    function buildSearchResult(candidates, matchedFields, warnings, limit) {
      var scored = candidates.map(function (fid) {
        var score = (matchedFields[fid] || []).reduce(function (s, f) { return s + (FIELD_WEIGHT[f] || 1); }, 0);
        return { fileId: fid, score: score };
      });
      scored.sort(function (a, b) {
        if (b.score !== a.score) return b.score - a.score;
        return (dateMs[b.fileId] || 0) - (dateMs[a.fileId] || 0);
      });

      var truncated = scored.length > limit;
      var dupCounts = duplicateCountArray();
      var results = scored.slice(0, limit).map(function (s) {
        var fid = s.fileId;
        return {
          fileId: fid, path: paths[fid], subject: subjects[fid], fromAddr: fromAddrs[fid],
          fromName: fromNames[fid], dateMs: dateMs[fid], size: sizes[fid], attCount: attCounts[fid],
          urlCount: urlCounts[fid], recipientCount: recipientCounts[fid], duplicateCount: dupCounts[fid],
          auth: authInfo[fid], score: s.score, matchedFields: matchedFields[fid] || [],
          nameMismatch: !!nameMismatchFlags[fid], lookalikeDomain: !!lookalikeDomainFlags[fid], punycodeSender: !!punycodeSenderFlags[fid],
          urgencyScore: urgencyScores[fid] || 0, financialIndicators: financialIndicatorsPerFile[fid] || [],
          domainCategories: domainCategoriesPerFile[fid] || []
        };
      });
      return { results: results, total: scored.length, truncated: truncated, warnings: warnings };
    }

    function search(queryString, opts) {
      opts = opts || {};
      var qtrim = queryString.trim();
      if (!qtrim) return Promise.resolve({ results: [], matchedFields: {}, warnings: [] });

      // VSCode-style "files to include/exclude" — compiled once per call (not once per file), applied
      // as a final filter over the resolved candidate id list, so it composes with every existing leaf/
      // AND/OR/NOT/regex-mode combination without touching any of that logic.
      var pathFilters = EV.compilePathFilters(opts.include, opts.exclude);
      function byPathFilter(fid) { return EV.matchesPathFilters(paths[fid], pathFilters); }

      // The "Use Regular Expression" toggle bypasses the field:/phrase/tag query grammar entirely
      // -- the whole box is one pattern, exactly like Raw search's own regex mode, rather than
      // trying to make regex compose with the rest of the grammar.
      if (opts.isRegex) {
        var g = candidatesForGlobalRegex(qtrim, !!opts.caseSensitive);
        var gWarnings = g.warning ? [g.warning] : ['Regex mode searches subject/from/to/attachment — use Raw search to match the full body.'];
        return Promise.resolve(buildSearchResult(g.ids.filter(byPathFilter), g.matchedFieldsById || {}, gWarnings, opts.limit || 500));
      }

      var tokens;
      try {
        tokens = tokenizeQuery(qtrim);
      } catch (e) {
        return Promise.resolve({ results: [], matchedFields: {}, warnings: ['couldn’t parse the search query — ' + (e && e.message ? e.message : e)] });
      }
      if (tokens.length === 0) return Promise.resolve({ results: [], matchedFields: {}, warnings: [] });

      var parsed;
      try {
        parsed = parseTokens(tokens);
      } catch (e) {
        parsed = { node: null, error: 'couldn’t parse the search query — ' + (e && e.message ? e.message : e) };
      }

      var warnings = [];
      if (opts.caseSensitive) warnings.push('Case-sensitive verifies subject/from/to/attachment only — body/header text matches are not case-checked.');
      if (parsed.error) warnings.push(parsed.error);
      if (!parsed.node) {
        return Promise.resolve({ results: [], matchedFields: {}, warnings: warnings });
      }
      var ast = parsed.node;

      var hasTagClause = astHasTagLeaf(ast);
      var tagLookup = hasTagClause ? EV.tags.getAll() : Promise.resolve(null);

      return tagLookup.then(function (allTagRecords) {
        var ctx = {
          warnings: warnings,
          matchedFields: {},
          tagFileIdSets: hasTagClause ? buildTagFileIdSets(allTagRecords) : new Map(),
          opts: opts
        };

        var candidates;
        try {
          candidates = evalNode(ast, false, ctx);
        } catch (e) {
          ctx.warnings.push('search failed unexpectedly — matched nothing (' + (e && e.message ? e.message : e) + ')');
          candidates = [];
        }
        candidates = candidates.filter(byPathFilter);

        return buildSearchResult(candidates, ctx.matchedFields, ctx.warnings, opts.limit || 500);
      });
    }

    return {
      startIndexing: startIndexing,
      cancel: cancel,
      search: search,
      // TEST-ONLY hooks: let tests/searchIndex.test.js feed synthetic per-file
      // docs into a real index instance (via ingestDoc) and reset between
      // scenarios (via reset), without needing the whole Worker/workspace
      // ingestion pipeline. Not used by the app itself.
      ingestDocForTest: ingestDoc,
      resetForTest: reset,
      addOcrText: addOcrText,
      /** Attachment extensions seen in this folder (with the leading dot), most common first -- feeds autocomplete. */
      attachmentExts: function () {
        return Array.from(attExtCounts.entries()).map(function (e) { return { name: e[0], count: e[1] }; })
          .sort(function (a, b) { return b.count - a.count || (a.name < b.name ? -1 : 1); });
      },
      /** Domain categories seen in this folder with how many emails have each -- feeds meta.category: autocomplete. */
      categoryNames: function () {
        return Array.from(categoryCounts.entries()).map(function (e) { return { name: e[0], count: e[1] }; })
          .sort(function (a, b) { return b.count - a.count || (a.name < b.name ? -1 : 1); });
      },
      /** Header names seen in this folder, most common first -- feeds the search help panel. */
      headerNames: function () {
        return Array.from(headerNameCounts.entries()).map(function (e) { return { name: e[0], count: e[1] }; })
          .sort(function (a, b) { return b.count - a.count || (a.name < b.name ? -1 : 1); });
      },
      /** How many indexed emails have their decoded text retained for any-substring search (rest: whole-word only). */
      textCoverage: function () { return { retained: retainedDocs, total: allIndexedFileIds().length - skippedCount }; },
      setRetainedBudgetForTest: function (n) { retainedBudget = n; },
      ocrStats: ocrStats,
      flagCounts: flagCounts,
      isRunning: function () { return running; },
      stats: function () { return { total: total, indexed: indexedCount, skipped: skippedCount }; },
      skippedFiles: function () { return skippedFileList.slice(); },
      fileIdForPath: function (path) { return pathToFileId.get(path); },
      /** {subject, fromAddr} for one already-indexed path -- feeds the Rules panel's "View matches"
       * list, which needs to render rows the same way Search results do without re-running a search. */
      docSummaryForPath: function (path) {
        var fid = pathToFileId.get(path);
        if (fid === undefined) return null;
        return { subject: subjects[fid] || '', fromAddr: fromAddrs[fid] || '' };
      },
      emailIdForPath: function (path) {
        var fid = pathToFileId.get(path);
        return fid === undefined ? null : (emailIds[fid] || null);
      },
      pathsByEmailId: function () {
        var map = new Map();
        for (var fid = 0; fid < emailIds.length; fid++) {
          var eid = emailIds[fid];
          if (!eid) continue;
          var arr = map.get(eid);
          if (!arr) { arr = []; map.set(eid, arr); }
          arr.push(paths[fid]);
        }
        return map;
      },
      /**
       * Aggregates indicator counts across every currently-indexed email in
       * the open folder — sender domains, URL/link domains, and attachment
       * extensions — for a one-click IOC dump instead of reading them off
       * one email at a time. Each count is "N emails referenced this value",
       * not "N times this value appeared" (a domain repeated 5x in one body
       * counts once for that email), which is the more useful number for
       * "how many messages touch this domain". An optional `pathSet` (a
       * Set of paths) narrows this to just those emails — e.g. the caller's
       * current search results or an explicit multi-selection — instead of
       * always covering the whole folder.
       */
      iocSummary: function (pathSet) {
        var senderDomains = new Map();
        var originIpCounts = new Map();
        var connectingIpCounts = new Map();
        var urlDomains = new Map();
        var attExts = new Map();
        var financialIndicatorTypes = new Map();
        var domainCategoryCounts = new Map();
        var senderAnomalies = 0;
        function bump(map, key) { if (!key) return; map.set(key, (map.get(key) || 0) + 1); }
        for (var fid = 0; fid < paths.length; fid++) {
          if (paths[fid] === undefined) continue; // hole from in-progress indexing
          if (pathSet && !pathSet.has(paths[fid])) continue;
          bump(senderDomains, fromDomains[fid]);
          bump(originIpCounts, originIps[fid]);
          bump(connectingIpCounts, connectingIps[fid]);
          (urlDomainsPerFile[fid] || []).forEach(function (d) { bump(urlDomains, d); });
          (attExtsPerFile[fid] || []).forEach(function (e) { bump(attExts, e); });
          (financialIndicatorsPerFile[fid] || []).forEach(function (t) { bump(financialIndicatorTypes, t); });
          (domainCategoriesPerFile[fid] || []).forEach(function (c) { bump(domainCategoryCounts, c); });
          if (nameMismatchFlags[fid] || lookalikeDomainFlags[fid] || punycodeSenderFlags[fid]) senderAnomalies++;
        }
        function toSortedArray(map) {
          return Array.from(map.entries())
            .map(function (e) { return { value: e[0], count: e[1] }; })
            .sort(function (a, b) { return b.count - a.count || a.value.localeCompare(b.value); });
        }
        return {
          senderDomains: toSortedArray(senderDomains),
          originIps: toSortedArray(originIpCounts),
          connectingIps: toSortedArray(connectingIpCounts),
          urlDomains: toSortedArray(urlDomains),
          attachmentExtensions: toSortedArray(attExts),
          financialIndicatorTypes: toSortedArray(financialIndicatorTypes),
          domainCategories: toSortedArray(domainCategoryCounts),
          senderAnomalyCount: senderAnomalies
        };
      }
    };
  };
})(typeof self !== 'undefined' ? self : this);
