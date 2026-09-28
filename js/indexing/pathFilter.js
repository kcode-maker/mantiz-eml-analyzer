/**
 * pathFilter.js — the shared "files to include/exclude" path-matching logic behind Decoded and Raw
 * search's include/exclude filter fields (VSCode-style). Pure, dependency-free functions only, no DOM
 * — used identically by js/indexing/searchIndex.js and js/indexing/rawSearch.js, so the matching
 * semantics can never drift between the two search modes.
 *
 * Pattern language is deliberately simple, extending the Explorer tree filter's own existing
 * convention (a plain, case-insensitive, unanchored substring match against the relative path) with
 * two optional wildcards: "*" (any run of characters) and "?" (exactly one character) — not a full
 * glob engine (no "**", no character classes), consistent with this project's zero-new-dependency,
 * keep-it-simple ethos.
 */
(function (g) {
  'use strict';
  var EV = g.EV || (g.EV = {});

  /** Splits a raw textarea/input string into a flat list of trimmed, non-empty patterns. Splits on
   * newline first, then on comma within each line -- NOT on whitespace, since a folder/file name can
   * legitimately contain spaces (unlike a domain/keyword token, which never does). */
  EV.parsePathPatternList = function (raw) {
    if (!raw) return [];
    var out = [];
    String(raw).split(/\r?\n/).forEach(function (line) {
      line.split(',').forEach(function (part) {
        var p = part.trim();
        if (p) out.push(p);
      });
    });
    return out;
  };

  var REGEX_METACHAR_RE = /[.+^${}()|[\]\\]/g;

  /** Compiles one pattern into a case-insensitive, unanchored RegExp -- "*" becomes ".*", "?" becomes
   * "." (exactly one char), every other regex metacharacter is escaped so it matches literally. Returns
   * null for an empty/whitespace-only pattern (nothing to compile) rather than a regex matching everything. */
  EV.compilePathPattern = function (pattern) {
    if (!pattern) return null;
    var trimmed = String(pattern).trim();
    if (!trimmed) return null;
    var escaped = trimmed.replace(REGEX_METACHAR_RE, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
    try {
      return new RegExp(escaped, 'i');
    } catch (e) {
      return null; // shouldn't happen given the escaping above, but never let a bad pattern throw
    }
  };

  /** Compiles both raw include/exclude strings once per search call (not once per file) into
   * {include: RegExp[], exclude: RegExp[]}, dropping any pattern that failed to compile. */
  EV.compilePathFilters = function (includeRaw, excludeRaw) {
    function compileAll(raw) {
      return EV.parsePathPatternList(raw).map(EV.compilePathPattern).filter(Boolean);
    }
    return { include: compileAll(includeRaw), exclude: compileAll(excludeRaw) };
  };

  /** The hot-path predicate, called once per candidate file. Exclude always wins (matches VSCode's own
   * precedence); an empty include list means "match everything not excluded", otherwise at least one
   * include pattern must match. */
  EV.matchesPathFilters = function (path, filters) {
    if (!filters) return true;
    var i;
    for (i = 0; i < filters.exclude.length; i++) {
      if (filters.exclude[i].test(path)) return false;
    }
    if (!filters.include.length) return true;
    for (i = 0; i < filters.include.length; i++) {
      if (filters.include[i].test(path)) return true;
    }
    return false;
  };
})(typeof self !== 'undefined' ? self : this);
