// Works out where the user is stuck, in plain words (no typed values are read).
const KINDS = [
  [/date|calendar|dob|birth|depart|arriv|journey/i, "date"],
  [/search/i, "search"],
  [/\b(from|to|origin|destination|city|station)\b/i, "place"],
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
  const pt = el.parentElement ? clean(el.parentElement.innerText) : "";
  return pt.length <= 40 ? pt : "";   // long parent text is not a label
}

// ---------- calendars and date lists ----------
const MONTH_RE = /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d\d)/i;
const DAY_RE = /^\d{1,2}(\s?(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*)?$/i;

function describeCalendar(root, nearby) {
  const days = (nearby || []).filter((n) => DAY_RE.test((n.name || "").trim()));
  if (days.length < 7) return null;

  const m = ((root.innerText || "").slice(0, 400)).match(MONTH_RE);
  const month = m ? m[1] + " " + m[2] : "";
  const blocked = days.filter((n) => n.state && n.state.disabled).length;
  const unreachable = days.filter((n) => n.keyboardReachable === false).length;

  const parts = [month ? "A calendar is open, showing " + month + "." : "A list of dates is open."];
  if (blocked) parts.push("Some earlier dates can't be chosen.");
  if (unreachable) parts.push("The dates can't be reached with the keyboard.");
  parts.push("Which date do you want?");

  const issues = unreachable ? ["dates that can't be reached with the keyboard"] : [];
  return {
    fieldKind: "calendar",
    issues,
    summary: "A date picker is open" + (month ? " showing " + month : "") + ". " +
      (unreachable ? "The dates can't be reached with the keyboard." : "The dates can be reached."),
    spoken: parts.join(" "),
  };
}

// ---------- whole-screen description ----------
function pageSituation(p, noFocus) {
  const bits = [];
  if (p.dialog) bits.push("an open " + p.dialog);
  if (p.unnamed) bits.push(p.unnamed + (p.unnamed > 1 ? " controls" : " control") + " your screen reader can't name");
  if (p.mouseOnly) bits.push(p.mouseOnly + (p.mouseOnly > 1 ? " clickable items" : " clickable item") + " the keyboard can't reach");
  if (p.readonlyFields) bits.push(p.readonlyFields + (p.readonlyFields > 1 ? " fields" : " field") + " you can't type into");

  const lead = noFocus
    ? "I can't tell which field you are on, so I looked at the whole screen."
    : "You are not on a field, so I looked at the whole screen.";
  return {
    fieldKind: "page",
    issues: bits,
    summary: (noFocus ? "No element had focus. " : "Focus was not on a field. ") +
      "Page scan found: " + (bits.join("; ") || "nothing obviously blocked") + ".",
    spoken: bits.length
      ? lead + " I found " + bits.join(", ") + ". What do you want to do?"
      : lead + " Nothing looks obviously blocked. Tab to the part you are stuck on and press the shortcut again, or tell me what you want.",
  };
}

// ---------- main description ----------
function describeSituation(nearby, pageScan) {
  const el = document.activeElement;
  const scan = () => pageScan || scanPageProblems();

  if (!el || el === document.body) return pageSituation(scan(), true);

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

  const isField = /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName);
  // Focus is on a heading, a plain box or a container: describe the whole screen, don't guess.
  if (!isField && !/^(BUTTON|A)$/.test(el.tagName)) return pageSituation(scan(), false);

  const readName = accessibleName(el);                  // what the screen reader says
  const seen = isField ? visibleLabel(el) : "";         // what a sighted user sees
  const hint = [readName, seen, el.placeholder, el.name, el.id, el.type].join(" ");
  let kind = el.type === "date" ? "date" : "other";
  if (kind === "other") for (const [re, k] of KINDS) if (re.test(hint)) { kind = k; break; }

  const own = [];
  if (!readName) own.push("has no name for the screen reader");
  if (el.readOnly && kind === "date") own.push("can't be typed into and needs the calendar");
  const blocked = (nearby || []).filter(
    (n) => (n.role === "button" || n.hasMouseHandler) && (n.unnamed || !n.keyboardReachable)
  ).length;

  const parts = [];
  parts.push("You are on " + (isField ? KIND_PHRASE[kind] : "a button") + (seen ? ", labelled " + seen : (readName ? ", named " + readName : "")) + ".");
  if (!readName && seen) parts.push("The screen shows " + seen + ", but your screen reader doesn't read it.");
  if (own.length) parts.push("Problem: this " + (isField ? "field " : "button ") + own.join(", and ") + ".");
  if (blocked) parts.push("Also, there " + (blocked > 1 ? "are " + blocked + " nearby controls" : "is 1 nearby control") + " that your screen reader can't name or reach.");
  parts.push(KIND_QUESTION[kind]);

  const issues = own.slice();
  if (blocked) issues.push(blocked + " nearby control" + (blocked > 1 ? "s" : "") + " that can't be named or reached");
  return {
    fieldKind: kind,
    issues,
    summary: "Focused a " + kind + " field. Screen reader name: " + (readName || "none") +
      ". Visible label: " + (seen || "none") + ". Problems: " + (issues.join("; ") || "none found") + ".",
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

// Questions like "what do I fill in here?" are answered locally, never sent anywhere.
function isExplainQuestion(text) {
  return /(what|which).*(fill|enter|write|type|put|asking|field|this|here)|what is this|what does this|explain|read (this|it)/i.test(text);
}

function explainField(el) {
  if (!el || el === document.body) {
    return "I can't tell which field you are on. Tab to it and press the shortcut again.";
  }
  const clean = (t) => (t || "").replace(/\s+/g, " ").trim().slice(0, 120);
  const label = clean(accessibleName(el)) || clean(visibleLabel(el));
  const parts = [];

  parts.push(label ? "This field is asking for: " + label + "." : "This field has no name for your screen reader.");

  const type = (el.getAttribute("type") || "").toLowerCase();
  const TYPE_HELP = {
    date: "It expects a date.", email: "It expects an email address.", tel: "It expects a phone number.",
    number: "It expects a number.", password: "It expects a password.", time: "It expects a time.",
    url: "It expects a web address.", search: "It is a search box.",
  };
  if (TYPE_HELP[type]) parts.push(TYPE_HELP[type]);
  if (el.placeholder) parts.push("The hint says: " + clean(el.placeholder) + ".");

  const by = el.getAttribute("aria-describedby");
  if (by) {
    const t = clean(by.split(" ").map((id) => (document.getElementById(id) || {}).innerText || "").join(" "));
    if (t) parts.push("Extra help on the page: " + t + ".");
  }
  if (el.tagName === "SELECT") {
    const opts = Array.from(el.options).slice(0, 6).map((o) => clean(o.text)).filter(Boolean);
    if (opts.length) parts.push("Choices include: " + opts.join(", ") + ".");
  }
  if (el.required || el.getAttribute("aria-required") === "true") parts.push("It is required.");
  if (el.getAttribute("aria-invalid") === "true") parts.push("The page says what is typed here has an error.");
  if (el.readOnly) parts.push("You can't type here. It needs a picker, like a calendar.");
  if (isSensitiveField(el)) parts.push("This is a private field, so I will never read or fill what is in it.");
  return parts.join(" ");
}