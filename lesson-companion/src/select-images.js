(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.LessonSelect = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const MIN_EDGE = 140;
  const MIN_VISIBLE = 100;
  const MAX_IMAGES = 4;

  function intersectionRatio(rect, viewport) {
    const left = Math.max(0, rect.left);
    const top = Math.max(0, rect.top);
    const right = Math.min(viewport.width, rect.left + rect.width);
    const bottom = Math.min(viewport.height, rect.top + rect.height);
    const width = Math.max(0, right - left);
    const height = Math.max(0, bottom - top);
    const area = rect.width * rect.height;
    if (area <= 0) return 0;
    return (width * height) / area;
  }

  function visibleSlice(rect, viewport) {
    const left = Math.max(rect.left, 0);
    const top = Math.max(rect.top, 0);
    const right = Math.min(rect.left + rect.width, viewport.width);
    const bottom = Math.min(rect.top + rect.height, viewport.height);
    const width = Math.max(0, right - left);
    const height = Math.max(0, bottom - top);
    const area = rect.width * rect.height;
    return {
      offsetX: left - rect.left,
      offsetY: top - rect.top,
      width: width,
      height: height,
      ratio: area > 0 ? (width * height) / area : 0,
    };
  }

  function isDecorative(item) {
    const hint = `${item.alt || ""} ${item.src || ""}`.toLowerCase();
    return /(logo|icon|avatar|favicon|sprite|badge|watermark)/.test(hint);
  }

  function selectLessonImages(candidates, viewport) {
    const preferredExists = candidates.some((item) => item && item.preferred);
    const picked = [];
    for (const item of candidates) {
      if (!item || item.width < MIN_EDGE || item.height < MIN_EDGE) continue;
      if (preferredExists && !item.preferred) continue;
      if (isDecorative(item)) continue;
      const ratio = intersectionRatio(item, viewport);
      const visibleHeight =
        Math.min(item.top + item.height, viewport.height) - Math.max(item.top, 0);
      const visibleWidth =
        Math.min(item.left + item.width, viewport.width) - Math.max(item.left, 0);
      const visibleEnough =
        ratio >= 0.18 || (visibleHeight >= MIN_VISIBLE && visibleWidth >= MIN_EDGE);
      if (!visibleEnough) continue;
      picked.push(item);
    }
    picked.sort((a, b) => a.top - b.top || a.left - b.left || b.width * b.height - a.width * a.height);
    return picked.slice(0, MAX_IMAGES);
  }

  return {
    MIN_EDGE: MIN_EDGE,
    MAX_IMAGES: MAX_IMAGES,
    intersectionRatio: intersectionRatio,
    visibleSlice: visibleSlice,
    selectLessonImages: selectLessonImages,
  };
});
