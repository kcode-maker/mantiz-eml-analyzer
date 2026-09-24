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
    copy: '<rect x="5" y="5" width="9" height="9.5" rx="1"/><path d="M3 10.5V2.5a1 1 0 0 1 1-1h6"/>'
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
