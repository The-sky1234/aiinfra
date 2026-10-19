const test = require("node:test");
const assert = require("node:assert/strict");
const { selectLessonImages, visibleSlice } = require("../src/select-images.js");
const { buildMessages, SYSTEM } = require("../src/prompt.js");

const viewport = { width: 1200, height: 800 };

test("keeps lesson images on screen and drops icons", () => {
  const selected = selectLessonImages(
    [
      { id: "logo", src: "/logo.svg", alt: "logo", top: 0, left: 0, width: 180, height: 180, preferred: false },
      { id: "below", src: "/page-9.png", alt: "", top: 1400, left: 80, width: 800, height: 1000, preferred: true },
      { id: "page", src: "/page-3.png", alt: "kernel", top: 120, left: 80, width: 820, height: 1100, preferred: true },
      { id: "caption-icon", src: "/badge.png", alt: "badge", top: 200, left: 20, width: 200, height: 200, preferred: true },
    ],
    viewport
  );
  assert.deepEqual(selected.map((item) => item.id), ["page"]);
});

test("orders two visible figures from top to bottom", () => {
  const selected = selectLessonImages(
    [
      { id: "lower", src: "/b.png", alt: "", top: 420, left: 40, width: 700, height: 360, preferred: true },
      { id: "upper", src: "/a.png", alt: "", top: 40, left: 40, width: 700, height: 360, preferred: true },
    ],
    viewport
  );
  assert.deepEqual(selected.map((item) => item.id), ["upper", "lower"]);
});

test("crops a tall scan to the visible slice", () => {
  const slice = visibleSlice({ top: -400, left: 100, width: 800, height: 2000 }, viewport);
  assert.equal(slice.offsetY, 400);
  assert.ok(slice.ratio < 0.75);
  assert.equal(slice.height, 800);
});

test("explanation prompt refuses a long verbatim copy", () => {
  const built = buildMessages({
    title: "第 4 课",
    url: "https://everythingai.top/learn/ai-systems-performance-engineering-text/lesson-04",
    headings: ["Roofline"],
    visibleText: "一张很短的图注",
    screenIndex: 2,
  });
  assert.match(SYSTEM, /不要把画面里的长段落原样抄下来/);
  assert.match(built.userText, /Roofline/);
  assert.match(built.userText, /第 2 屏/);
  assert.equal(built.userText.includes("password"), false);
});
