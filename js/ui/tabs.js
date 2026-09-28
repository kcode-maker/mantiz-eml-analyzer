/**
 * tabs.js — IDE-style multi-tab management for the right pane. Each tab
 * holds one open email (parsed lazily on first render) plus its own small
 * UI state (which sub-view is active, whether remote content is allowed for
 * that message). Closing a tab revokes any blob: URLs it created.
 */
(function (g) {
  'use strict';
  var EV = g.EV || (g.EV = {});

  // A folder full of interesting emails invites opening far more tabs than anyone actually keeps
  // track of -- past this many, the least-recently-viewed tab is evicted to make room for the new
  // one (recently (re)selecting a tab keeps it "fresh", so it isn't the first to go just because it
  // was opened early on -- an LRU queue, not a strict open-order FIFO). Nothing about a tag/note is
  // lost when a tab closes this way -- those are saved to IndexedDB as you go, not held in tab state.
  var DEFAULT_MAX_TABS = 10;

  function clampMaxTabs(n) {
    n = Math.round(Number(n));
    if (!Number.isFinite(n)) n = DEFAULT_MAX_TABS; // e.g. NaN/undefined input, not a valid 0
    return Math.max(1, Math.min(100, n));
  }

  EV.createTabManager = function (stripEl, opts) {
    opts = opts || {};
    var tabs = [];
    var activeId = null;
    var seq = 0;
    var activationSeq = 0;
    var maxTabs = clampMaxTabs(opts.maxTabs);

    function byPath(path) {
      return tabs.filter(function (t) { return t.path === path; })[0];
    }

    function evictLeastRecentlyViewed() {
      var oldest = tabs[0];
      for (var i = 1; i < tabs.length; i++) {
        if (tabs[i].lastActivated < oldest.lastActivated) oldest = tabs[i];
      }
      close(oldest.id);
    }

    function open(fileEntry) {
      var existing = byPath(fileEntry.path);
      if (existing) {
        activate(existing.id);
        return existing;
      }
      while (tabs.length >= maxTabs) evictLeastRecentlyViewed();
      var tab = {
        id: ++seq,
        path: fileEntry.path,
        name: fileEntry.name,
        entry: fileEntry,
        parsed: null,
        parseError: null,
        loading: false,
        activeSubTab: 'preview',
        allowRemote: false,
        blobUrls: [],
        scrollPositions: {},
        lastActivated: 0
      };
      tabs.push(tab);
      activate(tab.id);
      if (opts.onChange) opts.onChange();
      return tab;
    }

    function activate(id) {
      var tab = getById(id);
      if (!tab) return;
      activeId = id;
      tab.lastActivated = ++activationSeq;
      renderStrip();
      if (opts.onActivate) opts.onActivate(getActive());
    }

    function setMaxTabs(n) {
      maxTabs = clampMaxTabs(n);
      while (tabs.length > maxTabs) evictLeastRecentlyViewed();
    }

    function revoke(tab) {
      tab.blobUrls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) {} });
      tab.blobUrls = [];
    }

    function close(id) {
      var idx = -1;
      for (var i = 0; i < tabs.length; i++) if (tabs[i].id === id) { idx = i; break; }
      if (idx === -1) return;
      revoke(tabs[idx]);
      tabs.splice(idx, 1);
      if (activeId === id) {
        activeId = tabs.length ? tabs[Math.min(idx, tabs.length - 1)].id : null;
      }
      renderStrip();
      if (opts.onActivate) opts.onActivate(getActive());
      if (opts.onChange) opts.onChange();
    }

    function closeOthers(id) {
      tabs.slice().forEach(function (t) { if (t.id !== id) close(t.id); });
    }

    function closeAll() {
      tabs.slice().forEach(function (t) { close(t.id); });
    }

    function getActive() {
      for (var i = 0; i < tabs.length; i++) if (tabs[i].id === activeId) return tabs[i];
      return null;
    }

    function getById(id) {
      for (var i = 0; i < tabs.length; i++) if (tabs[i].id === id) return tabs[i];
      return null;
    }

    function iconFor(t) {
      if (t.parseError) return { glyph: '⚠️', cls: 'ev-tab-icon-error', title: 'Failed to parse: ' + t.parseError };
      if (!t.parsed) return { glyph: '⏳', cls: 'ev-tab-icon-loading', title: 'Parsing…' };
      return { glyph: EV.iconSvg('mail'), cls: 'ev-tab-icon-ok', title: 'Email' };
    }

    function renderStrip() {
      stripEl.innerHTML = '';
      tabs.forEach(function (t) {
        var el = document.createElement('div');
        el.className = 'ev-tab' + (t.id === activeId ? ' active' : '');
        el.title = t.path;

        var icon = iconFor(t);
        var iconSpan = document.createElement('span');
        iconSpan.className = 'ev-tab-icon ' + icon.cls;
        iconSpan.innerHTML = icon.glyph;
        iconSpan.title = icon.title;
        el.appendChild(iconSpan);

        var nameSpan = document.createElement('span');
        nameSpan.className = 'ev-tab-name';
        nameSpan.textContent = t.name;
        el.appendChild(nameSpan);

        if (t.parsed && t.parsed.attachments && t.parsed.attachments.length) {
          var clip = document.createElement('span');
          clip.className = 'ev-tab-attachment-badge';
          clip.textContent = '📎';
          clip.title = t.parsed.attachments.length + ' attachment(s)';
          el.appendChild(clip);
        }

        var tags = opts.getTagsForPath ? (opts.getTagsForPath(t.path) || []) : [];
        if (tags.length) {
          var dots = document.createElement('span');
          dots.className = 'ev-tag-dots';
          tags.slice(0, 4).forEach(function (tag) {
            var d = document.createElement('span');
            d.className = 'ev-tag-dot';
            d.style.background = EV.tagColor(tag);
            d.title = tag;
            dots.appendChild(d);
          });
          el.appendChild(dots);
        }

        var closeBtn = document.createElement('span');
        closeBtn.className = 'ev-tab-close';
        closeBtn.textContent = '×';
        closeBtn.title = 'Close (Alt+W)';
        closeBtn.onclick = function (e) { e.stopPropagation(); close(t.id); };
        el.appendChild(closeBtn);

        el.onclick = function () { activate(t.id); };
        el.oncontextmenu = function (e) {
          e.preventDefault();
          if (opts.onTabContextMenu) opts.onTabContextMenu(t, e.clientX, e.clientY);
        };
        stripEl.appendChild(el);
      });
    }

    return {
      open: open,
      activate: activate,
      close: close,
      closeOthers: closeOthers,
      closeAll: closeAll,
      getActive: getActive,
      getById: getById,
      list: function () { return tabs.slice(); },
      renderStrip: renderStrip,
      setMaxTabs: setMaxTabs,
      getMaxTabs: function () { return maxTabs; },
      next: function () {
        if (tabs.length < 2) return;
        var idx = tabs.findIndex(function (t) { return t.id === activeId; });
        activate(tabs[(idx + 1) % tabs.length].id);
      },
      prev: function () {
        if (tabs.length < 2) return;
        var idx = tabs.findIndex(function (t) { return t.id === activeId; });
        activate(tabs[(idx - 1 + tabs.length) % tabs.length].id);
      }
    };
  };
})(typeof self !== 'undefined' ? self : this);
