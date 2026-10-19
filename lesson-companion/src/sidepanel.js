const MAX_SCREENS = 24;
const PRESETS = {
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  qwen: { baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-vl-plus" },
  ollama: { baseUrl: "http://127.0.0.1:11434/v1", model: "qwen2.5vl" },
};

const statusNode = document.querySelector("#status");
const logNode = document.querySelector("#log");
const setupNode = document.querySelector("#setup");
const baseUrlInput = document.querySelector("#base-url");
const modelInput = document.querySelector("#model");
const apiKeyInput = document.querySelector("#api-key");
const presetInput = document.querySelector("#preset");
const readButton = document.querySelector("#read");
const continueButton = document.querySelector("#continue");
const stopButton = document.querySelector("#stop");
const questionInput = document.querySelector("#question");

let running = false;
let stopRequested = false;
let lastCapture = null;
let lastAnswer = "";
const seen = new Set();

document.querySelector("#toggle-setup").addEventListener("click", () => {
  const hidden = setupNode.hasAttribute("hidden");
  if (hidden) setupNode.removeAttribute("hidden");
  else setupNode.setAttribute("hidden", "");
  document.querySelector("#toggle-setup").textContent = hidden ? "收起" : "展开";
});

presetInput.addEventListener("change", () => {
  const preset = PRESETS[presetInput.value];
  if (!preset) return;
  baseUrlInput.value = preset.baseUrl;
  modelInput.value = preset.model;
});

document.querySelector("#save").addEventListener("click", async () => {
  const baseUrl = baseUrlInput.value.trim().replace(/\/$/, "");
  const model = modelInput.value.trim();
  let origin = "";
  try {
    origin = new URL(baseUrl).origin;
  } catch (_error) {
    setStatus("接口地址要像 https://api.openai.com/v1 这样。");
    return;
  }
  if (!model) {
    setStatus("先写模型名。必须是能看图的模型。");
    return;
  }
  const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
  if (!granted) {
    setStatus("没有允许扩展访问这个模型接口。");
    return;
  }
  await chrome.storage.local.set({
    baseUrl: baseUrl,
    model: model,
    apiKey: apiKeyInput.value.trim(),
    preset: presetInput.value,
  });
  setStatus("模型已保存。回到课文页，点「讲解这一屏」。");
});

readButton.addEventListener("click", () => runOnce(false));
continueButton.addEventListener("click", () => runOnce(true));
stopButton.addEventListener("click", () => {
  stopRequested = true;
  setStatus("这一屏结束后就停。");
});

document.querySelector("#ask").addEventListener("submit", async (event) => {
  event.preventDefault();
  const question = questionInput.value.trim();
  if (!question || running) return;
  if (!lastCapture) {
    setStatus("还没有读过屏幕。先点「讲解这一屏」。");
    return;
  }
  questionInput.value = "";
  append("你", question, "user");
  running = true;
  readButton.disabled = true;
  continueButton.disabled = true;
  try {
    await speak(lastCapture, question, 0);
  } catch (error) {
    append("伴读", error.message || "追问失败", "error");
    setStatus(error.message || "追问失败");
  } finally {
    running = false;
    readButton.disabled = false;
    continueButton.disabled = false;
  }
});

restore().catch((error) => setStatus(error.message));

async function restore() {
  const saved = await chrome.storage.local.get(["baseUrl", "model", "apiKey", "preset"]);
  if (saved.preset) presetInput.value = saved.preset;
  if (saved.baseUrl) baseUrlInput.value = saved.baseUrl;
  if (saved.model) modelInput.value = saved.model;
  if (saved.apiKey) apiKeyInput.value = saved.apiKey;
  if (saved.baseUrl && saved.model) setupNode.setAttribute("hidden", "");
}

async function runOnce(continuous) {
  if (running) return;
  running = true;
  stopRequested = false;
  setBusy(true);
  try {
    await ensureSettings();
    if (!continuous) {
      const capture = await sendToLesson("capture");
      assertCapture(capture);
      await speak(capture, "", 0);
      return;
    }

    let screens = 0;
    let stale = 0;
    let first = true;
    while (!stopRequested && screens < MAX_SCREENS && stale < 3) {
      const advance = !first;
      first = false;
      const capture = await sendToLesson(advance ? "advance" : "capture");
      assertCapture(capture);
      if (advance && capture.moved === false) {
        setStatus("这一课已经读到底了。");
        break;
      }
      const freshImages = capture.images.filter((image) => !seen.has(fingerprint(image.dataUrl)));
      const textKey = fingerprint(`text:${capture.visibleText}`);
      const freshText = Boolean(capture.visibleText) && !seen.has(textKey);
      if (freshImages.length || freshText) {
        stale = 0;
        screens += 1;
        await speak({ ...capture, images: freshImages }, "", screens);
        freshImages.forEach((image) => seen.add(fingerprint(image.dataUrl)));
        if (capture.visibleText) seen.add(textKey);
      } else {
        stale += 1;
        setStatus("这一屏和刚才重复，继续往下找。");
      }
      if (capture.atEnd) {
        setStatus("这一课已经读到底了。");
        break;
      }
    }
    if (stopRequested) setStatus("已停。");
    else if (screens >= MAX_SCREENS) {
      setStatus(`先讲了 ${MAX_SCREENS} 屏。还想往下，就再点一次「从这里往下讲」。`);
    } else if (stale >= 3) setStatus("往下几屏没有新的课件，先停在这里。");
  } catch (error) {
    append("伴读", error.message || "讲解失败", "error");
    setStatus(error.message || "讲解失败");
  } finally {
    running = false;
    setBusy(false);
  }
}

function assertCapture(capture) {
  if (!capture || !capture.ok) throw new Error((capture && capture.error) || "读不到这一屏");
}

async function speak(capture, question, screenIndex) {
  if (!capture.images.length && !capture.visibleText) {
    setStatus("这一屏没有课件图，也没有课文。滚到有内容的位置再试。");
    return;
  }
  const built = LessonPrompt.buildMessages({
    title: capture.title,
    url: capture.url,
    headings: capture.headings,
    visibleText: capture.visibleText,
    previous: question ? lastAnswer.slice(0, 1500) : "",
    question: question,
    screenIndex: screenIndex || undefined,
  });
  const label = question ? "追问" : screenIndex ? `第 ${screenIndex} 屏` : "这一屏";
  setStatus(`正在看${label}，图 ${capture.images.length} 张。`);
  const answer = await callModel(built.system, built.userText, capture.images);
  lastCapture = capture;
  lastAnswer = answer;
  append(label, answer, "");
  setStatus(`${label}讲完了。可以追问，也可以往下讲。`);
}

async function callModel(system, userText, images) {
  const settings = await chrome.storage.local.get(["baseUrl", "model", "apiKey"]);
  const endpoint = settings.baseUrl.endsWith("/chat/completions")
    ? settings.baseUrl
    : `${settings.baseUrl}/chat/completions`;
  const content = [{ type: "text", text: userText }];
  for (const image of images) {
    content.push({ type: "image_url", image_url: { url: image.dataUrl } });
  }
  const headers = { "Content-Type": "application/json" };
  if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
  const timeout = AbortSignal.timeout ? AbortSignal.timeout(90000) : undefined;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: headers,
    signal: timeout,
    body: JSON.stringify({
      model: settings.model,
      temperature: 0.3,
      max_tokens: 1400,
      messages: [
        { role: "system", content: system },
        { role: "user", content: content },
      ],
    }),
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(redact(`模型接口返回 ${response.status}：${raw.slice(0, 280)}`, settings.apiKey));
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (_error) {
    throw new Error("模型没有返回 JSON。确认接口是 OpenAI 兼容的 /chat/completions。");
  }
  const text = data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : "";
  if (!text || typeof text !== "string") throw new Error("模型没有写出讲解。");
  return text.trim();
}

async function ensureSettings() {
  const settings = await chrome.storage.local.get(["baseUrl", "model"]);
  if (!settings.baseUrl || !settings.model) {
    setupNode.removeAttribute("hidden");
    throw new Error("先保存一个能看图的模型。");
  }
}

async function sendToLesson(type) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id || !tab.url || !tab.url.startsWith("https://everythingai.top/learn/")) {
    throw new Error("当前标签不是 EverythingAI 的课文页。");
  }
  try {
    return await chrome.tabs.sendMessage(tab.id, { type: type });
  } catch (_error) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["src/select-images.js", "src/content.js"],
    });
    return chrome.tabs.sendMessage(tab.id, { type: type });
  }
}

function fingerprint(value) {
  return `${value.length}:${value.slice(80, 140)}:${value.slice(-80)}`;
}

function append(title, text, kind) {
  const item = document.createElement("article");
  item.className = `bubble ${kind || ""}`.trim();
  const heading = document.createElement("h3");
  heading.textContent = title;
  const body = document.createElement("div");
  body.textContent = text;
  item.append(heading, body);
  logNode.append(item);
  item.scrollIntoView({ block: "end" });
}

function setStatus(text) {
  statusNode.textContent = text;
}

function setBusy(busy) {
  readButton.disabled = busy;
  continueButton.disabled = busy;
  stopButton.disabled = !busy;
}

function redact(text, secret) {
  if (!secret) return text;
  return text.split(secret).join("（密钥已隐藏）");
}
