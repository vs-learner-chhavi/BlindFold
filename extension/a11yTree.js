// Collects interactive elements near the focused element: role, name, state.
// Never reads field values.

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
    role: el.getAttribute("role") || el.tagName.toLowerCase(),
    name: isSensitiveField(el) ? "[sensitive field]" : name,
    unnamed: name === "",                       // key evidence for "button with no name"
    keyboardReachable: nativeFocusable || (tabindex !== null && Number(tabindex) >= 0),
    hasMouseHandler: el.hasAttribute("onclick"),
    state: {
      disabled: !!el.disabled,
      readonly: !!el.readOnly,
      expanded: el.getAttribute("aria-expanded"),
    },
  };
}

function buildNearbyTree(limit = 25) {
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