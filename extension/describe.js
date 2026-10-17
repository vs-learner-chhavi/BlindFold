// Works out where the user is stuck, in plain words (no values are read).
const KINDS = [
  [/date|calendar|dob|birth|depart|arriv|journey/i, "date"],
  [/search/i, "search"],
  [/from|to|origin|destination|city|station/i, "place"],
];
const KIND_PHRASE = { date: "a date field", search: "a search box", place: "a place field", other: "a form field" };
const KIND_QUESTION = {
  date: "Which date do you want?",
  search: "What do you want to search for?",
  place: "Which place do you want?",
  other: "What do you want to do here?",
};

function visibleLabel(el) {
  const clean = (t) => (t || "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (el.id) {
    const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
    if (l) return clean(l.innerText);
  }
  const wrap = el.closest("label");
  if (wrap) return clean(wrap.innerText);
  const by = el.getAttribute("aria-labelledby");
  if (by) {
    const t = by.split(" ").map((id) => (document.getElementById(id) || {}).innerText || "").join(" ");
    if (clean(t)) return clean(t);
  }
  let prev = el.previousElementSibling;
  for (let i = 0; prev && i < 2; i++, prev = prev.previousElementSibling) {
    const t = clean(prev.innerText);
    if (t) return t;
  }
  return el.parentElement ? clean(el.parentElement.innerText) : "";
}

function describeSituation(nearby) {
  const el = document.activeElement;

  if (!el || el === document.body) {
    return {
      fieldKind: "unknown", issues: [],
      summary: "No element had focus.",
      spoken: "I can't tell which part of the page you are on. Tab to the part you are stuck on and press the shortcut again, or tell me what you want.",
    };
  }
  if (isSensitiveField(el)) {
    return {
      fieldKind: "private", issues: [],
      summary: "The user is on a private field. It was not read.",
      spoken: "You are on a private field, like a password or personal detail. I will not read or fill it. What else do you need help with?",
    };
  }
  const cal = describeCalendar(
    el.closest("[role=dialog], dialog, [class*=calendar i], [class*=datepicker i]") || el,
    nearby
  );
  if (cal) return cal;

  const readName = accessibleName(el);
  const role = (el.getAttribute("role") || "").toLowerCase();
  const tag = el.tagName.toLowerCase();

  const isDialog =
    role === "dialog" ||
    role === "alertdialog" ||
    tag === "dialog";

  const seen = isDialog ? "" : visibleLabel(el);

  // Use the focused control's own metadata for field classification.
  // Do not classify a dialog from its entire accessible name.
  const hint = [
    el.type,
    el.getAttribute("aria-label"),
    el.getAttribute("placeholder"),
    el.getAttribute("name"),
    el.id
  ].filter(Boolean).join(" ");

let kind = el.type === "date" ? "date" : "other";

if (!isDialog && kind === "other") {
  for (const [re, k] of KINDS) {
    if (re.test(hint)) {
      kind = k;
      break;
    }
  }
}

  const issues = [];
  if (!readName) issues.push("has no name for the screen reader");
  if (el.readOnly && kind === "date") issues.push("can't be typed into and needs the calendar");
  const blocked = (nearby || []).filter(
    (n) => (n.role === "button" || n.hasMouseHandler) && (n.unnamed || !n.keyboardReachable)
  ).length;
  if (blocked) issues.push(blocked + " nearby control" + (blocked > 1 ? "s that your screen reader can't name or reach" : " that your screen reader can't name or reach"));

  const parts = [];
  parts.push("You are on " + KIND_PHRASE[kind] + (seen ? ", labelled " + seen : "") + ".");
  if (!readName && seen) parts.push("The screen shows " + seen + ", but your screen reader doesn't read it.");
  if (issues.length) parts.push("Problem: this field " + issues.join(", and ") + ".");
  parts.push(KIND_QUESTION[kind]);

  return {
    fieldKind: kind,
    issues,
    summary:
      "Focused a " + kind + " field. Screen reader name: " + (readName || "none") +
      ". Visible label: " + (seen || "none") + ". Problems: " + (issues.join("; ") || "none found") + ".",
    spoken: parts.join(" "),
  };
}

const MONTH_RE = /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d\d)/i;

function describeCalendar(root, nearby) {
  const m = ((root.innerText || "").slice(0, 400)).match(MONTH_RE);
  const days = (nearby || []).filter((n) => /^\d{1,2}$/.test(n.name || ""));
  if (!m || days.length < 7) return null;

  const month = m[1] + " " + m[2];
  const enabled = days.filter((n) => !n.state.disabled).map((n) => Number(n.name));
  const firstOpen = enabled.length ? Math.min(...enabled) : null;
  const blocked = days.length - enabled.length;

  const parts = ["A calendar is open, showing " + month + "."];
  if (blocked && firstOpen) parts.push("Dates before the " + firstOpen + "th can't be chosen.");
  parts.push("To reach another month, use the arrow buttons. Which date do you want?");

  return {
    fieldKind: "calendar",
    issues: [],
    summary: "A date picker calendar is open showing " + month + (firstOpen ? ", earliest selectable day " + firstOpen : "") + ".",
    spoken: parts.join(" "),
  };
}

// Lets the user simply say "help me here"
function normalizeGoal(text, snapshot) {
  if (/^\s*(please\s+)?help( me)?( here| out)?\s*[.!]?\s*$/i.test(text)) {
    const s = snapshot && snapshot.situation;
    return "Help me with the part where I am stuck. " + (s ? s.summary : "");
  }
  return text;
}