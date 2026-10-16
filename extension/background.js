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
      if (tabId) chrome.tabs.sendMessage(tabId, { type: "SESSION_FAILED" });
    });
});