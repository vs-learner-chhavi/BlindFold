// Collects interactive elements near the focused element: role, name, state.
// Never reads field values.

// ---- stable element ids and Tab history (used by reports) ----
const _ids = new WeakMap();
let _n = 0;
function elId(el) {
  if (!el) return null;
  if (!_ids.has(el)) _ids.set(el, "e" + (++_n));
  return _ids.get(el);
}
const focusHistory = [];
document.addEventListener("focusin", (e) => {
  if (e.target.closest && e.target.closest("#blindfold-dialog")) return;
  const id = elId(e.target);
  if (id && focusHistory[focusHistory.length - 1] !== id) {
    focusHistory.push(id);
    if (focusHistory.length > 30) focusHistory.shift();
  }
}, true);

const INTERACTIVE =
  'a[href], button, input, select, textarea, [role], [tabindex], [onclick]';

function findContainer(start) {
  if (!start || start === document.body) {
    return document.querySelector("[role=dialog], dialog[open], form") || document.body;
  }
  const known = start.closest("form, [role=dialog], dialog, main, [role=main]");
  if (known) return known;
  let el = start;
  for (let i = 0; i < 8 && el.parentElement && el.parentElement !== document.body; i++) {
    el = el.parentElement;
  }
  return el;
}

function isVisible(el) {
  const r = el.getBoundingClientRect();
  const s = getComputedStyle(el);
  return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
}

function describeNode(el) {
  const name = accessibleName(el);
  const tabindex = el.getAttribute("tabindex");
  const nativeFocusable = /^(a|button|input|select|textarea)$/i.test(el.tagName);
  return {
    id: elId(el),
    containsImage: !!el.querySelector("img, svg"),
    role: el.getAttribute("role") || el.tagName.toLowerCase(),
    name: isSensitiveField(el) ? "[sensitive field]" : name,
    unnamed: name === "",
    keyboardReachable: nativeFocusable || (tabindex !== null && Number(tabindex) >= 0),
    hasMouseHandler: el.hasAttribute("onclick"),
    state: {
      disabled: !!el.disabled,
      readonly: !!el.readOnly,
      expanded: el.getAttribute("aria-expanded"),
    },
  };
}

function buildNearbyTree(limit = 45) {
  const root = findContainer(document.activeElement);
  const nodes = [];
  root.querySelectorAll(INTERACTIVE).forEach((el) => {
    if (nodes.length >= limit || !isVisible(el)) return;
    const role = el.getAttribute("role") || "";
    if (/^(main|navigation|banner|region)$/.test(role)) return;
    const node = describeNode(el);
    if (node.role === "img" && !node.unnamed) return; // keep only unlabeled images
    nodes.push(node);
  });
  return nodes;
}

// Used when nothing useful has focus: scans what is on screen for blocked controls.
function scanPageProblems() {
  const out = { unnamed: 0, mouseOnly: 0, readonlyFields: 0, dialog: "", items: [] };
  const inView = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && isVisible(el);
  };

  const dlg = document.querySelector("[role=dialog], dialog[open]");
  if (dlg && isVisible(dlg) && !dlg.closest("#blindfold-dialog") && dlg.id !== "blindfold-dialog") {
    const label = (dlg.getAttribute("aria-label") || "").trim();
    const isCal = /(January|February|March|April|May|June|July|August|September|October|November|December)\s+20\d\d/i.test((dlg.innerText || "").slice(0, 400));
    out.dialog = label || (isCal ? "calendar" : "dialog");
  }

  document.querySelectorAll("button, a[href], input, select, textarea, [role=button]").forEach((el) => {
    if (el.closest("#blindfold-dialog")) return;
    if (!inView(el) || isSensitiveField(el)) return;
    if (el.tagName === "INPUT" && /^(hidden|submit|button|reset|image|checkbox|radio)$/i.test(el.type)) return;
    if (!accessibleName(el)) out.unnamed++;
    if (el.readOnly) out.readonlyFields++;
  });

  // Mouse-only items: pointer cursor but not a link, button or tabbable element.
  // This also catches clicks attached in JavaScript.
  let checked = 0;
  document.querySelectorAll("div, span, li, td, img, svg").forEach((el) => {
    if (checked > 600 || out.items.length >= 12) return;
    checked++;
    if (el.closest("#blindfold-dialog")) return;
    if (!inView(el) || el.closest("a[href], button, [role=button], [tabindex]")) return;
    if (el.children.length > 3) return;
    if (getComputedStyle(el).cursor !== "pointer") return;
    if (el.parentElement && getComputedStyle(el.parentElement).cursor === "pointer") return;
    const name = ((el.innerText || el.getAttribute("alt") || "") + "").trim().slice(0, 40);
    out.mouseOnly++;
    out.items.push({
      id: elId(el),
      role: "clickable", name, unnamed: name === "",
      keyboardReachable: false, hasMouseHandler: true, inferred: true,
      state: { disabled: false, readonly: false, expanded: null },
    });
  });
  return out;
}