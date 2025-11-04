// Injected into each frame to annotate images/videos/backgrounds
(() => {
  const CLASS = '__imgurl_annotator__';
  let cancelHandler = null;

  function annotateImages(options = {}) {
    const {
      includeBackgroundImages = true,
      includeVideos = true,
      labelMode = 'url',
      onlyVisible = false,
      viewportPad = 0,
      excludeEncoded = true,
      minSizePx = 6,
      blockedPrefixes = []
    } = options;

    // Remove old annotations first
    removeAnnotations();

    const labels = [];

    const vp = {
      top: -viewportPad,
      left: -viewportPad,
      right: window.innerWidth + viewportPad,
      bottom: window.innerHeight + viewportPad,
    };

    const isInViewport = (r) => {
      if (!onlyVisible) return true;
      return !(r.right < vp.left || r.left > vp.right || r.bottom < vp.top || r.top > vp.bottom);
    };

    // NEW: now accepts kind and stores pure page-based coords in dataset
    const makeLabel = (text, rect, kind) => {
      if (!rect || !isFinite(rect.top) || !isFinite(rect.left)) return null;
      if (!isInViewport(rect)) return null;
      const div = document.createElement('div');
      div.className = CLASS;
      // NEW: store page-based raw coordinates and metadata for later TXT export
      try {
        const leftPage = (window.scrollX + rect.left);
        const topPage = (window.scrollY + rect.top);
        div.dataset.leftPage = String(leftPage);
        div.dataset.topPage = String(topPage);
        div.dataset.width = String(rect.width);
        div.dataset.height = String(rect.height);
        if (kind) div.dataset.kind = String(kind);
      } catch {}
      Object.assign(div.style, {
        position: 'absolute',
        left: `${window.scrollX + rect.left + 2}px`,
        top: `${window.scrollY + rect.top + 2}px`,
        zIndex: '2147483647',
        background: 'rgba(0,0,0,0.72)',
        color: '#fff',
        padding: '3px 6px',
        borderRadius: '3px',
        font: '16px/1.35 -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, "Noto Sans JP", sans-serif',
        maxWidth: '56vw',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
        lineHeight: '1.35',
        boxShadow: '0 1px 2px rgba(0,0,0,.3)',
        pointerEvents: 'none'
      });
      div.textContent = text;
      document.body.appendChild(div);
      labels.push(div);
      return div;
    };

    // <img>
    const imgs = Array.from(document.images || []);
    for (const img of imgs) {
      try {
        let src = img.currentSrc || img.src;
        if (!src) {
          const attrs = ['data-src', 'data-original', 'data-lazy', 'data-srcset'];
          for (const a of attrs) {
            const v = img.getAttribute(a);
            if (v) { src = v.split(' ')[0]; break; }
          }
        }
        // Fallback: parse srcset manually if needed
        if (!src) {
          const ss = img.getAttribute('srcset') || img.getAttribute('data-srcset');
          if (ss) {
            const first = (ss.split(',')[0] || '').trim().split(' ')[0];
            if (first) src = first;
          }
        }
        if (!src) continue;
        const abs = toAbsUrl(src);
        const rect = img.getBoundingClientRect();
        if (!isElementVisible(img, rect, minSizePx)) continue;
        if (!shouldAnnotate(abs, { kind: 'IMG', el: img, minSize: minSizePx, excludeEncoded, blockedPrefixes })) continue;
        const label = formatLabel(abs, { mode: labelMode, kind: 'IMG' });
        // NEW: pass kind to makeLabel
        makeLabel(label, rect, 'IMG');
      } catch { /* ignore */ }
    }

    // <video>
    if (includeVideos) {
      const vids = Array.from(document.querySelectorAll('video'));
      for (const v of vids) {
        try {
          let src = v.currentSrc || '';
          if (!src || /^(blob:|data:)/i.test(src)) {
            const sources = Array.from(v.querySelectorAll('source'));
            const pick = sources.find(s => /mp4|webm|ogg|m3u8/i.test(s.type || '') || s.src) || sources[0];
            if (pick && pick.getAttribute('src')) src = pick.getAttribute('src');
          }
          if (!src) continue;
          const abs = toAbsUrl(src);
          const rect = v.getBoundingClientRect();
          if (!isElementVisible(v, rect, minSizePx)) continue;
          if (!shouldAnnotate(abs, { kind: 'VID', el: v, minSize: minSizePx, excludeEncoded, blockedPrefixes })) continue;
          const label = formatLabel(abs, { mode: labelMode, kind: 'VID' });
          // NEW: pass kind to makeLabel
          makeLabel(label, rect, 'VID');
        } catch { /* ignore */ }
      }
    }

    // background-image (optimized: only scan likely-visible elements)
    if (includeBackgroundImages) {
      // Collect candidates from the current viewport using elementsFromPoint
      // to avoid scanning the entire DOM on very large pages.
      const candidates = new Set();
      const step = Math.max(40, Math.floor(Math.min(window.innerWidth, window.innerHeight) / 12) || 40);
      const pad = 8;
      for (let y = pad; y < window.innerHeight - pad; y += step) {
        for (let x = pad; x < window.innerWidth - pad; x += step) {
          try {
            const els = document.elementsFromPoint(x, y);
            for (const el of els) {
              if (el && el.nodeType === 1) candidates.add(el);
            }
          } catch { /* ignore */ }
        }
      }
      for (const el of candidates) {
        if (!el || el.tagName === 'IMG' || el.tagName === 'SOURCE') continue;
        // Quick geometry filter before any expensive style reads
        let rect;
        try { rect = el.getBoundingClientRect(); } catch { rect = null; }
        if (!isElementVisible(el, rect, minSizePx)) continue;
        const urls = extractBgUrls(el);
        if (!urls || urls.length === 0) continue;
        const first = toAbsUrl(urls[0]);
        if (!shouldAnnotate(first, { kind: 'BG', el, minSize: minSizePx, excludeEncoded, blockedPrefixes })) continue;
        const more = urls.length > 1 ? ` (+${urls.length - 1} more)` : '';
        const label = formatLabel(first, { mode: labelMode, kind: 'BG' }) + more;
        // NEW: pass kind to makeLabel
        makeLabel(label, rect, 'BG');
      }
    }

    return labels.length;
  }

  function removeAnnotations() {
    const nodes = document.querySelectorAll('.' + CSS.escape(CLASS));
    let count = 0;
    nodes.forEach(n => { n.remove(); count++; });
    return count;
  }

  function collectLabels() {
    // NEW: prefer dataset-based page coords; keep existing props for compatibility
    const nodes = Array.from(document.querySelectorAll('.' + CSS.escape(CLASS)));
    return nodes.map(n => {
      const text = n.textContent || '';
      const leftStyle = parseFloat(n.style.left) || 0;
      const topStyle = parseFloat(n.style.top) || 0;
      const widthStyle = n.offsetWidth || 0;
      const heightStyle = n.offsetHeight || 0;
      let leftPage = parseFloat(n.dataset.leftPage);
      let topPage = parseFloat(n.dataset.topPage);
      let width = parseFloat(n.dataset.width);
      let height = parseFloat(n.dataset.height);
      const kind = n.dataset.kind || '';
      if (!isFinite(leftPage)) leftPage = leftStyle - 2; // fallback: remove +2px offset
      if (!isFinite(topPage)) topPage = topStyle - 2;   // fallback: remove +2px offset
      if (!isFinite(width)) width = widthStyle;
      if (!isFinite(height)) height = heightStyle;
      return {
        text,
        // legacy overlay coords (kept):
        left: leftStyle,
        top: topStyle,
        width,
        height,
        // NEW: page-based pure coords
        leftPage,
        topPage,
        kind
      };
    });
  }

  function toAbsUrl(u) {
    try { return new URL(u, document.baseURI).href; } catch { return String(u); }
  }

  function formatLabel(url, { mode = 'url', kind = '' } = {}) {
    const base = extractFilename(url);
    if (mode === 'filename') return prefix(kind, base);
    if (mode === 'url') return prefix(kind, url);
    return prefix(kind, base) + "\n" + url;
  }

  function prefix(kind, text) { return (kind ? `[${kind}] ` : '') + text; }

  function extractFilename(url) {
    try {
      const u = new URL(url, document.baseURI);
      const pathname = u.pathname || '';
      const parts = pathname.split('/').filter(Boolean);
      return parts.pop() || pathname || url;
    } catch { return url; }
  }

  function shouldAnnotate(url, opts = {}) {
    const { el, minSize = 6, excludeEncoded = true, blockedPrefixes = [] } = opts;
    if (!url) return false;
    const u = String(url);
    // Exclude data/blob and percent-encoded or query-containing URLs if requested
    if (/^(data:|blob:)/i.test(u)) return false;
    if (excludeEncoded && /[%?]/.test(u)) return false;
    // Exclude assets containing "_popup" in the URL (case-insensitive)
    if (/_popup/i.test(u)) return false;
    // Exclude URLs containing "/henkin/images" (case-insensitive)
    if (/\/henkin\/images/i.test(u)) return false;
    // Exclude blocked prefixes or host
    for (const p of blockedPrefixes) {
      if (u.startsWith(p)) return false;
    }
    try {
      const parsed = new URL(u);
      if (blockedPrefixes.some(p => {
        try { const bp = new URL(p); return (bp.host && bp.host === parsed.host); } catch { return false; }
      })) return false;
    } catch {}
    // Exclude tiny tracking pixels (e.g., 1x1 gif)
    try {
      const r = el.getBoundingClientRect();
      if ((r.width <= minSize && r.height <= minSize) && /\.gif(?:$|\?)/i.test(u)) return false;
    } catch {}
    return true;
  }

  function extractBgUrls(el) {
    const urls = [];
    try {
      const st = getComputedStyle(el);
      if (st) {
        const bg = st.backgroundImage;
        if (bg && bg !== 'none') {
          const re = /url\(("|'|)(.*?)\1\)/g;
          let m; while ((m = re.exec(bg)) !== null) { if (m[2]) urls.push(m[2]); }
        }
      }
    } catch {}
    return urls;
  }

  function isElementVisible(el, rect, minSize) {
    try {
      const st = getComputedStyle(el);
      if (!st || st.display === 'none' || st.visibility === 'hidden' || st.visibility === 'collapse') return false;
      const opacity = parseFloat(st.opacity || '1');
      if (isFinite(opacity) && opacity < 0.02) return false;
      const r = rect || el.getBoundingClientRect();
      if (!r || r.width < Math.max(1, minSize) || r.height < Math.max(1, minSize)) return false;
      return true;
    } catch {
      return true;
    }
  }

  // Wait for next paint(s) to ensure overlays are rendered before screenshot
  function waitForPaint(cycles = 2, extraDelay = 80) {
    return new Promise((resolve) => {
      let n = Math.max(1, cycles);
      const step = () => {
        if (--n <= 0) return setTimeout(resolve, extraDelay);
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  // Simple chooser UI to select export mode at start
  function showModeChooser() {
    return new Promise((resolve) => {
      try {
        const old = document.querySelector('.__imgurl_modechooser__');
        if (old) old.remove();
      } catch (err) {}

      const wrap = document.createElement('div');
      wrap.className = '__imgurl_modechooser__';
      Object.assign(wrap.style, {
        position: 'fixed',
        left: '0',
        top: '0',
        width: '100vw',
        height: '100vh',
        zIndex: '2147483647',
        background: 'rgba(0,0,0,.35)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backdropFilter: 'blur(1.5px)'
      });

      const box = document.createElement('div');
      Object.assign(box.style, {
        background: '#111',
        color: '#fff',
        padding: '16px 18px',
        borderRadius: '12px',
        boxShadow: '0 6px 18px rgba(0,0,0,.5)',
        minWidth: '260px',
        font: '14px/1.45 -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, "Noto Sans JP", sans-serif'
      });

      const title = document.createElement('div');
      title.textContent = '出力形式を選んでください';
      title.style.fontWeight = '600';
      title.style.marginBottom = '10px';
      title.style.color = '#fff';

      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.gap = '10px';
      row.style.marginTop = '6px';

      const btn = (label) => {
        const b = document.createElement('button');
        b.textContent = label;
        Object.assign(b.style, {
          appearance: 'none',
          background: '#2b7cff',
          color: '#fff',
          border: 'none',
          padding: '8px 12px',
          borderRadius: '8px',
          cursor: 'pointer',
          font: 'inherit'
        });
        b.onmouseenter = () => { b.style.opacity = '0.92'; };
        b.onmouseleave = () => { b.style.opacity = '1'; };
        return b;
      };

      const bFull = btn('ページ全体（画像＋テキスト）');
      bFull.style.background = '#00b894';
      const bSelection = btn('選択範囲スクロール');
      bSelection.style.background = '#ff7675';

      const optWrap = document.createElement('div');
      optWrap.style.marginTop = '10px';
      optWrap.style.display = 'flex';
      optWrap.style.alignItems = 'center';
      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.id = '__imgurl_opt_pos__';
      chk.checked = false;
      const lab = document.createElement('label');
      lab.textContent = '位置情報を含める';
      lab.setAttribute('for', chk.id);
      lab.style.marginLeft = '6px';
      lab.style.color = '#fff';

      const cleanup = () => {
        try { document.removeEventListener('keydown', onKey, true); } catch (err) {}
      };

      const finish = (mode) => {
        cleanup();
        try { wrap.remove(); } catch (err) {}
        resolve(mode === null ? null : { mode, includePos: !!chk.checked });
      };

      const onKey = (e) => {
        if (e.key === 'Escape' || e.code === 'Escape' || e.keyCode === 27) {
          e.preventDefault();
          finish(null);
        }
      };
      document.addEventListener('keydown', onKey, true);

      bFull.addEventListener('click', () => finish('image_txt'));
      bSelection.addEventListener('click', () => finish('beta_selection_scroll'));

      box.appendChild(title);
      row.appendChild(bFull);
      row.appendChild(bSelection);
      box.appendChild(row);
      optWrap.appendChild(chk);
      optWrap.appendChild(lab);
      box.appendChild(optWrap);
      wrap.appendChild(box);
      document.documentElement.appendChild(wrap);
    });
  }

  function selectAreaOnce() {
    const EDGE_MARGIN_PX = 48;
    const AUTO_SCROLL_STEP = 32;

    return new Promise((resolve) => {
      let finished = false;
      let selecting = false;
      let startPageX = 0;
      let startPageY = 0;
      let currentPageX = 0;
      let currentPageY = 0;
      let lastClientX = 0;
      let lastClientY = 0;
      let autoScrollDir = 0;
      let autoScrollRaf = null;

      const cleanup = (result) => {
        if (finished) return;
        finished = true;
        stopAutoScroll();
        try { document.removeEventListener('keydown', onKeyDown, true); } catch (err) {}
        try { overlay.remove(); } catch (err) {}
        try { outline && outline.remove(); } catch (err) {}
        resolve(result || null);
      };

      const overlay = document.createElement('div');
      overlay.className = '__imgurl_select_overlay__';
      Object.assign(overlay.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '2147483647',
        cursor: 'crosshair',
        background: 'rgba(0,0,0,0.02)',
        userSelect: 'none'
      });

      const outline = document.createElement('div');
      Object.assign(outline.style, {
        position: 'absolute',
        border: '2px solid #1a73e8',
        background: 'rgba(26,115,232,0.15)',
        pointerEvents: 'none',
        display: 'none'
      });
      overlay.appendChild(outline);
      document.documentElement.appendChild(overlay);

      const onKeyDown = (e) => {
        if (e && (e.key === 'Escape' || e.key === 'Esc' || e.keyCode === 27)) {
          e.preventDefault();
          cleanup(null);
        }
      };
      document.addEventListener('keydown', onKeyDown, true);

      const updateOutline = () => {
        const startClientX = startPageX - window.scrollX;
        const startClientY = startPageY - window.scrollY;
        const currentClientX = currentPageX - window.scrollX;
        const currentClientY = currentPageY - window.scrollY;
        const minX = Math.min(startClientX, currentClientX);
        const minY = Math.min(startClientY, currentClientY);
        const width = Math.max(1, Math.abs(currentClientX - startClientX));
        const height = Math.max(1, Math.abs(currentClientY - startClientY));
        outline.style.display = 'block';
        outline.style.left = `${minX}px`;
        outline.style.top = `${minY}px`;
        outline.style.width = `${width}px`;
        outline.style.height = `${height}px`;
      };

      const ensureAutoScroll = () => {
        if (autoScrollDir === 0 || autoScrollRaf) return;
        const step = () => {
          if (!autoScrollDir) {
            autoScrollRaf = null;
            return;
          }
          const before = window.scrollY;
          window.scrollBy({ top: autoScrollDir * AUTO_SCROLL_STEP, behavior: 'auto' });
          const delta = window.scrollY - before;
          if (delta !== 0) {
            currentPageY += delta;
            updateOutline();
          } else {
            autoScrollDir = 0;
          }
          autoScrollRaf = requestAnimationFrame(step);
        };
        autoScrollRaf = requestAnimationFrame(step);
      };

      const stopAutoScroll = () => {
        autoScrollDir = 0;
        if (autoScrollRaf) {
          cancelAnimationFrame(autoScrollRaf);
          autoScrollRaf = null;
        }
      };

      const updateAutoScrollDirection = (clientY) => {
        let dir = 0;
        if (clientY > (window.innerHeight - EDGE_MARGIN_PX)) dir = 1;
        else if (clientY < EDGE_MARGIN_PX) dir = -1;
        if (dir !== autoScrollDir) {
          autoScrollDir = dir;
          if (dir === 0) stopAutoScroll();
          else ensureAutoScroll();
        }
      };

      overlay.addEventListener('pointerdown', (ev) => {
        if (ev.button !== 0) {
          ev.preventDefault();
          return;
        }
        selecting = true;
        lastClientX = ev.clientX;
        lastClientY = ev.clientY;
        startPageX = window.scrollX + ev.clientX;
        startPageY = window.scrollY + ev.clientY;
        currentPageX = startPageX;
        currentPageY = startPageY;
        updateOutline();
        try { overlay.setPointerCapture(ev.pointerId); } catch (err) {}
        ev.preventDefault();
      }, { passive: false });

      overlay.addEventListener('pointermove', (ev) => {
        if (!selecting) return;
        lastClientX = ev.clientX;
        lastClientY = ev.clientY;
        currentPageX = window.scrollX + lastClientX;
        currentPageY = window.scrollY + lastClientY;
        updateOutline();
        updateAutoScrollDirection(lastClientY);
        ev.preventDefault();
      }, { passive: false });

      const finishSelection = () => {
        stopAutoScroll();
        if (!selecting) return;
        selecting = false;
        const pageLeft = Math.min(startPageX, currentPageX);
        const pageTop = Math.min(startPageY, currentPageY);
        const pageWidth = Math.max(1, Math.abs(currentPageX - startPageX));
        const pageHeight = Math.max(1, Math.abs(currentPageY - startPageY));
        const viewportRect = outline.getBoundingClientRect();
        cleanup({
          viewport: {
            left: viewportRect.left,
            top: viewportRect.top,
            width: viewportRect.width,
            height: viewportRect.height
          },
          page: {
            left: pageLeft,
            top: pageTop,
            width: pageWidth,
            height: pageHeight
          },
          devicePixelRatio: window.devicePixelRatio || 1
        });
      };

      overlay.addEventListener('pointerup', (ev) => {
        try { overlay.releasePointerCapture(ev.pointerId); } catch (err) {}
        finishSelection();
      }, { passive: false });

      overlay.addEventListener('pointercancel', (ev) => {
        try { overlay.releasePointerCapture(ev.pointerId); } catch (err) {}
        stopAutoScroll();
        selecting = false;
        cleanup(null);
      }, { passive: false });
    });
  }
  async function annotateAndFlush(opts = {}) {
    try { annotateImages(opts); } catch {}
    await waitForPaint(2, opts.settleDelay || 120);
    return true;
  }

  // expose
  function startCancelWatch() {
    if (cancelHandler) return;
    cancelHandler = (e) => {
      const isEsc = !!e && (
        e.key === 'Escape' || e.code === 'Escape' || e.key === 'Esc' || e.keyCode === 27
      );
      if (isEsc) {
        cleanupFlow();
        try { chrome.runtime.sendMessage({ type: 'IMGURL_CANCEL' }); } catch {}
      }
    };
    // Capture phase on both window and document to be robust across sites/iframes
    window.addEventListener('keydown', cancelHandler, true);
    document.addEventListener('keydown', cancelHandler, true);
    // Also listen to keyup as a fallback (some sites trap keydown)
    window.addEventListener('keyup', cancelHandler, true);
    document.addEventListener('keyup', cancelHandler, true);
  }

  function stopCancelWatch() {
    if (cancelHandler) {
      try { window.removeEventListener('keydown', cancelHandler, true); } catch {}
      try { document.removeEventListener('keydown', cancelHandler, true); } catch {}
      try { window.removeEventListener('keyup', cancelHandler, true); } catch {}
      try { document.removeEventListener('keyup', cancelHandler, true); } catch {}
      cancelHandler = null;
    }
  }

  // (removed) Floating export bar UI was used in older flow.

  function cleanupFlow() {
    try { removeAnnotations(); } catch {}
    try { stopCancelWatch(); } catch {}
  }

  // --- Progress overlay (not captured: we toggle visibility off during shots) ---
  let progressEl = null;
  function ensureProgressEl() {
    if (progressEl && progressEl.isConnected) return progressEl;
    const div = document.createElement('div');
    div.className = '__imgurl_progress__';
    Object.assign(div.style, {
      position: 'fixed',
      left: '50%',
      top: '16px',
      transform: 'translateX(-50%)',
      zIndex: '2147483647',
      background: 'rgba(0,0,0,0.8)',
      color: '#fff',
      padding: '8px 12px',
      borderRadius: '16px',
      font: '14px/1.4 -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, "Noto Sans JP", sans-serif',
      boxShadow: '0 2px 6px rgba(0,0,0,.35)',
      pointerEvents: 'none'
    });
    const spin = document.createElement('span');
    spin.style.display = 'inline-block';
    spin.style.width = '12px';
    spin.style.height = '12px';
    spin.style.marginRight = '8px';
    spin.style.border = '2px solid rgba(255,255,255,.4)';
    spin.style.borderTopColor = '#fff';
    spin.style.borderRadius = '50%';
    spin.style.animation = 'imgurl_spin 1s linear infinite';
    const text = document.createElement('span');
    text.className = 'txt';
    text.textContent = '貅門ｙ荳ｭ窶ｦ';
    try { text.style.color = '#fff'; } catch {}
    div.appendChild(spin);
    div.appendChild(text);
    const style = document.createElement('style');
    style.textContent = '@keyframes imgurl_spin{to{transform:rotate(360deg)}}';
    document.documentElement.appendChild(style);
    document.documentElement.appendChild(div);
    progressEl = div;
    return div;
  }
  function showProgressOverlay(text) {
    const el = ensureProgressEl();
    const t = el.querySelector('.txt');
    if (t) t.textContent = text || '処理中…';
    el.style.visibility = 'visible';
  }
  function setProgressOverlay(text) {
    if (!progressEl) return;
    const t = progressEl.querySelector('.txt');
    if (t) t.textContent = text || '';
  }
  function setProgressVisibility(visible) {
    if (progressEl) progressEl.style.visibility = visible ? 'visible' : 'hidden';
  }
  function hideProgressOverlay() {
    if (progressEl) { try { progressEl.remove(); } catch {} progressEl = null; }
  }

  // NEW: ensure overlay is hidden before capture and give the browser a paint or two
  async function prepareForCapture() {
    try { setProgressVisibility(false); } catch {}
    try { await waitForPaint(2, 0); } catch {}
    return true;
  }
  // NEW: restore overlay after capture and yield one frame
  async function restoreAfterCapture() {
    try { setProgressVisibility(true); } catch {}
    try { await waitForPaint(1, 0); } catch {}
    return true;
  }

  window.__imgurl_annotator = {
    annotateImages,
    annotateAndFlush,
    removeAnnotations,
    collectLabels,
    startCancelWatch,
    stopCancelWatch,
    showProgressOverlay,
    hideProgressOverlay,
    setProgressOverlay,
    setProgressVisibility,
    // NEW:
    prepareForCapture,
    restoreAfterCapture,
    showModeChooser,
    selectAreaOnce,
  };
})();
