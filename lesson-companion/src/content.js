(function () {
  if (globalThis.__lessonCompanionLoaded) return;
  globalThis.__lessonCompanionLoaded = true;

  const selectApi = globalThis.LessonSelect;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || (message.type !== "capture" && message.type !== "advance")) return;
    handle(message)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({ ok: false, error: error && error.message ? error.message : "读取这一屏失败" });
      });
    return true;
  });

  async function handle(message) {
    if (!onLessonPage()) {
      return { ok: false, error: "请先打开某一课的正文页。目录和商城里没有课文。" };
    }
    let atEnd = false;
    let moved = false;
    if (message.type === "advance") {
      const step = scrollNext();
      atEnd = step.atEnd;
      moved = step.moved;
      if (!moved) {
        return { ok: true, atEnd: true, moved: false, images: [], visibleText: "", title: lessonTitle(), url: publicUrl(), headings: [] };
      }
      await settle();
    }
    const captured = await captureViewport();
    captured.atEnd = message.type === "advance" && atEnd;
    captured.moved = message.type === "advance" ? moved : true;
    return captured;
  }

  function onLessonPage() {
    return /^\/learn\/[^/]+\/[^/]+\/?$/.test(location.pathname);
  }

  function publicUrl() {
    const url = new URL(location.href);
    url.search = "";
    url.hash = "";
    return url.href;
  }

  function lessonTitle() {
    const heading = document.querySelector(".lesson-header h1");
    const text = heading && heading.innerText ? heading.innerText.trim() : "";
    return text || document.title;
  }

  function findScroller() {
    const root = document.scrollingElement || document.documentElement;
    let best = root;
    let bestScore = 0;
    if (root.scrollHeight > root.clientHeight + 80) {
      bestScore = root.clientWidth * root.clientHeight;
    }
    const nodes = document.querySelectorAll("main, article, section, div");
    for (const el of nodes) {
      if (el.scrollHeight <= el.clientHeight + 80) continue;
      if (el.clientHeight < 240 || el.clientWidth < 280) continue;
      const overflow = getComputedStyle(el).overflowY;
      if (!/(auto|scroll|overlay)/.test(overflow)) continue;
      const score = el.clientWidth * el.clientHeight;
      if (score > bestScore) {
        best = el;
        bestScore = score;
      }
    }
    return best;
  }

  function scrollNext() {
    const el = findScroller();
    const before = el.scrollTop;
    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    if (before >= max - 4) return { atEnd: true, moved: false };
    const step = Math.max(220, Math.round(el.clientHeight * 0.82));
    el.scrollTo({ top: Math.min(max, before + step), behavior: "auto" });
    const after = el.scrollTop;
    return { atEnd: after >= max - 4, moved: after > before + 2 };
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function settle() {
    await wait(350);
    const pending = Array.from(document.images).filter((img) => !img.complete && isLessonImage(img));
    await Promise.race([
      Promise.all(
        pending.map(
          (img) =>
            new Promise((resolve) => {
              img.addEventListener("load", resolve, { once: true });
              img.addEventListener("error", resolve, { once: true });
            })
        )
      ),
      wait(1800),
    ]);
    await wait(180);
  }

  function isLessonImage(img) {
    if (!img || img.closest(".watermark-layer, .brand, .reader-sidebar, dialog:not([open])")) return false;
    return Boolean(img.closest(".reader-image, .reader-blocks, .reader-main"));
  }

  function collectDocuments() {
    const docs = [document];
    for (const frame of document.querySelectorAll("iframe")) {
      try {
        if (frame.contentDocument) docs.push(frame.contentDocument);
      } catch (_error) {
        // Cross-origin lesson frames are unreadable from the page.
      }
    }
    return docs;
  }

  function queryDeep(doc, selector) {
    const found = [];
    const visit = (node) => {
      if (!node || !node.querySelectorAll) return;
      found.push(...node.querySelectorAll(selector));
      for (const el of node.querySelectorAll("*")) {
        if (el.shadowRoot) visit(el.shadowRoot);
      }
    };
    visit(doc);
    return found;
  }

  function shown(el) {
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = el.getBoundingClientRect();
    return rect.width >= 2 && rect.height >= 2;
  }

  async function captureViewport() {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const candidates = [];
    const elements = new Map();
    let index = 0;
    for (const doc of collectDocuments()) {
      for (const img of queryDeep(doc, "img")) {
        if (!shown(img)) continue;
        const rect = img.getBoundingClientRect();
        const id = `img-${index++}`;
        candidates.push({
          id: id,
          alt: img.alt || "",
          src: img.currentSrc || img.src || "",
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          preferred: isLessonImage(img),
        });
        elements.set(id, img);
      }
      for (const canvas of queryDeep(doc, "canvas")) {
        if (!shown(canvas) || canvas.closest(".watermark-layer")) continue;
        const rect = canvas.getBoundingClientRect();
        const id = `canvas-${index++}`;
        candidates.push({
          id: id,
          alt: "",
          src: "",
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          preferred: Boolean(canvas.closest(".reader-main, .reader-blocks, .mermaid-canvas")),
        });
        elements.set(id, canvas);
      }
    }

    const selected = selectApi.selectLessonImages(candidates, viewport);
    const images = [];
    for (const item of selected) {
      const el = elements.get(item.id);
      try {
        const dataUrl = await rasterize(el, item, viewport);
        if (dataUrl) images.push({ dataUrl: dataUrl });
      } catch (_error) {
        // Skip a single unreadable picture and keep going.
      }
    }

    return {
      ok: true,
      title: lessonTitle(),
      url: publicUrl(),
      headings: visibleHeadings(),
      visibleText: visibleText(),
      images: images,
    };
  }

  function visibleHeadings() {
    return Array.from(document.querySelectorAll(".lesson-header h1, .reader-blocks h2, .reader-blocks h3"))
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.bottom > 0 && rect.top < window.innerHeight;
      })
      .map((el) => el.innerText.trim())
      .filter(Boolean)
      .slice(0, 6);
  }

  function visibleText() {
    const root = document.querySelector(".reader-blocks");
    if (!root) return "";
    const parts = [];
    let count = 0;
    for (const el of root.children) {
      if (el.classList.contains("watermark-layer")) continue;
      const rect = el.getBoundingClientRect();
      if (rect.bottom < 24 || rect.top > window.innerHeight - 8) continue;
      const text = (el.innerText || "").replace(/\n{3,}/g, "\n\n").trim();
      if (!text) continue;
      parts.push(text);
      count += text.length;
      if (count > 1800) break;
    }
    return parts.join("\n\n").slice(0, 1800);
  }

  async function rasterize(el, item, viewport) {
    const slice = selectApi.visibleSlice(item, viewport);
    if (slice.width < 8 || slice.height < 8) return "";
    const source = await loadSource(el);
    const natural = naturalSize(el, source, item);
    const scaleX = item.width > 0 ? natural.width / item.width : 1;
    const scaleY = item.height > 0 ? natural.height / item.height : 1;
    const sendWhole = slice.ratio >= 0.75;
    const sx = sendWhole ? 0 : clamp(slice.offsetX * scaleX, 0, natural.width - 1);
    const sy = sendWhole ? 0 : clamp(slice.offsetY * scaleY, 0, natural.height - 1);
    const sw = sendWhole ? natural.width : clamp(slice.width * scaleX, 1, natural.width - sx);
    const sh = sendWhole ? natural.height : clamp(slice.height * scaleY, 1, natural.height - sy);
    return drawScaled(source, sx, sy, sw, sh, 1400, 1800, 0.74);
  }

  function naturalSize(el, source, item) {
    if (el.tagName === "CANVAS") return { width: el.width || item.width, height: el.height || item.height };
    if (source instanceof ImageBitmap) return { width: source.width, height: source.height };
    const width = el.naturalWidth || source.width || item.width;
    const height = el.naturalHeight || source.height || item.height;
    return { width: width, height: height };
  }

  async function loadSource(el) {
    if (el.tagName === "CANVAS") return el;
    if (canDraw(el)) return el;
    const src = el.currentSrc || el.src || "";
    if (!src) throw new Error("图片没有地址");
    if (src.startsWith("blob:") || src.startsWith("data:")) {
      const response = await fetch(src);
      return createImageBitmap(await response.blob());
    }
    const absolute = new URL(src, location.href).href;
    const fetched = await chrome.runtime.sendMessage({ type: "fetch-image", url: absolute });
    if (!fetched || !fetched.ok) throw new Error((fetched && fetched.error) || "读不到课件图");
    const binary = atob(fetched.base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return createImageBitmap(new Blob([bytes], { type: fetched.mime || "image/jpeg" }));
  }

  function canDraw(img) {
    try {
      const probe = document.createElement("canvas");
      probe.width = 1;
      probe.height = 1;
      probe.getContext("2d", { willReadFrequently: true }).drawImage(img, 0, 0, 1, 1);
      return true;
    } catch (_error) {
      return false;
    }
  }

  function drawScaled(source, sx, sy, sw, sh, maxW, maxH, quality) {
    const scale = Math.min(1, maxW / sw, maxH / sh);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sw * scale));
    canvas.height = Math.max(1, Math.round(sh * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL("image/jpeg", quality);
    if (url.length > 900000 && quality > 0.5) {
      return drawScaled(source, sx, sy, sw, sh, 1100, 1400, 0.5);
    }
    return url;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }
})();
