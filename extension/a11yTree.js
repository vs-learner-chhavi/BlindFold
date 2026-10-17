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
  const rawName = accessibleName(el);
  const sensitive = isSensitiveField(el);
  const name = sensitive ? "[sensitive field]" : rawName;

  const tabindex = el.getAttribute("tabindex");
  const nativeFocusable = /^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/i.test(
    el.tagName
  );

  const role = el.getAttribute("role") || el.tagName.toLowerCase();

  return {
    role,
    name: name || "",
    unnamed: !rawName.trim() && !sensitive,
    nameRedacted: sensitive,
    keyboardReachable:
      nativeFocusable ||
      (tabindex !== null && Number(tabindex) >= 0),

    hasMouseHandler:
      el.hasAttribute("onclick") ||
      typeof el.onclick === "function",

    state: {
      disabled:
        !!el.disabled ||
        el.getAttribute("aria-disabled") === "true",

      readonly:
        !!el.readOnly ||
        el.getAttribute("aria-readonly") === "true",

      expanded: el.getAttribute("aria-expanded"),
      checked: el.getAttribute("aria-checked"),
      selected: el.getAttribute("aria-selected"),
      pressed: el.getAttribute("aria-pressed"),
      required:
        !!el.required ||
        el.getAttribute("aria-required") === "true",
      invalid: el.getAttribute("aria-invalid"),
    },
  };
}

function buildNearbyTree(limit = 50) {
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