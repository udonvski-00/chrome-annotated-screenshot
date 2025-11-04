/*
  Image URL Annotated Screenshot (MV3)
  - Adds URL labels via content script (full path)
  - Captures FULL PAGE by scrolling and stitches images
  - ESC to cancel mid-capture: stitches what was taken so far and saves
*/

let cancelRequested = false;
const DEBUG = true;
// Target width for viewport-only PNG capture. Larger images are scaled down.
// Set to null to keep original width.
const VIEWPORT_TARGET_WIDTH_PX = 1000; // target width for viewport captures (px)
// Target width for FULL-PAGE PNG export (final output width)
const FULLPAGE_TARGET_WIDTH_PX = 1000; // target width for full-page captures (px)
let __lastCapAt = 0;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'IMGURL_CANCEL') {
    cancelRequested = true;
    sendResponse && sendResponse({ ok: true });
    return true;
  }
  return false;
});

  chrome.action.onClicked.addListener(async (tab) => {
    try {
      if (!tab || !tab.id || tab.status !== 'complete') return;
      cancelRequested = false;
      const tabId = tab.id;
      const windowId = tab.windowId;

    // Ensure annotator is present and ESC watcher enabled in all frames
    try {
      await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['content.js'] });
      await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: () => { try { return window.__imgurl_annotator && window.__imgurl_annotator.startCancelWatch(); } catch (err) { return; } } });
    } catch (err) {}
    // Small warm-up to avoid first-run race conditions
    try { await delay(200); } catch (err) {}

    /* if (DEBUG) console.log('[IMGURL] Start capture', { tabId }); */
    // Ask user the export mode (viewport or full image+text)
    let exportMode = 'image_txt';
    let includePos = false; // whether to include position info in TXT
    try {
      const res = await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: async () => {
          try {
            const annotator = window.__imgurl_annotator;
            if (!annotator || typeof annotator.showModeChooser !== 'function') return 'image_txt';
            return await annotator.showModeChooser();
          } catch (err) {
            return 'image_txt';
          }
        }
      });
      if (Array.isArray(res) && res[0] && typeof res[0].result !== 'undefined') {
        const v = res[0].result;
        if (v && typeof v === 'object') {
          exportMode = v.mode || 'image_txt';
          includePos = !!v.includePos;
        } else {
          exportMode = v;
        }
      }
    } catch (err) {}
    if (exportMode === null || typeof exportMode === 'undefined') return;
    if (exportMode === 'pdf') exportMode = 'image_txt';
    const isSelectionScrollMode = (exportMode === 'beta_selection_scroll');
    let scrollSelectionInfo = null;
    let scrollSelectionBounds = null;
    let scrollSelectionViewportCss = null;
    // Show progress overlay (top frame only)
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: () => { try { return window.__imgurl_annotator && window.__imgurl_annotator.showProgressOverlay('Preparing capture...'); } catch (err) { return; } },
        args: []
      });
    } catch (err) {}
    if (isSelectionScrollMode) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: () => { try { window.__imgurl_annotator && window.__imgurl_annotator.setProgressOverlay('選択範囲をドラッグしてください'); window.__imgurl_annotator && window.__imgurl_annotator.setProgressVisibility(true); } catch (err) {} }
        });
      } catch (err) {}
      try {
        const selRes = await chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: async () => { try { return await (window.__imgurl_annotator && window.__imgurl_annotator.selectAreaOnce()); } catch (err) { return null; } }
        });
        if (Array.isArray(selRes) && selRes[0] && selRes[0].result) {
          scrollSelectionInfo = selRes[0].result;
        }
      } catch (err) {}
      if (!scrollSelectionInfo || !scrollSelectionInfo.viewport || !scrollSelectionInfo.viewport.width || !scrollSelectionInfo.viewport.height) {
        return;
      }
      const topCss = Number(scrollSelectionInfo.page && scrollSelectionInfo.page.top) || 0;
      const heightCss = Number(scrollSelectionInfo.page && scrollSelectionInfo.page.height) || 0;
      const leftCss = Number(scrollSelectionInfo.page && scrollSelectionInfo.page.left) || 0;
      const widthCss = Number(scrollSelectionInfo.page && scrollSelectionInfo.page.width) || 0;
      scrollSelectionBounds = {
        leftCss,
        topCss,
        rightCss: leftCss + Math.max(0, widthCss),
        widthCss: Math.max(0, widthCss),
        bottomCss: topCss + Math.max(0, heightCss),
        heightCss: Math.max(0, heightCss)
      };
      scrollSelectionViewportCss = {
        left: Number(scrollSelectionInfo.viewport && scrollSelectionInfo.viewport.left) || 0,
        top: Number(scrollSelectionInfo.viewport && scrollSelectionInfo.viewport.top) || 0,
        width: Number(scrollSelectionInfo.viewport && scrollSelectionInfo.viewport.width) || 0,
        height: Number(scrollSelectionInfo.viewport && scrollSelectionInfo.viewport.height) || 0
      };
    }
    // NEW: Viewport-only branch (png + txt, no scrolling)
    if (exportMode === 'viewport_image_txt') {
      /* if (DEBUG) console.log('[IMGURL] Viewport capture mode'); */
      let selectionInfo = null;
      let selectionBounds = null;
      let selectionViewportCss = null;
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: () => { try { window.__imgurl_annotator && window.__imgurl_annotator.setProgressOverlay('Drag to select an area'); window.__imgurl_annotator && window.__imgurl_annotator.setProgressVisibility(true); } catch (err) {} }
        });
      } catch (err) {}
      try {
        const selRes = await chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: async () => { try { return await (window.__imgurl_annotator && window.__imgurl_annotator.selectAreaOnce()); } catch (err) { return null; } }
        });
        if (Array.isArray(selRes) && selRes[0] && selRes[0].result) {
          selectionInfo = selRes[0].result;
        }
      } catch (err) {}
      if (!selectionInfo || !selectionInfo.viewport || !selectionInfo.viewport.width || !selectionInfo.viewport.height) {
        return;
      }
      selectionBounds = {
        leftCss: Number(selectionInfo.page && selectionInfo.page.left) || 0,
        topCss: Number(selectionInfo.page && selectionInfo.page.top) || 0,
        rightCss: (Number(selectionInfo.page && selectionInfo.page.left) || 0) + (Number(selectionInfo.page && selectionInfo.page.width) || 0),
        bottomCss: (Number(selectionInfo.page && selectionInfo.page.top) || 0) + (Number(selectionInfo.page && selectionInfo.page.height) || 0)
      };
      selectionViewportCss = {
        left: Number(selectionInfo.viewport && selectionInfo.viewport.left) || 0,
        top: Number(selectionInfo.viewport && selectionInfo.viewport.top) || 0,
        width: Number(selectionInfo.viewport && selectionInfo.viewport.width) || 0,
        height: Number(selectionInfo.viewport && selectionInfo.viewport.height) || 0
      };
      const selectionActive = !!(selectionInfo && selectionInfo.viewport && selectionInfo.viewport.width && selectionInfo.viewport.height);
      // Annotate only visible area on top frame
      try {
        const opts = {
          includeBackgroundImages: true,
          includeVideos: true,
          labelMode: 'url',
          onlyVisible: true,
          viewportPad: 0,
          excludeEncoded: true,
          blockedPrefixes: [],
          settleDelay: 200
        };
        await withTimeout(chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: (o) => { try { return window.__imgurl_annotator && window.__imgurl_annotator.annotateAndFlush(o); } catch (err) { return false; } },
          args: [opts]
        }), 1200);
      } catch (err) {}
      // Collect labels from top frame
      let labels = [];
      try {
        const res = await withTimeout(chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: () => { try { return window.__imgurl_annotator && window.__imgurl_annotator.collectLabels(); } catch (err) { return []; } }
        }), 1000);
        for (const r of (res || [])) { if (r && Array.isArray(r.result)) labels.push(...r.result); }
      } catch (err) {}
      // Capture visible tab
      let pngUrl = null;
      try {
        // NEW: hide overlay and wait a couple frames before capture
        try { await chrome.scripting.executeScript({ target: { tabId: tabId }, func: () => { try { return window.__imgurl_annotator && window.__imgurl_annotator.prepareForCapture(); } catch (err) { return true; } } }); } catch (err) {}
        pngUrl = await safeCaptureVisibleTab(windowId);
        // NEW: downscale to target width for viewport mode if needed
        if (!selectionActive) {
          try {
            if (VIEWPORT_TARGET_WIDTH_PX && isFinite(VIEWPORT_TARGET_WIDTH_PX)) {
              const resized = await downscalePngIfWider(pngUrl, VIEWPORT_TARGET_WIDTH_PX);
              if (resized) pngUrl = resized; // use resized image for both save and TXT meta
            }
          } catch (e) { /* if (DEBUG) console.warn('[IMGURL] resize skipped', e); */ }
        }
        // Crop to user selection (no auto-trim when selection is active)
        let viewportCropLeftCssForTxt = 0;
        let viewportCropTopCssForTxt = 0;
        let viewportPageWForTxt = null;
        let viewportPageHForTxt = null;
        try {
          // decode size and obtain viewport CSS width to convert CSS->px
          const bmp = await createImageBitmap(dataUrlToBlob(pngUrl));
          const pageWpx0 = bmp.width;
          const pageHpx0 = bmp.height;
          try { bmp.close && bmp.close(); } catch (err) {}
          viewportPageWForTxt = pageWpx0;
          viewportPageHForTxt = pageHpx0;
          let viewportW = null;
          try {
            const r = await chrome.scripting.executeScript({ target: { tabId: tabId }, func: () => window.innerWidth });
            viewportW = (Array.isArray(r) && r[0] && r[0].result) ? r[0].result : null;
          } catch (err) {}
          const scaleFallback = (viewportW && pageWpx0) ? (pageWpx0 / viewportW) : 1;
          const preferredScale = (selectionInfo && isFinite(selectionInfo.devicePixelRatio)) ? Number(selectionInfo.devicePixelRatio) : null;
          const scaleForLabels = (isFinite(preferredScale) && preferredScale > 0) ? preferredScale : ((isFinite(scaleFallback) && scaleFallback > 0) ? scaleFallback : 1);
          if (selectionActive && selectionViewportCss && selectionViewportCss.width > 0 && selectionViewportCss.height > 0) {
            const selLeftCss = selectionViewportCss.left;
            const selTopCss = selectionViewportCss.top;
            const selWidthCss = selectionViewportCss.width;
            const selHeightCss = selectionViewportCss.height;
            let leftPx = Math.max(0, Math.floor(selLeftCss * scaleForLabels));
            let topPx = Math.max(0, Math.floor(selTopCss * scaleForLabels));
            let widthPx = Math.max(1, Math.ceil(selWidthCss * scaleForLabels));
            let heightPx = Math.max(1, Math.ceil(selHeightCss * scaleForLabels));
            if (leftPx + widthPx > pageWpx0) widthPx = Math.max(1, pageWpx0 - leftPx);
            if (topPx + heightPx > pageHpx0) heightPx = Math.max(1, pageHpx0 - topPx);
            const cropped = await cropPngRect(pngUrl, { leftPx, topPx, widthPx, heightPx });
            if (cropped && cropped.url) {
              pngUrl = cropped.url;
              viewportCropLeftCssForTxt = selectionBounds ? selectionBounds.leftCss : selLeftCss;
              viewportCropTopCssForTxt = selectionBounds ? selectionBounds.topCss : selTopCss;
              viewportPageWForTxt = cropped.widthPx || widthPx;
              viewportPageHForTxt = cropped.heightPx || heightPx;
            }
          }
        } catch (e) { /* if (DEBUG) console.warn('[IMGURL] viewport crop failed', e); */ }
        if (typeof viewportCropLeftCssForTxt === 'number') {
          var __viewportCropLeftCss = viewportCropLeftCssForTxt;
        }
        if (typeof viewportCropTopCssForTxt === 'number') {
          var __viewportCropTopCss = viewportCropTopCssForTxt;
        }
        if (viewportPageWForTxt !== null) {
          var __viewportPageWpx = viewportPageWForTxt;
        }
        if (viewportPageHForTxt !== null) {
          var __viewportPageHpx = viewportPageHForTxt;
        }
      } finally {
        // NEW: restore overlay after capture
        try { await chrome.scripting.executeScript({ target: { tabId: tabId }, func: () => { try { return window.__imgurl_annotator && window.__imgurl_annotator.restoreAfterCapture(); } catch (err) { return true; } } }); } catch (err) {}
      }
      if (!pngUrl) throw new Error('Visible capture failed');
      const ts = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const base = `imgurls_view_${ts.getFullYear()}${pad(ts.getMonth()+1)}${pad(ts.getDate())}_${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}`;
      // Save JPEG
      await chrome.downloads.download({ url: pngUrl, filename: `${base}.jpg`, saveAs: false });
      // NEW: Build TXT with optional coordinates and page meta (viewport-only)
      try {
        const pickUrl = (raw) => {
          const str = String(raw || '');
          const m = /(https?:\/\/\S+)/i.exec(str);
          return m ? m[1].replace(/[),.;:!?]+$/, '') : '';
        };
        const inferKind = (obj) => {
          if (obj && obj.kind) return obj.kind;
          const t = String(obj && obj.text || '');
          const k = /^\s*\[(.*?)\]/.exec(t);
          return k ? (k[1] || '').toUpperCase() : '';
        };
        // Decode captured image to get pixel size
        const bmp = await createImageBitmap(dataUrlToBlob(pngUrl));
        let pageW = bmp.width;
        let pageH = bmp.height;
        try { bmp.close && bmp.close(); } catch (err) {}
        // Fetch viewport CSS width to estimate scale (rough devicePixelRatio)
        let viewportW = null;
        if (!selectionViewportCss || selectionViewportCss.width <= 0) {
          try {
            const r = await chrome.scripting.executeScript({ target: { tabId: tabId }, func: () => window.innerWidth });
            viewportW = (Array.isArray(r) && r[0] && r[0].result) ? r[0].result : null;
          } catch (err) {}
        }
        if (typeof __viewportPageWpx === 'number' && __viewportPageWpx > 0) { pageW = __viewportPageWpx; }
        if (typeof __viewportPageHpx === 'number' && __viewportPageHpx > 0) { pageH = __viewportPageHpx; }
        const cropLeftCss = (typeof __viewportCropLeftCss === 'number') ? __viewportCropLeftCss : 0;
        const cropTopCss = (typeof __viewportCropTopCss === 'number') ? __viewportCropTopCss : 0;
        let scale = 1;
        if (selectionViewportCss && selectionViewportCss.width > 0) {
          scale = pageW / selectionViewportCss.width;
        } else if (viewportW) {
          scale = pageW / viewportW;
        }
        // Sort by visual order using page coords when available
        const sorted = (labels || []).slice().sort((a, b) => {
          const ay = isFinite(a.topPage) ? a.topPage : (a.top || 0);
          const by = isFinite(b.topPage) ? b.topPage : (b.top || 0);
          if (ay !== by) return ay - by;
          const ax = isFinite(a.leftPage) ? a.leftPage : (a.left || 0);
          const bx = isFinite(b.leftPage) ? b.leftPage : (b.left || 0);
          return ax - bx;
        });
        const seenByPos = new Set();
        const lines = [];
        const intersectsSelection = (o) => {
          if (!selectionBounds) return true;
          const left = isFinite(o.leftPage) ? o.leftPage : (isFinite(o.left) ? o.left : 0);
          const top = isFinite(o.topPage) ? o.topPage : (isFinite(o.top) ? o.top : 0);
          const width = Math.max(0, isFinite(o.width) ? o.width : 0);
          const height = Math.max(0, isFinite(o.height) ? o.height : 0);
          const right = left + width;
          const bottom = top + height;
          return right > selectionBounds.leftCss && left < selectionBounds.rightCss && bottom > selectionBounds.topCss && top < selectionBounds.bottomCss;
        };
        for (const o of sorted) {
          if (!intersectsSelection(o)) continue;
          const u = pickUrl(o && o.text);
          if (!u) continue;
          const x = (isFinite(o.leftPage) ? o.leftPage : (o.left || 0)) - cropLeftCss;
          const y = (isFinite(o.topPage) ? o.topPage : (o.top || 0)) - cropTopCss;
          const w = isFinite(o.width) ? o.width : 0;
          const h = isFinite(o.height) ? o.height : 0;
          const key = `${u}@@${Math.round(y)}x${Math.round(x)}`; // NEW: dedupe by page coords
          if (seenByPos.has(key)) continue;
          seenByPos.add(key);
          const kind = inferKind(o) || 'IMG';
          if (includePos) {
            lines.push(`${u} | kind=${kind} | x=${Math.round(x)} | y=${Math.round(y)} | w=${Math.round(w)} | h=${Math.round(h)} | pageW=${pageW} | pageH=${pageH} | scale=${Number(scale).toString()}`);
          } else {
            lines.push(`${u}`);
          }
        }
        if (lines.length > 0) {
          const txt = lines.join('\n');
          const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
          const url = await blobToDataUrl(blob);
          await chrome.downloads.download({ url, filename: `${base}.txt`, saveAs: false });
        }
      } catch (e) { /* if (DEBUG) console.warn('[IMGURL] viewport URL list export failed', e); */ }
      return; // Finish viewport mode
    }
    // Capture full page (or from current position down) and stitch into one PNG
    const capture = await captureFullPage(
      { id: tabId, windowId },
      {
        collectLabels: true,
        returnMeta: true,
        noStitch: false,
        startFromCurrent: (exportMode === 'below_image_txt'),
        scrollSelection: isSelectionScrollMode ? {
          leftCss: scrollSelectionBounds.leftCss,
          widthCss: Math.max(1, scrollSelectionBounds.rightCss - scrollSelectionBounds.leftCss),
          topCss: scrollSelectionBounds.topCss,
          heightCss: Math.max(1, scrollSelectionBounds.bottomCss - scrollSelectionBounds.topCss)
        } : null
      }
    );
    let stitched = capture && (capture.dataUrl || capture);
    if (!stitched) throw new Error('Stitch failed');
    // Extract meta early to decide final-pass strategy
    const meta = (capture && capture.meta) || null;
    const partsCount = (meta && meta.parts && Array.isArray(meta.parts.urls)) ? meta.parts.urls.length : 0;
    // Final pass: annotate -> collect to rescue any missed labels
    // If user canceled (ESC), skip this heavy pass and use what we have.
    if (!cancelRequested) {
      try {
        const finalOpts = {
          includeBackgroundImages: true,
          includeVideos: true,
          labelMode: 'url',
          onlyVisible: true,
          viewportPad: 240,
          excludeEncoded: true,
          blockedPrefixes: [],
          settleDelay: 300
        };
        // On long pages (many parts), run only on top frame and with timeout
        const runAllFrames = partsCount <= 10;
        await withTimeout(chrome.scripting.executeScript({
          target: { tabId: tabId, allFrames: runAllFrames },
          func: (opts) => { try { return window.__imgurl_annotator && window.__imgurl_annotator.annotateAndFlush(opts); } catch (err) { return false; } },
          args: [finalOpts]
        }), runAllFrames ? 2000 : 900);
        await delay(180);
        const resFinal = await withTimeout(chrome.scripting.executeScript({
          target: { tabId: tabId, allFrames: runAllFrames },
          func: () => { try { return window.__imgurl_annotator && window.__imgurl_annotator.collectLabels(); } catch (err) { return []; } }
        }), runAllFrames ? 1500 : 800);
        for (const r of (resFinal || [])) {
          if (r && Array.isArray(r.result)) collectedLabels.push(...r.result);
        }
      } catch (e) {
        /* if (DEBUG) console.warn('[IMGURL] final-pass collect failed', e); */
      }
    } else {
      try { await chrome.scripting.executeScript({ target: { tabId }, func: () => { try { window.__imgurl_annotator && window.__imgurl_annotator.setProgressOverlay('Canceling... please wait'); } catch (err) {} } }); } catch (err) {}
    }
    const labels = collectedLabels || [];
    let size = meta ? { width: meta.widthPx, height: meta.heightPx } : await getImageSize(stitched);
    let extraScaleForTxt = 1; // reflect any output downscale
    const ts = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const basePrefix = isSelectionScrollMode ? 'imgurls_selection' : ((exportMode === 'below_image_txt') ? 'imgurls_below' : 'imgurls_full');
    {
      // Image + text: save stitched PNG
      try { await chrome.scripting.executeScript({ target: { tabId }, func: () => { try { window.__imgurl_annotator && window.__imgurl_annotator.setProgressOverlay('Saving image...'); } catch (err) {} } }); } catch (err) {}
      // Optionally downscale full-page PNG before saving and TXT
      if (!isSelectionScrollMode) {
        try {
          if (FULLPAGE_TARGET_WIDTH_PX && isFinite(FULLPAGE_TARGET_WIDTH_PX)) {
            const beforeW = size && size.width ? size.width : null;
            const resized = await downscalePngIfWider(stitched, FULLPAGE_TARGET_WIDTH_PX);
            if (resized && typeof resized === 'string') {
              stitched = resized;
              const after = await getImageSize(stitched);
              if (beforeW && after && after.width && after.width !== beforeW) {
                extraScaleForTxt = after.width / beforeW;
                size = { width: after.width, height: after.height };
              }
            }
          }
        } catch (e) { /* if (DEBUG) console.warn('[IMGURL] fullpage resize skipped', e); */ }
      }
      /*
      if (DEBUG) {
        try {
          await chrome.downloads.download({
            url: stitched,
            filename: `debug_full_before_trim_${Date.now()}.jpg`,
            saveAs: true
          });
        } catch (e) {
          console.warn('[IMGURL] debug download failed', e);
        }
      }
      */
      let fullCropLeftCssForTxt = 0;
      let fullCropTopCssForTxt = 0;

      if (!isSelectionScrollMode) {
        // Extra: remove right-side OS scrollbar area if present (Windows etc.)
        try {
          let sbCss = 0;
          try {
            const rr = await chrome.scripting.executeScript({ target: { tabId: tabId }, func: () => {
              try {
                const de = document.documentElement;
                const w = (typeof window.innerWidth === 'number') ? window.innerWidth : 0;
                const c = (de && typeof de.clientWidth === 'number') ? de.clientWidth : 0;
                const sb = Math.max(0, w - c);
                return sb || 0;
              } catch (err) { return 0; }
            } });
            if (Array.isArray(rr) && rr[0] && isFinite(rr[0].result)) sbCss = Number(rr[0].result) || 0;
          } catch (err) {}
          const s = (size && isFinite(size.width) && size.width > 0) ? (size.width / (await (async () => {
            try { const r = await chrome.scripting.executeScript({ target: { tabId: tabId }, func: () => window.innerWidth }); return (Array.isArray(r) && r[0] && r[0].result) ? r[0].result : null; } catch (err) { return null; }
          })() || size.width)) : 1;
          let cutPx = Math.ceil((sbCss || 0) * (isFinite(s) && s > 0 ? s : 1)) + 1; // +1 fudge
          const maxCut = Math.floor((size.width || 0) * 0.25);
          if (!isFinite(cutPx) || cutPx < 0) cutPx = 0;
          if (isFinite(maxCut) && cutPx > maxCut) cutPx = maxCut;
          if (cutPx > 0 && (size.width - cutPx) >= Math.min(320, size.width)) {
            const cropped2 = await cropPngHoriz(stitched, 0, size.width - cutPx);
            if (cropped2) {
              stitched = cropped2;
              size = { width: size.width - cutPx, height: size.height };
            }
          }
        } catch (e) { /* if (DEBUG) console.warn('[IMGURL] scrollbar trim failed', e); */ }

        // NEW: trim any remaining white columns on both left and right sides after scrollbar removal
        try {
          // Use up to 25% of the current width for trimming
          const trim = await autoTrimWhitespaceSides(stitched, {
            tolerance: 10,
            maxTrimPx: Math.floor((size && size.width ? size.width : 0) * 0.25),
            ignoreBottomRatio: 0.15
          });
          if (trim && trim.url) {
            // Convert trimmed left pixels to CSS units using meta.scale
            const currentWidthPx = size && size.width ? size.width : 0;
            const scaleForTrim = (() => {
              const base = (meta && isFinite(meta.scale)) ? meta.scale : 1;
              const extra = (isFinite(extraScaleForTxt) && extraScaleForTxt > 0) ? extraScaleForTxt : 1;
              return base * extra;
            })();
            const wouldClip = trimWouldClipLabels(labels, scaleForTrim, {
              cutLeftPx: trim.cutLeftPx || 0,
              cutRightPx: trim.cutRightPx || 0,
              pageWidthPx: currentWidthPx
            });
            if (!wouldClip) {
              fullCropLeftCssForTxt += ((trim.cutLeftPx || 0) / (scaleForTrim || 1));
              stitched = trim.url;
              size = { width: trim.widthPx || size.width, height: size.height };
            }
          }
        } catch (e) {
          /* if (DEBUG) console.warn('[IMGURL] auto trim sides failed', e); */
        }
      } else if (scrollSelectionBounds && scrollSelectionViewportCss) {
        const scaleBase = (meta && isFinite(meta.scale)) ? meta.scale : 1;
        const totalScale = scaleBase * ((isFinite(extraScaleForTxt) && extraScaleForTxt > 0) ? extraScaleForTxt : 1);
        const selectionWidthCss = Math.max(0, (typeof scrollSelectionBounds.widthCss === 'number' ? scrollSelectionBounds.widthCss : (scrollSelectionBounds.rightCss - scrollSelectionBounds.leftCss)));
        const selectionHeightCss = Math.max(0, (typeof scrollSelectionBounds.heightCss === 'number' ? scrollSelectionBounds.heightCss : (scrollSelectionBounds.bottomCss - scrollSelectionBounds.topCss)));
        const selectionLeftPx = Math.max(0, Math.floor(scrollSelectionBounds.leftCss * totalScale));
        const selectionTopCssRel = Math.max(0, scrollSelectionBounds.topCss - ((meta && isFinite(meta.startYCss)) ? meta.startYCss : 0));
        const selectionTopPx = Math.max(0, Math.floor(selectionTopCssRel * totalScale));
        const selectionWidthPx = Math.max(1, Math.ceil(selectionWidthCss * totalScale));
        const selectionHeightPx = Math.max(1, Math.ceil(selectionHeightCss * totalScale));
        const availableHeightPx = size && size.height ? size.height : 0;
        const clampedHeightPx = Math.max(1, Math.min(selectionHeightPx, availableHeightPx - selectionTopPx));
        const croppedRect = await cropPngRect(stitched, { leftPx: selectionLeftPx, topPx: selectionTopPx, widthPx: selectionWidthPx, heightPx: clampedHeightPx });
        if (croppedRect && croppedRect.url) {
          stitched = croppedRect.url;
          const outH = croppedRect.heightPx || clampedHeightPx;
          size = { width: croppedRect.widthPx || selectionWidthPx, height: outH };
          fullCropLeftCssForTxt = scrollSelectionBounds.leftCss;
          fullCropTopCssForTxt = selectionTopCssRel;
        }
      }
      var __fullCropLeftCss = fullCropLeftCssForTxt;
      if (typeof fullCropTopCssForTxt === 'number') {
        var __fullCropTopCss = fullCropTopCssForTxt;
      }
      const imgName = `${basePrefix}_${ts.getFullYear()}${pad(ts.getMonth()+1)}${pad(ts.getDate())}_${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}.jpg`;
      await chrome.downloads.download({ url: stitched, filename: imgName, saveAs: false });
    }

    // NEW: Output TXT with optional coordinates and page meta in visual order (top->left)
    try {
      const pickUrl = (raw) => {
        const str = String(raw || '');
        const m = /(https?:\/\/\S+)/i.exec(str);
        return m ? m[1].replace(/[),.;:!?]+$/, '') : '';
      };
      const inferKind = (obj) => {
        if (obj && obj.kind) return obj.kind;
        const t = String(obj && obj.text || '');
        const k = /^\s*\[(.*?)\]/.exec(t);
        return k ? (k[1] || '').toUpperCase() : '';
      };
      // Determine page dimensions and scale
      const pageW = size && size.width ? size.width : 0;
      const pageH = size && size.height ? size.height : 0;
      let scale = (meta && isFinite(meta.scale)) ? meta.scale : null;
      if (!isFinite(scale) || !scale) {
        // Fallback: estimate scale from current viewport width
        let viewportW = null;
        try {
          const r = await chrome.scripting.executeScript({ target: { tabId }, func: () => window.innerWidth });
          viewportW = (Array.isArray(r) && r[0] && r[0].result) ? r[0].result : null;
        } catch (err) {}
        scale = (viewportW && pageW) ? (pageW / viewportW) : 1;
      }
      // Apply any output downscale so numeric coordinates match the saved asset
      if (isFinite(extraScaleForTxt) && extraScaleForTxt > 0) scale *= extraScaleForTxt;
      // If we horizontally cropped, shift X by crop-left (CSS units)
      const cropLeftCssFull = (typeof __fullCropLeftCss === 'number') ? __fullCropLeftCss : 0;
      const cropTopCssFull = (typeof __fullCropTopCss === 'number') ? __fullCropTopCss : 0;
      const sorted = (labels || []).slice().sort((a, b) => {
        const ay = isFinite(a.topPage) ? a.topPage : (a.top || 0);
        const by = isFinite(b.topPage) ? b.topPage : (b.top || 0);
        if (ay !== by) return ay - by;
        const ax = isFinite(a.leftPage) ? a.leftPage : (a.left || 0);
        const bx = isFinite(b.leftPage) ? b.leftPage : (b.left || 0);
        return ax - bx;
      });
      const seenByPos = new Set();
      const lines = [];
      // Vertical shift for partial-from-current capture so Y=0 aligns to stitched top
      const startYCss = (meta && isFinite(meta.startYCss)) ? meta.startYCss : 0;
      const overlapsScrollSelection = (o) => {
        if (!isSelectionScrollMode || !scrollSelectionBounds) return true;
        const left = isFinite(o.leftPage) ? o.leftPage : (isFinite(o.left) ? o.left : 0);
        const top = isFinite(o.topPage) ? o.topPage : (isFinite(o.top) ? o.top : 0);
        const width = Math.max(0, isFinite(o.width) ? o.width : 0);
        const height = Math.max(0, isFinite(o.height) ? o.height : 0);
        const right = left + width;
        const bottom = top + height;
        return (
          right > scrollSelectionBounds.leftCss &&
          left < scrollSelectionBounds.rightCss &&
          bottom > scrollSelectionBounds.topCss &&
          top < scrollSelectionBounds.bottomCss
        );
      };
      for (const o of sorted) {
        if (!overlapsScrollSelection(o)) continue;
        const u = pickUrl(o && o.text);
        if (!u) continue;
        const x = (isFinite(o.leftPage) ? o.leftPage : (o.left || 0)) - cropLeftCssFull;
        const y = (isFinite(o.topPage) ? o.topPage : (o.top || 0)) - startYCss - cropTopCssFull;
        const w = isFinite(o.width) ? o.width : 0;
        const h = isFinite(o.height) ? o.height : 0;
        const key = `${u}@@${Math.round(y)}x${Math.round(x)}`; // NEW: dedupe by page coords
        if (seenByPos.has(key)) continue;
        seenByPos.add(key);
        const kind = inferKind(o) || 'IMG';
        if (includePos) {
          lines.push(`${u} | kind=${kind} | x=${Math.round(x)} | y=${Math.round(y)} | w=${Math.round(w)} | h=${Math.round(h)} | pageW=${pageW} | pageH=${pageH} | scale=${Number(scale).toString()}`);
        } else {
          lines.push(`${u}`);
        }
      }
      if (lines.length > 0) {
        const txt = lines.join('\n');
        const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
        const url = await blobToDataUrl(blob);
        const base = `${basePrefix}_${ts.getFullYear()}${pad(ts.getMonth()+1)}${pad(ts.getDate())}_${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}`;
        const txtName = `${base}.txt`;
        await chrome.downloads.download({ url, filename: txtName, saveAs: false });
      }
    } catch (e) {
      /* if (DEBUG) console.warn('[IMGURL] URL list export failed', e); */
    }

  } catch (err) {
    console.error('Capture failed:', err);
  } finally {
    if (tab && tab.id) {
      // Cleanup overlays and ESC watcher
      try { await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: () => { try { return window.__imgurl_annotator && window.__imgurl_annotator.removeAnnotations(); } catch (err) { return 0; } } }); } catch (err) {}
      try { await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: () => { try { return window.__imgurl_annotator && window.__imgurl_annotator.stopCancelWatch(); } catch (err) { return; } } }); } catch (err) {}
      try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => { try { window.__imgurl_annotator && window.__imgurl_annotator.hideProgressOverlay(); } catch (err) {} } }); } catch (err) {}
      try { await chrome.action.setBadgeText({ tabId: tab.id, text: '' }); } catch (err) {}
    }
    cancelRequested = false;
  }
});

let collectedLabels = [];

async function captureFullPage(tab, options = {}) {
  const wantLabels = !!options.collectLabels;
  const labelsOnly = !!options.labelsOnly;
  const returnMeta = !!options.returnMeta;
  const noStitch = !!options.noStitch;
  const startFromCurrent = !!options.startFromCurrent;
  collectedLabels = [];
  const [{ result: metrics }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      // Pick the active vertical scroller near viewport center if exists; fallback to document scroller
      const isScrollableY = (el) => {
        try {
          if (!el) return false;
          const st = getComputedStyle(el);
          const canScroll = (el.scrollHeight - el.clientHeight) > 4;
          const oy = (st.overflowY || st.overflow || '').toLowerCase();
          return canScroll && (oy === 'auto' || oy === 'scroll');
        } catch (err) { return false; }
      };
      let scroller = null;
      try {
        let el = document.elementFromPoint(Math.floor(window.innerWidth/2), Math.floor(window.innerHeight/2));
        while (el && el !== document.body && el !== document.documentElement) {
          if (isScrollableY(el)) { scroller = el; break; }
          el = el.parentElement;
        }
      } catch (err) {}
      if (!scroller) scroller = document.scrollingElement || document.documentElement || document.body;
      // Tag for later locate in step loop and restore
      try { scroller && scroller.setAttribute && scroller.setAttribute('data-imgurl-scroller', '1'); } catch (err) {}
      const totalWidth = Math.max((scroller && scroller.scrollWidth) || 0, document.documentElement.clientWidth || 0);
      const totalHeight = Math.max((scroller && scroller.scrollHeight) || 0, document.documentElement.clientHeight || 0);
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight; // keep window height for capture consistency
      const dpr = window.devicePixelRatio || 1;
      const x = (scroller && typeof scroller.scrollLeft === 'number' ? scroller.scrollLeft : window.scrollX) || 0;
      const y = (scroller && typeof scroller.scrollTop === 'number' ? scroller.scrollTop : window.scrollY) || 0;
      return { totalWidth, totalHeight, viewportWidth, viewportHeight, dpr, x, y };
    }
  });
  /* if (DEBUG) console.log('[IMGURL] metrics', metrics); */
  // Determine starting Y (CSS units)
  const scrollSel = options.scrollSelection || null;
  const scrollSelTopCss = scrollSel && isFinite(scrollSel.topCss) ? scrollSel.topCss : null;
  const scrollSelHeightCss = scrollSel && isFinite(scrollSel.heightCss) ? scrollSel.heightCss : null;
  const scrollSelBottomCss = (scrollSelTopCss !== null && scrollSelHeightCss !== null) ? (scrollSelTopCss + scrollSelHeightCss) : null;

  const totalHeightCss = Math.max(0, (metrics && metrics.totalHeight) || 0);
  let dynamicHeightCss = totalHeightCss;
  try {
    const [{ result: latestHeight }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const scroller = document.querySelector('[data-imgurl-scroller="1"]') || document.scrollingElement || document.documentElement || document.body;
        return Math.max((scroller && scroller.scrollHeight) || 0, document.documentElement.clientHeight || 0);
      }
    });
    if (isFinite(latestHeight)) dynamicHeightCss = Math.max(dynamicHeightCss, latestHeight || 0);
  } catch (err) {}
  const defaultStartCss = Math.max(0, Math.min(
    totalHeightCss,
    Math.floor(startFromCurrent ? ((metrics && metrics.y) || 0) : 0)
  ));
  const startYCss = (scrollSelTopCss !== null)
    ? Math.max(0, Math.min(scrollSelTopCss, dynamicHeightCss))
    : defaultStartCss;
  const baseCoverageEndCss = (scrollSelBottomCss !== null)
    ? Math.min(scrollSelBottomCss, dynamicHeightCss)
    : dynamicHeightCss;
  const targetCoverageCss = Math.max(0, baseCoverageEndCss - startYCss);

  // Prepare scrolling: disable smooth scroll/snap to avoid timing issues
  let scrollBackup = null;
  try {
    const [{ result: backup }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const html = document.documentElement;
        const body = document.body;
        const bk = {
          htmlScrollBehavior: html && html.style && html.style.scrollBehavior,
          bodyScrollBehavior: body && body.style && body.style.scrollBehavior,
          htmlSnap: html && html.style && html.style.scrollSnapType,
          scrollerScrollBehavior: '',
          scrollerSnap: ''
        };
        try { if (html && html.style) html.style.scrollBehavior = 'auto'; } catch (err) {}
        try { if (body && body.style) body.style.scrollBehavior = 'auto'; } catch (err) {}
        try { if (html && html.style) html.style.scrollSnapType = 'none'; } catch (err) {}
        // Also disable on detected scroll container if possible
        try {
          const s = document.querySelector('[data-imgurl-scroller="1"]');
          if (s && s.style) {
            bk.scrollerScrollBehavior = s.style.scrollBehavior || '';
            bk.scrollerSnap = s.style.scrollSnapType || '';
            s.style.scrollBehavior = 'auto';
            s.style.scrollSnapType = 'none';
          }
        } catch (err) {}
        return bk;
      }
    });
    scrollBackup = backup || null;
  } catch (err) {}

  const steps = [];
  // Use exact viewport height per step to avoid overlap in output
  const stepH = Math.max(1, Math.floor(metrics.viewportHeight));
  const safetyTailCss = Math.min(Math.max(40, metrics.viewportHeight * 0.2), 240);
  let captureEndCss;
  if (scrollSelBottomCss !== null) {
    captureEndCss = Math.max(startYCss + 1, Math.min(scrollSelBottomCss, dynamicHeightCss));
  } else {
    const targetEndCss = dynamicHeightCss + safetyTailCss;
    captureEndCss = Math.max(startYCss + 1, targetEndCss);
  }

  for (let y = startYCss; y < captureEndCss; y += stepH) {
    const remaining = captureEndCss - y;
    if (remaining <= 0) break;
    const clipCss = Math.min(metrics.viewportHeight, remaining);
    if (clipCss <= 0) break;
    steps.push({ y, clipCss });
  }

  const partUrls = [];
  const clipPx = [];
  // NEW: Array to record measured viewport heights (device pixel units) for each captured step
  const measuredClipPx = [];

  let lastCap = null;
  let sameCount = 0;
  for (let idx = 0; idx < steps.length; idx++) {
    const step = steps[idx];
    // NEW: Measured bitmap height for this step (in device pixels)
    let measuredStepPx = null;
    /* if (DEBUG) console.log('[IMGURL] step begin', { y: step.y, clip: step.clipCss }); */
    if (!(await isTabAlive(tab.id))) break;
    if (cancelRequested) break;
    // Update progress label (top frame only). Example: 3/20 15%
    try {
      const txt = `Press Esc to stop: capturing... ${idx + 1}/${steps.length}`;
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: (t) => { try { window.__imgurl_annotator && window.__imgurl_annotator.setProgressOverlay(t); } catch (err) {} }, args: [txt] });
    } catch (err) {}
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (y) => {
        const s = document.querySelector('[data-imgurl-scroller="1"]') || document.scrollingElement || document.documentElement || document.body;
        try { s.scrollTo ? s.scrollTo(0, y) : (s.scrollTop = y); } catch (err) {}
        try { window.scrollTo(0, y); } catch (err) {}
      },
      args: [step.y]
    });
    // Wait until scrolled to target or timeout
    try {
      const start = Date.now();
      while (true) {
        const [{ result: curY }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => { const s = document.querySelector('[data-imgurl-scroller="1"]') || document.scrollingElement || document.documentElement || document.body; const winY = (typeof window.scrollY === 'number') ? window.scrollY : 0; return (s && typeof s.scrollTop === 'number' ? s.scrollTop : 0) || winY || 0; } });
        if (Math.abs((curY || 0) - step.y) < 2) break;
        if (Date.now() - start > 1200) break;
        await delay(60);
      }
      // Fallback: if we still aren't near target, retry and bail if no movement
      const [{ result: afterY }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => { const s = document.querySelector('[data-imgurl-scroller="1"]') || document.scrollingElement || document.documentElement || document.body; const winY = (typeof window.scrollY === 'number') ? window.scrollY : 0; return (s && typeof s.scrollTop === 'number' ? s.scrollTop : 0) || winY || 0; } });
      if (Math.abs((afterY || 0) - step.y) > 4) {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (y) => {
            try { window.scrollTo({ top: y, left: 0, behavior: 'auto' }); } catch (err) {}
            try {
              const s = document.querySelector('[data-imgurl-scroller="1"]') || document.scrollingElement || document.documentElement || document.body;
              if (s) { s.scrollTop = y; if (s.scrollTo) s.scrollTo({ top: y, left: 0, behavior: 'auto' }); }
            } catch (err) {}
          },
          args: [step.y]
        });
        await delay(220);
        const [{ result: afterY2 }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => { const s = document.querySelector('[data-imgurl-scroller="1"]') || document.scrollingElement || document.documentElement || document.body; const winY = (typeof window.scrollY === 'number') ? window.scrollY : 0; return (s && typeof s.scrollTop === 'number' ? s.scrollTop : 0) || winY || 0; } });
        if (Math.abs((afterY2 || 0) - step.y) > 6) {
          // As a last resort, dispatch a wheel event so that cross-origin
          // iframe content under the cursor scrolls like a real user gesture.
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: (delta) => {
                try {
                  const cx = Math.floor(window.innerWidth/2);
                  const cy = Math.floor(window.innerHeight/2);
                  const ev = new WheelEvent('wheel', { deltaY: delta, clientX: cx, clientY: cy, bubbles: true, cancelable: true });
                  const el = document.elementFromPoint(cx, cy) || document.body;
                  (el || document).dispatchEvent(ev);
                } catch (err) {}
              },
              args: [Math.max(120, Math.floor(step.y/4) || 240)]
            });
            await delay(260);
          } catch (err) {}
        }
      }
    } catch (err) {}
    // Wait for paint to settle: ensure 2 frames after scroll
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => new Promise(res => { requestAnimationFrame(() => requestAnimationFrame(res)); })
      });
    } catch (err) {}
    /* if (DEBUG) console.log('[IMGURL] after rAF-2 at', step.y); */
    if (cancelRequested) break;
    // Re-annotate only visible area at this position
    try {
      // Step-level: operate on top frame only to avoid heavy multi-frame work.
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => (window.__imgurl_annotator && window.__imgurl_annotator.removeAnnotations()) || 0 });
      const annotateOpts = {
        includeBackgroundImages: true,
        includeVideos: true,
        labelMode: 'url',
        onlyVisible: true,
        viewportPad: 240,
        // Include URLs with query strings and percent-encoded characters
        excludeEncoded: true,
        // Do not block any host/prefix by default
        blockedPrefixes: [],
        settleDelay: 220
      };
      const res = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (opts) => { try { return window.__imgurl_annotator && window.__imgurl_annotator.annotateAndFlush(opts); } catch (err) { return 0; } },
        args: [annotateOpts]
      });
      await delay(160);
      // Early collect immediately after overlays are painted (helps lazyload)
      if (wantLabels) {
        try {
          const res1 = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => { try { return window.__imgurl_annotator && window.__imgurl_annotator.collectLabels(); } catch (err) { return []; } } });
          let added1 = 0;
          for (const r of res1) {
            if (r && Array.isArray(r.result)) { added1 += r.result.length; collectedLabels.push(...r.result); }
          }
          /* if (DEBUG) console.log('[IMGURL] collected early +', added1, 'total', collectedLabels.length); */
        } catch (err) {}
      }
      try { const total = (res || []).reduce((a, r) => a + (r && r.result ? r.result : 0), 0); await chrome.action.setBadgeText({ tabId: tab.id, text: String(total || '') }); } catch (err) {}
    } catch (err) {}
    if (cancelRequested) break;
    // Capture this viewport (labels collection happens each step)
    if (!labelsOnly) {
      try {
        // NEW: Hide overlay and wait before capturing so it won't appear
        try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => { try { return window.__imgurl_annotator && window.__imgurl_annotator.prepareForCapture(); } catch (err) { return true; } } }); } catch (err) {}
        const url = await safeCaptureVisibleTab(tab.windowId);
        if (url) {
          // NEW: Decode the captured frame to obtain actual bitmap height (device pixels)
          try {
            const blob = dataUrlToBlob(url);
            const bmp  = await createImageBitmap(blob);
            if (bmp && isFinite(bmp.height) && bmp.height > 0) {
              measuredStepPx = bmp.height;
            }
            try { bmp.close && bmp.close(); } catch (err) {}
          } catch (err) {}
          if (lastCap && url === lastCap) {
            sameCount++;
          } else {
            sameCount = 0;
          }
          lastCap = url;
          partUrls.push(url);
          /* if (DEBUG) console.log('[IMGURL] captured', !!url, 'sameCount', sameCount, 'parts', partUrls.length); */
          // If we've captured identical frames repeatedly, be persistent and try to unstick
          if (sameCount >= 6) {
            // Last-ditch: force a repaint via a transient transform and 2 rAFs
            try {
              await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => new Promise(r => {
                  const h = document.documentElement;
                  const old = h && h.style && h.style.transform;
                  if (h && h.style) h.style.transform = 'translateZ(0)';
                  requestAnimationFrame(() => {
                    if (h && h.style) h.style.transform = old || '';
                    requestAnimationFrame(r);
                  });
                })
              });
            } catch (err) {}
            if (sameCount >= 8) break;
          }
        }
      } catch (e) { console.warn('capture step failed', e); }
      finally {
        // NEW: Restore overlay visibility after capture
        try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => { try { return window.__imgurl_annotator && window.__imgurl_annotator.restoreAfterCapture(); } catch (err) { return true; } } }); } catch (err) {}
      }
    }
    // collect labels if requested
    if (wantLabels) {
      try {
        // Step-level: collect only from top frame; final pass collects all frames.
        const res = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => { try { return window.__imgurl_annotator && window.__imgurl_annotator.collectLabels(); } catch (err) { return []; } } });
        let added2 = 0;
        for (const r of res) { if (r && Array.isArray(r.result)) { added2 += r.result.length; collectedLabels.push(...r.result); } }
        /* if (DEBUG) console.log('[IMGURL] collected step +', added2, 'total', collectedLabels.length); */
      } catch (err) {}
    }
    // NEW: Save measured height for this step; fallback to 0 if none
    const measuredVal = (scrollSelBottomCss !== null) ? 0 : (Number.isFinite(measuredStepPx) && measuredStepPx > 0 ? measuredStepPx : 0);
    measuredClipPx.push(measuredVal);
    clipPx.push(step.clipCss);
  }

  // Restore scroll position
  if (await isTabAlive(tab.id)) {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: ({ x, y }) => { const s = document.querySelector('[data-imgurl-scroller="1"]') || document.scrollingElement || document.documentElement || document.body; try { s.scrollTo ? s.scrollTo(x, y) : (s.scrollTop = y, s.scrollLeft = x); } catch (err) { window.scrollTo(x, y); } }, args: [{ x: metrics.x, y: metrics.y }] });
  }

  // Restore scroll behavior
  try {
    if (scrollBackup) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (bk) => {
          const html = document.documentElement; const body = document.body;
          try { if (html && html.style) html.style.scrollBehavior = bk.htmlScrollBehavior || ''; } catch (err) {}
          try { if (body && body.style) body.style.scrollBehavior = bk.bodyScrollBehavior || ''; } catch (err) {}
          try { if (html && html.style) html.style.scrollSnapType = bk.htmlSnap || ''; } catch (err) {}
          try {
            const s = document.querySelector('[data-imgurl-scroller="1"]');
            if (s && s.style) {
              s.style.scrollBehavior = bk.scrollerScrollBehavior || '';
              s.style.scrollSnapType = bk.scrollerSnap || '';
            }
          } catch (err) {}
        },
        args: [scrollBackup]
      });
    }
  } catch (err) {}

  // If nothing captured yet, try a single current viewport
  if (partUrls.length === 0) {
    try { return await safeCaptureVisibleTab(tab.windowId); } catch (err) { return null; }
  }

  // If caller wants meta only and to avoid stitching, return parts for downstream processing
  if (noStitch && returnMeta) {
    // Decode only the first frame to determine pixel width and DPR scale
    let widthPx = metrics.viewportWidth;
    try {
      if (partUrls.length > 0) {
        const blob0 = dataUrlToBlob(partUrls[0]);
        const bmp0 = await createImageBitmap(blob0);
        widthPx = bmp0.width || metrics.viewportWidth;
        try { bmp0.close && bmp0.close(); } catch (err) {}
      }
    } catch (err) {}
    const scale = widthPx / metrics.viewportWidth;
    const clipHeightsPx = clipPx.slice(0, partUrls.length).map(h => Math.round(h * scale));
    const totalHeightPx = clipHeightsPx.reduce((a, b) => a + b, 0);
    return {
      dataUrl: null,
      meta: {
        widthPx,
        heightPx: totalHeightPx,
        viewportWidth: metrics.viewportWidth,
        scale,
        startYCss,
        parts: { urls: partUrls.slice(0), clipPx: clipPx.slice(0) }
      }
    };
  }

  // Stitch captured parts so far (original path)
  try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: (t) => { try { window.__imgurl_annotator && window.__imgurl_annotator.setProgressOverlay(t); } catch (err) {} }, args: ['Processing...'] }); } catch (err) {}
  const bitmaps = [];
  for (const u of partUrls) {
    try { const blob = dataUrlToBlob(u); const bmp = await createImageBitmap(blob); bitmaps.push(bmp); } catch (e) { console.warn('decode failed, skipping frame', e); }
  }
  if (bitmaps.length === 0) return null;

  const widthPx = bitmaps[0].width;
  const scale = widthPx / metrics.viewportWidth; // ~dpr
  // NEW: Determine clip heights (pixel units). Prefer measured heights when available, fallback to CSS-to-px conversion.
  let clipHeightsPx;
  if (measuredClipPx.length === bitmaps.length && measuredClipPx.some(v => v > 0)) {
    const fallbackFromCss = clipPx.slice(0, bitmaps.length).map(h => Math.max(1, Math.round(h * scale)));
    clipHeightsPx = measuredClipPx.map((v, i) => {
      const val = v || fallbackFromCss[i] || 1;
      return Math.max(1, Math.round(val));
    });
  } else {
    clipHeightsPx = clipPx.slice(0, bitmaps.length).map(h => Math.max(1, Math.round(h * scale)));
  }
  if (scrollSelBottomCss !== null && clipHeightsPx.length > 0 && steps.length === 1) {
    clipHeightsPx[0] = Math.max(1, Math.round(targetCoverageCss * scale));
  }
  // Guard against extremely large canvases: scale down instead of truncating
  const MAX_CANVAS_DIM = 32760; // conservative per-engine limit (both width/height)
  let totalHeightPx = clipHeightsPx.reduce((a, b) => a + b, 0);
  // Compute uniform output scale to fit within limits
  const scaleOut = Math.min(1,
    MAX_CANVAS_DIM / Math.max(1, widthPx),
    MAX_CANVAS_DIM / Math.max(1, totalHeightPx)
  );

  const outW = Math.max(1, Math.round(widthPx * scaleOut));
  // NEW: Precompute scaled drawing heights per frame and determine final output height
  const dhList = clipHeightsPx.map(h => Math.max(1, Math.round(h * scaleOut)));
  const totalOutHeight = dhList.reduce((a, b) => a + b, 0);
  let canvasHeight;
  if (scrollSelBottomCss !== null) {
    canvasHeight = totalOutHeight || 1;
  } else {
    const desiredHeightPx = Math.max(1, Math.round(targetCoverageCss * scale));
    const desiredOutHeight = Math.max(1, Math.round(desiredHeightPx * scaleOut));
    canvasHeight = Math.min(totalOutHeight || 1, desiredOutHeight || totalOutHeight || 1);
  }

  const canvas = new OffscreenCanvas(outW, canvasHeight);
  const ctx = canvas.getContext('2d');
  let dy = 0;
  for (let i = 0; i < bitmaps.length; i++) {
    if (dy >= canvasHeight) break;
    const bmp = bitmaps[i];
    let ch = clipHeightsPx[i];
    if (!isFinite(ch) || ch <= 0) continue;
    if (ch > bmp.height) ch = bmp.height;
    let sy;
    if (scrollSelBottomCss !== null) {
      sy = 0;
    } else {
      sy = (ch < bmp.height) ? (bmp.height - ch) : 0;
    }
    let dh = dhList[i];
    if (scrollSelBottomCss !== null && steps.length === 1) {
      sy = 0;
      ch = Math.min(ch, Math.max(1, Math.round(targetCoverageCss * scale)));
      dh = Math.min(dh, canvasHeight);
    } else if (dy + dh > canvasHeight) {
      const allowed = Math.max(0, canvasHeight - dy);
      if (allowed <= 0) break;
      const ratio = allowed / dh;
      dh = Math.max(1, Math.round(allowed));
      const clipped = Math.max(1, Math.round(ch * ratio));
      sy = Math.max(0, ch - clipped);
      ch = clipped;
    }
    const dw = Math.max(1, Math.round(bmp.width * scaleOut));
    ctx.drawImage(bmp, 0, sy, bmp.width, ch, 0, dy, dw, dh);
    dy += dh;
  }
  totalHeightPx = Math.max(1, Math.round(canvasHeight / Math.max(scaleOut, Number.EPSILON)));

  const outBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
  const dataUrl = await blobToDataUrl(outBlob);
  if (returnMeta) {
    return { dataUrl, meta: { widthPx, heightPx: totalHeightPx, viewportWidth: metrics.viewportWidth, scale, startYCss } };
  }
  return dataUrl;
}

async function getImageSize(dataUrl) {
  const blob = dataUrlToBlob(dataUrl);
  const bmp = await createImageBitmap(blob);
  const size = { width: bmp.width, height: bmp.height };
  try { bmp.close && bmp.close(); } catch (err) {}
  return size;
}

async function isTabAlive(tabId) {
  try { await chrome.tabs.get(tabId); return true; } catch (err) { return false; }
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function withTimeout(p, ms, onTimeoutValue=null) {
  return Promise.race([
    p,
    new Promise(resolve => setTimeout(() => resolve(onTimeoutValue), Math.max(1, ms)))
  ]);
}

// global declaration: let __lastCapAt = 0;

async function safeCaptureVisibleTab(windowId) {
  let lastErr;
  for (let i = 0; i < 4; i++) {
    // quota handling: minimum interval + jitter
    const now = Date.now();
    const gap = now - __lastCapAt;
    if (gap < 600) await delay(600 - gap + Math.floor(Math.random() * 80));
    try {
      const url = await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 92 });
      if (url) { __lastCapAt = Date.now(); return url; }
    } catch (e) {
      lastErr = e;
      /* if (DEBUG) console.warn('[IMGURL] captureVisibleTab failed try', i + 1, e); */
      const isQuota = String(e && e.message || '').includes('MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND');
      await delay(isQuota ? (700 + i * 250) : 300); // use backoff when hitting capture quota
    }
  }
  if (lastErr) throw lastErr;
  return null;
}

// Downscale a PNG data URL to the specified target width, preserving aspect ratio.
// Returns a new data URL if resized, or the original if already narrower.
async function downscalePngIfWider(pngDataUrl, targetWidth) {
  try {
    const blob = dataUrlToBlob(pngDataUrl);
    const bmp = await createImageBitmap(blob);
    const w = bmp.width, h = bmp.height;
    if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) { try { bmp.close && bmp.close(); } catch (err) {} ; return pngDataUrl; }
    if (!isFinite(targetWidth) || targetWidth <= 0 || w <= targetWidth) { try { bmp.close && bmp.close(); } catch (err) {} ; return pngDataUrl; }
    const scale = targetWidth / w;
    const outW = Math.max(1, Math.round(targetWidth));
    const outH = Math.max(1, Math.round(h * scale));
    const canvas = new OffscreenCanvas(outW, outH);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, w, h, 0, 0, outW, outH);
    try { bmp.close && bmp.close(); } catch (err) {}
    const outBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
    return await blobToDataUrl(outBlob);
  } catch (e) {
    /* if (DEBUG) console.warn('[IMGURL] downscale failed', e); */
    return pngDataUrl;
  }
}

// Horizontal crop helpers: compute crop from media label bounds and crop PNG
async function cropHorizontalByLabels(pngDataUrl, labels, { pageWpx, scale, padCss = 12, minMediaWidthCss = 60, maxCropRatio = 0.15, minSpanRatio = 0.5 } = {}) {
  try {
    if (!labels || labels.length === 0 || !isFinite(pageWpx) || !isFinite(scale)) return null;
    let minL = Infinity, maxR = -Infinity;
    for (const o of labels) {
      const w = isFinite(o && o.width) ? o.width : 0;
      const l = isFinite(o && o.leftPage) ? o.leftPage : (isFinite(o && o.left) ? o.left : 0);
      if (!isFinite(l) || !isFinite(w)) continue;
      if (w < minMediaWidthCss) continue;
      if (l < minL) minL = l;
      const r = l + w;
      if (r > maxR) maxR = r;
    }
    if (!isFinite(minL) || !isFinite(maxR) || maxR <= minL) return null;
    // If media span is too narrow relative to page, skip cropping to avoid cutting non-media content
    const pageWCss = pageWpx / (scale || 1);
    const spanCss = maxR - minL;
    if (pageWCss && (spanCss / pageWCss) < minSpanRatio) return null;
    const pad = Math.max(0, padCss);
    let leftPx = Math.max(0, Math.floor((minL - pad) * scale));
    let rightPx = Math.min(pageWpx, Math.ceil((maxR + pad) * scale));
    // Safety clamp: do not crop away more than a fraction of page width per side
    const maxCropPx = Math.floor(pageWpx * Math.max(0, Math.min(0.45, maxCropRatio)));
    if (leftPx > maxCropPx) leftPx = maxCropPx;
    if ((pageWpx - rightPx) > maxCropPx) rightPx = pageWpx - maxCropPx;
    if (rightPx - leftPx < Math.min(320, pageWpx)) { leftPx = 0; rightPx = pageWpx; }
    if (leftPx <= 0 && rightPx >= pageWpx) return null; // nothing to crop
    const cropped = await cropPngHoriz(pngDataUrl, leftPx, rightPx - leftPx);
    return { url: cropped, leftPx, widthPx: rightPx - leftPx };
  } catch (e) { /* if (DEBUG) console.warn('[IMGURL] cropHorizontalByLabels failed', e); */ return null; }
}

async function cropPngHoriz(pngDataUrl, sx, sw) {
  const blob = dataUrlToBlob(pngDataUrl);
  const bmp = await createImageBitmap(blob);
  const sxClamped = Math.max(0, Math.min(sx, bmp.width - 1));
  const w = Math.max(1, Math.min(sw, bmp.width - sxClamped));
  const canvas = new OffscreenCanvas(w, bmp.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, sxClamped, 0, w, bmp.height, 0, 0, w, bmp.height);
  try { bmp.close && bmp.close(); } catch (err) {}
  const outBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
  return await blobToDataUrl(outBlob);
}

async function cropPngRect(pngDataUrl, { leftPx = 0, topPx = 0, widthPx = 0, heightPx = 0 }) {
  const blob = dataUrlToBlob(pngDataUrl);
  const bmp = await createImageBitmap(blob);
  const sx = Math.max(0, Math.min(Math.floor(leftPx), bmp.width - 1));
  const sy = Math.max(0, Math.min(Math.floor(topPx), bmp.height - 1));
  const sw = Math.max(1, Math.min(Math.ceil(widthPx), bmp.width - sx));
  const sh = Math.max(1, Math.min(Math.ceil(heightPx), bmp.height - sy));
  const canvas = new OffscreenCanvas(sw, sh);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
  try { bmp.close && bmp.close(); } catch (err) {}
  const outBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
  const url = await blobToDataUrl(outBlob);
  return { url, widthPx: sw, heightPx: sh };
}

// Detect and trim nearly-uniform side columns (e.g., page background or whitespace)
// Returns { url, cutLeftPx, cutRightPx, widthPx } or null when no meaningful trim.
function trimWouldClipLabels(labels, scale, { cutLeftPx = 0, cutRightPx = 0, pageWidthPx = null } = {}, marginPx = 12) {
  const s = (isFinite(scale) && scale > 0) ? scale : null;
  if (!s || !Array.isArray(labels) || labels.length === 0) return false;
  const cutLeft = Math.max(0, cutLeftPx || 0);
  const cutRight = Math.max(0, cutRightPx || 0);
  if (cutLeft === 0 && cutRight === 0) return false;
  const pageW = (isFinite(pageWidthPx) && pageWidthPx > 0) ? pageWidthPx : null;
  const guard = Math.max(0, marginPx || 0);
  for (const o of labels) {
    if (!o) continue;
    const leftCss = isFinite(o.leftPage) ? o.leftPage : (isFinite(o.left) ? o.left : null);
    const widthCss = isFinite(o.width) ? o.width : null;
    if (!isFinite(leftCss) || !isFinite(widthCss) || widthCss <= 0) continue;
    const leftPx = leftCss * s;
    const rightPx = (leftCss + widthCss) * s;
    if (cutLeft > 0 && (leftPx - guard) < cutLeft) return true;
    if (cutRight > 0 && pageW) {
      const distFromRight = pageW - rightPx;
      if ((distFromRight - guard) < cutRight) return true;
    }
  }
  return false;
}

async function autoTrimWhitespaceSides(pngDataUrl, { tolerance = 12, maxTrimPx = null, ignoreBottomRatio = 0 } = {}) {
  try {
    const blob = dataUrlToBlob(pngDataUrl);
    const bmp = await createImageBitmap(blob);
    const w = bmp.width, h = bmp.height;
    if (!isFinite(w) || !isFinite(h) || w <= 2) { try { bmp.close && bmp.close(); } catch (err) {}; return null; }

    const ignoreRatio = Math.max(0, Math.min(0.9, ignoreBottomRatio || 0));
    let usableHeight = Math.max(1, Math.floor(h * (1 - ignoreRatio)));
    if (!isFinite(usableHeight) || usableHeight > h) usableHeight = h;
    const sampleH = Math.max(1, Math.min(usableHeight, 2048)); // sample up to 2048 rows for speed
    const canvas = new OffscreenCanvas(w, sampleH);
    const ctx = canvas.getContext('2d');
    // Draw the full width but only top N rows; for background-like detection this is sufficient
    ctx.drawImage(bmp, 0, 0, w, usableHeight, 0, 0, w, sampleH);
    try { bmp.close && bmp.close(); } catch (err) {}
    const img = ctx.getImageData(0, 0, w, sampleH);
    const data = img.data;

    // Helper to compute average color of a column range near a side
    const avgColorOfColumn = (x) => {
      let r = 0, g = 0, b = 0, a = 0;
      for (let y = 0; y < sampleH; y += 2) { // sample every other row
        const idx = ((y * w) + x) * 4;
        r += data[idx]; g += data[idx + 1]; b += data[idx + 2]; a += data[idx + 3];
      }
      const n = Math.ceil(sampleH / 2);
      return [r / n, g / n, b / n, a / n];
    };

    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const sq = (x) => x * x;
    const isNear = (p, q, tol) => (sq(p[0]-q[0]) + sq(p[1]-q[1]) + sq(p[2]-q[2])) <= sq(tol*3); // rough RGB sphere

    const leftBg = avgColorOfColumn(0);
    const rightBg = avgColorOfColumn(w - 1);

    const maxTrimEach = isFinite(maxTrimPx) && maxTrimPx !== null ? clamp(Math.floor(maxTrimPx), 0, Math.floor(w * 0.45)) : Math.floor(w * 0.25);

    // Walk from each side while the majority of sampled pixels match the side background within tolerance
    const isBackgroundColumn = (x, bg) => {
      let bgCount = 0, total = 0;
      for (let y = 0; y < sampleH; y += 3) { // stride 3 for speed
        const idx = ((y * w) + x) * 4;
        const pix = [data[idx], data[idx + 1], data[idx + 2], data[idx + 3]];
        // Ignore transparent; count as background to not block trimming of transparent areas
        if (pix[3] < 10 || isNear(pix, bg, tolerance)) bgCount++;
        total++;
      }
      return total > 0 && (bgCount / total) >= 0.97; // almost uniform
    };

    let cutL = 0;
    for (let x = 0; x < Math.min(maxTrimEach, Math.floor(w / 2)); x++) {
      if (isBackgroundColumn(x, leftBg)) { cutL = x + 1; } else { break; }
    }

    let cutR = 0;
    for (let x = 0; x < Math.min(maxTrimEach, Math.floor(w / 2)); x++) {
      const xi = w - 1 - x;
      if (isBackgroundColumn(xi, rightBg)) { cutR = x + 1; } else { break; }
    }

    // Ensure we keep a reasonable width
    const remain = w - cutL - cutR;
    if (remain < Math.min(320, w)) { cutL = 0; cutR = 0; }
    if (cutL <= 0 && cutR <= 0) return null;

    const cropped = await cropPngHoriz(pngDataUrl, cutL, remain);
    return { url: cropped, cutLeftPx: cutL, cutRightPx: cutR, widthPx: remain };
  } catch (e) {
    /* if (DEBUG) console.warn('[IMGURL] autoTrimWhitespaceSides internal error', e); */
    return null;
  }
}


function dataUrlToBlob(dataUrl) {
  const [meta, b64] = dataUrl.split(',');
  const mimeMatch = /data:([^;]+);base64/i.exec(meta || '');
  const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
  const binary = atob(b64 || '');
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function blobToDataUrl(blob) {
  const buf = await blob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buf);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const sub = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, sub);
  }
  const base64 = btoa(binary);
  const mime = blob && blob.type ? blob.type : 'application/octet-stream';
  return `data:${mime};base64,${base64}`;
}


// Clear badge when switching tabs
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try { await chrome.action.setBadgeText({ tabId: activeInfo.tabId, text: '' }); } catch (err) {}
});
















