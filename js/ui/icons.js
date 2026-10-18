/**
 * icons.js — a tiny, dependency-free inline-SVG icon set, replacing ad-hoc
 * emoji in the most frequently-seen parts of the UI (toolbar, tree, tab
 * strip, context menu). Every icon uses stroke="currentColor" so it
 * automatically recolors with the surrounding text (hover/selected/disabled
 * states need no extra CSS). Kept intentionally small and hand-drawn rather
 * than pulling in an icon font/library — consistent with this project
 * having zero dependencies beyond DOMPurify.
 */
(function (g) {
  'use strict';
  var EV = g.EV || (g.EV = {});

  var ICONS = {
    folder: '<path d="M1.5 3.5a1 1 0 0 1 1-1h3.2l1.3 1.6h6.5a1 1 0 0 1 1 1v7.4a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-9z"/>',
    mail: '<rect x="1.5" y="3" width="13" height="10" rx="1.2"/><path d="M2 4.2l6 4.8 6-4.8"/>',
    file: '<path d="M3.5 1.5h6l3 3v10h-9z"/><path d="M9.5 1.5v3h3"/>',
    trash: '<path d="M2.5 4.5h11" stroke-linecap="round"/><path d="M5.5 4.5v-1a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1"/><path d="M4 4.5l.7 8.5a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9l.7-8.5"/>',
    folderArrow: '<path d="M1.5 3.5a1 1 0 0 1 1-1h3.2l1.3 1.6h6.5a1 1 0 0 1 1 1v7.4a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-9z"/><path d="M6 9.5h4M8 7.5l2 2-2 2" stroke-linecap="round" stroke-linejoin="round"/>',
    copy: '<rect x="5" y="5" width="9" height="9.5" rx="1"/><path d="M3 10.5V2.5a1 1 0 0 1 1-1h6"/>',
    magnifier: '<circle cx="6.8" cy="6.8" r="4.3"/><path d="M10.1 10.1L14 14" stroke-linecap="round"/>',
    x: '<path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke-linecap="round"/>',
    check: '<path d="M3 8.5l3.2 3.2L13 4.8" stroke-linecap="round" stroke-linejoin="round"/>',
    minus: '<path d="M4 8h8" stroke-linecap="round"/>',
    chain: '<rect x="1.2" y="5.8" width="8.2" height="4.4" rx="2.2"/><rect x="6.6" y="5.8" width="8.2" height="4.4" rx="2.2"/>',
    chainBroken: '<rect x="0.8" y="5.8" width="6" height="4.4" rx="2.2"/><rect x="9.2" y="5.8" width="6" height="4.4" rx="2.2"/><path d="M8 2.4v2.2M5.7 3.3l1.1 1.7M10.3 3.3l-1.1 1.7M8 13.6v-2.2M5.7 12.7l1.1-1.7M10.3 12.7l-1.1-1.7" stroke-linecap="round"/>',
    clock: '<circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.4 1.6" stroke-linecap="round" stroke-linejoin="round"/>',
    user: '<circle cx="8" cy="5.5" r="2.6"/><path d="M2.8 13.5c.6-2.6 2.6-4 5.2-4s4.6 1.4 5.2 4" stroke-linecap="round"/>',
    inbox: '<path d="M2 9.5l2-6h8l2 6v3.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"/><path d="M2 9.5h3.5l.8 1.6h3.4l.8-1.6H14"/>',
    help: '<circle cx="8" cy="8" r="6"/><path d="M6.2 6.3a1.9 1.9 0 1 1 2.7 1.7c-.6.3-.9.7-.9 1.3" stroke-linecap="round"/><circle cx="8" cy="11.6" r=".5"/>',
    server: '<rect x="2" y="2.5" width="12" height="4.2" rx="1"/><rect x="2" y="9.3" width="12" height="4.2" rx="1"/><circle cx="4.6" cy="4.6" r=".5"/><circle cx="4.6" cy="11.4" r=".5"/>',
    shield: '<path d="M8 1.6l5 1.8v4.1c0 3-2.1 5.2-5 6.5-2.9-1.3-5-3.5-5-6.5V3.4z"/><path d="M5.8 8l1.6 1.6 3-3" stroke-linecap="round"/>',
    link: '<path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.8.8"/><path d="M9.2 6.8a2.6 2.6 0 0 0-3.7 0L3.3 9a2.6 2.6 0 0 0 3.7 3.7l.8-.8"/>',
    paperclip: '<path d="M12.6 7.4l-4.8 4.8a3 3 0 0 1-4.2-4.2l5.1-5.1a2 2 0 0 1 2.8 2.8L6.4 10.8a1 1 0 0 1-1.4-1.4l4.5-4.5" stroke-linecap="round"/>',
    tag: '<path d="M2.2 2.2h5.3l6.3 6.3a1 1 0 0 1 0 1.4l-3.9 3.9a1 1 0 0 1-1.4 0L2.2 7.5z"/><circle cx="5.2" cy="5.2" r=".9"/>',
    info: '<circle cx="8" cy="8" r="6"/><path d="M8 7.3v3.4" stroke-linecap="round"/><circle cx="8" cy="5.2" r=".4"/>',
    alert: '<path d="M8 2l6.2 11H1.8z"/><path d="M8 6.5v3.2" stroke-linecap="round"/><circle cx="8" cy="11.4" r=".4"/>'
  };

  /** Raw inline `<svg>` markup for `name` — set as innerHTML on a wrapper element (never as text). */
  EV.iconSvg = function (name, size) {
    var body = ICONS[name];
    if (!body) return '';
    var s = size || 14;
    return '<svg viewBox="0 0 16 16" width="' + s + '" height="' + s + '" fill="none" stroke="currentColor" ' +
      'stroke-width="1.3" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>';
  };

  /** A ready-to-append <span class="ev-icon [className]"> wrapping the SVG. */
  EV.iconEl = function (name, className, size) {
    var span = document.createElement('span');
    span.className = 'ev-icon' + (className ? ' ' + className : '');
    span.innerHTML = EV.iconSvg(name, size);
    return span;
  };
})(typeof self !== 'undefined' ? self : this);
