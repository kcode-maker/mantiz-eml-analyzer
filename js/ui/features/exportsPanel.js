/**
 * exportsPanel.js — moving data in and out: tag and rule export/import (JSON), the portable tags sidecar file that travels with the folder, and the Markdown case report.
 */
(function (g) {
  'use strict';
  var EV = g.EV || (g.EV = {});
  EV.ui = EV.ui || {};
  EV.ui.features = EV.ui.features || {};

  EV.ui.features.exportsPanel = function createExportsPanel(ctx) {
    var state = ctx.state, els = ctx.els, searchIdx = ctx.searchIdx;
    // Exported to the other features (function declarations are hoisted, so these are valid before their definitions).
    ctx.checkForTagsSidecar = checkForTagsSidecar;
    ctx.updateTagsSidecarButtonState = updateTagsSidecarButtonState;

    els.btn_export_tags.addEventListener('click', function () {
      EV.tags.exportJson().then(function (json) {
        var blob = new Blob([json], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'mantiz-eml-analyzer-tags-' + new Date().toISOString().slice(0, 10) + '.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      });
    });

    /** " N tag name(s) were converted ..." when an import held names outside the allowed format. */
    function renamedNote(renamed) {
      var olds = Object.keys(renamed || {});
      if (!olds.length) return '';
      return '\n\n' + olds.length + ' tag name' + (olds.length === 1 ? ' was' : 's were') +
        ' converted to the allowed format (lowercase a\u2013z, 0\u20139, - and _), e.g. "' + olds[0] + '" \u2192 "' + renamed[olds[0]] + '".';
    }

    els.btn_import_tags.addEventListener('click', function () { els.import_tags_input.click(); });

    els.import_tags_input.addEventListener('change', function () {
      var file = els.import_tags_input.files[0];
      if (!file) return;
      file.text().then(function (text) {
        return EV.tags.importJsonDetailed(text);
      }).then(function (res) {
        EV.alertDialog('Imported tag data for ' + res.records + ' email(s).' + renamedNote(res.renamed));
        window.EV.onTagsChanged();
      }).catch(function (err) {
        EV.alertDialog('Import failed: ' + err.message);
      });
      els.import_tags_input.value = '';
    });

    // A "Save to folder" button writes the same JSON EV.tags.exportJson() already produces as
    // mantiz-tags.json at the workspace root; opening that folder again later (even on a different
    // machine/browser) detects it and offers to load it back in -- fixes "switching machines loses
    // tags" without ever writing anything automatically (constraint #1: only an explicit user click).

    function updateTagsSidecarButtonState() {
      var writable = EV.hasWriteCapableWorkspace(state.workspace);
      els.btn_save_tags_sidecar.disabled = !writable;
      els.btn_save_tags_sidecar.title = writable
        ? 'Save all tags/notes as mantiz-tags.json in this folder, so they travel with it (e.g. to another machine/browser).'
        : ctx.WRITE_UNAVAILABLE_TITLE;
    }

    els.btn_save_tags_sidecar.addEventListener('click', function () {
      var dirHandle = state.workspace.dirHandle;
      EV.ensureWritePermission(dirHandle).then(function (granted) {
        if (!granted) { EV.alertDialog('Write permission was not granted — nothing was saved.'); return null; }
        return EV.tags.exportJson().then(function (json) { return EV.saveTagsSidecar(dirHandle, json); }).then(function () {
          EV.alertDialog('Saved tags to "' + EV.TAGS_SIDECAR_NAME + '" in this folder.');
        });
      }).catch(function (err) { EV.alertDialog('Save failed: ' + (err && err.message || err)); });
    });

    function checkForTagsSidecar(ws) {
      els.tags_sidecar_banner.style.display = 'none';
      if (!ws || ws.mode !== 'fsAccess' || !ws.dirHandle) return;
      EV.loadTagsSidecar(ws.dirHandle).then(function (text) {
        if (!text || state.workspace !== ws) return; // folder switched again before this resolved
        var count;
        try { count = (JSON.parse(text).records || []).length; } catch (e) { return; } // corrupt/foreign file -- ignore rather than offer a broken load
        els.tags_sidecar_text.textContent = 'Found saved tags in this folder (' + EV.TAGS_SIDECAR_NAME + ', ' + count + ' email' + (count === 1 ? '' : 's') + ') — load them?';
        els.tags_sidecar_banner.style.display = 'flex';
        els.btn_load_tags_sidecar.onclick = function () {
          EV.tags.importJsonDetailed(text).then(function (res) {
            els.tags_sidecar_banner.style.display = 'none';
            window.EV.onTagsChanged();
            EV.alertDialog('Loaded tag data for ' + res.records + ' email(s) from this folder.' + renamedNote(res.renamed));
          }).catch(function (err) { EV.alertDialog('Load failed: ' + (err && err.message || err)); });
        };
      });
    }

    els.btn_dismiss_tags_sidecar.addEventListener('click', function () { els.tags_sidecar_banner.style.display = 'none'; });


    els.btn_export_rules.addEventListener('click', function () {
      EV.rulesStore.exportJson().then(function (json) {
        var blob = new Blob([json], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'mantiz-eml-analyzer-rules-' + new Date().toISOString().slice(0, 10) + '.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      });
    });

    els.btn_import_rules.addEventListener('click', function () { els.import_rules_input.click(); });

    els.import_rules_input.addEventListener('change', function () {
      var file = els.import_rules_input.files[0];
      if (!file) return;
      file.text().then(function (text) {
        return EV.rulesStore.importJson(text);
      }).then(function (result) {
        var msg = 'Imported ' + result.imported + ' rule(s).';
        if (result.skipped) msg += ' Skipped ' + result.skipped + ' (tag already in use by an existing rule, or missing required fields).';
        EV.alertDialog(msg);
        ctx.renderRulesList();
      }).catch(function (err) {
        EV.alertDialog('Import failed: ' + err.message);
      });
      els.import_rules_input.value = '';
    });


    function fmtDateShort(ms) { return ms ? new Date(ms).toISOString().slice(0, 10) : ''; }

    function mdEscape(s) { return String(s || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' '); }

    els.btn_export_report.addEventListener('click', function () {
      if (!state.workspace) { EV.alertDialog('Open a folder first.'); return; }
      EV.tags.allTagNames().then(function (tagNames) {
        if (!tagNames.length) { EV.alertDialog('No tagged emails yet — tag some emails or run a rule first.'); return null; }
        var chain = Promise.resolve();
        var sections = [];
        var totalEmails = new Set();
        tagNames.forEach(function (tagName) {
          chain = chain.then(function () {
            // Reuses the same tag: clause the search box itself uses, rather
            // than a second path for cross-referencing tags to email metadata.
            return searchIdx.search('tag:"' + tagName + '"', { limit: 5000 }).then(function (res) {
              res.results.forEach(function (r) { totalEmails.add(r.path); });
              sections.push({ tag: tagName, results: res.results });
            });
          });
        });
        return chain.then(function () { return { sections: sections, totalEmails: totalEmails.size }; });
      }).then(function (data) {
        if (!data) return;
        var lines = [];
        lines.push('# Mantiz-EML-Analyzer — Case Report');
        lines.push('');
        lines.push('- **Folder:** ' + state.workspace.name);
        lines.push('- **Generated:** ' + new Date().toISOString());
        lines.push('- **Tagged emails:** ' + data.totalEmails + ' across ' + data.sections.length + ' tag(s)');
        lines.push('');
        data.sections.sort(function (a, b) { return b.results.length - a.results.length; }).forEach(function (section) {
          lines.push('## ' + section.tag + ' (' + section.results.length + ')');
          lines.push('');
          lines.push('| Subject | From | Date | Path |');
          lines.push('|---|---|---|---|');
          section.results.forEach(function (r) {
            lines.push('| ' + mdEscape(r.subject) + ' | ' + mdEscape(r.fromAddr) + ' | ' + fmtDateShort(r.dateMs) + ' | ' + mdEscape(r.path) + ' |');
          });
          lines.push('');
        });
        var md = lines.join('\n');
        var blob = new Blob([md], { type: 'text/markdown' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'mantiz-eml-analyzer-case-report-' + new Date().toISOString().slice(0, 10) + '.md';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      }).catch(function (err) {
        EV.alertDialog('Report generation failed: ' + err.message);
      });
    });

  };
})(typeof self !== 'undefined' ? self : this);
