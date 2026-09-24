/**
 * rawSearch.js — greps the untouched original bytes of every file in the
 * open workspace, in parallel across the worker pool, streaming match
 * batches back to the caller as they're found (no pre-built index needed,
 * so this is available immediately even on a folder that's still being
 * decoded-indexed in the background). Cancelable.
 */
(function (g) {
  'use strict';
  var EV = g.EV || (g.EV = {});

  EV.createRawSearch = function (pool) {
    var cancelled = false;
    var running = false;
    // Bumped on every search() call so a previous, still in-flight raw search
    // (e.g. the user changed the query and hit Search again before the first
    // scan finished) stops delivering onMatches/onProgress once it's been
    // superseded, instead of interleaving two searches' results together.
    var epoch = 0;

    function search(workspace, query, opts) {
      opts = opts || {};
      cancelled = false;
      epoch++;
      var myEpoch = epoch;
      running = true;
      var allFiles = EV.flattenFileNodes(workspace.root).filter(function (n) { return EV.isEmlFile(n.name); });
      var fileEntries = allFiles.map(function (n, i) { return { fileId: i, entry: n.entry }; });

      return EV.runOverFileEntries(pool, fileEntries, {
        taskType: 'rawScanBatch',
        taskOpts: { query: query, isRegex: !!opts.isRegex, caseSensitive: !!opts.caseSensitive },
        batchSize: opts.batchSize || 16,
        concurrency: opts.concurrency,
        isCancelled: function () { return cancelled || epoch !== myEpoch; },
        onBatch: function (msg) {
          if (epoch !== myEpoch) return;
          if (opts.onMatches && msg.results && msg.results.length) opts.onMatches(msg.results);
        },
        onProgress: function (done, totalN) {
          if (epoch !== myEpoch) return;
          if (opts.onProgress) opts.onProgress(done, totalN);
        },
        onError: opts.onError
      }).then(function (result) {
        if (epoch !== myEpoch) return result;
        running = false;
        return result;
      });
    }

    function cancel() { cancelled = true; }

    return { search: search, cancel: cancel, isRunning: function () { return running; } };
  };
})(typeof self !== 'undefined' ? self : this);
