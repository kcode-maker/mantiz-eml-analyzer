/**
 * overlays.js — small UI primitives shared by every feature module: the right-click context menu, the bottom toast (with an
 * optional Undo button), clipboard copy with feedback, the one-dialog-at-a-time slot, and two formatters. No app state (EV.ui.*).
 */
(function (g) {
  'use strict';
  var EV = g.EV || (g.EV = {});
  EV.ui = EV.ui || {};
  var el = EV.ui.el;

  function fmtBytesShort(n) {
    if (n == null) return '?';
    if (n < 1024) return n + 'B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + 'KB';
    return (n / (1024 * 1024)).toFixed(1) + 'MB';
  }
  var activeContextMenu = null;
  function closeContextMenu() {
    if (!activeContextMenu) return;
    activeContextMenu.remove();
    activeContextMenu = null;
    document.removeEventListener('click', closeContextMenu, true);
    document.removeEventListener('keydown', onContextMenuKeydown, true);
  }
  function onContextMenuKeydown(e) { if (e.key === 'Escape') closeContextMenu(); }
  function showContextMenu(x, y, items) {
    closeContextMenu();
    var menu = document.createElement('div');
    menu.className = 'ev-context-menu';
    items.forEach(function (item) {
      if (item.separator) { menu.appendChild(el('div', 'ev-context-menu-sep')); return; }
      var btn = document.createElement('button');
      btn.className = 'ev-context-menu-item' + (item.danger ? ' danger' : '');
      btn.disabled = !!item.disabled;
      if (item.title) btn.title = item.title;
      var icon = el('span', 'ev-context-menu-icon');
      icon.innerHTML = item.icon || '';
      var label = el('span', null, item.label);
      btn.appendChild(icon);
      btn.appendChild(label);
      btn.onclick = function () { closeContextMenu(); if (item.onClick) item.onClick(); };
      menu.appendChild(btn);
    });
    document.body.appendChild(menu);
    var rect = menu.getBoundingClientRect();
    var left = Math.min(x, window.innerWidth - rect.width - 8);
    var top = Math.min(y, window.innerHeight - rect.height - 8);
    menu.style.left = Math.max(4, left) + 'px';
    menu.style.top = Math.max(4, top) + 'px';
    activeContextMenu = menu;
    setTimeout(function () {
      document.addEventListener('click', closeContextMenu, true);
      document.addEventListener('keydown', onContextMenuKeydown, true);
    }, 0);
  }
  function basename(path) {
    var parts = String(path).split('/');
    return parts[parts.length - 1];
  }
  // showContextMenu closes the menu before running a clicked item's onClick, so there's no surviving
  // menu surface left to show a "Copied!" confirmation on (unlike copyBtn in render.js, which mutates
  // its own still-visible button text) -- this is the minimal new primitive that's actually needed.
  var activeToast = null;
  /** A short message at the bottom of the window. opts: {duration ms (default 1500), actionLabel, onAction} --
   * an action (e.g. Undo) adds a button and, since it needs time to be clicked, defaults to 8 seconds. */
  function showToast(message, opts) {
    opts = opts || {};
    if (activeToast) { clearTimeout(activeToast._timer); activeToast.remove(); }
    var toast = el('div', 'ev-toast', message);
    if (opts.actionLabel && opts.onAction) {
      var btn = el('button', 'ev-toast-action', opts.actionLabel);
      btn.type = 'button';
      btn.onclick = function () {
        clearTimeout(toast._timer);
        toast.remove();
        if (activeToast === toast) activeToast = null;
        opts.onAction();
      };
      toast.appendChild(btn);
    }
    document.body.appendChild(toast);
    activeToast = toast;
    toast._timer = setTimeout(function () {
      toast.remove();
      if (activeToast === toast) activeToast = null;
    }, opts.duration || (opts.actionLabel ? 8000 : 1500));
  }
  function copyToClipboard(text, successMsg) {
    if (!navigator.clipboard || !navigator.clipboard.writeText) { showToast('Clipboard not available in this browser.'); return; }
    navigator.clipboard.writeText(text).then(function () {
      showToast(successMsg);
    }).catch(function () {
      showToast('Copy failed — clipboard access was blocked.');
    });
  }
  // Only one of this file's own dialogs (Move/Copy, Tag Deletion) can be open at a time: a second click on the button that
  // opened it must not stack another copy on top.
  var openAppDialog = null;
  function claimDialogSlot(overlay) {
    if (openAppDialog && document.body.contains(openAppDialog)) return false;
    openAppDialog = overlay;
    return true;
  }

  EV.ui.showContextMenu = showContextMenu; EV.ui.showToast = showToast; EV.ui.copyToClipboard = copyToClipboard;
  EV.ui.claimDialogSlot = claimDialogSlot; EV.ui.basename = basename; EV.ui.fmtBytesShort = fmtBytesShort;
})(typeof self !== 'undefined' ? self : this);
