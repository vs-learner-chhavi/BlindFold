function accessibleName(el) {
  if (!el) return "";
  const label =
    el.getAttribute("aria-label") ||
    (el.labels && el.labels[0] && el.labels[0].innerText) ||
    el.getAttribute("title") ||
    el.getAttribute("placeholder") ||
    el.innerText ||
    el.name ||
    "";
  return label.trim().slice(0, 100);
}

function describeElement(el) {
  if (!el || el === document.body) return null;
  return {
    role: el.getAttribute("role") || el.tagName.toLowerCase(),
    name: accessibleName(el),
    state: {
      disabled: el.disabled || false,
      readonly: el.readOnly || false,
      expanded: el.getAttribute("aria-expanded"),
      checked: el.checked ?? null,
    },
  };
}

function getSafeValues() {
  const out = [];
  document.querySelectorAll("input, select, textarea").forEach((el) => {
    if (isSensitiveField(el)) return;
    const value = (el.value || "").trim();
    if (!value) return;
    out.push({ field: accessibleName(el), value: value.slice(0, 100) });
  });
  return out.slice(0, 30);
}

function buildSnapshot() {
  return {
    pageUrl: location.href,
    pageTitle: document.title,
    focusedElement: describeElement(document.activeElement),
    nearbyTree: buildNearbyTree(),
    safeValues: getSafeValues(),
    capturedAt: new Date().toISOString(),
  };
}