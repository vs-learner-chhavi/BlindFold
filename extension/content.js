// Blindfold content script (runs inside the web page)
// Routes shortcut / session messages to the goal dialog and the agent loop (loop.js).

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "HELP_REQUESTED") {
    if (bfLoop.active) {
      announce("I'm already working on a request. Press Escape to stop it.");
    } else {
      const snapshot = buildSnapshot();   // BEFORE the dialog moves focus
      openGoalDialog(snapshot);
    }
    sendResponse({ ok: true });
  }
  if (message.type === "SESSION_STARTED") startAgentLoop(message.session);
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

// If the last approved click navigated this tab, pick the loop back up on the new page.
bfResumeIfPending();
