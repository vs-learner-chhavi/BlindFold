// Blindfold agent loop (content script).
//   wait for TinyFish inspection -> speak what was found -> ask backend for ONE step
//   -> read it out and require explicit approval (yes / no / stop) -> execute in this tab
//   -> verify the real page change -> speak the outcome -> repeat until done or stopped.
// Escape stops everything at any time. No action ever runs without a "yes" from the user.

const bfLoop = {
  active: false,
  stopped: false,
  run: 0,
  sessionId: null,
  tabId: null,
  introSpoken: false,
  prevFocus: null,
  ui: null,
  onKey: null,
  cancel: null,
};

const BF_STOP_WORDS = /^(stop|cancel|quit|exit|done|finish|nothing|no thanks|never ?mind|that'?s all)\b/i;

// ---------- plumbing ----------

async function bfApi(method, path, body) {
  let resp;
  try {
    resp = await chrome.runtime.sendMessage({ type: "BF_API", method, path, body });
  } catch (e) {
    throw new Error("extension_unreachable");
  }
  if (!resp || !resp.ok) throw new Error("backend_" + ((resp && resp.status) || "unreachable"));
  return resp.data;
}

async function bfTabId() {
  if (bfLoop.tabId != null) return bfLoop.tabId;
  const r = await chrome.runtime.sendMessage({ type: "BF_TAB_ID" });
  bfLoop.tabId = r && r.tabId != null ? r.tabId : null;
  return bfLoop.tabId;
}

async function bfSavePending(rec) {
  const id = await bfTabId();
  if (id == null) return;
  await chrome.storage.local.set({ ["bf_pending_" + id]: { ...rec, savedAt: Date.now() } });
}

async function bfClearPending() {
  try {
    const id = await bfTabId();
    if (id != null) await chrome.storage.local.remove("bf_pending_" + id);
  } catch (e) {}
}

// After a click that navigated, the old script is gone. The new page picks the loop back up.
async function bfResumeIfPending() {
  try {
    const id = await bfTabId();
    if (id == null) return;
    const key = "bf_pending_" + id;
    const got = await chrome.storage.local.get(key);
    const p = got[key];
    if (!p) return;
    await chrome.storage.local.remove(key);
    if (Date.now() - p.savedAt > 60000) return;
    const changed = location.href !== p.beforeUrl;
    const report = {
      actionId: p.actionId,
      outcome: changed ? "navigated" : "executed",
      verification: {
        status: changed && p.expectKind === "url_changed" ? "verified" : "unverified",
        evidence: changed ? `The page changed to ${location.host}${location.pathname}.` : "The page reloaded.",
      },
    };
    await bfSleep(900);
    startAgentLoop({ sessionId: p.sessionId }, report);
  } catch (e) {}
}

// ---------- speech ----------

function bfSay(text) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    speak(text, finish); // goal.js
    setTimeout(finish, Math.max(2500, String(text).length * 95)); // never hang if the voice engine stalls
  });
}

function bfListen(onFinal, onEnd) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  try {
    const rec = new SR();
    rec.lang = "en-IN";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => onFinal(String(e.results[0][0].transcript || ""));
    rec.onerror = () => {};
    rec.onend = () => onEnd && onEnd();
    rec.start();
    return rec;
  } catch (e) {
    return null;
  }
}

// Only an unmistakable yes counts as approval. Anything else is not consent.
function bfClassify(heard) {
  const t = String(heard).toLowerCase().replace(/[^a-z' ]/g, "").trim();
  if (/^(yes|yeah|yep|yup|approve|approved|go ahead|do it)( please)?$/.test(t)) return "yes";
  if (/^(no|nope|nah|decline|declined|reject|dont|don't|do not)$/.test(t)) return "no";
  if (/^(stop|cancel|quit)$/.test(t)) return "stop";
  return null;
}

// ---------- dialog ----------

function bfUiOpen() {
  if (bfLoop.ui) return bfLoop.ui;
  const box = document.createElement("div");
  box.id = "blindfold-agent";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-labelledby", "bfa-title");
  box.tabIndex = -1;
  box.style.cssText =
    "position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:2147483647;" +
    "width:min(560px,92vw);background:#0B1F3A;color:#fff;border:3px solid #FF8A00;" +
    "border-radius:12px;padding:20px;font:18px/1.4 Arial,sans-serif;box-shadow:0 8px 30px #000a;";

  const title = document.createElement("h2");
  title.id = "bfa-title";
  title.textContent = "Blindfold";
  title.style.cssText = "margin:0 0 10px;font-size:22px;color:#FF8A00";

  const status = document.createElement("p");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.style.cssText = "margin:0 0 8px;color:#fff;font-weight:bold";

  const detail = document.createElement("p");
  detail.style.cssText = "margin:0 0 12px;color:#dbe7f5";

  const input = document.createElement("input");
  input.type = "text";
  input.setAttribute("aria-label", "Your answer");
  input.style.cssText =
    "display:none;width:100%;box-sizing:border-box;padding:10px;font-size:18px;border-radius:6px;border:2px solid #14B8A6;color:#000 !important;background:#fff !important";

  const row = document.createElement("div");
  row.style.cssText = "margin-top:12px;display:flex;gap:10px;flex-wrap:wrap";

  box.append(title, status, detail, input, row);
  document.body.appendChild(box);

  const ui = {
    box, input,
    status: (t) => { status.textContent = bfPlain(t); },
    detail: (t) => { detail.textContent = bfPlain(t); },
    buttons(list) {
      row.textContent = "";
      list.forEach(({ label, click, primary }) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        b.style.cssText =
          "padding:10px 14px;font-size:16px;border:0;border-radius:6px;" +
          (primary ? "background:#14B8A6 !important;color:#000 !important" : "background:#fff !important;color:#0B1F3A !important");
        b.addEventListener("click", click);
        row.appendChild(b);
      });
    },
    showInput(show) { input.style.display = show ? "block" : "none"; input.value = ""; },
  };
  bfLoop.ui = ui;
  return ui;
}

function bfUiClose() {
  if (bfLoop.ui) { bfLoop.ui.box.remove(); bfLoop.ui = null; }
  const f = bfLoop.prevFocus;
  if (f && f.focus && f.isConnected) { try { f.focus(); } catch (e) {} }
}

function bfOnKeyDown(e) {
  if (!bfLoop.active) return;
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    bfStop("Stopped. Nothing else will happen.");
    return;
  }
  if (bfLoop.onKey) bfLoop.onKey(e);
}

function bfStop(message) {
  if (!bfLoop.active) return;
  bfLoop.stopped = true;
  bfLoop.run++; // any coroutine still awaiting is now dead
  if (bfLoop.cancel) bfLoop.cancel();
  bfCleanup();
  bfClearPending();
  if (message) announce(message); // content.js
}

function bfCleanup() {
  bfLoop.active = false;
  bfLoop.onKey = null;
  bfLoop.cancel = null;
  document.removeEventListener("keydown", bfOnKeyDown, true);
  try { speechSynthesis.cancel(); } catch (e) {}
  bfUiClose();
}

async function bfEnd(message) {
  if (!bfLoop.active) return;
  if (bfLoop.ui) { bfLoop.ui.status(message); bfLoop.ui.buttons([]); }
  await bfSay(message);
  bfCleanup();
  await bfClearPending();
}

// ---------- user interaction ----------

function bfDescribeLocal(action) {
  const entry = bfRegistry.map.get(action.targetId);
  if (!entry) return null;
  const label = entry.name || action.targetLabel || "unnamed control";
  let what;
  if (action.type === "type_text") what = `type "${action.text}" into the field labelled "${label}"`;
  else if (action.type === "select_option") what = `choose "${action.optionText}" in the menu labelled "${label}"`;
  else what = `press the ${bfRoleWord(entry.role)} labelled "${label}"`;
  const el = entry.ref.deref();
  let extra = "";
  if (el && el.tagName.toLowerCase() === "a" && el.href) {
    const host = bfHost(el.href);
    if (host && host !== location.host) extra = ` This link goes to ${host}.`;
  }
  return { what, extra };
}

function bfApprove(action, desc) {
  return new Promise((resolve) => {
    const ui = bfUiOpen();
    let rec = null, done = false, tries = 0;
    const finish = (v) => {
      if (done) return;
      done = true;
      try { rec && rec.abort(); } catch (e) {}
      try { speechSynthesis.cancel(); } catch (e) {}
      bfLoop.onKey = null;
      bfLoop.cancel = null;
      ui.buttons([]);
      resolve(v);
    };
    bfLoop.cancel = () => finish("stop");
    bfLoop.onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "y" || k === "n") {
        e.preventDefault();
        e.stopPropagation();
        finish(k === "y" ? "yes" : "no");
      }
    };

    const outcome = action.expectedOutcome ? ` ${action.expectedOutcome}` : "";
    const text = `I'd like to ${desc.what}.${desc.extra}${outcome} Say yes or no. You can also press Y or N.`;
    ui.status("Approve this step?");
    ui.detail(`I'd like to ${desc.what}.${desc.extra}${outcome}`);
    ui.showInput(false);
    ui.buttons([
      { label: "Approve (Y)", primary: true, click: () => finish("yes") },
      { label: "Decline (N)", click: () => finish("no") },
      { label: "Stop (Esc)", click: () => finish("stop") },
    ]);
    ui.box.focus();

    const listen = () => {
      if (done) return;
      rec = bfListen((heard) => {
        const c = bfClassify(heard);
        if (c) finish(c);
        else if (++tries < 2) speak("I didn't catch a clear yes or no. Say it again, or press Y or N.", listen);
      });
    };
    speak(text, listen);
  });
}

// Resolves with the user's text, or null if they chose to stop.
function bfAsk(prompt) {
  return new Promise((resolve) => {
    const ui = bfUiOpen();
    let rec = null, done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      try { rec && rec.abort(); } catch (e) {}
      try { speechSynthesis.cancel(); } catch (e) {}
      ui.input.removeEventListener("keydown", onEnter);
      bfLoop.cancel = null;
      ui.showInput(false);
      ui.buttons([]);
      resolve(v);
    };
    const submit = () => {
      const v = ui.input.value.trim();
      if (!v) { speak("Please say or type your answer, or say stop."); return; }
      finish(BF_STOP_WORDS.test(v) ? null : v);
    };
    const onEnter = (e) => {
      if (e.key === "Enter") { e.preventDefault(); try { rec && rec.abort(); } catch (x) {} submit(); }
    };
    const listen = () => {
      if (done) return;
      ui.input.value = "";
      ui.status("Listening...");
      rec = bfListen(
        (heard) => { ui.input.value = heard; submit(); },
        () => { if (!done && !ui.input.value.trim()) ui.status("I didn't hear anything. Press Speak, or type your answer."); }
      );
      if (!rec) ui.status("Voice input isn't available. Type your answer and press Enter.");
    };

    bfLoop.cancel = () => finish(null);
    ui.status("Your turn.");
    ui.detail(prompt); // stays on screen even if voice input is unavailable
    ui.showInput(true);
    ui.input.addEventListener("keydown", onEnter);
    ui.buttons([
      { label: "Speak", primary: true, click: listen },
      { label: "Send", click: submit },
      { label: "Stop (Esc)", click: () => finish(null) },
    ]);
    ui.input.focus();
    speak(prompt + " Speak after the pause, or type and press Enter.", listen);
  });
}

// ---------- backend steps ----------

function bfNext(report, userReply) {
  const targets = bfCollectTargets();
  return bfApi("POST", "/next/" + bfLoop.sessionId, {
    targets,
    calendarMonth: bfCalendarMonth(),
    pageContext: bfPageContext(), // targets.js: plain on-screen text, no field values
    safeValues: getSafeValues(), // capture.js, sensitive fields already excluded
    userReply: userReply || undefined,
    report: report || undefined,
  });
}

function bfOutcomeSpeech(res) {
  const ev = res.verification.evidence || "";
  if (res.verification.status === "verified") return `Done. ${ev}`;
  if (res.verification.status === "unverified") return `I did it, but I couldn't confirm that it worked. ${ev}`;
  return `That didn't work. ${ev}`;
}

// ---------- the loop ----------

async function startAgentLoop(session, resumeReport) {
  if (bfLoop.active) { announce("I'm already working on a request. Press Escape to stop it."); return; }
  Object.assign(bfLoop, {
    active: true, stopped: false, sessionId: session.sessionId, introSpoken: false,
    prevFocus: document.activeElement, onKey: null, cancel: null,
  });
  const myRun = ++bfLoop.run;
  const dead = () => bfLoop.run !== myRun;
  document.addEventListener("keydown", bfOnKeyDown, true);
  const ui = bfUiOpen();

  try {
    let report = resumeReport || null;
    let userReply = null;

    // No waiting for the background website check: the live page is what matters, and it is ready now.
    ui.status(resumeReport ? "The page changed. Looking at the new page." : "Looking at the page. Press Escape to stop.");

    while (!dead()) {
      ui.buttons([]);
      ui.showInput(false);
      ui.status("Working it out...");
      let plan;
      const slow = setTimeout(() => { if (!dead()) speak("One moment."); }, 4000);
      try {
        plan = await bfNext(report, userReply);
        clearTimeout(slow);
      } catch (e) {
        clearTimeout(slow);
        await bfEnd("I lost contact with the Blindfold server, so I'm stopping. Nothing else will happen.");
        return;
      }
      report = null;
      userReply = null;
      if (dead()) return;

      if (plan.intro && !bfLoop.introSpoken) {
        bfLoop.introSpoken = true;
        ui.detail(bfPlain(plan.intro));
        await bfSay(plan.intro);
        if (dead()) return;
      }

      if (plan.kind === "error") { await bfEnd("Something got out of sync, so I'm stopping. Nothing else will happen."); return; }
      if (plan.kind === "done" || plan.kind === "handoff") { await bfEnd(plan.spoken || "That's all I can do here."); return; }

      if (plan.kind === "ask") {
        const reply = await bfAsk(plan.spoken || "What would you like me to do next?");
        if (dead()) return;
        if (reply === null) { await bfEnd("Okay. Nothing was changed."); return; }
        userReply = reply;
        continue;
      }

      if (plan.kind === "propose") {
        const a = plan.action;
        const desc = bfDescribeLocal(a);
        if (!desc) {
          report = { actionId: a.actionId, outcome: "failed", verification: { status: "failed", evidence: "I lost track of that control." } };
          continue;
        }

        const decision = await bfApprove(a, desc);
        if (dead()) return;
        if (decision === "stop") { await bfEnd("Stopped. Nothing was changed."); return; }
        if (decision === "no") {
          report = { actionId: a.actionId, outcome: "rejected", verification: { status: "failed", evidence: "The user declined this step." } };
          const reply = await bfAsk("Okay, I won't do that. What would you like instead? Or say stop.");
          if (dead()) return;
          if (reply === null) { await bfEnd("Okay. Nothing was changed."); return; }
          userReply = reply;
          continue;
        }

        // Explicit "yes": execute in this tab, then verify against the live page.
        ui.buttons([]);
        ui.status("Doing it...");
        const res = await bfExecute(a, {
          beforeAct: () => bfSavePending({ sessionId: bfLoop.sessionId, actionId: a.actionId, expectKind: a.expect && a.expect.kind, beforeUrl: location.href, label: a.targetLabel }),
        });
        await bfClearPending();
        if (dead()) return;

        const line = bfOutcomeSpeech(res);
        ui.status(line);
        await bfSay(line);
        if (dead()) return;
        report = { actionId: a.actionId, outcome: res.outcome, verification: res.verification };
        continue;
      }

      await bfEnd("I couldn't work out a safe next step, so I'm stopping. Nothing else will happen.");
      return;
    }
  } catch (e) {
    console.warn("[Blindfold] loop error:", e && e.message);
    if (!dead()) await bfEnd("Something went wrong, so I'm stopping. Nothing else will happen.");
  }
}
