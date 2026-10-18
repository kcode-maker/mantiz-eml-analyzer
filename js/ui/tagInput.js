/**
 * tagInput.js — live validation for every tag-name box (the per-email "+ add tag", the multi-select
 * bar, the rule editor's tag). The rules themselves live in EV.tags.normalizeName (one definition,
 * also used by import and rule save); this only gives them a UI:
 *   - uppercase is lowercased as you type;
 *   - anything else not allowed turns the box red and says why, in a small note under it;
 *   - check() is what the submit handlers call: it returns the clean name, or null after showing the reason.
 * One shared note element, so boxes that come and go (the per-email box is rebuilt per tab) leak nothing.
 *
 * The note can never get stuck on screen. A submit handler can call check() from a BUTTON click, after the box has already lost
 * focus, so no later blur would ever hide it -- and the box may then be hidden or removed (modal closed, bar cleared). So it is
 * also dismissed by: any click or Escape/other key outside the box, the box disappearing, and a short timeout.
 */
(function (g) {
  'use strict';
  var EV = g.EV || (g.EV = {});
  var note = null;
  var noteOwner = null;
  var hideTimer = null;
  var AUTO_HIDE_MS = 4000;

  function getNote() {
    if (note) return note;
    note = document.createElement('div');
    note.className = 'ev-tag-input-note';
    note.setAttribute('role', 'alert');
    note.style.display = 'none';
    document.body.appendChild(note);
    window.addEventListener('resize', hide);
    // A scrolling ANCESTOR would leave the fixed note misplaced, so it hides; the box's own text scrolling as you type must not.
    window.addEventListener('scroll', function (e) { if (e.target !== noteOwner) hide(); }, true);
    // Dismiss on the next interaction anywhere except the box itself (capture phase: nothing can swallow the event first).
    document.addEventListener('mousedown', function (e) { if (noteOwner && e.target !== noteOwner) hide(); }, true);
    document.addEventListener('keydown', function (e) {
      if (!noteOwner) return;
      if (e.key === 'Escape' || document.activeElement !== noteOwner) hide();
    }, true);
    return note;
  }

  function hide() {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    if (note) note.style.display = 'none';
    noteOwner = null;
  }

  function show(input, message) {
    var n = getNote();
    n.textContent = message;
    n.style.display = 'block';
    var r = input.getBoundingClientRect();
    n.style.left = r.left + 'px';
    n.style.top = (r.bottom + 3) + 'px';
    n.style.maxWidth = Math.max(220, Math.min(320, window.innerWidth - r.left - 12)) + 'px';
    noteOwner = input;
    if (hideTimer) clearTimeout(hideTimer);
    // A box that is gone (removed, or hidden with its modal/bar) must not leave its note behind; otherwise just time out.
    hideTimer = setTimeout(hide, AUTO_HIDE_MS);
  }

  /** @returns {{check: function(): ?string}} */
  function bind(input) {
    input.setAttribute('maxlength', String(EV.tags.TAG_NAME_MAX + 20)); // room to see a too-long name; the length rule itself is in normalizeName

    function validateLive() {
      var lower = input.value.toLowerCase();
      if (lower !== input.value) {
        var pos = input.selectionStart;
        input.value = lower;
        try { input.setSelectionRange(pos, pos); } catch (e) { /* not focusable yet */ }
      }
      if (!input.value.trim()) { input.classList.remove('ev-invalid'); if (noteOwner === input) hide(); return; }
      var res = EV.tags.normalizeName(input.value);
      input.classList.toggle('ev-invalid', !res.ok);
      if (res.ok) { if (noteOwner === input) hide(); } else show(input, res.error);
    }

    input.addEventListener('input', validateLive);
    input.addEventListener('blur', function () { if (noteOwner === input) hide(); });

    return {
      /** The clean tag name, or null (with the reason shown) if what's typed isn't a valid tag. */
      check: function () {
        var res = EV.tags.normalizeName(input.value);
        input.classList.toggle('ev-invalid', !res.ok);
        if (!res.ok) { show(input, res.error); return null; }
        if (noteOwner === input) hide();
        return res.name;
      },
      reset: function () { input.classList.remove('ev-invalid'); if (noteOwner === input) hide(); }
    };
  }

  EV.tagInput = { bind: bind, hideNote: hide };
})(typeof self !== 'undefined' ? self : this);
