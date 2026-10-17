// Blindfold targets (content script).
// Builds a registry of live, actionable elements with short-lived ids ("bf-12").
// The planner can only choose from these ids, and every id is re-validated against the
// live page right before anything is executed. Field VALUES are never collected here.

const BF_CONSEQUENTIAL =
  /\b(pay|payment|book|buy|purchase|order|checkout|check out|confirm|submit|send|delete|remove|cancel|log ?in|sign ?in|sign ?up|register|proceed|place order|transfer|donate|subscribe|unsubscribe|apply now)\b/i;

const BF_CANDIDATES =
  'a[href], button, input, select, textarea, [role=button], [role=link], [role=option], [role=gridcell], [role=menuitem], [role=tab], [role=checkbox], [role=radio], [role=combobox], [role=textbox], [onclick], [tabindex]';

const bfRegistry = { map: new Map(), seq: 0 };

function bfNorm(s) {
  return String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function bfVisible(el) {
  if (!el || !el.isConnected) return false;
  const r = el.getBoundingClientRect();
  const s = getComputedStyle(el);
  return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0";
}

function bfInViewport(el) {
  const r = el.getBoundingClientRect();
  return r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
}

function bfIsDisabled(el) {
  return !!el.disabled || el.getAttribute("aria-disabled") === "true" || el.closest("fieldset[disabled]") !== null;
}

function bfIsEditable(el) {
  const tag = el.tagName.toLowerCase();
  if (el.readOnly || el.getAttribute("aria-readonly") === "true") return false;
  if (tag === "textarea") return true;
  if (tag === "input") {
    const type = (el.getAttribute("type") || "text").toLowerCase();
    return ["text", "search", "url", "number", "date"].includes(type);
  }
  return false;
}

function bfLabel(el) {
  const tag = el.tagName.toLowerCase();
  let name = accessibleName(el); // capture.js
  if (!name && ["input", "select", "textarea"].includes(tag)) name = visibleLabel(el); // describe.js
  return String(name || "").replace(/\s+/g, " ").trim().slice(0, 80);
}

function bfHint(el) {
  const cls = typeof el.className === "string" ? el.className : "";
  const svgTitle = el.querySelector && el.querySelector("svg title");
  return (svgTitle ? svgTitle.textContent + " " : "") + cls.replace(/[^a-zA-Z ]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 50);
}

// A form that also holds password / card / OTP style fields is a login or payment form.
function bfInSensitiveForm(el) {
  const form = el.closest("form");
  if (!form) return false;
  return Array.from(form.querySelectorAll("input, textarea, select")).some(isSensitiveField);
}

// Local, independent re-check of "would this step change or send something?"
function bfIsConsequential(el) {
  const text = [accessibleName(el), el.getAttribute("title"), el.getAttribute("aria-label"), el.getAttribute("value"), bfHint(el)].join(" ");
  if (BF_CONSEQUENTIAL.test(text)) return true;
  const type = (el.getAttribute("type") || "").toLowerCase();
  const isSubmit = type === "submit" || (el.tagName.toLowerCase() === "button" && type !== "button" && !!el.closest("form"));
  return isSubmit && bfInSensitiveForm(el);
}

function bfKind(el) {
  const tag = el.tagName.toLowerCase();
  const role = (el.getAttribute("role") || "").toLowerCase();
  if (tag === "select") return "select";
  if (tag === "textarea" || tag === "input") return "input";
  if (tag === "a" || role === "link") return "link";
  if (tag === "button" || role === "button") return "button";
  return "other";
}

// Cells of hand-rolled date pickers often react to listeners we cannot see (no onclick attribute).
function bfLooksClickable(el) {
  if (!/^(div|span|li|td|p)$/i.test(el.tagName)) return false;
  const text = bfNorm(el.innerText);
  if (!text || text.length > 30 || el.children.length > 3) return false;
  return getComputedStyle(el).cursor === "pointer";
}

function bfCollectTargets(limit = 90) {
  bfRegistry.map.clear();
  const seen = new Set();
  const found = [];

  const consider = (el) => {
    if (seen.has(el) || found.length >= 400) return;
    seen.add(el);
    if (el.closest("#blindfold-dialog, #blindfold-agent")) return; // never target ourselves
    if (!bfVisible(el) || isSensitiveField(el)) return;
    if (el.tagName.toLowerCase() === "input" && ["hidden", "password", "file"].includes((el.getAttribute("type") || "").toLowerCase())) return;
    found.push(el);
  };

  document.querySelectorAll(BF_CANDIDATES).forEach(consider);
  let scanned = 0;
  for (const el of document.querySelectorAll("div, span, li, td, p")) {
    if (++scanned > 3000) break;
    if (!seen.has(el) && bfLooksClickable(el)) consider(el);
  }

  // Elements inside an open dialog/popup first, then on-screen ones, then the rest.
  const popup = document.querySelector("[role=dialog]:not(#blindfold-dialog):not(#blindfold-agent), dialog[open]");
  const rank = (el) => (popup && popup.contains(el) ? 0 : bfInViewport(el) ? 1 : 2);
  found.sort((a, b) => rank(a) - rank(b));

  const targets = [];
  for (const el of found.slice(0, limit)) {
    const id = "bf-" + ++bfRegistry.seq;
    const name = bfLabel(el);
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute("type") || "").toLowerCase();
    const t = {
      id,
      tag,
      role: (el.getAttribute("role") || tag).toLowerCase(),
      kind: bfKind(el),
      name,
      unnamed: !name,
      hint: name ? undefined : bfHint(el),
      disabled: bfIsDisabled(el),
      editable: bfIsEditable(el),
      filled: ["input", "textarea", "select"].includes(tag) ? !!String(el.value || "").trim() : undefined,
      inputType: tag === "input" ? type || "text" : undefined,
      options: tag === "select" ? Array.from(el.options).slice(0, 40).map((o) => (o.text || "").trim().slice(0, 60)) : undefined,
      href: tag === "a" && el.href ? bfHost(el.href) : undefined,
      inViewport: bfInViewport(el),
      focused: bfWasUserFocus(el),
      state: {
        expanded: el.getAttribute("aria-expanded"),
        selected: el.getAttribute("aria-selected"),
        checked: el.getAttribute("aria-checked") ?? (el.checked != null ? String(el.checked) : null),
        pressed: el.getAttribute("aria-pressed"),
      },
    };
    bfRegistry.map.set(id, { ref: new WeakRef(el), name, tag, role: t.role });
    targets.push(t);
  }
  return targets;
}

// The control the user was on when they asked for help (our own dialog steals focus later).
function bfWasUserFocus(el) {
  const f = typeof bfLoop !== "undefined" && bfLoop.prevFocus;
  return el === (f && f.isConnected ? f : document.activeElement);
}

const BF_ROLE_WORDS = { a: "link", link: "link", button: "button", input: "field", textbox: "field", textarea: "field", combobox: "dropdown", select: "menu", checkbox: "checkbox", radio: "option", option: "option", tab: "tab", menuitem: "menu item", gridcell: "item" };
function bfRoleWord(role) {
  return BF_ROLE_WORDS[String(role || "").toLowerCase()] || "item";
}

// What is on screen, as plain text, for the planner. Never includes field values, our own dialog,
// hidden elements, scripts or styles. Prefers an open popup, then <main>, then the whole page.
function bfPageContext() {
  const popup = document.querySelector("[role=dialog]:not(#blindfold-dialog):not(#blindfold-agent), dialog[open]");
  const root = popup || document.querySelector("main, [role=main]") || document.body;
  const chunks = [];
  let total = 0, nodes = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode() && total < 1800 && nodes < 600) {
    nodes++;
    const n = walker.currentNode;
    const el = n.parentElement;
    const text = (n.nodeValue || "").replace(/\s+/g, " ").trim();
    if (!text || !el) continue;
    if (/^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA)$/.test(el.tagName)) continue;
    if (el.closest("#blindfold-dialog, #blindfold-agent, #blindfold-live-region")) continue;
    if (!bfVisible(el)) continue;
    chunks.push(text);
    total += text.length + 1;
  }
  const headings = Array.from(document.querySelectorAll("h1, h2, h3"))
    .filter((h) => !h.closest("#blindfold-agent, #blindfold-dialog") && bfVisible(h))
    .slice(0, 8)
    .map((h) => (h.innerText || h.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80))
    .filter(Boolean);
  return { title: document.title.slice(0, 120), host: location.host, popupOpen: !!popup, headings, text: chunks.join(" ").slice(0, 1800) };
}

function bfHost(href) {
  try {
    const u = new URL(href, location.href);
    if (!/^https?:$/.test(u.protocol)) return "blocked-scheme";
    return u.host;
  } catch {
    return "";
  }
}

function bfCalendarMonth() {
  const root = document.querySelector("[role=dialog]:not(#blindfold-dialog):not(#blindfold-agent), dialog[open], [class*=calendar i], [class*=datepicker i]");
  const m = root && (root.innerText || "").slice(0, 600).match(MONTH_RE); // describe.js
  return m ? m[1] + " " + m[2] : null;
}

// Re-validate a target against the live page immediately before acting.
function bfResolveTarget(id) {
  const entry = bfRegistry.map.get(id);
  if (!entry) return { ok: false, reason: "I no longer know which control that was." };
  const el = entry.ref.deref();
  if (!el || !el.isConnected) return { ok: false, reason: "That control has disappeared from the page." };
  if (!bfVisible(el)) return { ok: false, reason: "That control is no longer visible." };
  if (bfIsDisabled(el)) return { ok: false, reason: "That control is disabled." };
  if (isSensitiveField(el)) return { ok: false, reason: "That is a private field, so I won't touch it." };
  if (bfLabel(el) !== entry.name) return { ok: false, reason: "That control changed since I looked, so I won't risk a wrong click." };
  if (bfIsConsequential(el)) return { ok: false, blocked: true, reason: "That step could submit, book, pay or change something, so I won't do it for you." };

  const tag = el.tagName.toLowerCase();
  if (tag === "a" && el.href) {
    if (bfHost(el.href) === "blocked-scheme") return { ok: false, blocked: true, reason: "That link doesn't open an ordinary web page, so I won't follow it." };
    if (el.hasAttribute("download")) return { ok: false, blocked: true, reason: "That link downloads a file, so I won't follow it." };
  }
  return { ok: true, el, entry };
}
