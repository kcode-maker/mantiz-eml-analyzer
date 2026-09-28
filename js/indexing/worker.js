/**
 * worker.js — pool worker entry point. Deliberately thin: all real logic
 * lives in indexLogic.js (shared with the main-thread fallback path) so
 * behavior is identical whether or not Workers are available.
 */
importScripts('../parsing/emlParser.js', '../parsing/urlExtract.js', 'indexLogic.js');

self.onmessage = async function (e) {
  var msg = e.data;
  try {
    if (msg.type === 'indexBatch') {
      var docs = [];
      for (var i = 0; i < msg.files.length; i++) {
        var f = msg.files[i];
        try {
          var buf = await f.blob.arrayBuffer();
          docs.push(await self.EV.buildIndexDoc(f.fileId, f.path, buf, msg.opts));
        } catch (err) {
          docs.push({ fileId: f.fileId, path: f.path, subject: '(failed to parse)', fromName: '', fromAddr: '',
            toStr: '', dateMs: null, size: f.blob.size || 0, attNames: '', urlCount: 0, fieldTokens: {}, skipped: true, error: String(err) });
        }
      }
      self.postMessage({ id: msg.id, type: 'batchDone', docs: docs });
    } else if (msg.type === 'rawScanBatch') {
      var results = [];
      for (var j = 0; j < msg.files.length; j++) {
        var rf = msg.files[j];
        try {
          var rbuf = await rf.blob.arrayBuffer();
          var r = self.EV.rawScanFile(rf.fileId, rf.path, rbuf, msg.opts);
          if (r) {
            // Invalid regex applies to every file in the batch identically —
            // fail the whole batch fast instead of repeating the same error.
            if (r.error) { self.postMessage({ id: msg.id, type: 'error', error: r.error }); return; }
            results.push(r);
          }
        } catch (err) {
          // A single unreadable/corrupt file must not discard the matches
          // already found in the rest of this batch.
        }
      }
      self.postMessage({ id: msg.id, type: 'batchDone', results: results });
    } else if (msg.type === 'evalRules') {
      var ruleResults = [];
      for (var k = 0; k < msg.files.length; k++) {
        var ef = msg.files[k];
        try {
          var ebuf = await ef.blob.arrayBuffer();
          ruleResults.push(self.EV.evalRulesForFile(ef.fileId, ef.path, ebuf, msg.opts.rules, msg.opts));
        } catch (err) {
          ruleResults.push({ fileId: ef.fileId, path: ef.path, emailId: null, matchedRuleIds: [], errors: [{ ruleId: null, message: String(err) }] });
        }
      }
      self.postMessage({ id: msg.id, type: 'batchDone', ruleResults: ruleResults });
    } else {
      self.postMessage({ id: msg.id, type: 'error', error: 'Unknown message type: ' + msg.type });
    }
  } catch (err) {
    self.postMessage({ id: msg.id, type: 'error', error: String(err && err.stack || err) });
  }
};
