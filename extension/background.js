// Blindfold background service worker (Task 2.1 + 2.2)
// Listens for the help shortcut and tells the active tab's content script.

importScripts("api.js");
chrome.runtime.onInstalled.addListener(() => {
  console.log("[Blindfold] Extension installed.");
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "trigger-help") return;

  console.log("[Blindfold] Help shortcut pressed.");

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    console.warn("[Blindfold] No active tab found.");
    return;
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "HELP_REQUESTED" });
    if (response && response.snapshot) {
      try {
        const session = await sendRescueRequest(response.snapshot, "TEST: help me on this page");
        console.log("[Blindfold] Session created:", session);
      } catch (e) {
      console.warn("[Blindfold] Backend not reachable yet:", e.message);
      }
    }
  } catch (err) {
    // Happens on pages where content scripts can't run (chrome:// pages, web store)
    console.warn("[Blindfold] Could not reach the page:", err.message);
  }
});