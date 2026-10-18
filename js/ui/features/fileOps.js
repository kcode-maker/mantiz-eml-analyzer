/**
 * fileOps.js — acting on emails from any list (Explorer, Search results, Tags, Rules): the right-click menu, Delete (to .deleted) / Move / Copy with their destination dialog, and the bulk "Extract OCR (selected)" action. File writes only ever happen as the direct result of the user choosing one of these actions.
 */
(function (g) {
  'use strict';
  var EV = g.EV || (g.EV = {});
  EV.ui = EV.ui || {};
  EV.ui.features = EV.ui.features || {};

  EV.ui.features.fileOps = function createFileOps(ctx) {
    var state = ctx.state, els = ctx.els, searchIdx = ctx.searchIdx;
    var basename = EV.ui.basename, claimDialogSlot = EV.ui.claimDialogSlot, copyToClipboard = EV.ui.copyToClipboard, el = EV.ui.el, showContextMenu = EV.ui.showContextMenu, showToast = EV.ui.showToast;
    // Exported to the other features (function declarations are hoisted, so these are valid before their definitions).
    ctx.showFileActionMenu = showFileActionMenu;

    function pathsToEntries(paths) {
      return paths.map(function (p) { return state.pathToEntry.get(p); }).filter(Boolean);
    }

    function reportFileOpResult(verb, result) {
      var msg = verb + ' ' + result.succeeded.length + ' email(s).';
      if (result.failed.length) {
        msg += ' ' + result.failed.length + ' failed: ' + result.failed.map(function (f) { return f.path + ' (' + f.error + ')'; }).join('; ');
      }
      EV.alertDialog(msg);
    }

    ctx.WRITE_UNAVAILABLE_TITLE = 'Only available when this folder was opened via "Open Folder" in Chrome/Edge, with write access granted.';

    function performDelete(paths) {
      EV.confirmDialog({
        title: 'Move ' + paths.length + ' email' + (paths.length === 1 ? '' : 's') + ' to .deleted?',
        message: 'They\'ll be removed from this folder\'s view (tree, search, rules) but not permanently deleted — recover them from the .deleted folder on disk any time.',
        confirmLabel: 'Move to .deleted', danger: true
      }).then(function (ok) { if (ok) doDelete(paths); });
    }

    function doDelete(paths) {
      var dirHandle = state.workspace.dirHandle;
      EV.ensureWritePermission(dirHandle).then(function (granted) {
        if (!granted) { EV.alertDialog('Write permission was not granted — nothing was changed.'); return null; }
        return EV.deleteEntries(pathsToEntries(paths), dirHandle).then(function (result) {
          reportFileOpResult('Deleted', result);
          return ctx.reloadWorkspaceFromHandle();
        });
      }).catch(function (err) { EV.alertDialog('Delete failed: ' + (err && err.message || err)); });
    }

    function performMoveCopy(paths, folderPath, mode) {
      var dirHandle = state.workspace.dirHandle;
      EV.ensureWritePermission(dirHandle).then(function (granted) {
        if (!granted) { EV.alertDialog('Write permission was not granted — nothing was changed.'); return null; }
        return EV.resolveFolderPath(dirHandle, folderPath).then(function (destHandle) {
          return EV.copyOrMoveEntries(pathsToEntries(paths), destHandle, mode === 'move').then(function (result) {
            reportFileOpResult(mode === 'move' ? 'Moved' : 'Copied', result);
            return ctx.reloadWorkspaceFromHandle();
          });
        });
      }).catch(function (err) { EV.alertDialog((mode === 'move' ? 'Move' : 'Copy') + ' failed: ' + (err && err.message || err)); });
    }

    function openMoveCopyDialog(paths, mode) {
      var overlay = el('div', 'ev-modal-overlay');
      if (!claimDialogSlot(overlay)) return;
      var modal = el('div', 'ev-modal');
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      var countLabel = paths.length === 1 ? '1 email' : paths.length + ' emails';
      modal.appendChild(el('h3', null, (mode === 'move' ? 'Move ' : 'Copy ') + countLabel + ' to folder'));

      modal.appendChild(el('label', 'ev-form-label', 'Existing folder'));
      var select = document.createElement('select');
      select.className = 'ev-form-input';
      var noneOpt = el('option', null, '— none, type a new name below —');
      noneOpt.value = '';
      select.appendChild(noneOpt);
      EV.listExistingFolders(state.workspace.root).forEach(function (f) {
        var o = el('option', null, f);
        o.value = f;
        select.appendChild(o);
      });
      modal.appendChild(select);

      modal.appendChild(el('label', 'ev-form-label', 'Or new folder name'));
      var input = document.createElement('input');
      input.type = 'text';
      input.className = 'ev-form-input';
      input.placeholder = 'e.g. campaign-invoice-fraud';
      modal.appendChild(input);

      select.addEventListener('change', function () { if (select.value) input.value = ''; });
      input.addEventListener('input', function () { if (input.value) select.value = ''; });

      var actions = el('div', 'ev-modal-actions');
      var cancelBtn = el('button', 'ev-btn', 'Cancel');
      var okBtn = el('button', 'ev-btn ev-btn-primary', mode === 'move' ? 'Move' : 'Copy');
      cancelBtn.onclick = function () { overlay.remove(); };
      okBtn.onclick = function () {
        var folderPath = select.value || EV.sanitizeFolderName(input.value);
        if (!folderPath) { EV.alertDialog('Pick an existing folder, or type a new folder name.'); return; }
        overlay.remove();
        performMoveCopy(paths, folderPath, mode);
      };
      actions.appendChild(cancelBtn);
      actions.appendChild(okBtn);
      modal.appendChild(actions);
      overlay.appendChild(modal);
      document.body.appendChild(overlay);
      input.focus();
    }

    var ocrBatchCancelled = false;

    var ocrBatchActive = false;

    function showOcrBatchStopButton(show) { els.btn_stop_ocr.style.display = show ? 'inline-block' : 'none'; }

    els.btn_stop_ocr.addEventListener('click', function () { ocrBatchCancelled = true; });

    /**
     * Bulk "Extract OCR (selected)" -- runs OCR on the first meaningful image attachment of each
     * selected email, one at a time (OCR is inherently serial: one page-session-scoped OCRClient,
     * see ocrBridge.js), pushing extracted text straight into the live search index exactly like a
     * single per-email OCR click does (window.EV.onOcrTextReady). Skips anything already cached
     * (EV.ocr.run checks the SHA-256 cache itself), so re-running this over an overlapping selection
     * only processes what's new. Deliberately scoped to whatever the user selected -- never "the
     * whole folder" at once -- this app is meant to scale to very large folders, and OCR runs
     * through one shared, sequential engine instance, so an unscoped whole-folder run could take hours.
     */
    function extractOcrForPaths(paths) {
      if (!window.EV.ocr || !window.EV.ocr.isSupported()) {
        EV.alertDialog('OCR isn’t available in this browser (createImageBitmap is missing).');
        return;
      }
      if (ocrBatchActive) {
        showToast('An OCR batch is already running — stop it first.');
        return;
      }
      ocrBatchCancelled = false;
      ocrBatchActive = true;
      showOcrBatchStopButton(true);
      els.status_ocr.style.display = 'inline-block';
      var total = paths.length, done = 0, ocrd = 0, noImage = 0, failed = 0;
      els.status_ocr.textContent = 'Extracting OCR… 0/' + total;

      function next(idx) {
        if (ocrBatchCancelled || idx >= paths.length) {
          ocrBatchActive = false;
          showOcrBatchStopButton(false);
          els.status_ocr.textContent = (ocrBatchCancelled ? 'OCR batch stopped — ' : 'OCR batch done — ') +
            ocrd.toLocaleString() + ' extracted' +
            (noImage ? ', ' + noImage.toLocaleString() + ' had no eligible image' : '') +
            (failed ? ', ' + failed.toLocaleString() + ' failed' : '') +
            ' (' + done.toLocaleString() + '/' + total.toLocaleString() + ' checked).';
          setTimeout(function () { if (!ocrBatchActive) els.status_ocr.style.display = 'none'; }, 8000);
          return Promise.resolve();
        }
        var path = paths[idx];
        var entry = state.pathToEntry.get(path);
        if (!entry) { noImage++; done++; return next(idx + 1); }
        return entry.getBytes().then(function (buf) {
          var parsed;
          try { parsed = EV.parseEml(buf); } catch (e) { parsed = null; }
          var att = parsed ? EV.pickFirstMeaningfulImageAttachment(parsed.attachments) : null;
          if (!att) { noImage++; done++; els.status_ocr.textContent = 'Extracting OCR… ' + done + '/' + total; return next(idx + 1); }
          if (!att._sha256Promise) att._sha256Promise = EV.sha256Hex(att.bytes);
          return window.EV.ocr.run(att).then(function (text) {
            ocrd++; done++;
            searchIdx.addOcrText(path, text);
            els.status_ocr.textContent = 'Extracting OCR… ' + done + '/' + total;
            return next(idx + 1);
          });
        }).catch(function () {
          failed++; done++;
          els.status_ocr.textContent = 'Extracting OCR… ' + done + '/' + total;
          return next(idx + 1);
        });
      }
      return next(0);
    }

    /** Builds the right-click menu for one or more selected email paths. Shared by the tree, and (later) Tags/Rules bulk actions. */
    function showFileActionMenu(x, y, paths) {
      var writable = EV.hasWriteCapableWorkspace(state.workspace);
      var label = paths.length === 1 ? '1 email' : paths.length + ' emails';
      var ocrAvailable = !!(window.EV.ocr && window.EV.ocr.isSupported());
      showContextMenu(x, y, [
        {
          label: 'Copy path' + (paths.length === 1 ? '' : 's'), icon: EV.iconSvg('copy'),
          title: state.folderBase ? null : 'The full location of this folder isn\u2019t known (browsers don\u2019t reveal it), so this is the path inside the opened folder.',
          onClick: function () { copyToClipboard(paths.map(ctx.fullPath).join('\n'), 'Copied ' + label + (state.folderBase ? ' full' : '') + ' path(s).'); }
        },
        state.folderBase ? {
          label: 'Copy relative path' + (paths.length === 1 ? '' : 's'), icon: EV.iconSvg('copy'),
          onClick: function () { copyToClipboard(paths.join('\n'), 'Copied ' + label + ' relative path(s).'); }
        } : null,
        {
          label: 'Copy file name' + (paths.length === 1 ? '' : 's'), icon: EV.iconSvg('file'),
          onClick: function () { copyToClipboard(paths.map(basename).join('\n'), 'Copied ' + label + ' file name(s).'); }
        },
        { separator: true },
        {
          label: 'Extract OCR (' + label + ')', icon: EV.iconSvg('magnifier'), disabled: !ocrAvailable,
          title: ocrAvailable
            ? 'Runs local OCR on each email’s first meaningful image (skips ones already cached) and makes the text searchable via attachment.ocr: — no network call, nothing executed, runs one email at a time.'
            : 'OCR isn’t available in this browser (createImageBitmap is missing).',
          onClick: function () { extractOcrForPaths(paths); }
        },
        { separator: true },
        {
          label: 'Delete ' + label + ' (to .deleted)', icon: EV.iconSvg('trash'), danger: true, disabled: !writable,
          title: writable ? 'Moves to a hidden .deleted folder — reversible, never shown by this app again.' : ctx.WRITE_UNAVAILABLE_TITLE,
          onClick: function () { performDelete(paths); }
        },
        {
          label: 'Move ' + label + ' to folder…', icon: EV.iconSvg('folderArrow'), disabled: !writable,
          title: writable ? null : ctx.WRITE_UNAVAILABLE_TITLE,
          onClick: function () { openMoveCopyDialog(paths, 'move'); }
        },
        {
          label: 'Copy ' + label + ' to folder…', icon: EV.iconSvg('copy'), disabled: !writable,
          title: writable ? null : ctx.WRITE_UNAVAILABLE_TITLE,
          onClick: function () { openMoveCopyDialog(paths, 'copy'); }
        }
      ].filter(Boolean));
    }

    EV.showFileActionMenu = showFileActionMenu;

  };
})(typeof self !== 'undefined' ? self : this);
