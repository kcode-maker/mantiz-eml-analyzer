/**
 * virtualList.js — minimal fixed-row-height virtualized list. Only the rows
 * currently scrolled into view are ever real DOM nodes, so the folder tree
 * and search-results panel stay smooth whether they hold 50 rows or 500,000.
 */
(function (g) {
  'use strict';
  var EV = g.EV || (g.EV = {});

  EV.createVirtualList = function (container, opts) {
    var rowHeight = opts.rowHeight || 22;
    var items = [];
    var viewport = document.createElement('div');
    viewport.className = 'ev-vlist-viewport';
    viewport.style.position = 'relative';
    container.innerHTML = '';
    container.appendChild(viewport);
    var scheduled = false;

    function setItems(newItems) {
      items = newItems || [];
      viewport.style.height = (items.length * rowHeight) + 'px';
      renderVisible();
    }

    function renderVisible() {
      var scrollTop = container.scrollTop;
      var viewHeight = container.clientHeight || 400;
      var startIdx = Math.max(0, Math.floor(scrollTop / rowHeight) - 8);
      var endIdx = Math.min(items.length, Math.ceil((scrollTop + viewHeight) / rowHeight) + 8);
      viewport.innerHTML = '';
      var frag = document.createDocumentFragment();
      for (var i = startIdx; i < endIdx; i++) {
        var rowEl = document.createElement('div');
        rowEl.className = 'ev-vlist-row';
        rowEl.style.position = 'absolute';
        rowEl.style.top = (i * rowHeight) + 'px';
        rowEl.style.left = '0';
        rowEl.style.right = '0';
        rowEl.style.height = rowHeight + 'px';
        opts.renderRow(items[i], rowEl, i);
        frag.appendChild(rowEl);
      }
      viewport.appendChild(frag);
    }

    function onScroll() {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(function () { scheduled = false; renderVisible(); });
    }
    container.addEventListener('scroll', onScroll);

    return {
      setItems: setItems,
      refresh: renderVisible,
      getItems: function () { return items; },
      scrollToIndex: function (i) { container.scrollTop = Math.max(0, i * rowHeight - 40); }
    };
  };
})(typeof self !== 'undefined' ? self : this);
