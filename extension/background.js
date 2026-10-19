// Blindfold background service worker (Task 2.1 + 2.2)
// Listens for the help shortcut and tells the active tab's content script.

importScripts("api.js");

chrome.runtime.onInstalled.addListener(() => console.log("[Blindfold] Extension installed."));

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "trigger-help") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "HELP_REQUESTED" });
  } catch (err) {
    console.warn("[Blindfold] Could not reach the page:", err.message);
  }
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type !== "GOAL_READY") return;
  const tabId = sender.tab && sender.tab.id;
  sendRescueRequest(message.snapshot, message.goal)
    .then((session) => {
      console.log("[Blindfold] Session created:", session);
      if (tabId) chrome.tabs.sendMessage(tabId, { type: "SESSION_STARTED", session });
    })
    .catch((e) => {
      console.warn("[Blindfold] Backend not reachable:", e.message);
      if (e && e.message === "LIMIT") {
        if (tabId) chrome.tabs.sendMessage(tabId, { type: "SESSION_LIMIT" });
        return;
      }
      if (tabId) chrome.tabs.sendMessage(tabId, { type: "SESSION_FAILED" });
    });
});

// Content scripts talk to the local backend only through this proxy, and only on these routes.
const BF_ALLOWED_ROUTES = [/^GET \/status\/[\w-]+$/, /^POST \/next\/[\w-]+$/];

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "BF_TAB_ID") {
    sendResponse({ tabId: sender.tab ? sender.tab.id : null });
    return false;
  }
  if (message.type !== "BF_API") return false;

  const method = String(message.method || "GET").toUpperCase();
  const path = String(message.path || "");
  if (!sender.tab || !BF_ALLOWED_ROUTES.some((re) => re.test(method + " " + path))) {
    sendResponse({ ok: false, status: 403 });
    return false;
  }
  fetch(BACKEND_URL + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: method === "POST" ? JSON.stringify(message.body || {}) : undefined,
  })
    .then(async (res) => {
      let data = null;
      try { data = await res.json(); } catch (e) {}
      sendResponse({ ok: res.ok, status: res.status, data });
    })
    .catch(() => sendResponse({ ok: false, status: 0 }));
  return true; // keep the channel open for the async response
});
