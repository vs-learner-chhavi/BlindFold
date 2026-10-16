// Blindfold content script (runs inside the web page)
// For now it only proves the shortcut reaches the page.
// Snapshot capture (sensitive filter, focused element, accessibility tree) comes next.

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "HELP_REQUESTED") {
    const snapshot = buildSnapshot();   // BEFORE the dialog moves focus
    openGoalDialog(snapshot);
    sendResponse({ ok: true });
  }
  if (message.type === "SESSION_STARTED") announce("Request sent. Working on it.");
  if (message.type === "SESSION_FAILED") announce("I couldn't reach the server. Nothing was submitted.");
  return true;
});

function announce(text) {
  speak(text);
  let region = document.getElementById("blindfold-live-region");
  if (!region) {
    region = document.createElement("div");
    region.id = "blindfold-live-region";
    region.setAttribute("role", "status");
    region.setAttribute("aria-live", "polite");
    region.style.cssText = "position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden;";
    document.body.appendChild(region);
  }
  region.textContent = "";
  setTimeout(() => (region.textContent = text), 50);
}