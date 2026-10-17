// Blindfold executor (content script).
// Runs ONE approved action in the user's real tab, then checks what actually changed.
// Three honest outcomes for verification:
//   verified   - the expected change was observed
//   unverified - the action ran, but the evidence is missing or ambiguous
//   failed     - the action could not run, or the expected change clearly did not happen
// Nothing here ever reports a task as "complete"; that decision stays with the planner.

const BF_PII = [
  /\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b/,
  /\b\d{4}\s?\d{4}\s?\d{4}\b/,
  /[\w.+-]+@[\w-]+\.[\w.]+/,
  /(\+?\d{1,3}[ -]?)?\b\d{10}\b/,
];

function bfSafeText(text) {
  const t = String(text == null ? "" : text);
  return !!t.trim() && t.length <= 80 && !/[\r\n<>]/.test(t) && !BF_PII.some((re) => re.test(t));
}

const bfSleep = (ms) => new Promise((r) => setTimeout(r, ms));

function bfBodyText() {
  return bfNorm(document.body ? document.body.innerText || document.body.textContent : "");
}

function bfIsOurs(node) {
  const el = node && node.nodeType === 1 ? node : node && node.parentElement;
  return !!(el && el.closest && el.closest("#blindfold-agent, #blindfold-dialog, #blindfold-live-region"));
}

function bfStartWatch() {
  const w = { count: 0, last: Date.now(), obs: null };
  w.obs = new MutationObserver((records) => {
    if (records.every((m) => bfIsOurs(m.target))) return;
    w.count += records.length;
    w.last = Date.now();
  });
  w.obs.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  return w;
}

async function bfSettle(w, quietMs = 450, maxMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    await bfSleep(60);
    if (Date.now() - w.last >= quietMs && Date.now() - start >= quietMs) break;
  }
  w.obs.disconnect();
}

function bfStateSnapshot(el) {
  return {
    aria: ["aria-expanded", "aria-selected", "aria-checked", "aria-pressed"].map((a) => el.getAttribute(a)).join("|"),
    checked: el.checked == null ? null : !!el.checked,
    cls: typeof el.className === "string" ? el.className : "",
  };
}

function bfReadField(el) {
  if (!el || isSensitiveField(el)) return null;
  const v = el.value != null && el.value !== "" ? el.value : el.innerText || el.textContent || "";
  return String(v).replace(/\s+/g, " ").trim().slice(0, 60);
}

function bfDispatchClick(el) {
  const r = el.getBoundingClientRect();
  const base = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
  try { el.focus({ preventScroll: true }); } catch (e) {}
  if (typeof PointerEvent === "function") el.dispatchEvent(new PointerEvent("pointerdown", { ...base, pointerType: "mouse", isPrimary: true }));
  el.dispatchEvent(new MouseEvent("mousedown", base));
  if (typeof PointerEvent === "function") el.dispatchEvent(new PointerEvent("pointerup", { ...base, pointerType: "mouse", isPrimary: true }));
  el.dispatchEvent(new MouseEvent("mouseup", base));
  el.dispatchEvent(new MouseEvent("click", base)); // also triggers native activation for links, buttons, checkboxes
}

function bfTypeInto(el, text) {
  try { el.focus({ preventScroll: true }); } catch (e) {}
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, text); // bypasses React's value tracker
  el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function bfChooseOption(el, optionText) {
  const want = bfNorm(optionText);
  const opt = Array.from(el.options).find((o) => bfNorm(o.text) === want) || Array.from(el.options).find((o) => bfNorm(o.text).includes(want));
  if (!opt || opt.disabled) return false;
  try { el.focus({ preventScroll: true }); } catch (e) {}
  el.value = opt.value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function bfCovered(el) {
  if (typeof document.elementFromPoint !== "function") return false;
  const r = el.getBoundingClientRect();
  // Blindfold's own dialog often sits over the page. It must never count as "something covering the control".
  const ours = document.getElementById("blindfold-agent");
  const prev = ours ? ours.style.pointerEvents : "";
  if (ours) ours.style.pointerEvents = "none";
  let hit;
  try { hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); } finally { if (ours) ours.style.pointerEvents = prev; }
  if (!hit) return false; // can't tell; don't block
  if (hit.closest && hit.closest("#blindfold-agent, #blindfold-dialog")) return false;
  return !(hit === el || el.contains(hit) || hit.contains(el) || (hit.closest && el.closest && hit.closest("label") && hit.closest("label") === el.closest("label")));
}

function bfVerify(action, el, before, watch) {
  const fail = (evidence) => ({ status: "failed", evidence });
  const unverified = (evidence) => ({ status: "unverified", evidence });
  const ok = (evidence) => ({ status: "verified", evidence });

  if (action.type === "type_text") {
    const now = bfReadField(el);
    if (now == null) return unverified("I typed it, but I can't read the field to check.");
    if (bfNorm(now).includes(bfNorm(action.text))) return ok(`The field now reads "${now}".`);
    return unverified(`I typed it, but the field shows "${now}".`);
  }

  if (action.type === "select_option") {
    const chosen = el.selectedOptions && el.selectedOptions[0] ? el.selectedOptions[0].text.trim() : "";
    return bfNorm(chosen) === bfNorm(action.optionText) ? ok(`The menu now shows "${chosen}".`) : fail(`The menu shows "${chosen}" instead.`);
  }

  // click
  const expect = action.expect || { kind: "state_changed" };
  const urlChanged = location.href !== before.url;
  let result;

  switch (expect.kind) {
    case "text_visible": {
      const has = bfBodyText().includes(bfNorm(expect.text));
      result = has && !before.textHas ? ok(`I can now see "${expect.text}" on the page.`)
        : has ? unverified(`"${expect.text}" was already on the page, so I can't tell if the click changed anything.`)
        : fail(`I didn't see "${expect.text}" appear.`);
      break;
    }
    case "text_hidden": {
      const has = bfBodyText().includes(bfNorm(expect.text));
      result = !has && before.textHas ? ok(`"${expect.text}" is gone from the page.`) : has ? fail(`"${expect.text}" is still on the page.`) : unverified("It wasn't on the page to begin with.");
      break;
    }
    case "field_contains": {
      const entry = bfRegistry.map.get(expect.targetId);
      const el2 = entry && entry.ref.deref();
      const now = bfReadField(el2);
      if (!el2 || !el2.isConnected) { result = unverified("The field I wanted to check is no longer on the page."); break; }
      if (now == null) { result = unverified("That field is private, so I can't read it to check."); break; }
      const has = bfNorm(now).includes(bfNorm(expect.text));
      const label = entry.name || "field";
      result = has && !before.fieldHas ? ok(`The ${label} field now reads "${now}".`)
        : has ? unverified(`The ${label} field already contained that, so I can't tell if the click changed it.`)
        : fail(`The ${label} field reads "${now}", not what I expected.`);
      break;
    }
    case "target_removed":
      result = !el.isConnected || !bfVisible(el) ? ok("That control has closed or disappeared, as expected.") : fail("That control is still showing.");
      break;
    case "url_changed":
      result = urlChanged ? ok("The page address changed.") : fail("The page address did not change.");
      break;
    default: { // state_changed
      const after = bfStateSnapshot(el);
      const gone = !el.isConnected || !bfVisible(el);
      if (gone || after.aria !== before.snap.aria || after.checked !== before.snap.checked) result = ok("The control's state changed.");
      else if (after.cls !== before.snap.cls || watch.count > 0) result = unverified("Something on the page changed, but I can't confirm it was the change I expected.");
      else result = fail("Nothing on the page visibly changed.");
    }
  }

  if (result.status !== "verified" && urlChanged) return unverified("The page moved to a new address, but I can't confirm it was the one I expected.");
  return result;
}

// action: validated proposal from the backend. hooks.beforeAct(): awaited just before a click.
async function bfExecute(action, hooks = {}) {
  const failed = (outcome, evidence) => ({ outcome, verification: { status: "failed", evidence } });

  if (!["click", "type_text", "select_option"].includes(action.type)) return failed("blocked", "That kind of step isn't allowed.");
  if (action.type === "type_text" && !bfSafeText(action.text)) return failed("blocked", "That text looks personal, so I won't type it.");

  const res = bfResolveTarget(action.targetId);
  if (!res.ok) return failed(res.blocked ? "blocked" : "failed", res.reason);
  const el = res.el;

  if (action.type === "type_text" && !bfIsEditable(el)) return failed("failed", "That field can't be typed into.");
  if (action.type === "select_option" && el.tagName.toLowerCase() !== "select") return failed("failed", "That isn't a menu.");

  if (el.scrollIntoView) el.scrollIntoView({ block: "center", inline: "nearest" });
  await bfSleep(60);
  if (action.type === "click" && bfCovered(el)) return failed("failed", "Something else is covering that control, so a click wouldn't reach it.");

  const before = {
    url: location.href,
    snap: bfStateSnapshot(el),
    textHas: action.expect && action.expect.text ? bfBodyText().includes(bfNorm(action.expect.text)) : false,
    fieldHas: false,
  };
  if (action.expect && action.expect.kind === "field_contains") {
    const e2 = bfRegistry.map.get(action.expect.targetId);
    const v = e2 && bfReadField(e2.ref.deref());
    before.fieldHas = !!v && bfNorm(v).includes(bfNorm(action.expect.text));
  }

  const watch = bfStartWatch();
  try {
    if (action.type === "click") {
      if (hooks.beforeAct) await hooks.beforeAct(); // lets the page navigate safely and still be resumed
      bfDispatchClick(el);
    } else if (action.type === "type_text") {
      bfTypeInto(el, action.text);
    } else if (!bfChooseOption(el, action.optionText)) {
      watch.obs.disconnect();
      return failed("failed", "I couldn't find that option in the menu.");
    }
  } catch (e) {
    watch.obs.disconnect();
    return failed("failed", "The page refused the action.");
  }

  await bfSettle(watch);
  return { outcome: "executed", verification: bfVerify(action, el, before, watch) };
}
