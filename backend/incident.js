function toIncident(session) {
  const r = session.request;
  const res = session.result || {};
  const f = r.focusedElement;
  return {
    user_ref: r.userRef,
    page_url: r.pageUrl,
    page_title: r.pageTitle,
    user_goal: r.userGoal,
    stuck_element: f ? { id: f.id, role: f.role, name: f.name || "" } : null,
    screen_reader_announcement: r.announcement || "",
    accessibility_tree: (r.nearbyTree || []).map((n) => ({
      id: n.id, role: n.role, name: n.name || "",
      readonly: !!(n.state && n.state.readonly),
      keyboard_operable: n.keyboardReachable !== false,
      contains_image: !!n.containsImage,
    })),
    focus_history: r.focusHistory || [],
    visible_messages: [],
    announced_messages: [],
    rescue: {
      completed: session.status === "done",
      actions: res.actions || (res.summary ? [res.summary] : []),
    },
  };
}
module.exports = { toIncident };