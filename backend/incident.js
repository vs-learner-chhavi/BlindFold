// Names can carry what the user picked (dates, prices, names). Keep only the words before the first digit.
function safeName(raw) {
  const t = String(raw || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const head = t.replace(/\d.*$/, "").trim().slice(0, 40);
  return head || "(named control)";
}

const ROLE_MAP = { a: "link", input: "textbox", textarea: "textbox", select: "combobox", clickable: "button" };
const normRole = (r) => ROLE_MAP[r] || r;

function safeGoal(r) {
  // Never pass the user's own words on: they can contain names or booking details.
  const kind = r.situation && r.situation.fieldKind;
  if (kind === "calendar" || kind === "date") return "choose a date";
  if (kind === "place") return "choose a place";
  if (kind === "search") return "search";
  return "complete a step on this page";
}

function toIncident(session) {
  const r = session.request;
  const f = r.focusedElement;

  const tree = (r.nearbyTree || [])
    .map((n) => ({
      id: n.id, role: normRole(n.role), name: safeName(n.name) || "",
      readonly: !!(n.state && n.state.readonly),
      keyboard_operable: n.keyboardReachable !== false,
      contains_image: !!n.containsImage,
    }))
    .concat((r.headings || []).map((h) => ({
      id: h.id, role: "heading", name: h.name || "heading",
      readonly: false, keyboard_operable: true, contains_image: false,
    })));

  let stuck = f ? { id: f.id, role: normRole(f.role), name: safeName(f.name) || "" } : null;
  if (stuck && /^(dialog|main|form|region)$/.test(stuck.role)) {
    const bad = tree.find((n) => n.role !== "heading" && (!n.name || n.keyboard_operable === false || n.readonly));
    if (bad) stuck = { id: bad.id, role: bad.role, name: bad.name };
  }

  return {
    user_ref: r.userRef,
    page_url: r.pageUrl,
    page_title: r.pageTitle,
    user_goal: safeGoal(r),
    stuck_element: stuck,
    screen_reader_announcement: stuck
    ? "(estimated, not recorded from a screen reader) " + stuck.role + (stuck.name ? ", " + stuck.name : "")
    : "",
    accessibility_tree: tree,
    focus_history: r.focusHistory || [],
    visible_messages: [],
    announced_messages: [],
    rescue: {
      completed: !!session.completed,
      actions: (session.history || []).map((h) => h.description || h.label).filter(Boolean),
    },
  };
}
module.exports = { toIncident };