/**
 * uiKit.js — the few DOM/format helpers every UI module shares, so no module re-implements them (EV.ui.*). No state, no
 * dependencies; loaded before any other js/ui file.
 */
(function (g) {
  'use strict';
  var EV = g.EV || (g.EV = {});
  EV.ui = EV.ui || {};

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function fmtBytes(n) {
    if (n == null) return '?';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function fmtAddr(a) {
    return a.name ? a.name + ' <' + a.address + '>' : a.address;
  }

  function copyBtn(getText, label) {
    var b = el('button', 'ev-mini-btn', label || 'Copy');
    b.onclick = function () {
      navigator.clipboard && navigator.clipboard.writeText(getText()).catch(function () {});
      b.textContent = 'Copied!';
      setTimeout(function () { b.textContent = label || 'Copy'; }, 1200);
    };
    return b;
  }

  function downloadBlob(bytes, filename, mime) {
    var blob = new Blob([bytes], { type: mime || 'application/octet-stream' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  EV.ui.el = el; EV.ui.fmtBytes = fmtBytes; EV.ui.fmtAddr = fmtAddr; EV.ui.copyBtn = copyBtn; EV.ui.downloadBlob = downloadBlob;
})(typeof self !== 'undefined' ? self : this);
