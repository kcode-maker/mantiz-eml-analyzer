/**
 * dialogs.js — the app's own confirm / alert dialogs, replacing the browser's native window.confirm()/alert().
 *
 * Why: some hosts never show native dialogs at all — an embedded browser pane in a desktop app can return
 * `false` from confirm() instantly and show nothing for alert(). Anything gated on confirm() (turning remote
 * content on, deleting emails or a rule) then silently did nothing, and every alert() message was invisible.
 * These work in every browser/host, are keyboard-friendly (Esc cancels, Tab cycles, the safe button is
 * focused first) and queue, so two messages in a row are both shown.
 *
 *   EV.confirmDialog({title, message, confirmLabel, cancelLabel, danger}) -> Promise<boolean>
 *   EV.alertDialog(message, title)                                        -> Promise<void>
 */
(function (g) {
  'use strict';
  var EV = g.EV || (g.EV = {});

  var queue = [];
  var showing = false;

  function mk(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function showNext() {
    if (showing || !queue.length) return;
    showing = true;
    var spec = queue.shift();
    var previouslyFocused = document.activeElement;

    var overlay = mk('div', 'ev-modal-overlay');
    overlay.style.zIndex = '320';
    var modal = mk('div', 'ev-modal');
    modal.style.width = '440px';
    modal.setAttribute('role', spec.kind === 'confirm' ? 'alertdialog' : 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', spec.title);
    modal.appendChild(mk('h3', null, spec.title));
    var msg = mk('div', null, spec.message);
    msg.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.5;max-height:50vh;overflow:auto';
    modal.appendChild(msg);

    var actions = mk('div', 'ev-modal-actions');
    var cancelBtn = null;
    if (spec.kind === 'confirm') {
      cancelBtn = mk('button', 'ev-btn', spec.cancelLabel);
      cancelBtn.type = 'button';
      actions.appendChild(cancelBtn);
    }
    var okBtn = mk('button', 'ev-btn ' + (spec.danger ? 'ev-btn-danger' : 'ev-btn-primary'), spec.confirmLabel);
    okBtn.type = 'button';
    actions.appendChild(okBtn);
    modal.appendChild(actions);
    overlay.appendChild(modal);

    var done = false;
    function finish(result) {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      showing = false;
      try { if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus(); } catch (e) { /* element gone */ }
      spec.resolve(result);
      showNext();
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); return; }
      if (e.key === 'Tab') { // keep focus inside the dialog
        var btns = cancelBtn ? [cancelBtn, okBtn] : [okBtn];
        var i = btns.indexOf(document.activeElement);
        e.preventDefault();
        btns[(i + (e.shiftKey ? btns.length - 1 : 1)) % btns.length].focus();
      }
    }
    document.addEventListener('keydown', onKey, true);
    if (cancelBtn) cancelBtn.onclick = function () { finish(false); };
    okBtn.onclick = function () { finish(true); };
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) finish(false); });
    document.body.appendChild(overlay);
    (cancelBtn || okBtn).focus(); // for a confirmation the safe choice is the default one
  }

  EV.confirmDialog = function (opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      queue.push({
        kind: 'confirm', resolve: resolve, title: opts.title || 'Please confirm', message: String(opts.message == null ? '' : opts.message),
        confirmLabel: opts.confirmLabel || 'OK', cancelLabel: opts.cancelLabel || 'Cancel', danger: !!opts.danger
      });
      showNext();
    });
  };

  EV.alertDialog = function (message, title) {
    return new Promise(function (resolve) {
      queue.push({ kind: 'alert', resolve: resolve, title: title || 'Notice', message: String(message == null ? '' : message), confirmLabel: 'OK' });
      showNext();
    });
  };
})(typeof self !== 'undefined' ? self : this);
