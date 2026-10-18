function accessibleName(el) {
  if (el.matches && el.matches("[role=dialog], dialog, [role=main], main, form")) {
    const by = el.getAttribute("aria-labelledby");
    const t = el.getAttribute("aria-label") || (by && (document.getElementById(by) || {}).innerText) || "";
    return t.trim().slice(0, 100);
  }
  if (!el) return "";
  const label =
    el.getAttribute("aria-label") ||
    (el.labels && el.labels[0] && el.labels[0].innerText) ||
    el.getAttribute("title") ||
    el.getAttribute("placeholder") ||
    el.innerText ||
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
    id: elId(el),
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

const TRACKING = /^(utm_|gclid$|gbraid$|wbraid$|gad_|fbclid$|msclkid$|referrer$|singular_)/i;
function cleanUrl(href) {
  try {
    const u = new URL(href);
    Array.from(u.searchParams.keys()).forEach((k) => { if (TRACKING.test(k)) u.searchParams.delete(k); });
    u.hash = "";
    return u.toString();
  } catch (e) {
    return location.origin + location.pathname;
  }
}

function buildSnapshot() {
  const nearbyTree = buildNearbyTree();
  const f = describeElement(document.activeElement);
  return {
    pageUrl: cleanUrl(location.href),
    pageTitle: document.title,
    headings: Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6,[role=heading]"))
    .slice(0, 20).map((h) => ({ id: elId(h), role: "heading", name: "section heading" })),
    focusedElement: describeElement(document.activeElement),
    nearbyTree,
    safeValues: getSafeValues(),
    situation: describeSituation(nearbyTree),
    capturedAt: new Date().toISOString(),
    focusHistory: focusHistory.slice(),
    announcement: f ? (f.name ? f.role + ", " + f.name : f.role) : "",
  };
}