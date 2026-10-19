(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.LessonPrompt = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const SYSTEM = [
    "你是「课文伴读」，坐在读者旁边，用通俗中文讲他正在看的这一屏。",
    "读者已经打开了自己的课程。画面经常是课件图，偶尔带少量标题或图注。",
    "先给一句结论，说明这一屏在讲什么。",
    "再把关键概念用日常的话讲清楚。有公式、箭头、代码或架构图时，逐个说明它们在干什么。",
    "补一个具体的小例子，帮助读者把这屏和前面的概念接上。",
    "最后留一个自测小问题，并在单独一行写出简短答案。",
    "看不清的地方直接说看不清，不要编造图里没有的数字或结论。",
    "用自己的话讲。不要把画面里的长段落原样抄下来。",
    "如果读者是在追问，就紧扣他的问题回答，不必再套一整套结构。",
  ].join("\n");

  function buildMessages(input) {
    const lines = [
      `课文：${input.title || "未命名"}`,
      `页面：${input.url || ""}`,
    ];
    if (input.screenIndex) {
      lines.push(`这是连续讲解里的第 ${input.screenIndex} 屏。`);
    }
    if (input.headings && input.headings.length) {
      lines.push(`屏幕上的标题：${input.headings.join(" / ")}`);
    }
    if (input.visibleText) {
      lines.push(`这一屏旁边能读到的短文字（只是辅助，以课件图为准）：\n${input.visibleText}`);
    }
    if (input.previous) {
      lines.push(`上一屏的讲解：\n${input.previous}`);
    }
    lines.push(input.question || "请讲解这一屏。");
    return {
      system: SYSTEM,
      userText: lines.join("\n\n"),
    };
  }

  return {
    SYSTEM: SYSTEM,
    buildMessages: buildMessages,
  };
});
