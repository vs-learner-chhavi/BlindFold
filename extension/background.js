// Blindfold background service worker (Task 2.1 + 2.2)
// Listens for the help shortcut and tells the active tab's content script.

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
    console.log("[Blindfold] Content script replied:", response);
  } catch (err) {
    // Happens on pages where content scripts can't run (chrome:// pages, web store)
    console.warn("[Blindfold] Could not reach the page:", err.message);
  }
});