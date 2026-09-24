/**
 * sanitize.js — turns a raw (attacker-controlled) HTML email body into a safe
 * document to load in a sandboxed, script-less iframe.
 *
 * Defense in depth, in order:
 *  1. DOMPurify strips scripts/handlers/dangerous tags.
 *  2. A DOM walk rewrites every remote/`cid:` resource reference: `cid:` becomes
 *     a local blob: URL from the message's own inline attachments, and plain
 *     http(s) resources are removed unless the caller explicitly allows them
 *     (default = blocked, matching the anti-phishing "don't load remote
 *     content" posture of real mail clients).
 *  3. The result is wrapped with a restrictive CSP meta tag.
 *  4. The caller still renders it inside <iframe sandbox> with no
 *     allow-scripts/allow-same-origin — so even a DOMPurify bypass can't
 *     execute script or read cookies/storage.
 */
(function (g) {
  'use strict';
  var EV = g.EV || (g.EV = {});

  var PURIFY_CONFIG = {
    WHOLE_DOCUMENT: false,
    RETURN_DOM: false,
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea',
      'select', 'link', 'meta', 'base', 'applet', 'audio', 'video', 'svg', 'picture', 'source', 'track'],
    FORBID_ATTR: ['srcset', 'formaction', 'action']
  };

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  EV.escapeHtml = escapeHtml;

  function rewriteCssUrls(css, resolveUrl) {
    if (!css) return css;
    return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, function (m, q, u) {
      var r = resolveUrl(u);
      return r.value ? 'url(' + q + r.value + q + ')' : 'none';
    }).replace(/@import\s+[^;]+;/gi, '');
  }

  function buildShell(bodyHtml, allowRemote) {
    var csp = "default-src 'none'; img-src data: blob: " + (allowRemote ? 'https: http:' : '') +
      "; style-src 'unsafe-inline'; font-src data:;";
    return '<!DOCTYPE html><html><head><meta charset="utf-8">' +
      '<meta http-equiv="Content-Security-Policy" content="' + escapeHtml(csp) + '">' +
      '<style>' +
      'html,body{margin:0;padding:10px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;' +
      'font-size:14px;line-height:1.5;color:#1a1a1a;word-wrap:break-word;overflow-wrap:break-word;}' +
      'img{max-width:100%;}table{max-width:100%;}pre.ev-plain{white-space:pre-wrap;word-wrap:break-word;' +
      'font-family:inherit;margin:0;}' +
      '.ev-url{color:#0a5cd8;text-decoration:underline;word-break:break-all;}' +
      '.ev-link{cursor:help;text-decoration-style:dotted;}' +
      '.ev-link-mismatch{background:rgba(224,49,49,.22);outline:1px dashed #e03131;border-radius:2px;}' +
      '</style></head><body>' + bodyHtml + '</body></html>';
  }

  function extractHost(u) {
    try {
      var url = new URL(u, 'http://ev-placeholder.invalid/');
      if (!/^https?:$/.test(url.protocol)) return null;
      return url.hostname.toLowerCase().replace(/^www\./, '');
    } catch (e) {
      return null;
    }
  }

  // Not anchored to the whole string on purpose: real phishing anchor text is
  // often a full sentence with the deceptive domain embedded in it (e.g.
  // "Click here: paypal.com to verify"), not just a bare URL by itself.
  var EMBEDDED_URL_RE = /\b(?:https?:\/\/[^\s<>"']+|www\.[^\s<>"']+|[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,})\b/i;

  function findEmbeddedUrlCandidate(text) {
    var m = EMBEDDED_URL_RE.exec(text);
    return m ? m[0] : null;
  }

  function textLooksLikeUrl(text) {
    return EMBEDDED_URL_RE.test(text);
  }

  /**
   * @param {string} rawHtml
   * @param {Array} attachments  parsed attachments, each optionally carrying a `.blobUrl`
   *                             (assigned by render.js) for inline (cid:) resources
   * @param {{allowRemote?: boolean}} opts
   * @returns {{html:string, blockedRemoteUrls:string[]}}
   */
  EV.sanitizeEmailHtml = function (rawHtml, attachments, opts) {
    opts = opts || {};
    var allowRemote = !!opts.allowRemote;
    var clean = g.DOMPurify.sanitize(rawHtml || '', PURIFY_CONFIG);

    var cidMap = {};
    (attachments || []).forEach(function (a) {
      if (a.contentId) cidMap[a.contentId.toLowerCase()] = a;
    });
    var blocked = [];

    function resolveUrl(raw) {
      if (!raw) return { value: '', blocked: false };
      // Browsers strip every ASCII tab/newline/CR out of a URL — wherever
      // they occur, not just at the ends — before resolving it (WHATWG URL
      // spec, step 1). Without doing the same here first, a scheme like
      // "ht\tps://evil.com" wouldn't match the http(s) check below, but the
      // browser would still strip the tab and fetch it for real once this
      // value hit a real src/href attribute — while this function reported
      // nothing was blocked. Stripping them first makes our decision match
      // what the browser will actually do.
      var v = raw.replace(/[\t\r\n]+/g, '').trim();
      if (/^cid:/i.test(v)) {
        var att = cidMap[v.slice(4).toLowerCase()];
        return { value: (att && att.blobUrl) || '', blocked: false };
      }
      if (/^(https?:)?\/\//i.test(v) || /^https?:/i.test(v)) {
        if (!allowRemote) {
          blocked.push(v);
          return { value: '', blocked: true };
        }
        return { value: v, blocked: false };
      }
      // data:, blob:, relative, mailto:, tel:, or unknown scheme — DOMPurify already
      // strips javascript:/vbscript: URIs, so anything left here is inert.
      return { value: v, blocked: false };
    }

    var doc;
    try {
      doc = new DOMParser().parseFromString('<div id="ev-root">' + clean + '</div>', 'text/html');
    } catch (e) {
      return { html: buildShell('<pre class="ev-plain">' + escapeHtml(rawHtml || '') + '</pre>', allowRemote), blockedRemoteUrls: [] };
    }
    var root = doc.getElementById('ev-root');

    root.querySelectorAll('img,input[type=image],[background]').forEach(function (el) {
      ['src', 'background'].forEach(function (attr) {
        if (!el.hasAttribute(attr)) return;
        var original = el.getAttribute(attr);
        var r = resolveUrl(original);
        if (r.blocked) {
          el.removeAttribute(attr);
          el.setAttribute('data-ev-blocked-url', original);
          el.setAttribute('title', 'Blocked remote resource (not loaded): ' + original);
          if (attr === 'src') el.setAttribute('alt', '[remote image blocked — hover to see URL]');
        } else {
          el.setAttribute(attr, r.value);
        }
      });
    });

    root.querySelectorAll('[style]').forEach(function (el) {
      el.setAttribute('style', rewriteCssUrls(el.getAttribute('style'), resolveUrl));
    });
    root.querySelectorAll('style').forEach(function (el) {
      el.textContent = rewriteCssUrls(el.textContent, resolveUrl);
    });
    var links = [];
    root.querySelectorAll('a[href]').forEach(function (a) {
      var hrefRaw = a.getAttribute('href') || '';
      var text = (a.textContent || '').trim();
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer nofollow');
      a.classList.add('ev-link');
      a.setAttribute('title', hrefRaw);

      var mismatch = false;
      var urlCandidate = text ? findEmbeddedUrlCandidate(text) : null;
      if (urlCandidate) {
        var hostFromText = extractHost(/^https?:\/\//i.test(urlCandidate) ? urlCandidate : 'http://' + urlCandidate);
        var hostFromHref = extractHost(hrefRaw);
        if (hostFromText && hostFromHref && hostFromText !== hostFromHref) {
          mismatch = true;
          a.classList.add('ev-link-mismatch');
          a.setAttribute('title', 'Displayed text says "' + text + '" — actual destination: ' + hrefRaw);
        }
      }
      links.push({ text: text, href: hrefRaw, mismatch: mismatch });
    });

    return { html: buildShell(root.innerHTML, allowRemote), blockedRemoteUrls: blocked, links: links };
  };

  var URL_HILITE_RE = /\b((?:https?|hxxps?|ftp):\/\/[^\s<]+|www\.[^\s<]+)/gi;

  /** Plain-text body -> safe, non-clickable HTML with URLs visually marked. */
  EV.plainTextToSafeHtml = function (text) {
    var esc = escapeHtml(text || '');
    esc = esc.replace(URL_HILITE_RE, function (m) { return '<span class="ev-url">' + m + '</span>'; });
    return buildShell('<pre class="ev-plain">' + esc + '</pre>', false);
  };
})(typeof self !== 'undefined' ? self : this);
