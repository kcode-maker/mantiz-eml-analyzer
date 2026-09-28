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
 * words present", not strict adjacency — see README for why), and
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

  // field:/pattern/i — supported only on fields whose raw (untokenized)
  // string is retained per-file (checked below), since regex needs to run
  // against the real text, not word postings. Not anchored to word
  // boundaries; test it against the whole stored value for that field.
  var REGEX_VALUE_RE = /^\/(.+)\/([a-z]*)$/i;
  var REGEX_ELIGIBLE_FIELDS = { subject: 1, from: 1, to: 1, cc: 1, bcc: 1, replyto: 1, returnpath: 1, attachment: 1 };

  var SIZE_UNIT_MULTIPLIER = { b: 1, kb: 1024, mb: 1024 * 1024, gb: 1024 * 1024 * 1024 };
  // query field name -> internal per-file numeric array name
  var NUMERIC_FIELDS = { 'attachment.count': 'attCounts', size: 'sizes', urls: 'urlCounts', recipients: 'recipientCounts', duplicates: 'duplicateCounts', urgency: 'urgencyScores' };
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
    var attNamesRaw = [];
    var nameMismatchFlags = [];
    var lookalikeDomainFlags = [];
    var punycodeSenderFlags = [];
    var urgencyScores = [];
    var financialIndicatorsPerFile = [];
    var domainCategoriesPerFile = [];
    var emailIds = [];
    var skippedFileList = []; // [{path, reason}] -- files that failed to parse or were too large, surfaced in the UI instead of only folded into a count
    var authInfo = []; // { spf, dkim, dmarc }
    var fieldIndex = {};
    FIELDS.forEach(function (f) { fieldIndex[f] = new Map(); });
    var pathToFileId = new Map();
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
      attNamesRaw[doc.fileId] = doc.attNames || '';
      nameMismatchFlags[doc.fileId] = !!doc.nameMismatch;
      lookalikeDomainFlags[doc.fileId] = !!doc.lookalikeDomain;
      punycodeSenderFlags[doc.fileId] = !!doc.punycodeSender;
      urgencyScores[doc.fileId] = doc.urgencyScore || 0;
      financialIndicatorsPerFile[doc.fileId] = doc.financialIndicators || [];
      domainCategoriesPerFile[doc.fileId] = doc.domainCategories || [];
      emailIds[doc.fileId] = doc.emailId || null;
      authInfo[doc.fileId] = { spf: doc.spf, dkim: doc.dkim, dmarc: doc.dmarc };
      pathToFileId.set(doc.path, doc.fileId);
      if (doc.skipped) {
        skippedCount++;
        skippedFileList.push({ path: doc.path, reason: doc.error || doc.subject || 'skipped' });
        return;
      }
      var ft = doc.fieldTokens || {};
      FIELDS.forEach(function (field) {
        (ft[field] || []).forEach(function (tok) { addPosting(field, tok, doc.fileId); });
      });
    }

    function reset() {
      paths = []; subjects = []; fromAddrs = []; fromNames = []; toStrs = [];
      ccStrs = []; bccStrs = []; replyToStrs = []; returnPathStrs = []; messageIds = [];
      dateMs = []; sizes = []; attCounts = []; urlCounts = []; recipientCounts = []; emailIds = []; authInfo = [];
      fromDomains = []; urlDomainsPerFile = []; attExtsPerFile = []; attSha256PerFile = []; attNamesRaw = []; skippedFileList = [];
      nameMismatchFlags = []; lookalikeDomainFlags = []; punycodeSenderFlags = [];
      urgencyScores = []; financialIndicatorsPerFile = []; domainCategoriesPerFile = [];
      FIELDS.forEach(function (f) { fieldIndex[f] = new Map(); });
      pathToFileId = new Map();
      ocrCoveredFileIds = new Set();
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
        taskOpts: { trustedDomains: opts.trustedDomains || [], domainCategories: opts.domainCategories || [] },
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
      ocrCoveredFileIds.add(fileId);
    }

    /** How many currently-indexed emails have at least one OCR'd attachment -- feeds the
     * "not exhaustive" coverage note next to attachment.ocr: search results. */
    function ocrStats() {
      return { coveredCount: ocrCoveredFileIds.size };
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
    var FIELD_NAME_RE = /^[\w]+(?:\.[\w]+)?/;

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
        return { field: 'attachment.ext', extMatch: true, text: valueRaw.toLowerCase(), negate: negate };
      }
      if (rawField === 'attachment.sha256') {
        return { field: 'attachment.sha256', sha256Match: true, text: valueRaw.trim().toLowerCase(), negate: negate };
      }
      if (rawField === 'header.messageid') {
        return { field: 'header.messageid', exactMatch: true, text: valueRaw.trim().toLowerCase(), negate: negate };
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

    function postingsForToken(field, token) {
      if (field === 'any') return union(FIELDS.map(function (f) { return fieldIndex[f].get(token) || []; }));
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
      var ids = allIndexedFileIds().filter(function (fid) { return re.test(fieldRawText(clause.field, fid)); });
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
          if (re.test(fieldRawText(f, fid))) {
            hit = true;
            var list = matchedFieldsById[fid] || (matchedFieldsById[fid] = []);
            if (list.indexOf(f) === -1) list.push(f);
          }
        });
        if (hit) ids.push(fid);
      });
      return { ids: ids, warning: null, matchedFieldsById: matchedFieldsById };
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
      if (clause.exactMatch) {
        if (!clause.text) return { ids: [], warning: '"header.messageid:" needs a value' };
        var midIds = allIndexedFileIds().filter(function (fid) { return messageIds[fid] === clause.text; });
        return { ids: midIds, warning: null };
      }
      var tokens = EV.tokenize(clause.text);
      if (tokens.length === 0) {
        return { ids: [], warning: '"' + clause.text + '" is too short to search on (minimum 2 characters) — matched nothing rather than everything' };
      }
      var sets = tokens.map(function (t) { return postingsForToken(clause.field, t); });
      sets.sort(function (a, b) { return a.length - b.length; });
      var result = sets[0] || [];
      for (var i = 1; i < sets.length; i++) result = intersect(result, sets[i]);
      // The inverted index is case-folded, so exact-case verification (a quoted phrase, always;
      // or ANY term while the "Match Case" toggle is on) can only be checked against the
      // fields with retained raw text -- same scope regex is limited to, above.
      var verifiableField = RAW_TEXT_FIELDS.indexOf(clause.field) !== -1 || clause.field === 'any';
      if (verifiableField && (clause.phrase || opts.caseSensitive)) {
        var needle = opts.caseSensitive ? clause.text : clause.text.toLowerCase();
        result = result.filter(function (fid) {
          return RAW_TEXT_FIELDS.some(function (f) {
            var t = fieldRawText(f, fid);
            if (!opts.caseSensitive) t = t.toLowerCase();
            return t.indexOf(needle) !== -1;
          });
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
            var fids = ctx.tagFileIdSets.get(clause.text);
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
      ocrStats: ocrStats,
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
