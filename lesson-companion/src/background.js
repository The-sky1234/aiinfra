chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "fetch-image") return;
  const url = safeImageUrl(message.url);
  if (!url) {
    sendResponse({ ok: false, error: "只读取课程网站上的课件图" });
    return;
  }
  fetch(url, { credentials: "include" })
    .then(async (response) => {
      if (!response.ok) throw new Error(`课件图请求失败（${response.status}）`);
      const blob = await response.blob();
      if (!blob.type.startsWith("image/")) throw new Error("返回的不是图片");
      const bytes = new Uint8Array(await blob.arrayBuffer());
      sendResponse({ ok: true, mime: blob.type, base64: bytesToBase64(bytes) });
    })
    .catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : "读不到课件图" });
    });
  return true;
});

function safeImageUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "everythingai.top") return "";
    return url.href;
  } catch (_error) {
    return "";
  }
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
