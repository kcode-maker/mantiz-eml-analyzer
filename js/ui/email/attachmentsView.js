/**
 * attachmentsView.js — the Attachments sub-tab: every attachment with type, size, SHA-256, download, inline preview and the
 * on-demand OCR panel (cached by content hash). Also owns the two helpers the bulk "Extract OCR" action shares with it, so the
 * per-email button and the bulk action can never pick a different image or hash it differently.
 */
(function (g) {
  'use strict';
  var EV = g.EV || (g.EV = {});
  EV.ui = EV.ui || {};
  var el = EV.ui.el, fmtBytes = EV.ui.fmtBytes, downloadBlob = EV.ui.downloadBlob;

  async function sha256Hex(bytes) {
    if (!g.crypto || !g.crypto.subtle) return null;
    try {
      var digest = await g.crypto.subtle.digest('SHA-256', bytes);
      var arr = Array.from(new Uint8Array(digest));
      return arr.map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    } catch (e) {
      return null;
    }
  }
  // Exported so app.js's bulk "Extract OCR (selected)" action can hash an attachment it
  // never renders a card for, using the exact same hashing this tab's own Attachments-tab
  // hash display/OCR cache already relies on -- one implementation, not a second copy.
  EV.sha256Hex = sha256Hex;

  /** The same "first meaningful image" rule renderAttachments uses for its OCR button:
   * an image, under the 8MB preview cap, over a tiny-tracking-pixel size floor -- inline or
   * regular attachment alike (see the comment at the OCR-button call site below for why).
   * Exported so app.js's bulk OCR action picks the exact same attachment a per-email click
   * would have, instead of drifting from it as a second, separately-maintained rule. */
  function pickFirstMeaningfulImageAttachment(attachments) {
    for (var i = 0; i < (attachments || []).length; i++) {
      var att = attachments[i];
      if (/^image\//.test(att.mimeType) && att.size < 8 * 1024 * 1024 && att.size > 512) return att;
    }
    return null;
  }
  EV.pickFirstMeaningfulImageAttachment = pickFirstMeaningfulImageAttachment;


  // ---------- sub-tab: Attachments ----------

  function renderTextAttachmentPreview(att, host) {
    var text = EV.decodeTextBytes(att.bytes, 'utf-8');
    var pre = el('pre', 'ev-attachment-text-preview');
    pre.textContent = text.length > 200000 ? text.slice(0, 200000) + '\n\n… truncated …' : text;
    host.appendChild(pre);
  }

  /** The OCR button/status/output panel for one image attachment -- same interaction pattern as
   * the WHOIS button (disable-while-running, inline status text, never silently blank). Caches the
   * result on the attachment object (att._ocrPromise), mirroring att._sha256Promise above, so
   * re-visiting this sub-tab doesn't lose an in-flight or completed result. */
  function renderOcrPanel(att, path) {
    var wrap = el('div', 'ev-ocr-panel');
    var btn = el('button', 'ev-btn ev-ocr-btn', '🔎 Extract text (OCR)');
    btn.title = 'Runs local OCR on this image — no network call, nothing executed, pixel analysis only. Runs once and caches the result.';
    var statusEl = el('span', 'ev-ocr-status');
    var textHost = el('pre', 'ev-ocr-text-output');
    textHost.style.display = 'none';
    wrap.appendChild(btn);
    wrap.appendChild(statusEl);
    wrap.appendChild(textHost);

    function showResult(text) {
      textHost.textContent = text && text.trim() ? text : '(no text detected)';
      textHost.style.display = 'block';
      statusEl.textContent = '';
    }

    if (att._ocrText !== undefined) {
      btn.textContent = 'Re-run OCR';
      showResult(att._ocrText);
    }

    btn.onclick = function () {
      if (!window.EV.ocr || !window.EV.ocr.isSupported()) {
        statusEl.textContent = 'OCR isn’t available in this browser.';
        return;
      }
      btn.disabled = true;
      statusEl.textContent = 'Running OCR… (first use this session may take a few seconds to load the engine)';
      att._ocrPromise = window.EV.ocr.run(att);
      att._ocrPromise.then(function (text) {
        btn.disabled = false;
        btn.textContent = 'Re-run OCR';
        att._ocrText = text;
        showResult(text);
        // Extends this text's search coverage to the current session's index immediately --
        // covers both a cache-hit (an already-OCR'd attachment from an earlier session) and a
        // freshly-computed result alike, since EV.ocr.run() checks the IndexedDB cache internally.
        if (path && window.EV.onOcrTextReady) window.EV.onOcrTextReady(path, text);
      }).catch(function (err) {
        btn.disabled = false;
        statusEl.textContent = 'OCR failed: ' + (err && err.message || 'unknown error');
      });
    };
    return wrap;
  }

  function renderAttachments(tab, container) {
    container.innerHTML = '';
    var p = tab.parsed;
    if (!p.attachments.length) {
      container.appendChild(el('div', 'ev-muted', 'No attachments in this message.'));
      return;
    }
    var firstMeaningfulImage = pickFirstMeaningfulImageAttachment(p.attachments);
    p.attachments.forEach(function (att, idx) {
      var card = el('div', 'ev-attachment-card');
      var head = el('div', 'ev-attachment-head');
      head.appendChild(el('span', 'ev-attachment-name', att.filename));
      head.appendChild(el('span', 'ev-attachment-meta',
        (att.isInline ? 'inline · ' : '') + att.mimeType + ' · ' + fmtBytes(att.size)));
      card.appendChild(head);

      var actions = el('div', 'ev-attachment-actions');
      var dlBtn = el('button', 'ev-btn', 'Download');
      dlBtn.onclick = function () { downloadBlob(att.bytes, att.filename, att.mimeType); };
      actions.appendChild(dlBtn);

      var vtBtn = el('button', 'ev-btn ev-vt-btn', '🛡 VirusTotal');
      vtBtn.title = 'Look up this file’s SHA-256 on VirusTotal (opens in a new tab; nothing is uploaded, only the hash is looked up)';
      vtBtn.style.display = 'none';
      actions.appendChild(vtBtn);

      var hashSpan = el('span', 'ev-attachment-hash', 'sha256: computing…');
      hashSpan.title = 'SHA-256 of this attachment\'s raw bytes — computed once and cached, not recomputed on every visit to this tab.';
      actions.appendChild(hashSpan);
      // Cache the promise itself (not just its resolved value) on the
      // attachment object, mirroring _previewBlobUrl below — re-visiting this
      // tab used to recompute the hash from scratch every time, which is
      // wasteful on a message with large attachments.
      if (!att._sha256Promise) att._sha256Promise = sha256Hex(att.bytes);
      att._sha256Promise.then(function (hex) {
        if (hex) {
          hashSpan.textContent = 'sha256: ' + hex;
          vtBtn.style.display = 'inline-block';
          vtBtn.onclick = function () {
            window.open('https://www.virustotal.com/gui/file/' + hex, '_blank', 'noopener,noreferrer');
          };
        } else {
          hashSpan.textContent = 'sha256: unavailable (serve over http(s) to enable)';
        }
      });
      card.appendChild(actions);

      if (/^image\//.test(att.mimeType) && att.size < 8 * 1024 * 1024) {
        if (!att._previewBlobUrl) {
          att._previewBlobUrl = URL.createObjectURL(new Blob([att.bytes], { type: att.mimeType }));
          tab.blobUrls.push(att._previewBlobUrl);
        }
        var img = document.createElement('img');
        img.className = 'ev-attachment-image-preview';
        img.src = att._previewBlobUrl;
        card.appendChild(img);
        // "First image" = first one over a tiny-tracking-pixel size floor, inline or attached
        // alike -- inline (cid:) images are often exactly where a real phishing screenshot lives
        // (e.g. an entire fake login page embedded as one image), not just tracking pixels/logos,
        // so the inline flag alone was never the right signal to skip on.
        if (att === firstMeaningfulImage) {
          card.appendChild(renderOcrPanel(att, tab.path));
        }
      } else if (/^text\/(plain|csv)$/.test(att.mimeType) || /\.(txt|csv|log|json)$/i.test(att.filename)) {
        renderTextAttachmentPreview(att, card);
      } else if (att.mimeType === 'text/html' || /\.html?$/i.test(att.filename)) {
        var warn = el('div', 'ev-muted', 'HTML attachment — shown as inert source text only, never rendered:');
        card.appendChild(warn);
        renderTextAttachmentPreview(att, card);
      }
      container.appendChild(card);
    });
  }

  EV.ui.renderAttachments = renderAttachments;
})(typeof self !== 'undefined' ? self : this);
