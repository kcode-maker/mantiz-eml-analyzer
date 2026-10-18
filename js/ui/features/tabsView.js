/**
 * tabsView.js — the right pane's tab strip and its glue: opening an email in a tab, what happens when a tab is activated (path bar, status bar, renders the email), the standing remote-content chip, and keeping the Explorer's open-in-tab markers current.
 */
(function (g) {
  'use strict';
  var EV = g.EV || (g.EV = {});
  EV.ui = EV.ui || {};
  EV.ui.features = EV.ui.features || {};

  EV.ui.features.tabsView = function createTabsView(ctx) {
    var state = ctx.state, els = ctx.els;
    // Exported to the other features (function declarations are hoisted, so these are valid before their definitions).
    ctx.onTabActivate = onTabActivate;
    ctx.openTab = openTab;

    function refreshOpenTabIndicators() {
      state.openTabPaths = new Set(ctx.tabMgr.list().map(function (t) { return t.path; }));
      ctx.treeList.refresh();
    }

    ctx.tabMgr = EV.createTabManager(els.tab_strip, {
      onActivate: onTabActivate,
      onChange: function () { ctx.saveSession(); refreshOpenTabIndicators(); },
      getTagsForPath: function (path) { return state.tagDotCache.get(path); }
    });

    EV.settings.maxOpenTabs().then(function (n) { ctx.tabMgr.setMaxTabs(n); });

    function openTab(entry) {
      ctx.tabMgr.open(entry);
    }

    // Standing indicator while remote content is on for every email (see EV.remoteContent in render.js).
    EV.remoteContent.onChange = function (on) { els.status_remote.style.display = on ? '' : 'none'; };

    els.status_remote.addEventListener('click', function () {
      EV.remoteContent.set(false);
      var active = ctx.tabMgr && ctx.tabMgr.getActive();
      if (active) ctx.tabMgr.activate(active.id); // re-render the open email so it is blocked again right away
    });

    function onTabActivate(tab) {
      if (ctx.settingsOpen) ctx.closeSettingsView();
      if (ctx.overviewOpen) ctx.closeOverviewView();
      els.empty_state.style.display = tab ? 'none' : 'flex';
      els.subtab_nav.style.display = tab ? 'flex' : 'none';
      state.selectedPath = tab ? tab.path : null;
      ctx.treeList.refresh();
      if (!tab) {
        els.content.innerHTML = '';
        els.path_bar.innerHTML = '';
        els.status_selected.textContent = '';
        return;
      }
      els.status_selected.textContent = ctx.fullPath(tab.path);
      ctx.renderPathBar(tab.path);
      EV.renderTab(tab, { subtabNav: els.subtab_nav, content: els.content, loading: els.loading, onParsed: function () { ctx.tabMgr.renderStrip(); } });
      ctx.saveSession();
      ctx.revealInTree(tab.path);
    }

    onTabActivate(null);
  };
})(typeof self !== 'undefined' ? self : this);
