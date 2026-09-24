/**
 * rulesEngine.js — runs enabled tagging rules across the open workspace
 * (parallel over the worker pool, same infrastructure as search indexing),
 * then diffs each rule's new match set against its previously recorded one
 * (rulesStore) and applies exactly the tag adds/removes needed — so
 * re-running after editing a rule, or after new mail arrives, converges
 * tags to the correct state rather than just piling more on.
 *
 * Disabling a rule never needs a re-scan at all: rulesStore already knows
 * precisely which emails this rule tagged, so retracting is instant.
 */
(function (g) {
  'use strict';
  var EV = g.EV || (g.EV = {});

  EV.createRulesEngine = function (pool) {
    function runRules(workspace, rules, opts) {
      opts = opts || {};
      if (!rules.length) return Promise.resolve({ total: 0, matched: {}, errorCount: 0 });

      var allFiles = EV.flattenFileNodes(workspace.root).filter(function (n) { return EV.isEmlFile(n.name); });
      var fileEntries = allFiles.map(function (n, i) { return { fileId: i, entry: n.entry }; });
      var currentMatches = {};
      rules.forEach(function (r) { currentMatches[r.id] = new Set(); });
      var errorCount = 0;
      var ruleErrorSamples = {};

      var thinRules = rules.map(function (r) { return { id: r.id, expression: r.expression }; });

      // Read once per run, not per file -- the spoof-detection helpers (f.nameMismatch/
      // f.lookalikeDomain/f.domainIsTrusted) and f.domainCategories need the user's
      // Settings-configured trusted-domains/domain-categories lists threaded into the same taskOpts
      // already carrying the rules themselves.
      return Promise.all([EV.settings.trustedDomains(), EV.settings.domainCategories()]).then(function (res) {
        var trustedDomains = res[0], domainCategories = res[1];
        return EV.runOverFileEntries(pool, fileEntries, {
          taskType: 'evalRules',
          taskOpts: { rules: thinRules, trustedDomains: trustedDomains, domainCategories: domainCategories },
          batchSize: opts.batchSize || 40,
          isCancelled: opts.isCancelled,
          onProgress: opts.onProgress,
          onBatch: function (msg) {
            (msg.ruleResults || []).forEach(function (r) {
              if (r.errors && r.errors.length) {
                errorCount += r.errors.length;
                r.errors.forEach(function (e) {
                  if (e.ruleId && !ruleErrorSamples[e.ruleId]) ruleErrorSamples[e.ruleId] = e.message;
                });
              }
              if (!r.emailId) return;
              (r.matchedRuleIds || []).forEach(function (rid) {
                if (currentMatches[rid]) currentMatches[rid].add(r.emailId);
              });
            });
          }
        });
      }).then(function (result) {
        if (result.cancelled) {
          // Only part of the folder was scanned — applying the normal add/remove
          // diff here would incorrectly untag files that still match but simply
          // weren't reached yet. Leave every existing tag/match record alone.
          var partialStats = {};
          rules.forEach(function (rule) { partialStats[rule.id] = { matched: null, total: result.total, checked: result.processed, errorCount: errorCount, error: ruleErrorSamples[rule.id] || null, ranAt: Date.now(), cancelled: true }; });
          return { total: result.total, cancelled: true, statsByRule: partialStats };
        }
        return Promise.all([EV.rulesStore.getAllMatches(), EV.rulesStore.list()]).then(function (res) {
          var prevRecords = res[0];
          var liveRules = res[1];
          // Re-check each rule's CURRENT enabled/existence state right before
          // applying tag diffs: this scan may have taken a while, and if the
          // user disabled (or deleted) a rule mid-run, disableRule() already
          // instantly retracted its tags — applying this stale snapshot's
          // diff for that rule would resurrect tags the user just turned off.
          var liveById = {};
          liveRules.forEach(function (r) { liveById[r.id] = r; });
          var prevByRule = {};
          prevRecords.forEach(function (rec) {
            if (!prevByRule[rec.ruleId]) prevByRule[rec.ruleId] = new Set();
            prevByRule[rec.ruleId].add(rec.emailId);
          });
          var ops = [];
          var matchedCounts = {};
          rules.forEach(function (rule) {
            var live = liveById[rule.id];
            if (!live || !live.enabled) { matchedCounts[rule.id] = null; return; }
            var now = currentMatches[rule.id] || new Set();
            var before = prevByRule[rule.id] || new Set();
            matchedCounts[rule.id] = now.size;
            now.forEach(function (eid) {
              if (!before.has(eid)) {
                ops.push(EV.tags.addTag(eid, rule.tag, { type: 'rule', ruleId: rule.id }).then(function () { return EV.rulesStore.recordMatch(rule.id, eid); }));
              }
            });
            before.forEach(function (eid) {
              if (!now.has(eid)) {
                ops.push(EV.tags.removeTag(eid, rule.tag, { type: 'rule', ruleId: rule.id }).then(function () { return EV.rulesStore.unrecordMatch(rule.id, eid); }));
              }
            });
          });
          return Promise.all(ops).then(function () {
            var statsByRule = {};
            rules.forEach(function (rule) {
              statsByRule[rule.id] = { matched: matchedCounts[rule.id], total: result.total, errorCount: errorCount, error: ruleErrorSamples[rule.id] || null, ranAt: Date.now() };
            });
            return { total: result.total, matched: matchedCounts, errorCount: errorCount, cancelled: result.cancelled, statsByRule: statsByRule };
          });
        });
      });
    }

    /** Instant: retracts exactly the tag/email pairs this rule previously matched, no re-scan. */
    function disableRule(rule) {
      return EV.rulesStore.getMatchesForRule(rule.id).then(function (emailIds) {
        return Promise.all(emailIds.map(function (eid) {
          return EV.tags.removeTag(eid, rule.tag, { type: 'rule', ruleId: rule.id }).then(function () { return EV.rulesStore.unrecordMatch(rule.id, eid); });
        }));
      }).then(function () { return { retracted: true }; });
    }

    /** Dry run for the rule editor's "Test" button: no tagging side effects. */
    function testRule(workspace, expression, opts) {
      opts = opts || {};
      var allFiles = EV.flattenFileNodes(workspace.root).filter(function (n) { return EV.isEmlFile(n.name); });
      var limit = opts.limit || 2000;
      var fileEntries = allFiles.slice(0, limit).map(function (n, i) { return { fileId: i, entry: n.entry }; });
      var matches = [];
      var errorSample = null;
      var pathByFileId = {};
      fileEntries.forEach(function (fe) { pathByFileId[fe.fileId] = fe.entry.path; });

      return Promise.all([EV.settings.trustedDomains(), EV.settings.domainCategories()]).then(function (res) {
        return EV.runOverFileEntries(pool, fileEntries, {
          taskType: 'evalRules',
          taskOpts: { rules: [{ id: '__test__', expression: expression }], trustedDomains: res[0], domainCategories: res[1] },
          batchSize: 30,
          onBatch: function (msg) {
            (msg.ruleResults || []).forEach(function (r) {
              if (r.errors && r.errors.length && !errorSample) errorSample = r.errors[0].message;
              if (r.matchedRuleIds && r.matchedRuleIds.indexOf('__test__') !== -1) {
                matches.push({ path: r.path });
              }
            });
          }
        });
      }).then(function (result) {
        return { checked: result.total, matched: matches.length, samplePaths: matches.slice(0, 8).map(function (m) { return m.path; }), error: errorSample, truncated: allFiles.length > limit };
      });
    }

    return { runRules: runRules, disableRule: disableRule, testRule: testRule };
  };
})(typeof self !== 'undefined' ? self : this);
