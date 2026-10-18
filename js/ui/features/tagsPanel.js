/**
 * tagsPanel.js — the Tags panel and everything tag-related at the app level: tag dots, the filter list with counts, Tag file / Un-Tag file / Tag Deletion (with counts and undo), and re-rendering everything that shows tags when they change.
 */
(function (g) {
  'use strict';
  var EV = g.EV || (g.EV = {});
  EV.ui = EV.ui || {};
  EV.ui.features = EV.ui.features || {};

  EV.ui.features.tagsPanel = function createTagsPanel(ctx) {
    var state = ctx.state, els = ctx.els, searchIdx = ctx.searchIdx, rulesEngine = ctx.rulesEngine;
    var claimDialogSlot = EV.ui.claimDialogSlot, el = EV.ui.el, showToast = EV.ui.showToast;
    // Exported to the other features (function declarations are hoisted, so these are valid before their definitions).
    ctx.refreshTagDotCache = refreshTagDotCache;
    ctx.renderTagFilterList = renderTagFilterList;
    ctx.resolvePathsForTags = resolvePathsForTags;
    ctx.untagSelectedEmails = untagSelectedEmails;

    window.EV.onTagsChanged = function () {
      if (typeof ctx.refreshSuggestTagNames === 'function') ctx.refreshSuggestTagNames();
      refreshTagDotCache().then(function () {
        ctx.rebuildVisibleRows();
        ctx.tabMgr.renderStrip();
      });
      renderTagFilterList();
      ctx.refreshLiveResultsView();
    };

    function refreshTagDotCache() {
      return EV.tags.getAll().then(function (records) {
        state.tagDotCache = new Map();
        if (!state.workspace) return;
        var pathsByEmailId = searchIdx.pathsByEmailId();
        records.forEach(function (r) {
          if (!r.tags || !r.tags.length) return;
          var paths = pathsByEmailId.get(r.id);
          if (paths) paths.forEach(function (p) { state.tagDotCache.set(p, r.tags); });
        });
      });
    }

    // The Tags panel: a list of tags (tick to filter the tree) and ONE action bar above it that acts on
    // whatever is ticked -- View files / Un-Tag file / Tag Deletion / file actions.
    var tagCountsCache = {};

    function tickedTags() {
      return Array.from(state.tagFilter).filter(function (n) { return n in tagCountsCache; }).sort();
    }

    function updateTagActions() {
      var ticked = tickedTags();
      var n = ticked.length;
      els.tag_actions_hint.textContent = n
        ? n.toLocaleString() + ' tag' + (n === 1 ? '' : 's') + ' ticked: ' + ticked.slice(0, 3).join(', ') + (n > 3 ? ', \u2026' : '')
        : 'Tick one or more tags below, then use the buttons.';
      [els.btn_tag_view, els.btn_tag_remove, els.btn_tag_delete, els.btn_tag_files].forEach(function (b) { b.disabled = !n; });
      var sel = state.multiSelectedPaths.size;
      els.btn_tag_remove.title = 'Un-Tag file: take the ticked tag' + (n === 1 ? '' : 's') + ' off the emails selected in the Explorer' +
        (sel ? ' (' + sel.toLocaleString() + ' selected now)' : ' (Ctrl/Cmd-click files there first)') + '. The tag itself stays on every other email; use Tag Deletion to delete it everywhere.';
    }

    function renderTagFilterList() {
      EV.tags.tagCounts().then(function (counts) {
        tagCountsCache = counts;
        var names = Object.keys(counts).sort();
        // A ticked tag that no longer exists must not keep filtering (it would hide every file).
        var stale = Array.from(state.tagFilter).filter(function (n) { return !(n in counts); });
        stale.forEach(function (n) { state.tagFilter.delete(n); });
        if (stale.length) ctx.rebuildVisibleRows();
        els.tag_filter_list.innerHTML = '';
        updateTagActions();
        if (!names.length) {
          els.tag_filter_list.appendChild(Object.assign(document.createElement('div'), { className: 'ev-muted-small', textContent: 'No tags yet \u2014 add one from an open email.' }));
          return;
        }
        names.forEach(function (name) {
          var label = document.createElement('label');
          label.className = 'ev-tag-filter-item';
          label.title = 'Tick to filter the Explorer by this tag and to act on it with the buttons above.';
          var cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = state.tagFilter.has(name);
          cb.onchange = function () {
            if (cb.checked) state.tagFilter.add(name); else state.tagFilter.delete(name);
            ctx.rebuildVisibleRows();
            updateTagActions();
          };
          var dot = document.createElement('span');
          dot.className = 'ev-tag-dot';
          dot.style.background = EV.tagColor(name);
          label.appendChild(cb);
          label.appendChild(dot);
          label.appendChild(el('span', 'ev-tag-filter-name', name));
          var countSpan = el('span', 'ev-tag-count', '(' + counts[name].toLocaleString() + ')');
          countSpan.title = 'Emails carrying this tag (counts every folder you have tagged, not just the open one)';
          label.appendChild(countSpan);
          els.tag_filter_list.appendChild(label);
        });
      });
    }

    els.btn_tag_view.addEventListener('click', function () { var t = tickedTags(); if (t.length) ctx.showTagMatches(t); });

    els.btn_tag_remove.addEventListener('click', function () { var t = tickedTags(); if (t.length) untagSelectedEmails(t); });

    els.btn_tag_delete.addEventListener('click', function () { var t = tickedTags(); if (t.length) deleteTagsFlow(t); });

    els.btn_tag_files.addEventListener('click', function (e) {
      var t = tickedTags();
      if (!t.length) return;
      var r = els.btn_tag_files.getBoundingClientRect();
      var x = r.left, y = r.bottom + 2;
      resolvePathsForTags(t).then(function (paths) {
        if (!paths.length) { showToast('No indexed emails in the open folder carry ' + (t.length === 1 ? 'this tag.' : 'these tags.')); return; }
        ctx.showFileActionMenu(x, y, paths);
      });
    });

    // Tag Deletion (Tags tab) = the tag itself goes, from every email, in one step. Different from "Un-Tag
    // file" (just the selected emails) and from "Tag file" (adds a tag). Works on one or several ticked tags.

    /** @param {Array} allRules every rule whose tag is one of `names`, enabled or not */
    function showDeleteTagsDialog(names, counts, inFolder, allRules, onConfirm) {
      var total = names.reduce(function (sum, n) { return sum + (counts[n] || 0); }, 0);
      var enabledCount = allRules.filter(function (r) { return r.enabled; }).length;
      function plural(n, word) { return n.toLocaleString() + ' ' + word + (n === 1 ? '' : 's'); }
      var overlay = el('div', 'ev-modal-overlay');
      if (!claimDialogSlot(overlay)) return;
      var modal = el('div', 'ev-modal');
      modal.style.width = '440px';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-label', 'Tag Deletion');
      modal.appendChild(el('h3', null, names.length === 1 ? 'Tag Deletion: "' + names[0] + '"' : 'Tag Deletion: ' + names.length + ' tags'));
      var close = function () { overlay.remove(); document.removeEventListener('keydown', onKey, true); };
      var onKey = function (e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
      document.addEventListener('keydown', onKey, true);

      // At a glance: how many emails lose the tag, and how many rules apply it.
      var summary = el('div', null);
      summary.style.cssText = 'margin:0 0 10px;padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg-2)';
      summary.appendChild(el('div', null, 'Emails with ' + (names.length === 1 ? 'this tag' : 'these tags') + ': ' + total.toLocaleString() +
        (inFolder ? ' (' + inFolder.toLocaleString() + ' in the open folder)' : '')));
      summary.appendChild(el('div', null, 'Rules that apply ' + (names.length === 1 ? 'it' : 'them') + ': ' + allRules.length.toLocaleString() +
        (allRules.length ? ' (' + enabledCount.toLocaleString() + ' enabled)' : '')));
      modal.appendChild(summary);

      if (!total) {
        modal.appendChild(el('p', null, names.length === 1 ? 'No email currently carries this tag, so there is nothing to delete.' : 'No email currently carries these tags, so there is nothing to delete.'));
      } else {
        modal.appendChild(el('p', null, (names.length === 1 ? 'The tag is removed from every email that carries it' : 'Each tag is removed from every email that carries it') +
          '. The emails themselves are not changed or deleted. You can undo it for a few seconds afterwards.'));
        if (names.length > 1) {
          var list = el('ul', null);
          list.style.cssText = 'margin:6px 0 0;padding-left:18px;max-height:160px;overflow:auto';
          names.forEach(function (n) {
            var ruleCount = allRules.filter(function (r) { return r.tag === n; }).length;
            list.appendChild(el('li', null, n + ' \u2014 ' + plural(counts[n] || 0, 'email') + ', ' + plural(ruleCount, 'rule')));
          });
          modal.appendChild(list);
        }
        if (allRules.length) {
          var warn = el('div', null);
          warn.style.cssText = 'margin-top:10px;padding:8px 10px;border:1px solid var(--yellow, #e5c07b);border-radius:var(--radius)';
          warn.appendChild(el('div', null, (allRules.length === 1 ? 'This rule uses' : 'These rules use') + ' the tag and will be switched off. ' +
            (allRules.length === 1 ? 'It stays' : 'They stay') + ' off until you edit ' + (allRules.length === 1 ? 'it' : 'each') + ' and choose a different tag:'));
          var rl = el('ul', null);
          rl.style.cssText = 'margin:4px 0 0;padding-left:18px';
          allRules.forEach(function (r) { rl.appendChild(el('li', null, '"' + r.name + '" (tag ' + r.tag + ', ' + (r.enabled ? 'enabled now' : 'already off') + ')')); });
          warn.appendChild(rl);
          modal.appendChild(warn);
        }
      }
      var actions = el('div', 'ev-modal-actions');
      var cancel = el('button', 'ev-btn', total ? 'Cancel' : 'Close');
      cancel.type = 'button';
      cancel.onclick = close;
      actions.appendChild(cancel);
      if (total) {
        var go = el('button', 'ev-btn ev-btn-danger', names.length === 1 ? 'Delete tag' : 'Delete ' + names.length + ' tags');
        go.type = 'button';
        go.onclick = function () {
          close();
          onConfirm();
        };
        actions.appendChild(go);
      }
      modal.appendChild(actions);
      overlay.appendChild(modal);
      overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) close(); });
      document.body.appendChild(overlay);
      cancel.focus(); // the safe choice is the default one
    }

    function deleteTagsFlow(names) {
      names = names.slice();
      Promise.all([
        EV.tags.tagCounts(),
        resolvePathsForTags(names).catch(function () { return []; }),
        EV.rulesStore.list()
      ]).then(function (r) {
        var rules = r[2].filter(function (rule) { return names.indexOf(rule.tag) !== -1; });
        showDeleteTagsDialog(names, r[0], r[1].length, rules, function () {
          var blocked = []; // [{rule, wasEnabled}] -- every rule that used a deleted tag, now switched off and blocked
          var deleted = null;
          var chain = EV.tags.deleteTags(names).then(function (res) {
            deleted = res;
            names.forEach(function (name) { state.tagFilter.delete(name); }); // a leftover filter on a vanished tag would hide every file
          });
          names.forEach(function (name) {
            chain = chain.then(function () { return EV.rulesStore.blockRulesForDeletedTag(name); }).then(function (hit) {
              // Retract what the rules had tagged (their match records), exactly as disabling a rule does.
              return Promise.all(hit.map(function (h) {
                blocked.push(h);
                return h.wasEnabled ? rulesEngine.disableRule(h.rule) : null;
              }));
            });
          });
          chain.then(function () {
            var emails = deleted.results.reduce(function (sum, x) { return sum + x.count; }, 0);
            window.EV.onTagsChanged();
            if (blocked.length) ctx.renderRulesList();
            var what = names.length === 1 ? 'tag "' + names[0] + '"' : names.length + ' tags';
            showToast('Deleted ' + what + (names.length === 1 ? ' from ' + emails.toLocaleString() + ' email' + (emails === 1 ? '' : 's') : '') +
              (blocked.length ? '; ' + blocked.length + ' rule' + (blocked.length === 1 ? ' is' : 's are') + ' now off until given a new tag' : '') + '.', {
              actionLabel: 'Undo',
              duration: 10000,
              onAction: function () {
                deleted.undo().then(function () {
                  // Lift each block one after another, then switch back on the rules that were running.
                  var restore = Promise.resolve();
                  blocked.forEach(function (h) {
                    restore = restore.then(function () { return EV.rulesStore.unblockRule(h.rule.id); });
                  });
                  return restore.then(function () {
                    blocked.forEach(function (h) { if (h.wasEnabled) ctx.toggleRule(h.rule, true); });
                    ctx.renderRulesList();
                    window.EV.onTagsChanged();
                    showToast('Restored ' + (names.length === 1 ? 'tag "' + names[0] + '"' : names.length + ' tags') + '.');
                  });
                });
              }
            });
          }).catch(function (err) {
            window.EV.onTagsChanged();
            ctx.renderRulesList();
            showToast('Tag Deletion failed: ' + (err && err.message || err), { duration: 4000 });
          });
        });
      });
    }

    /** Removes the given tags from the emails selected in the Explorer (only those emails). */
    function untagSelectedEmails(names) {
      var ids = [];
      state.multiSelectedPaths.forEach(function (path) {
        var eid = searchIdx.emailIdForPath(path);
        if (eid) ids.push(eid);
      });
      if (!ids.length) { showToast('Select emails in the Explorer first (Ctrl/Cmd-click files), then use Un-Tag file.', { duration: 3500 }); return Promise.resolve(); }
      var removed = 0, ruleOwned = 0;
      var chain = Promise.resolve();
      names.forEach(function (name) {
        chain = chain.then(function () { return EV.tags.removeManualTagFromMany(ids, name); }).then(function (res) { removed += res.removed; ruleOwned += res.ruleOwned; });
      });
      return chain.then(function () {
        var label = names.length === 1 ? '"' + names[0] + '"' : names.length + ' tags';
        var msg = removed
          ? 'Un-tagged ' + label + ' from ' + (names.length === 1 ? removed.toLocaleString() + ' email(s)' : 'the selected emails') + '.'
          : '';
        if (ruleOwned) msg += (msg ? ' ' : '') + ruleOwned.toLocaleString() + ' tagged by a rule \u2014 that can\u2019t be removed by hand; disable the rule on the Rules tab.';
        if (!msg) msg = 'None of the selected emails had ' + (names.length === 1 ? 'the tag "' + names[0] + '"' : 'those tags') + '.';
        showToast(msg, { duration: ruleOwned ? 5000 : 2500 });
        window.EV.onTagsChanged();
      }).catch(function (err) { showToast('Could not un-tag: ' + (err && err.message || err), { duration: 4000 }); });
    }

    /** All indexed emails' paths that currently carry the given tag — feeds the Tags panel's bulk Move/Copy/Delete menu. */
    /** Emails carrying ANY of the given tags (the same "any" rule the Explorer tag filter uses). */
    function resolvePathsForTags(tagNames) {
      var query = tagNames.map(function (n) { return 'tag:"' + n + '"'; }).join(' OR ');
      return searchIdx.search(query, { limit: 1000000 }).then(function (res) {
        return res.results.map(function (r) { return r.path; });
      });
    }

  };
})(typeof self !== 'undefined' ? self : this);
