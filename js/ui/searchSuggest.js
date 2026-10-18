/**
 * searchSuggest.js — VS Code-style autocomplete for the decoded-search box.
 *
 * Two halves, deliberately separate:
 *   1. Pure logic (EV.searchSuggest.compute / apply) — given the text, caret and a small context
 *      ({headerNames, attExts, tagNames}), says what to suggest and how accepting one rewrites the
 *      text. No DOM, so tests/searchSuggest.test.js runs it under jsc.
 *   2. EV.searchSuggest.attach(input, opts) — the dropdown: keyboard/mouse handling, ARIA, positioning.
 *
 * Behavior (chosen so autocomplete never gets between you and a plain search):
 *   - Suggestions appear while you type the current word; nothing for an empty word (Ctrl+Space or
 *     ArrowDown asks for everything).
 *   - Enter ALWAYS searches unless you've moved into the list with the arrow keys. Tab accepts the
 *     highlighted suggestion (or the top one).
 *   - Accepting a field inserts `name:` and immediately offers its values when they're a closed set
 *     (auth results, attachment extensions in this folder, your tags, numeric examples).
 *   - Silent inside an open quote, and (via opts.isEnabled) in Raw search / Use Regex mode.
 */
(function (g) {
  'use strict';
  var EV = g.EV || (g.EV = {});

  var AUTH_VALUES = ['fail', 'pass', 'softfail', 'neutral', 'none', 'temperror', 'permerror', 'missing'];
  var COUNT_EXAMPLES = ['>0', '>1', '>3', '>10', '<=1', '=0'];
  var SIZE_EXAMPLES = ['>1mb', '>5mb', '<100kb', '>=10mb'];

  // The catalogue mirrors the query grammar (EV.SEARCH_FIELD_NAMES in searchIndex.js) — the test suite
  // fails if the two ever disagree. `values` names a value source for the field's closed value set.
  var FIELDS = [
    { name: 'header.subject', detail: 'subject line' },
    { name: 'header.from', detail: 'sender address or display name' },
    { name: 'header.to', detail: 'To recipients (full address)' },
    { name: 'header.cc', detail: 'Cc recipients (full address)' },
    { name: 'header.bcc', detail: 'Bcc recipients (full address)' },
    { name: 'header.replyto', detail: 'Reply-To address' },
    { name: 'header.returnpath', detail: 'Return-Path address' },
    { name: 'header.messageid', detail: 'Message-ID (exact match)' },
    { name: 'header.raw', detail: 'any header value' },
    { name: 'body', detail: 'decoded body text' },
    { name: 'url', detail: 'link addresses in the body, e.g. url:".pdf"' },
    { name: 'meta.fromdomain', detail: 'sender\'s domain (not the display name)' },
    { name: 'meta.replytodomain', detail: 'Reply-To domain' },
    { name: 'meta.returnpathdomain', detail: 'Return-Path domain' },
    { name: 'meta.originip', detail: 'earliest public IP in the Received chain' },
    { name: 'meta.connectingip', detail: 'IP that connected to the receiving side' },
    { name: 'meta.urldomain', detail: 'host of any link in the email' },
    { name: 'meta.category', detail: 'domain category, e.g. URL Shortener', values: 'category' },
    { name: 'meta.flag', detail: 'mismatch / anomaly flag', values: 'metaflag' },
    { name: 'meta.financial', detail: 'financial indicator found in the body', values: 'metafinancial' },
    { name: 'script.subject', detail: 'script of the subject (LATIN, CYRILLIC, GREEK...)', values: 'script' },
    { name: 'script.body', detail: 'script of the body (LATIN, CYRILLIC, GREEK...)', values: 'script' },
    { name: 'attachment.filename', detail: 'attachment file name' },
    { name: 'attachment.ext', detail: 'attachment extension, e.g. .exe', values: 'ext' },
    { name: 'attachment.sha256', detail: 'attachment SHA-256 (exact)' },
    { name: 'attachment.ocr', detail: 'OCR text (only emails you ran OCR on)' },
    { name: 'attachment.count', detail: 'number of attachments', values: COUNT_EXAMPLES },
    { name: 'auth.spf', detail: 'SPF result', values: AUTH_VALUES },
    { name: 'auth.dkim', detail: 'DKIM result', values: AUTH_VALUES },
    { name: 'auth.dmarc', detail: 'DMARC result', values: AUTH_VALUES },
    { name: 'tag', detail: 'tag name', values: 'tag' },
    { name: 'size', detail: 'email size, e.g. >5mb', values: SIZE_EXAMPLES },
    { name: 'urls', detail: 'number of links', values: COUNT_EXAMPLES },
    { name: 'recipients', detail: 'unique To/Cc/Bcc count', values: COUNT_EXAMPLES },
    { name: 'duplicates', detail: 'emails sharing this Message-ID', values: COUNT_EXAMPLES },
    { name: 'urgency', detail: 'urgency-language score', values: ['>=1', '>=3', '>=5'] }
  ];
  var FIELD_BY_NAME = {};
  FIELDS.forEach(function (f) { FIELD_BY_NAME[f.name] = f; });

  // Header names that already have a dedicated field above (the generic header.<name> form would be
  // shadowed by it), so they're not listed a second time from the folder's real headers.
  var SHADOWED_HEADER_NAMES = { subject: 1, from: 1, to: 1, cc: 1, bcc: 1, replyto: 1, returnpath: 1, messageid: 1, raw: 1 };
  var MAX_FIELD_ITEMS = 60;
  var MAX_VALUE_ITEMS = 100;

  /** The word being typed at `caret`: [start,end) in text, or null inside an open quote. */
  function tokenAt(text, caret) {
    var quotes = 0;
    for (var i = 0; i < caret; i++) if (text.charAt(i) === '"') quotes++;
    if (quotes % 2 === 1) return null;
    var start = caret;
    while (start > 0 && !/[\s()]/.test(text.charAt(start - 1))) start--;
    var end = caret;
    while (end < text.length && !/[\s)]/.test(text.charAt(end))) end++;
    if (text.charAt(start) === '-' && start < end) start++; // a leading "-" negates the term; complete what follows it
    return { start: start, end: end };
  }

  function rankName(name, needle) {
    if (name.indexOf(needle) === 0) return 0;
    var dot = name.lastIndexOf('.');
    if (needle.indexOf('.') === -1 && dot !== -1 && name.slice(dot + 1).indexOf(needle) === 0) return 1;
    return name.indexOf(needle) !== -1 ? 2 : -1;
  }

  function fieldItems(needle, force, ctx, hasColonAfter) {
    if (!needle && !force) return [];
    var all = FIELDS.map(function (f, i) { return { name: f.name, detail: f.detail, chain: !!f.values, order: i }; });
    (ctx.headerNames || []).forEach(function (h, i) {
      if (SHADOWED_HEADER_NAMES[h.name]) return;
      all.push({ name: 'header.' + h.name, detail: 'header · ' + (h.count || 0).toLocaleString() + ' email' + (h.count === 1 ? '' : 's'), chain: false, order: 1000 + i });
    });
    var ranked = [];
    all.forEach(function (it) {
      var r = needle ? rankName(it.name, needle) : 0;
      if (r === -1) return;
      it.rank = r;
      ranked.push(it);
    });
    ranked.sort(function (a, b) { return a.rank - b.rank || a.order - b.order; });
    return ranked.slice(0, MAX_FIELD_ITEMS).map(function (it) {
      var at = it.rank === 0 ? 0 : it.name.indexOf(needle);
      return {
        kind: 'field', label: it.name, detail: it.detail,
        insert: it.name + (hasColonAfter ? '' : ':'), chain: it.chain,
        matchStart: needle && at >= 0 ? at : 0, matchLen: needle && at >= 0 ? needle.length : 0
      };
    });
  }

  var META_FLAG_HELP = {
    'replyto-mismatch': 'Reply-To domain differs from the sender\'s', 'returnpath-mismatch': 'Return-Path domain differs from the sender\'s',
    'name-mismatch': 'display name claims a brand the domain isn\'t', 'lookalike': 'sender domain imitates a trusted one',
    'punycode': 'sender domain uses xn-- (IDN) encoding'
  };

  function valueList(field, ctx) {
    var f = FIELD_BY_NAME[field];
    if (!f || !f.values) return null;
    if (f.values === 'ext') return (ctx.attExts || []).map(function (e) { return { value: e.name, detail: (e.count || 0).toLocaleString() + ' email' + (e.count === 1 ? '' : 's') }; });
    if (f.values === 'tag') return (ctx.tagNames || []).map(function (t) { return { value: t, detail: 'tag' }; });
    if (f.values === 'category') return (ctx.categories || []).map(function (c) { return { value: c.name, detail: (c.count || 0).toLocaleString() + ' email' + (c.count === 1 ? '' : 's') }; });
    // closed sets owned by the search index (EV.SEARCH_META_VALUES), so the list can't drift from what the parser accepts
    if (f.values === 'metaflag') return ((EV.SEARCH_META_VALUES || {})['meta.flag'] || []).map(function (v) { return { value: v, detail: META_FLAG_HELP[v] || (EV.ANOMALY_FLAG_HELP || {})[v] || '' }; });
    if (f.values === 'script') return ((EV.SEARCH_META_VALUES || {})[field] || []).map(function (v) { return { value: v }; });
    if (f.values === 'metafinancial') return ((EV.SEARCH_META_VALUES || {})['meta.financial'] || []).map(function (v) { return { value: v }; });
    return f.values.map(function (v) { return { value: v }; });
  }

  function valueItems(field, prefix, ctx) {
    var list = valueList(field, ctx);
    if (!list || /^"/.test(prefix)) return [];
    var needle = prefix.toLowerCase();
    var bare = needle.replace(/^\./, ''); // attachment.ext: accepts "exe" as well as ".exe"
    var out = [];
    for (var i = 0; i < list.length && out.length < MAX_VALUE_ITEMS; i++) {
      var v = String(list[i].value);
      var lv = v.toLowerCase();
      if (needle && lv.indexOf(needle) !== 0 && lv.replace(/^\./, '').indexOf(bare) !== 0) continue;
      out.push({
        kind: 'value', label: v, detail: list[i].detail || '',
        insert: /\s/.test(v) ? '"' + v + '"' : v, space: true,
        matchStart: 0, matchLen: lv.indexOf(needle) === 0 ? needle.length : bare.length
      });
    }
    // Typed value is already complete and is the only candidate: nothing left to suggest.
    if (out.length === 1 && out[0].label.toLowerCase() === needle) return [];
    return out;
  }

  /**
   * @returns {null | {from:number, to:number, mode:'field'|'value', items:Array}}
   *   `from`/`to` is the range of `text` an accepted suggestion replaces.
   */
  function compute(text, caret, ctx, force) {
    text = String(text == null ? '' : text);
    if (caret == null || caret > text.length) caret = text.length;
    ctx = ctx || {};
    var tok = tokenAt(text, caret);
    if (!tok) return null;
    var word = text.slice(tok.start, tok.end);
    var colon = word.indexOf(':');
    var items, from, to, mode;
    if (colon !== -1 && caret - tok.start > colon) {
      mode = 'value';
      var field = word.slice(0, colon).toLowerCase();
      from = tok.start + colon + 1;
      to = tok.end;
      items = valueItems(field, text.slice(from, caret), ctx);
    } else {
      mode = 'field';
      from = tok.start;
      to = colon !== -1 ? tok.start + colon : tok.end;
      items = fieldItems(text.slice(tok.start, caret).toLowerCase(), !!force, ctx, colon !== -1);
      // A lone, fully-typed field name that the caret already sits on the end of still offers its colon.
    }
    return items.length ? { from: from, to: to, mode: mode, items: items } : null;
  }

  /** Text and caret after accepting `item` into `range` ({from,to}). */
  function apply(text, range, item) {
    var before = text.slice(0, range.from);
    var after = text.slice(range.to);
    var ins = item.insert;
    var caret;
    if (item.space) {
      if (/^\s/.test(after)) { caret = before.length + ins.length + 1; }
      else { ins += ' '; caret = before.length + ins.length; }
    } else {
      caret = before.length + ins.length;
      if (item.kind === 'field' && after.charAt(0) === ':') caret++; // already followed by a colon: step over it
    }
    return { text: before + ins + after, caret: caret };
  }

  // ---------------------------------------------------------------- DOM controller

  // One popup element shared by every attached input (only one input has focus at a time), and one
  // set of window listeners — so inputs that are created and thrown away (the per-email tag box is
  // rebuilt on every tab render) never leak DOM nodes or listeners.
  var sharedPopup = null;
  var activeCtl = null; // the controller whose list is currently showing
  function getPopup() {
    if (sharedPopup) return sharedPopup;
    sharedPopup = document.createElement('div');
    sharedPopup.id = 'ev-suggest';
    sharedPopup.className = 'ev-suggest';
    sharedPopup.setAttribute('role', 'listbox');
    sharedPopup.style.display = 'none';
    // Dragging the popup's own scrollbar must not blur the input (which would close it).
    sharedPopup.addEventListener('mousedown', function (e) { e.preventDefault(); });
    document.body.appendChild(sharedPopup);
    window.addEventListener('resize', function () { if (activeCtl) activeCtl.close(); });
    window.addEventListener('scroll', function (e) {
      if (activeCtl && !sharedPopup.contains(e.target)) activeCtl.close();
    }, true);
    return sharedPopup;
  }

  /**
   * @param {HTMLInputElement|HTMLTextAreaElement} input
   * @param {{getContext: function(): object, isEnabled: function(): boolean,
   *          compute?: function(string, number, object, boolean): ?object,
   *          apply?: function(string, object, object): {text: string, caret: number},
   *          notifyInput?: boolean, showOnFocus?: boolean, multiline?: boolean}} opts
   *   compute/apply default to the search-grammar ones; the tag boxes and the rule editor pass their own.
   * @returns {{close: function, refresh: function}}
   */
  function attach(input, opts) {
    var popup = getPopup();
    var computeFn = opts.compute || compute;
    var applyFn = opts.apply || apply;
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', popup.id);
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('spellcheck', 'false');

    var current = null; // {range, items}
    var sel = -1;
    var composing = false;
    var dismissed = false; // Esc pressed: stay closed until the text changes
    var ctl = { close: close, refresh: refresh };

    function isOpen() { return activeCtl === ctl && popup.style.display !== 'none'; }

    function close() {
      if (activeCtl === ctl) {
        popup.style.display = 'none';
        popup.textContent = '';
        activeCtl = null;
      }
      current = null;
      sel = -1;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    }

    function setSel(i) {
      var rows = popup.querySelectorAll('.ev-suggest-row');
      if (sel >= 0 && rows[sel]) { rows[sel].classList.remove('selected'); rows[sel].setAttribute('aria-selected', 'false'); }
      sel = i;
      if (sel >= 0 && rows[sel]) {
        rows[sel].classList.add('selected');
        rows[sel].setAttribute('aria-selected', 'true');
        input.setAttribute('aria-activedescendant', rows[sel].id);
        rows[sel].scrollIntoView({ block: 'nearest' });
      } else {
        input.removeAttribute('aria-activedescendant');
      }
    }

    function position() {
      var r = input.getBoundingClientRect();
      var below = window.innerHeight - r.bottom - 8;
      var above = r.top - 8;
      var h = Math.min(popup.scrollHeight, 280);
      var up = below < Math.min(h, 160) && above > below;
      popup.style.left = r.left + 'px';
      popup.style.width = Math.max(r.width, 260) + 'px';
      popup.style.maxHeight = Math.max(120, Math.min(280, up ? above : below)) + 'px';
      if (up) { popup.style.top = ''; popup.style.bottom = (window.innerHeight - r.top + 2) + 'px'; }
      else { popup.style.bottom = ''; popup.style.top = (r.bottom + 2) + 'px'; }
    }

    function render(result) {
      if (activeCtl && activeCtl !== ctl) activeCtl.close();
      activeCtl = ctl;
      popup.textContent = '';
      current = { range: { from: result.from, to: result.to }, items: result.items };
      result.items.forEach(function (it, i) {
        var row = document.createElement('div');
        row.className = 'ev-suggest-row';
        row.id = 'ev-suggest-opt-' + i;
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', 'false');
        var label = document.createElement('span');
        label.className = 'ev-suggest-label';
        if (it.matchLen) {
          label.appendChild(document.createTextNode(it.label.slice(0, it.matchStart)));
          var b = document.createElement('b');
          b.textContent = it.label.slice(it.matchStart, it.matchStart + it.matchLen);
          label.appendChild(b);
          label.appendChild(document.createTextNode(it.label.slice(it.matchStart + it.matchLen)));
        } else {
          label.textContent = it.label;
        }
        var detail = document.createElement('span');
        detail.className = 'ev-suggest-detail';
        detail.textContent = it.detail || '';
        row.appendChild(label);
        row.appendChild(detail);
        // mousedown, not click: keeps focus (and the caret) in the input.
        row.addEventListener('mousedown', function (e) { e.preventDefault(); accept(i); });
        popup.appendChild(row);
      });
      var foot = document.createElement('div');
      foot.className = 'ev-suggest-foot';
      foot.textContent = '↑↓ select · Tab accept · Esc close';
      popup.appendChild(foot);
      popup.style.display = 'block';
      position();
      popup.scrollTop = 0;
      input.setAttribute('aria-expanded', 'true');
      sel = -1;
    }

    function refresh(force) {
      if (composing || (dismissed && !force) || !opts.isEnabled()) { if (!force) close(); return; }
      if (force) dismissed = false;
      var result = computeFn(input.value, input.selectionStart, opts.getContext(), !!force);
      if (!result) { close(); return; }
      render(result);
    }

    function accept(i) {
      if (!current || !current.items[i]) return;
      var item = current.items[i];
      var out = applyFn(input.value, current.range, item);
      input.value = out.text;
      input.setSelectionRange(out.caret, out.caret);
      input.focus();
      // Tag boxes validate on 'input' (js/ui/tagInput.js) and the rule editor tracks manual edits there too.
      if (opts.notifyInput) input.dispatchEvent(new Event('input', { bubbles: true }));
      close();
      dismissed = false;
      // Chain: a field that has a closed value set (or a namespace such as `f.`) offers what comes next straight away.
      if (item.kind === 'field' || item.chain) refresh(false);
    }

    input.addEventListener('input', function () { dismissed = false; refresh(false); });
    input.addEventListener('click', function () { refresh(false); });
    input.addEventListener('focus', function () { if (opts.showOnFocus) refresh(false); });
    input.addEventListener('keyup', function (e) {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].indexOf(e.key) !== -1) refresh(false);
    });
    input.addEventListener('blur', close);
    input.addEventListener('compositionstart', function () { composing = true; close(); });
    input.addEventListener('compositionend', function () { composing = false; refresh(false); });

    // Capture phase + stopImmediatePropagation: the box's own Enter handler (search / add tag) must not
    // also fire when Enter accepts a suggestion.
    input.addEventListener('keydown', function (e) {
      if (e.isComposing) return;
      if ((e.ctrlKey || e.metaKey) && e.key === ' ') { e.preventDefault(); refresh(true); return; }
      if (!isOpen()) {
        if (e.key === 'ArrowDown' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && opts.isEnabled() && !opts.multiline) { e.preventDefault(); refresh(true); }
        return;
      }
      var n = current ? current.items.length : 0;
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel(sel < n - 1 ? sel + 1 : 0); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(sel > 0 ? sel - 1 : n - 1); }
      else if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); accept(sel >= 0 ? sel : 0); }
      else if (e.key === 'Enter') {
        if (sel >= 0) { e.preventDefault(); e.stopImmediatePropagation(); accept(sel); }
        else close(); // nothing chosen: let Enter do its normal job (search / add the typed tag / newline)
      } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); dismissed = true; close(); }
    }, true);

    return ctl;
  }

  // ---------- tag boxes ----------
  // The tag inputs (per-email "+ add tag", the bulk bar, the rule editor's tag) take one tag name.
  // Suggest existing names so the same tag is typed the same way every time (a typo makes a second tag).

  var MAX_TAG_ITEMS = 40;

  /** Pure: existing tag names matching what's typed (prefix first, then substring). An empty box lists
   * them all (capped), since there's no grammar to get in the way here. */
  function computeTag(text, caret, ctx) {
    var names = (ctx && ctx.tagNames) || [];
    var exclude = {};
    ((ctx && ctx.exclude) || []).forEach(function (t) { exclude[String(t).toLowerCase()] = true; });
    var needle = String(text || '').trim().toLowerCase();
    var ranked = [];
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      var lc = name.toLowerCase();
      if (exclude[lc]) continue;
      var at = needle ? lc.indexOf(needle) : 0;
      if (at === -1) continue;
      if (needle && lc === needle) continue; // already exactly what's typed
      ranked.push({ name: name, rank: at === 0 ? 0 : 1, at: at, order: i });
    }
    if (!ranked.length) return null;
    ranked.sort(function (a, b) { return a.rank - b.rank || a.order - b.order; });
    return {
      from: 0, to: String(text || '').length, mode: 'tag',
      items: ranked.slice(0, MAX_TAG_ITEMS).map(function (r) {
        return { kind: 'tag', label: r.name, insert: r.name, matchStart: r.at, matchLen: needle.length, detail: 'existing tag' };
      })
    };
  }

  function applyTag(text, range, item) {
    return { text: item.insert, caret: item.insert.length };
  }

  /** Attach tag-name autocomplete to a single-tag input. getTagNames() returns the known names;
   * getExclude() (optional) returns names not to offer, e.g. tags this email already has. */
  function attachTagInput(input, getTagNames, getExclude) {
    return attach(input, {
      compute: computeTag, apply: applyTag, showOnFocus: true, notifyInput: true,
      isEnabled: function () { return true; },
      getContext: function () { return { tagNames: getTagNames() || [], exclude: getExclude ? getExclude() : [] }; }
    });
  }

  EV.searchSuggest = { compute: compute, apply: apply, attach: attach, FIELDS: FIELDS,
    computeTag: computeTag, applyTag: applyTag, attachTagInput: attachTagInput };
})(typeof self !== 'undefined' ? self : this);
