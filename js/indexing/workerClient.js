/**
 * workerClient.js — a small pool of Web Workers (one per CPU core, feature-
 * detected) that run indexLogic.js's batch functions, plus a synchronous
 * (but non-blocking, yielding) main-thread fallback for when Workers aren't
 * available (e.g. opened via plain file://). Callers never need to know
 * which mode is active.
 *
 * Also provides runOverFileEntries(): a concurrency-limited driver that
 * streams a huge file list through the pool in small batches, so memory use
 * stays bounded (only `concurrency * batchSize` files are ever in flight at
 * once) no matter whether the folder has 50 or 500,000 messages.
 */
(function (g) {
  'use strict';
  var EV = g.EV || (g.EV = {});

  EV.createWorkerPool = function (scriptUrl, size) {
    size = size || Math.max(2, Math.min(8, (g.navigator && g.navigator.hardwareConcurrency) || 4));
    var workers = [];
    var freeWorkers = [];
    var seq = 0;
    var pending = {};
    var queue = [];
    var usingWorkers = typeof g.Worker !== 'undefined';
    // Tracks which job id each live worker is currently executing, so a
    // worker-level 'error' event (a thrown error the worker itself never
    // caught, e.g. an unhandled exception mid-message) can reject the right
    // pending task instead of leaving it to hang forever.
    var workerJob = new Map();

    function onWorkerMessage(e) {
      var msg = e.data;
      var task = pending[msg.id];
      workerJob.delete(this);
      if (!task) { freeWorkers.push(this); drain(); return; }
      delete pending[msg.id];
      freeWorkers.push(this);
      if (msg.type === 'error') task.reject(new Error(msg.error));
      else task.resolve(msg);
      drain();
    }

    function spawnWorker() {
      var w = new g.Worker(scriptUrl);
      w.onmessage = onWorkerMessage;
      w.onerror = function (ev) {
        console.error('Mantiz-EML-Analyzer worker error', ev.message);
        var jobId = workerJob.get(w);
        workerJob.delete(w);
        // Remove the crashed worker so it's never handed another job.
        var wi = workers.indexOf(w);
        if (wi !== -1) workers.splice(wi, 1);
        var fi = freeWorkers.indexOf(w);
        if (fi !== -1) freeWorkers.splice(fi, 1);
        if (jobId != null && pending[jobId]) {
          pending[jobId].reject(new Error('Worker crashed: ' + ev.message));
          delete pending[jobId];
        }
        // Replace it so the pool's throughput doesn't shrink permanently.
        if (usingWorkers) {
          try {
            var replacement = spawnWorker();
            workers.push(replacement);
            freeWorkers.push(replacement);
          } catch (e) { /* replacement failed; pool just runs one worker smaller */ }
        }
        drain();
      };
      return w;
    }

    function spawnAll() {
      try {
        for (var i = 0; i < size; i++) {
          var w = spawnWorker();
          workers.push(w);
          freeWorkers.push(w);
        }
      } catch (e) {
        usingWorkers = false;
        workers = [];
        freeWorkers = [];
      }
    }
    if (usingWorkers) spawnAll();

    function drain() {
      while (freeWorkers.length && queue.length) {
        var w = freeWorkers.shift();
        var job = queue.shift();
        pending[job.id] = job;
        workerJob.set(w, job.id);
        w.postMessage(job.message);
      }
    }

    async function fallbackRun(id, type, files, opts) {
      var out = { id: id, type: 'batchDone' };
      var list = type === 'indexBatch' ? [] : [];
      for (var i = 0; i < files.length; i++) {
        var f = files[i];
        if (type === 'indexBatch') {
          try {
            var buf = await f.blob.arrayBuffer();
            list.push(EV.buildIndexDoc(f.fileId, f.path, buf, opts));
          } catch (err) {
            list.push({ fileId: f.fileId, path: f.path, subject: '(failed to parse)', fromName: '', fromAddr: '',
              toStr: '', dateMs: null, size: f.blob.size || 0, attNames: '', urlCount: 0, fieldTokens: {}, skipped: true, error: String(err) });
          }
        } else if (type === 'rawScanBatch') {
          try {
            var rbuf = await f.blob.arrayBuffer();
            var r = EV.rawScanFile(f.fileId, f.path, rbuf, opts);
            if (r) {
              if (r.error) throw new Error(r.error); // invalid regex — applies to the whole batch, fail fast
              list.push(r);
            }
          } catch (err) {
            if (err instanceof Error && /^Invalid regex/.test(err.message)) throw err;
            // else: a single unreadable/corrupt file — skip it, keep the rest of the batch's matches
          }
        } else if (type === 'evalRules') {
          try {
            var rbuf2 = await f.blob.arrayBuffer();
            list.push(EV.evalRulesForFile(f.fileId, f.path, rbuf2, opts.rules, opts));
          } catch (err) {
            list.push({ fileId: f.fileId, path: f.path, emailId: null, matchedRuleIds: [], errors: [{ ruleId: null, message: String(err) }] });
          }
        }
        if ((i & 3) === 3) await new Promise(function (res) { g.setTimeout(res, 0); });
      }
      if (type === 'indexBatch') out.docs = list;
      else if (type === 'evalRules') out.ruleResults = list;
      else out.results = list;
      return out;
    }

    function runBatch(type, files, opts) {
      var id = ++seq;
      if (usingWorkers) {
        return new Promise(function (resolve, reject) {
          queue.push({ id: id, resolve: resolve, reject: reject, message: { id: id, type: type, files: files, opts: opts } });
          drain();
        });
      }
      return fallbackRun(id, type, files, opts);
    }

    return {
      isUsingWorkers: function () { return usingWorkers; },
      poolSize: function () { return usingWorkers ? workers.length : 1; },
      runBatch: runBatch,
      terminateAll: function () {
        workers.forEach(function (w) { w.terminate(); });
        workers = [];
        freeWorkers = [];
        workerJob.clear();
        queue.forEach(function (job) { job.reject(new Error('cancelled')); });
        queue = [];
        Object.keys(pending).forEach(function (id) { pending[id].reject(new Error('cancelled')); });
        pending = {};
        // Without this, a runBatch() call after terminateAll() would still take
        // the "usingWorkers" branch and queue jobs that no worker is left to
        // drain, hanging forever instead of falling back to the main thread.
        usingWorkers = false;
      }
    };
  };

  /**
   * Streams `fileEntries` through `pool` in small batches with bounded
   * concurrency (backpressure), so only a small window of files is ever
   * resident in memory at once.
   *
   * @param {object} pool
   * @param {Array<{fileId:number, entry:object}>} fileEntries
   * @param {{taskType:string, taskOpts?:object, batchSize?:number, concurrency?:number,
   *          onBatch?:Function, onProgress?:Function, onError?:Function, isCancelled?:Function}} opts
   */
  EV.runOverFileEntries = function (pool, fileEntries, opts) {
    var batchSize = opts.batchSize || 40;
    var concurrency = opts.concurrency || pool.poolSize() * 2;
    var total = fileEntries.length;
    var nextIndex = 0;
    var doneCount = 0;
    var inFlight = 0;
    var settled = false;

    return new Promise(function (resolve) {
      function finish(result) {
        if (settled) return;
        settled = true;
        resolve(result);
      }
      function maybeDone() {
        if (nextIndex >= total && inFlight === 0) finish({ done: true, total: total, processed: doneCount });
      }
      function pump() {
        if (settled) return;
        while (inFlight < concurrency && nextIndex < total) {
          if (opts.isCancelled && opts.isCancelled()) {
            finish({ done: false, cancelled: true, total: total, processed: doneCount });
            return;
          }
          var batch = fileEntries.slice(nextIndex, nextIndex + batchSize);
          nextIndex += batch.length;
          inFlight++;
          Promise.all(batch.map(function (fe) {
            return fe.entry.getFile().then(function (blob) {
              return { fileId: fe.fileId, path: fe.entry.path, blob: blob };
            });
          })).then(function (files) {
            return pool.runBatch(opts.taskType, files, opts.taskOpts);
          }).then(function (msg) {
            inFlight--;
            doneCount += batch.length;
            if (opts.onBatch) opts.onBatch(msg, batch);
            if (opts.onProgress) opts.onProgress(doneCount, total);
            maybeDone();
            pump();
          }).catch(function (err) {
            inFlight--;
            doneCount += batch.length;
            if (opts.onError) opts.onError(err, batch);
            maybeDone();
            pump();
          });
        }
      }
      pump();
    });
  };
})(typeof self !== 'undefined' ? self : this);
