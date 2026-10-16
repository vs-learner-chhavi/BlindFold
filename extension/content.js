// Blindfold content script (runs inside the web page)
// For now it only proves the shortcut reaches the page.
// Snapshot capture (sensitive filter, focused element, accessibility tree) comes next.

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "HELP_REQUESTED") {
    console.log("[Blindfold] Help requested on:", location.href);
    console.log("[Blindfold] Focused element:", document.activeElement);

    // Screen-reader announcement without stealing focus
    announce("Blindfold ready. What do you need help with?");

    sendResponse({ ok: true, url: location.href });
  }
  return true;
});

// Polite live region so screen readers announce status without moving focus
function announce(text) {
  let region = document.getElementById("blindfold-live-region");
  if (!region) {
    region = document.createElement("div");
    region.id = "blindfold-live-region";
    region.setAttribute("role", "status");
    region.setAttribute("aria-live", "polite");
    region.style.cssText =
      "position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden;";
    document.body.appendChild(region);
  }
  region.textContent = "";
  setTimeout(() => (region.textContent = text), 50);
}