/**
 * rulesPanel.js — the Rules panel: the rule list and cards, the rule editor (templates, test, save, tag validation), running one or all rules with progress/stop, and showing a rule's matches.
 */
(function (g) {
  'use strict';
  var EV = g.EV || (g.EV = {});
  EV.ui = EV.ui || {};
  EV.ui.features = EV.ui.features || {};

  EV.ui.features.rulesPanel = function createRulesPanel(ctx) {
    var state = ctx.state, els = ctx.els, pool = ctx.pool, searchIdx = ctx.searchIdx, rulesEngine = ctx.rulesEngine;
    var showToast = EV.ui.showToast;
    // Exported to the other features (function declarations are hoisted, so these are valid before their definitions).
    ctx.refreshLiveResultsView = refreshLiveResultsView;
    ctx.renderRulesList = renderRulesList;
    ctx.runAllEnabledRules = runAllEnabledRules;
    ctx.showTagMatches = showTagMatches;
    ctx.toggleRule = toggleRule;

    var RULE_FIELD_HELP_HTML =
      '<table>' +
      '<tr><td>f.subject</td><td>string</td></tr>' +
      '<tr><td>f.from</td><td>{name,address,domain} or null</td></tr>' +
      '<tr><td>f.to / f.cc / f.bcc</td><td>array of {name,address,domain}</td></tr>' +
      '<tr><td>f.recipientCount</td><td>unique To+Cc+Bcc recipient count</td></tr>' +
      '<tr><td>f.replyTo</td><td>{name,address,domain} or null (Reply-To header)</td></tr>' +
      '<tr><td>f.returnPath</td><td>{name,address,domain} or null (Return-Path header)</td></tr>' +
      '<tr><td>f.date</td><td>JS Date or null</td></tr>' +
      '<tr><td>f.spf / f.dkim / f.dmarc</td><td>"pass" / "fail" / "none" / "softfail" / null</td></tr>' +
      '<tr><td>f.bodyText</td><td>combined plain-text body (HTML stripped as fallback)</td></tr>' +
      '<tr><td>f.urls</td><td>array of URL strings found in the body</td></tr>' +
      '<tr><td>f.urlDomains</td><td>array of unique hostnames from those URLs</td></tr>' +
      '<tr><td>f.attachments</td><td>array of {filename,mimeType,size,isInline,ext}</td></tr>' +
      '<tr><td>f.attachmentCount / f.size</td><td>numbers (size = raw byte length)</td></tr>' +
      '<tr><td>f.getHeader(name)</td><td>raw value of any header, case-insensitive</td></tr>' +
      '<tr><td>f.getHeaderAll(name)</td><td>array — for repeated headers like Received</td></tr>' +
      '<tr><td>f.trustedDomains</td><td>your Settings-configured trusted-domains list (literal + regex entries)</td></tr>' +
      '<tr><td>f.domainIsTrusted</td><td>true if f.from.domain is covered by a trusted-domains entry (exact, subdomain, or regex)</td></tr>' +
      '<tr><td>f.nameMismatch</td><td>true if the display name names a known brand but f.from.domain isn\'t that brand\'s domain</td></tr>' +
      '<tr><td>f.lookalikeDomain</td><td>true if f.from.domain is a likely typosquat of a trusted domain</td></tr>' +
      '<tr><td>f.punycodeSender</td><td>true if f.from.domain uses IDN/punycode (xn--) encoding</td></tr>' +
      '<tr><td>f.urgencyScore</td><td>count of distinct urgency/pressure phrases found in the body (e.g. "urgent", "wire transfer", "asap")</td></tr>' +
      '<tr><td>f.financialIndicators</td><td>array of financial-indicator types found, e.g. [\'iban\',\'gift_card_request\']</td></tr>' +
      '<tr><td>f.connectingIp / f.originIp</td><td>the IP that connected to the receiving side / the earliest public IP in the Received chain (string, or null when no hop has a public IP)</td></tr>' +
      '<tr><td>f.domainCategories</td><td>Settings-configured category names matched by any domain in this email (sender, URLs, headers, attachment names), e.g. [\'URL Shortener\']</td></tr>' +
      '<tr><td>h.domainsMatch(a,b)</td><td>case-insensitive domain equality</td></tr>' +
      '<tr><td>h.looksLikeDomain(a,b,maxDist)</td><td>typosquat check (edit distance, default ≤2)</td></tr>' +
      '<tr><td>h.looksLikeAnyDomain(a,list,maxDist)</td><td>same, against a list</td></tr>' +
      '<tr><td>h.domainsAlign(a,b)</td><td>same organizational domain (DMARC-style relaxed alignment) -- mail.example.com aligns with support.example.com</td></tr>' +
      '<tr><td>h.registrableDomain(hostname)</td><td>the organizational-domain reduction domainsAlign uses, e.g. "mail.example.co.uk" -&gt; "example.co.uk"</td></tr>' +
      '<tr><td>h.isDomainTrusted(domain,list)</td><td>exact/subdomain/regex match against a trusted-domains-style list</td></tr>' +
      '<tr><td>h.isPunycodeDomain(domain)</td><td>true if any label is IDN/punycode (xn--) encoded</td></tr>' +
      '<tr><td>h.includesAny(str,words)</td><td>true if str contains any of a list of words (case-insensitive)</td></tr>' +
      '<tr><td>h.COMMON_BRANDS</td><td>small built-in list of common brand domains</td></tr>' +
      '<tr><td>h.equals(a,b,caseSensitive?)</td><td>exact match — works on subject, sender name, domain, any header value…</td></tr>' +
      '<tr><td>h.contains(a,b,caseSensitive?)</td><td>substring match, same uses as above</td></tr>' +
      '<tr><td>h.startsWith / h.endsWith(a,b,caseSensitive?)</td><td>prefix / suffix match</td></tr>' +
      '<tr><td>h.matches(value,pattern,flags?)</td><td>regex match — pattern can be /literal/ or a plain string; never throws</td></tr>' +
      '<tr><td>h.attachmentExtIn(f.attachments,list)</td><td>true if any attachment extension is in the list, e.g. [".exe",".scr"]</td></tr>' +
      '<tr><td>h.anyAttachment(f.attachments,predicate)</td><td>true if any attachment satisfies a(a)=&gt;bool</td></tr>' +
      '<tr><td>h.countAttachments(f.attachments,predicate?)</td><td>count matching attachments (or all, if predicate omitted)</td></tr>' +
      '<tr><td>h.hasDualExtension(filename)</td><td>true for "invoice.pdf.exe"-style double extensions</td></tr>' +
      '<tr><td>h.hasHiddenUnicode(str,threshold?)</td><td>true if str has more than threshold (default 0) zero-width/invisible chars</td></tr>' +
      '<tr><td>h.shannonEntropy(str)</td><td>bits/char — higher means more random-looking</td></tr>' +
      '<tr><td>h.looksRandom(str,minLen?,entropyThreshold?)</td><td>true if str is long + high-entropy (default len≥12, entropy&gt;3.5) — flags generated IDs/tokens</td></tr>' +
      '</table>' +
      '<div class="ev-muted-small" style="margin-top:6px">Examples: <code>h.contains(f.subject,\'invoice\')</code> · ' +
      '<code>h.equals(f.from.domain,\'paypal.com\')</code> · <code>h.matches(f.getHeader(\'x-mailer\'),/outlook/i)</code> · ' +
      '<code>f.attachmentCount &gt; 3</code></div>';

    // RULE_TEMPLATES lives in js/rules/ruleTemplates.js (EV.RULE_TEMPLATES) — a DOM-free module so
    // tests/ruleTemplates.test.js can compile-check every template under jsc.
    var RULE_TEMPLATES = EV.RULE_TEMPLATES;

    var editingRuleId = null;

    var tagManuallyEdited = false;

    function renderRulesList() {
      EV.rulesStore.list().then(function (rules) {
        els.rules_list.innerHTML = '';
        if (!rules.length) {
          els.rules_list.appendChild(Object.assign(document.createElement('div'), {
            className: 'ev-muted-small', textContent: 'No rules yet. Click "+ New Rule" to create one — e.g. flag emails where the sender domain doesn\'t match the Reply-To domain.'
          }));
          return;
        }
        rules.forEach(function (rule) {
          var card = document.createElement('div');
          card.className = 'ev-rule-card' + (rule.enabled ? '' : ' disabled');

          var head = document.createElement('div');
          head.className = 'ev-rule-head';

          var switchLabel = document.createElement('label');
          switchLabel.className = 'ev-switch';
          var switchInput = document.createElement('input');
          switchInput.type = 'checkbox';
          switchInput.checked = rule.enabled;
          if (rule.blockedTag) {
            switchInput.disabled = true;
            switchInput.title = 'Off: the tag "' + rule.blockedTag + '" was deleted. Edit the rule and choose a different tag to turn it on.';
          }
          switchInput.onchange = function () { toggleRule(rule, switchInput.checked); };
          var slider = document.createElement('span');
          slider.className = 'ev-switch-slider';
          switchLabel.appendChild(switchInput);
          switchLabel.appendChild(slider);
          head.appendChild(switchLabel);

          head.appendChild(Object.assign(document.createElement('span'), { className: 'ev-rule-name', textContent: rule.name }));
          var tagChip = document.createElement('span');
          tagChip.className = 'ev-rule-tag-chip';
          tagChip.style.background = EV.tagColor(rule.tag);
          tagChip.textContent = rule.tag;
          head.appendChild(tagChip);
          card.appendChild(head);

          card.appendChild(Object.assign(document.createElement('div'), { className: 'ev-rule-expr', textContent: rule.expression, title: rule.expression }));

          var statsEl = document.createElement('div');
          statsEl.className = 'ev-rule-stats';
          if (rule.blockedTag) {
            statsEl.classList.add('has-error');
            statsEl.textContent = 'Off \u2014 its tag "' + rule.blockedTag + '" was deleted. Click Edit and choose a different tag to turn it on.';
          } else if (rule.lastRun && rule.lastRun.error) {
            statsEl.classList.add('has-error');
            statsEl.textContent = 'Error: ' + rule.lastRun.error;
          } else if (rule.lastRun && rule.lastRun.matched != null && rule.lastRun.total != null) {
            statsEl.textContent = 'Matched ' + rule.lastRun.matched.toLocaleString() + ' of ' + rule.lastRun.total.toLocaleString() + ' emails' +
              (rule.lastRun.errorCount ? ' (' + rule.lastRun.errorCount + ' evaluation error(s))' : '') +
              ' — ' + new Date(rule.lastRun.ranAt).toLocaleString();
          } else if (rule.lastRun) {
            // Rule was disabled/deleted mid-scan during a multi-rule run, so its stats couldn't be
            // completed -- never crash rendering over this, just say so.
            statsEl.textContent = 'Was disabled during its last run — matches not updated.';
          } else {
            statsEl.textContent = rule.enabled ? 'Not run yet — open a folder or click Run all' : 'Disabled';
          }
          card.appendChild(statsEl);

          var actions = document.createElement('div');
          actions.className = 'ev-rule-actions';
          var runBtn = document.createElement('button');
          runBtn.textContent = 'Run now';
          runBtn.onclick = function () { runSingleRule(rule); };
          if (rule.blockedTag) { runBtn.disabled = true; runBtn.title = 'Choose a different tag first (Edit) \u2014 its tag was deleted.'; }
          var editBtn = document.createElement('button');
          editBtn.textContent = 'Edit';
          editBtn.onclick = function () { openRuleModal(rule); };
          var delBtn = document.createElement('button');
          delBtn.className = 'danger';
          delBtn.textContent = 'Delete';
          delBtn.onclick = function () { deleteRule(rule); };
          var viewBtn = document.createElement('button');
          viewBtn.textContent = 'View matches';
          viewBtn.title = 'List every email this rule has matched in the Search tab — select some/all, then copy paths/names or move/copy them to a folder.';
          viewBtn.onclick = function () { showRuleMatches(rule); };
          var menuBtn = document.createElement('button');
          menuBtn.textContent = '⋯';
          menuBtn.title = 'Move, copy, or delete every email this rule has matched';
          menuBtn.onclick = function (e) {
            resolvePathsForRule(rule).then(function (paths) {
              if (!paths.length) { EV.alertDialog('This rule has no recorded matches yet — run it first.'); return; }
              ctx.showFileActionMenu(e.clientX, e.clientY, paths);
            });
          };
          actions.appendChild(runBtn);
          actions.appendChild(editBtn);
          actions.appendChild(delBtn);
          actions.appendChild(viewBtn);
          actions.appendChild(menuBtn);
          card.appendChild(actions);

          els.rules_list.appendChild(card);
        });
      });
    }

    /** All indexed emails' paths this rule currently has tagged — feeds the Rules panel's bulk Move/Copy/Delete menu. */
    function resolvePathsForRule(rule) {
      return EV.rulesStore.getMatchesForRule(rule.id).then(function (emailIds) {
        var byId = searchIdx.pathsByEmailId();
        var paths = [];
        emailIds.forEach(function (eid) { (byId.get(eid) || []).forEach(function (p) { paths.push(p); }); });
        return paths;
      });
    }

    /** Lists an arbitrary set of paths (a rule's matches, a tag's members, ...) in the Search tab's own
     * results list — same multi-select, right-click, "Select all"/"Clear selection" bar, and Copy
     * path(s)/name(s)/Move/Copy-to-folder actions Search already has, so clustering-then-moving works
     * identically no matter how the cluster was found (rule, tag, or a text search). */
    // When the Search tab is showing a tag's or a rule's emails, remember which, so the list can follow
    // later tag changes (Tag Deletion, Un-Tag file, a rule being disabled...) instead of going stale.
    ctx.liveResultsView = null;

    function showPathsInSearchResults(paths, snippetLabel, statusLabel, view) {
      ctx.clearSearchResults();
      ctx.liveResultsView = view || null;
      ctx.currentResults = paths.map(function (p) {
        var doc = searchIdx.docSummaryForPath(p) || {};
        return { path: p, subject: doc.subject || p, fromAddr: doc.fromAddr || '', snippet: snippetLabel };
      });
      ctx.searchResultsList.setItems(ctx.currentResults);
      ctx.updateSearchSelectionBar();
      els.search_status.textContent = statusLabel;
      ctx.showSidebarView('search');
    }

    /** Re-resolves a tag/rule results view after the tags changed: updates the list, or empties it (saying
     * why) when nothing carries the tag(s) any more. */
    function refreshLiveResultsView() {
      var view = ctx.liveResultsView;
      if (!view) return;
      (view.tags ? ctx.resolvePathsForTags(view.tags) : resolvePathsForRule(view.rule)).then(function (paths) {
        if (ctx.liveResultsView !== view) return; // the user has since run another search or opened another view
        if (!paths.length) {
          ctx.clearSearchResults();
          els.search_status.textContent = view.tags
            ? 'No emails carry ' + view.label + ' any more.'
            : 'No emails are matched by ' + view.label + ' any more.';
          return;
        }
        var keep = new Set(paths);
        Array.from(state.searchSelectedPaths).forEach(function (p) { if (!keep.has(p)) state.searchSelectedPaths.delete(p); });
        ctx.currentResults = paths.map(function (p) {
          var doc = searchIdx.docSummaryForPath(p) || {};
          return { path: p, subject: doc.subject || p, fromAddr: doc.fromAddr || '', snippet: view.snippet };
        });
        ctx.searchResultsList.setItems(ctx.currentResults);
        ctx.updateSearchSelectionBar();
        els.search_status.textContent = paths.length.toLocaleString() + ' email(s) ' + view.snippet;
      }).catch(function () { /* leave the list as it was */ });
    }

    function showRuleMatches(rule) {
      resolvePathsForRule(rule).then(function (paths) {
        if (!paths.length) { EV.alertDialog('This rule has no recorded matches yet — run it first.'); return; }
        showPathsInSearchResults(paths, 'matched by rule "' + rule.name + '"',
          paths.length.toLocaleString() + ' email(s) matched by rule "' + rule.name + '"',
          { rule: rule, label: 'the rule "' + rule.name + '"', snippet: 'matched by rule "' + rule.name + '"' });
      });
    }

    function showTagMatches(tagNames) {
      if (!Array.isArray(tagNames)) tagNames = [tagNames];
      var label = tagNames.map(function (n) { return '"' + n + '"'; }).join(' or ');
      ctx.resolvePathsForTags(tagNames).then(function (paths) {
        if (!paths.length) { showToast('No indexed emails in the open folder carry ' + (tagNames.length === 1 ? 'this tag.' : 'these tags.')); return; }
        showPathsInSearchResults(paths, 'tagged ' + label, paths.length.toLocaleString() + ' email(s) tagged ' + label,
          { tags: tagNames, label: tagNames.length === 1 ? 'the tag ' + label : 'any of the tags ' + label, snippet: 'tagged ' + label });
      });
    }

    function toggleRule(rule, enabled) {
      EV.rulesStore.update(rule.id, { enabled: enabled }).then(function (updated) {
        if (!enabled) {
          els.rules_status.textContent = 'Disabling "' + rule.name + '"…';
          return rulesEngine.disableRule(updated).then(function () {
            els.rules_status.textContent = 'Disabled "' + rule.name + '" — removed its tag from every email it had tagged.';
            return EV.rulesStore.setLastRun(rule.id, null);
          });
        } else if (state.workspace) {
          return runSingleRule(updated);
        }
      }).then(function () {
        renderRulesList();
        window.EV.onTagsChanged();
      }).catch(function (err) {
        els.rules_status.textContent = 'Could not update "' + rule.name + '": ' + (err && err.message || err);
        renderRulesList();
      });
    }

    function deleteRule(rule) {
      EV.confirmDialog({
        title: 'Delete rule "' + rule.name + '"?',
        message: 'Its tag will be removed from every email it tagged.',
        confirmLabel: 'Delete rule', danger: true
      }).then(function (ok) { if (ok) doDeleteRule(rule); });
    }

    function doDeleteRule(rule) {
      els.rules_status.textContent = 'Deleting "' + rule.name + '"…';
      rulesEngine.disableRule(rule).then(function () {
        return EV.rulesStore.remove(rule.id);
      }).then(function () {
        els.rules_status.textContent = 'Deleted "' + rule.name + '".';
        renderRulesList();
        window.EV.onTagsChanged();
      }).catch(function (err) {
        els.rules_status.textContent = 'Could not delete "' + rule.name + '": ' + (err && err.message || err);
        renderRulesList();
      });
    }

    var rulesRunCancelled = false;

    // Guards against two rule runs firing at once (e.g. clicking a per-rule
    // "Run" then "Run all" before the first scan finishes) — both would share
    // the single rulesRunCancelled flag and worker pool, and their completion
    // handlers would race to overwrite each other's status text/last-run stats.
    var rulesRunActive = false;

    function showRulesStopButton(show) {
      els.btn_stop_rules.style.display = show ? 'inline-block' : 'none';
    }

    els.btn_stop_rules.addEventListener('click', function () { rulesRunCancelled = true; });

    function runSingleRule(rule) {
      if (rule.blockedTag) {
        els.rules_status.textContent = '"' + rule.name + '" is off: its tag "' + rule.blockedTag + '" was deleted. Edit the rule and choose a different tag.';
        return Promise.resolve();
      }
      if (!state.workspace) {
        els.rules_status.textContent = 'Open a folder first.';
        return Promise.resolve();
      }
      if (rulesRunActive) {
        els.rules_status.textContent = 'A rule run is already in progress — stop it first.';
        return Promise.resolve();
      }
      rulesRunCancelled = false;
      rulesRunActive = true;
      showRulesStopButton(true);
      els.rules_status.textContent = 'Running "' + rule.name + '"…';
      return rulesEngine.runRules(state.workspace, [rule], {
        isCancelled: function () { return rulesRunCancelled; },
        onProgress: function (done, total) {
          els.rules_status.textContent = 'Running "' + rule.name + '"… ' + done.toLocaleString() + ' / ' + total.toLocaleString();
        }
      }).then(function (result) {
        if (result.cancelled) {
          var s = result.statsByRule[rule.id];
          els.rules_status.textContent = 'Stopped — checked ' + s.checked.toLocaleString() + ' of ' + s.total.toLocaleString() + ' emails; tags left unchanged.';
          return;
        }
        var stats = result.statsByRule[rule.id];
        // The rule may have been disabled/deleted (via its own toggle, which already called
        // setLastRun(id, null)) while this very scan was running -- don't overwrite that with a
        // stale matched:null snapshot, and don't format a null count into the status line.
        if (stats.matched == null) {
          els.rules_status.textContent = 'Rule "' + rule.name + '" was disabled while running — matches not updated.';
          renderRulesList();
          return;
        }
        return EV.rulesStore.setLastRun(rule.id, stats).then(function () {
          els.rules_status.textContent = 'Rule "' + rule.name + '" matched ' + stats.matched.toLocaleString() + ' of ' + stats.total.toLocaleString() + ' emails.';
          renderRulesList();
          window.EV.onTagsChanged();
        });
      }).catch(function (err) {
        els.rules_status.textContent = 'Rule run failed: ' + (err && err.message || err);
      }).then(function () {
        rulesRunActive = false;
        showRulesStopButton(false);
      });
    }

    function runAllEnabledRules() {
      if (rulesRunActive) {
        els.rules_status.textContent = 'A rule run is already in progress — stop it first.';
        return;
      }
      EV.rulesStore.list().then(function (rules) {
        var enabled = rules.filter(function (r) { return r.enabled; });
        if (!enabled.length || !state.workspace) return;
        rulesRunCancelled = false;
        rulesRunActive = true;
        showRulesStopButton(true);
        els.rules_status.textContent = 'Running ' + enabled.length + ' enabled rule(s)…';
        return rulesEngine.runRules(state.workspace, enabled, {
          isCancelled: function () { return rulesRunCancelled; },
          onProgress: function (done, total) {
            els.rules_status.textContent = 'Running ' + enabled.length + ' rule(s)… ' + done.toLocaleString() + ' / ' + total.toLocaleString();
          }
        }).then(function (result) {
          if (result.cancelled) {
            var s0 = Object.values(result.statsByRule)[0];
            els.rules_status.textContent = 'Stopped — checked ' + (s0 ? s0.checked.toLocaleString() : '0') + ' of ' + result.total.toLocaleString() + ' emails; tags left unchanged.';
            return;
          }
          // A rule the user disabled/deleted while this scan was running has matched:null here
          // (rulesEngine already re-checked live state) -- its own toggle/delete handler already
          // called setLastRun(id, null) for it, so skip re-persisting this stale snapshot over that.
          return Promise.all(enabled.map(function (r) {
            var stats = result.statsByRule[r.id];
            if (stats.matched == null) return Promise.resolve();
            return EV.rulesStore.setLastRun(r.id, stats);
          })).then(function () {
            els.rules_status.textContent = 'Ran ' + enabled.length + ' rule(s) across ' + result.total.toLocaleString() + ' emails.';
            renderRulesList();
            window.EV.onTagsChanged();
          });
        }).catch(function (err) {
          els.rules_status.textContent = 'Rule run failed: ' + (err && err.message || err);
        }).then(function () {
          rulesRunActive = false;
          showRulesStopButton(false);
        });
      }).catch(function (err) {
        rulesRunActive = false;
        showRulesStopButton(false);
        els.rules_status.textContent = 'Rule run failed: ' + (err && err.message || err);
      });
    }

    els.btn_run_all_rules.addEventListener('click', runAllEnabledRules);

    els.btn_new_rule.addEventListener('click', function () { openRuleModal(null); });

    function openRuleModal(rule) {
      editingRuleId = rule ? rule.id : null;
      tagManuallyEdited = !!rule;
      els.rule_modal_title.textContent = rule ? 'Edit Rule' : 'New Rule';
      els.rule_name.value = rule ? rule.name : '';
      els.rule_tag.value = rule ? rule.tag : '';
      ruleTagCheck.reset();
      els.rule_expression.value = rule ? rule.expression : '';
      els.rule_enabled.checked = rule ? rule.enabled : true;
      els.rule_test_result.textContent = '';
      els.rule_error.style.display = 'none';
      if (rule && rule.blockedTag) {
        els.rule_error.style.display = 'block';
        els.rule_error.textContent = 'This rule is off because its tag "' + rule.blockedTag + '" was deleted. Choose a different tag below, tick Enabled and save to turn it on.';
      }
      els.rule_help.style.display = 'none';
      els.rule_template_select.value = '';
      els.rule_modal_overlay.style.display = 'flex';
      els.rule_name.focus();
    }

    function closeRuleModal() { els.rule_modal_overlay.style.display = 'none'; EV.tagInput.hideNote(); }

    els.btn_cancel_rule.addEventListener('click', closeRuleModal);

    els.rule_modal_overlay.addEventListener('click', function (e) { if (e.target === els.rule_modal_overlay) closeRuleModal(); });

    els.rule_name.addEventListener('input', function () {
      if (!tagManuallyEdited) els.rule_tag.value = EV.rulesStore.slugify(els.rule_name.value);
    });

    var ruleTagCheck = EV.tagInput.bind(els.rule_tag);

    els.rule_tag.addEventListener('input', function () { tagManuallyEdited = true; });

    els.rule_help_toggle.addEventListener('click', function () {
      if (els.rule_help.style.display === 'none') {
        els.rule_help.innerHTML = RULE_FIELD_HELP_HTML;
        els.rule_help.style.display = 'block';
      } else {
        els.rule_help.style.display = 'none';
      }
    });

    RULE_TEMPLATES.forEach(function (t, i) {
      var opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = t.name;
      els.rule_template_select.appendChild(opt);
    });

    els.rule_template_select.addEventListener('change', function () {
      if (els.rule_template_select.value === '') return;
      var t = RULE_TEMPLATES[Number(els.rule_template_select.value)];
      els.rule_name.value = t.name;
      els.rule_tag.value = t.tag;
      tagManuallyEdited = true;
      els.rule_expression.value = t.expression;
    });

    els.btn_test_rule.addEventListener('click', function () {
      if (!state.workspace) { els.rule_test_result.textContent = 'Open a folder first to test against real emails.'; return; }
      var expr = els.rule_expression.value.trim();
      if (!expr) { els.rule_test_result.textContent = 'Write an expression first.'; return; }
      els.rule_test_result.textContent = 'Testing…';
      els.rule_error.style.display = 'none';
      rulesEngine.testRule(state.workspace, expr).then(function (r) {
        if (r.error) {
          els.rule_error.style.display = 'block';
          els.rule_error.textContent = 'Error while evaluating: ' + r.error;
          els.rule_test_result.textContent = '';
          return;
        }
        els.rule_test_result.textContent = 'Matched ' + r.matched.toLocaleString() + ' of ' + r.checked.toLocaleString() +
          (r.truncated ? ' (checked first ' + r.checked.toLocaleString() + ' only)' : ' loaded emails') +
          (r.samplePaths.length ? '  —  e.g. ' + r.samplePaths.slice(0, 3).join(', ') : '');
      });
    });

    els.btn_save_rule.addEventListener('click', function () {
      var name = els.rule_name.value.trim();
      var expression = els.rule_expression.value.trim();
      if (!name || !expression) {
        els.rule_error.style.display = 'block';
        els.rule_error.textContent = 'Name and expression are both required.';
        return;
      }
      // A typed tag must be valid as-is; an empty box falls back to a tag made from the rule's name.
      var desiredTag = name;
      if (els.rule_tag.value.trim()) {
        desiredTag = ruleTagCheck.check();
        if (!desiredTag) {
          els.rule_error.style.display = 'block';
          els.rule_error.textContent = 'Fix the tag name first: ' + EV.tags.normalizeName(els.rule_tag.value).error;
          return;
        }
      }
      // A rule whose tag was deleted must be given a genuinely different tag. If what's typed is still the
      // deleted tag, keep it exactly (no automatic "-2" suffix, which would sneak past the block); the store
      // then refuses to enable it, or keeps it off if it is being saved off.
      var existingRule = editingRuleId ? EV.rulesStore.get(editingRuleId) : Promise.resolve(null);
      existingRule.then(function (existing) {
        if (existing && existing.blockedTag && EV.rulesStore.slugify(desiredTag) === existing.blockedTag) return existing.blockedTag;
        return EV.rulesStore.uniqueTag(desiredTag, editingRuleId);
      }).then(function (tag) {
        var enabled = els.rule_enabled.checked;
        var savePromise = editingRuleId
          ? EV.rulesStore.update(editingRuleId, { name: name, tag: tag, expression: expression, enabled: enabled })
          : EV.rulesStore.create({ name: name, tag: tag, expression: expression, enabled: enabled });
        return savePromise.then(function (rule) {
          closeRuleModal();
          renderRulesList();
          if (enabled && state.workspace) return runSingleRule(rule);
          if (!enabled) return rulesEngine.disableRule(rule).then(function () { return EV.rulesStore.setLastRun(rule.id, null); }).then(renderRulesList);
        });
      }).catch(function (err) {
        els.rule_error.style.display = 'block';
        els.rule_error.textContent = String(err && err.message || err);
      });
    });

  };
})(typeof self !== 'undefined' ? self : this);
