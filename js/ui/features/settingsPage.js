/**
 * settingsPage.js — the Settings page's content: IDE config (max open tabs, server port), trusted domains, the organization's own domains and the editable domain categories.
 */
(function (g) {
  'use strict';
  var EV = g.EV || (g.EV = {});
  EV.ui = EV.ui || {};
  EV.ui.features = EV.ui.features || {};

  EV.ui.features.settingsPage = function createSettingsPage(ctx) {
    var els = ctx.els;
    var el = EV.ui.el, showToast = EV.ui.showToast;
    // Exported to the other features (function declarations are hoisted, so these are valid before their definitions).
    ctx.renderSettingsView = renderSettingsView;

    function renderTrustedDomainsList() {
      EV.settingsCache.refreshTrustedDomains(); // the Preview's Security checks read this list too
      EV.settings.trustedDomains().then(function (domains) {
        els.trusted_domains_list.innerHTML = '';
        if (!domains.length) {
          els.trusted_domains_list.appendChild(el('div', 'ev-muted-small', 'No trusted domains configured.'));
          return;
        }
        domains.slice().sort().forEach(function (domain) {
          var chip = document.createElement('span');
          chip.className = 'ev-trusted-domain-chip' + (EV.ruleHelpers.isRegexTrustedEntry(domain) ? ' ev-trusted-domain-regex' : '');
          chip.title = EV.ruleHelpers.isRegexTrustedEntry(domain) ? 'Regex pattern — matches any domain it tests true against' : domain;
          chip.appendChild(document.createTextNode(domain));
          var removeBtn = document.createElement('button');
          removeBtn.type = 'button';
          removeBtn.textContent = '×';
          removeBtn.title = 'Remove ' + domain;
          removeBtn.onclick = function () {
            EV.settings.setTrustedDomains(domains.filter(function (d) { return d !== domain; })).then(renderTrustedDomainsList);
          };
          chip.appendChild(removeBtn);
          els.trusted_domains_list.appendChild(chip);
        });
      });
    }

    /** Parses a bulk-paste textarea the same way the trusted-domains one does: newline-first, then
     * comma/space within a line, entries deduped by setDomainCategories itself. */
    function parseKeywordInput(raw) {
      var out = [];
      (raw || '').split(/\r?\n/).forEach(function (line) {
        line.trim().split(/[\s,]+/).forEach(function (k) { if (k) out.push(k); });
      });
      return out;
    }

    function saveDomainCategories(categories) {
      return EV.settings.setDomainCategories(categories).then(function () {
        EV.settingsCache.refreshDomainCategories();
        return renderDomainCategoriesList();
      });
    }

    function renderDomainCategoriesList() {
      EV.settings.domainCategories().then(function (categories) {
        els.domain_categories_list.innerHTML = '';
        categories.forEach(function (cat) {
          var card = el('div', 'ev-domain-category-card');
          var head = el('div', 'ev-domain-category-head');
          head.appendChild(el('strong', null, cat.name));
          var deleteBtn = document.createElement('button');
          deleteBtn.type = 'button';
          deleteBtn.className = 'ev-mini-btn ev-domain-category-delete';
          deleteBtn.textContent = 'Delete category';
          deleteBtn.onclick = function () {
            saveDomainCategories(categories.filter(function (c) { return c.name !== cat.name; }));
          };
          head.appendChild(deleteBtn);
          card.appendChild(head);

          var chipsWrap = el('div', 'ev-domain-category-keywords');
          cat.keywords.slice().sort().forEach(function (kw) {
            var chip = document.createElement('span');
            chip.className = 'ev-trusted-domain-chip';
            chip.appendChild(document.createTextNode(kw));
            var removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.textContent = '×';
            removeBtn.title = 'Remove ' + kw;
            removeBtn.onclick = function () {
              saveDomainCategories(categories.map(function (c) {
                return c.name !== cat.name ? c : Object.assign({}, c, { keywords: c.keywords.filter(function (k) { return k !== kw; }) });
              }));
            };
            chip.appendChild(removeBtn);
            chipsWrap.appendChild(chip);
          });
          card.appendChild(chipsWrap);

          var addRow = el('div', 'ev-settings-row');
          var input = document.createElement('input');
          input.type = 'text';
          input.placeholder = 'add keyword(s) — comma/space/newline separated, or .tld for a suffix match';
          var addBtn = document.createElement('button');
          addBtn.type = 'button';
          addBtn.className = 'ev-mini-btn';
          addBtn.textContent = '+ Add';
          addBtn.onclick = function () {
            var newKeywords = parseKeywordInput(input.value);
            if (!newKeywords.length) return;
            saveDomainCategories(categories.map(function (c) {
              return c.name !== cat.name ? c : Object.assign({}, c, { keywords: c.keywords.concat(newKeywords) });
            }));
          };
          addRow.appendChild(input);
          addRow.appendChild(addBtn);
          card.appendChild(addRow);

          els.domain_categories_list.appendChild(card);
        });
      });
    }

    els.btn_add_domain_category.addEventListener('click', function () {
      if (document.getElementById('ev-new-domain-category-card')) return; // already open
      var card = el('div', 'ev-domain-category-card');
      card.id = 'ev-new-domain-category-card';
      var nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.placeholder = 'Category name, e.g. "Crypto exchange"';
      card.appendChild(nameInput);
      var kwInput = document.createElement('textarea');
      kwInput.rows = 3;
      kwInput.placeholder = 'Keywords — comma/space/newline separated, e.g. coinbase.com, binance.com';
      card.appendChild(kwInput);
      var row = el('div', 'ev-settings-row');
      var saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'ev-mini-btn';
      saveBtn.textContent = 'Save category';
      saveBtn.onclick = function () {
        var name = nameInput.value.trim();
        var keywords = parseKeywordInput(kwInput.value);
        if (!name || !keywords.length) return;
        EV.settings.domainCategories().then(function (existing) {
          return saveDomainCategories(existing.concat([{ name: name, keywords: keywords }]));
        });
      };
      var cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'ev-mini-btn';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.onclick = function () { card.remove(); };
      row.appendChild(saveBtn);
      row.appendChild(cancelBtn);
      card.appendChild(row);
      els.domain_categories_list.appendChild(card);
      nameInput.focus();
    });

    els.btn_reset_domain_categories.addEventListener('click', function () {
      EV.settings.resetDomainCategoriesToDefault().then(function () {
        EV.settingsCache.refreshDomainCategories();
        return renderDomainCategoriesList();
      });
    });

    els.max_open_tabs.addEventListener('change', function () {
      EV.settings.setMaxOpenTabs(els.max_open_tabs.value).then(function (n) {
        els.max_open_tabs.value = n;
        ctx.tabMgr.setMaxTabs(n);
      });
    });

    /** scripts/serve.py has already started and bound to a port by the time this page loads in the
     * browser -- nothing running here can reach back and change that, so this is read-only, detected
     * straight from the page's own URL, with a pointer to the one file that actually controls it. */
    function renderServerPortValue() {
      if (location.protocol === 'file:') {
        els.server_port_value.textContent = 'N/A — opened via file://, not scripts/serve.py.';
        return;
      }
      var port = location.port || (location.protocol === 'https:' ? '443' : '80');
      els.server_port_value.textContent = 'Running on port ' + port + ' — edit .mantiz-config.json in the repo root (e.g. {"port": 9000}) and restart the server to change this.';
    }

    // VS Code-style two-pane Settings: a left category nav + a right detail pane that fills the rest
    // of the available width (previously the whole page was capped at 640px, wasting most of the
    // right pane on wide windows). Only one category's <section> is visible at a time.
    document.querySelectorAll('.ev-settings-nav-item').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var target = btn.dataset.settingsSection;
        document.querySelectorAll('.ev-settings-nav-item').forEach(function (b) { b.classList.toggle('active', b === btn); });
        document.querySelectorAll('.ev-settings-section').forEach(function (s) {
          s.style.display = (s.id === 'ev-settings-section-' + target) ? '' : 'none';
        });
      });
    });

    // Each long explanatory paragraph starts collapsed behind a small "ⓘ" toggle instead of always
    // taking up space — click to show/hide, same idea as VS Code's per-setting description toggle.
    document.querySelectorAll('.ev-info-toggle').forEach(function (btn) {
      // The description is either the button's own next sibling (a settings row: label/input/ⓘ/body
      // all as siblings) or the next sibling of the button's parent (a section title: the ⓘ sits
      // inside the title's own <div>, so the description paragraph after it is one level up).
      var next = btn.nextElementSibling;
      var body = (next && next.classList.contains('ev-info-body')) ? next : btn.parentElement.nextElementSibling;
      if (!body) return;
      btn.addEventListener('click', function () {
        body.style.display = (body.style.display === 'none') ? '' : 'none';
      });
    });

    function renderSettingsView() {
      EV.settings.maxOpenTabs().then(function (n) { els.max_open_tabs.value = n; });
      renderServerPortValue();
      renderTrustedDomainsList();
      renderInternalDomainsList();
      renderDomainCategoriesList();
    }

    els.btn_add_trusted_domain.addEventListener('click', function () {
      // Accepts a whole pasted list at once, not just one at a time; setTrustedDomains itself dedupes
      // (case/whitespace-insensitive for plain domains), so a repeated entry never shows up twice.
      // Split on newlines first, then on comma/space WITHIN a line -- but never split inside a line
      // that's a whole regex entry (e.g. "/\.corp\.example\.com$/i"), since a regex can legitimately
      // contain a comma (a {2,4}-style quantifier) that must not be treated as a list separator.
      var newDomains = [];
      els.trusted_domain_input.value.split(/\r?\n/).forEach(function (line) {
        line = line.trim();
        if (!line) return;
        if (EV.ruleHelpers.isRegexTrustedEntry(line)) { newDomains.push(line); return; }
        line.split(/[\s,]+/).forEach(function (d) { if (d) newDomains.push(d); });
      });
      if (!newDomains.length) return;
      EV.settings.trustedDomains().then(function (existing) {
        return EV.settings.setTrustedDomains(existing.concat(newDomains));
      }).then(function () {
        els.trusted_domain_input.value = '';
        renderTrustedDomainsList();
      });
    });

    els.btn_reset_trusted_domains.addEventListener('click', function () {
      EV.settings.resetTrustedDomainsToDefault().then(renderTrustedDomainsList);
    });

    function renderInternalDomainsList() {
      EV.settings.internalDomains().then(function (domains) {
        els.internal_domains_list.innerHTML = '';
        if (!domains.length) {
          els.internal_domains_list.appendChild(el('div', 'ev-muted-small', 'No organization domains set \u2014 internal/external is not shown.'));
          return;
        }
        domains.slice().sort().forEach(function (domain) {
          var chip = document.createElement('span');
          chip.className = 'ev-trusted-domain-chip';
          chip.title = domain;
          chip.appendChild(document.createTextNode(domain));
          var removeBtn = document.createElement('button');
          removeBtn.type = 'button';
          removeBtn.textContent = '\u00d7';
          removeBtn.title = 'Remove ' + domain;
          removeBtn.onclick = function () {
            EV.settings.setInternalDomains(domains.filter(function (d) { return d !== domain; })).then(function () { EV.settingsCache.refreshInternalDomains(); renderInternalDomainsList(); });
          };
          chip.appendChild(removeBtn);
          els.internal_domains_list.appendChild(chip);
        });
      });
    }

    els.btn_add_internal_domain.addEventListener('click', function () {
      var entries = (els.internal_domain_input.value || '').split(/[\s,;]+/).filter(Boolean);
      if (!entries.length) return;
      EV.settings.internalDomains().then(function (existing) {
        return EV.settings.setInternalDomains(existing.concat(entries));
      }).then(function (saved) {
        var kept = entries.filter(function (e) { return saved.indexOf(String(e).trim().toLowerCase().replace(/^@/, '')) !== -1; }).length;
        if (kept < entries.length) showToast((entries.length - kept) + ' entr' + (entries.length - kept === 1 ? 'y was' : 'ies were') + ' skipped \u2014 a domain looks like example.com.');
        els.internal_domain_input.value = '';
        EV.settingsCache.refreshInternalDomains();
        renderInternalDomainsList();
      });
    });

  };
})(typeof self !== 'undefined' ? self : this);
