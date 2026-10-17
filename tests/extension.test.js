const test = require("node:test");
const assert = require("node:assert/strict");
const { PORT, mockTinyFish, mockGemini, promptOf, scriptedDatePlanner, makePage, waitFor, sleep } = require("./helpers");

let tf, gm, srv, backendUrl;
test.before(async () => {
  // The website check never finishes here: the loop must not wait for it.
  tf = await mockTinyFish("**Upon inspecting** the page: 1. **From** 2. **To** (Departure Date controls)", { hang: true });
  gm = await mockGemini((body) => scriptedDatePlanner(body));
  process.env.GEMINI_API_KEY = "k";
  const { createServer } = require("../backend/server");
  srv = createServer();
  await new Promise((r) => srv.listen(PORT, "127.0.0.1", r));
  backendUrl = `http://localhost:${PORT}`;
});
test.after(() => { srv.close(); tf.server.close(); gm.server.close(); delete process.env.GEMINI_API_KEY; });

async function startSession(goal) {
  const r = await fetch(backendUrl + "/help", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "chrome-extension://testextensionid" },
    body: JSON.stringify({ pageUrl: "https://www.example-trains.test/book", userGoal: goal }),
  });
  return (await r.json()).sessionId;
}
const dialogStatus = (p) => (p.doc.querySelector("#blindfold-agent [role=status]") || {}).textContent || "";
const dialogDetail = (p) => { const el = p.doc.querySelector("#blindfold-agent"); return el ? el.querySelectorAll("p")[1].textContent : ""; };
const waitApproval = (p) => waitFor(() => dialogStatus(p) === "Approve this step?", 9000, "approval prompt");

test("full loop: inspect -> speak -> propose -> approve -> execute -> verify -> propose -> approve -> verify -> done", async () => {
  const p = makePage({ backendUrl });
  const t0 = Date.now();
  const sessionId = await startSession("Help me select 19 October as the departure date");
  p.run(`startAgentLoop({ sessionId: ${JSON.stringify(sessionId)} })`);

  await waitApproval(p);
  assert.ok(Date.now() - t0 < 4000, "first proposal arrives without waiting for the website check");
  assert.ok(!p.spoken.some((s) => /Upon inspecting|Departure Date controls|Still checking/.test(s)), "raw website-check text and 'still checking' are never spoken");
  assert.ok(p.spoken.every((s) => !/[*#_`]|https?:/.test(s)), "nothing spoken contains markdown symbols or URLs");
  assert.match(dialogDetail(p), /labelled "Departure Date"/);
  assert.equal(p.doc.getElementById("cal"), null, "nothing happens before approval");
  p.press("y");

  await waitFor(() => p.doc.getElementById("cal") && dialogStatus(p) === "Approve this step?" && /labelled "19"/.test(dialogDetail(p)), 9000, "second proposal");
  assert.ok(p.spoken.some((s) => /^Done\. I can now see "October"/.test(s) || /^I did it, but I couldn't confirm/.test(s)), "first outcome is spoken");
  assert.equal(p.doc.getElementById("dep").value, "Sun, 18 Oct", "date still unchanged until second approval");
  p.press("y");

  await waitFor(() => !p.doc.getElementById("blindfold-agent"), 9000, "loop end");
  assert.equal(p.doc.getElementById("dep").value, "Mon, 19 Oct");
  assert.ok(p.spoken.some((s) => /^Done\. The Departure Date field now reads "Mon, 19 Oct"/.test(s)), "verified outcome spoken");
  assert.ok(p.spoken.some((s) => /^The date is set\./.test(s)), "final spoken result");
  assert.equal(Object.keys(p.store).length, 0, "no pending navigation record left behind");
});

test("declining performs nothing, asks what next, and 'stop' ends cleanly", async () => {
  const p = makePage({ backendUrl });
  const sessionId = await startSession("Help me select 19 October");
  p.run(`startAgentLoop({ sessionId: ${JSON.stringify(sessionId)} })`);
  await waitApproval(p);
  p.press("n");
  await waitFor(() => /What would you like instead/.test(dialogDetail(p)), 9000, "ask prompt");
  assert.equal(p.doc.getElementById("cal"), null);
  const input = p.doc.querySelector("#blindfold-agent input");
  input.value = "stop";
  input.dispatchEvent(new p.w.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  await waitFor(() => !p.doc.getElementById("blindfold-agent"), 9000, "end");
  assert.ok(p.spoken.some((s) => /Nothing was changed/.test(s)));
  assert.equal(p.doc.getElementById("dep").value, "Sun, 18 Oct");
});

test("Escape is a kill switch at the approval prompt", async () => {
  const p = makePage({ backendUrl });
  const sessionId = await startSession("Help me select 19 October");
  p.run(`startAgentLoop({ sessionId: ${JSON.stringify(sessionId)} })`);
  await waitApproval(p);
  p.press("Escape");
  await waitFor(() => !p.doc.getElementById("blindfold-agent"), 3000, "closed");
  assert.equal(p.doc.getElementById("cal"), null);
  await sleep(300);
  assert.equal(p.run("bfLoop.active"), false);
});

test("a spoken-style non-answer is not consent; only y / yes counts", () => {
  const p = makePage({ backendUrl });
  const c = (t) => p.run(`bfClassify(${JSON.stringify(t)})`);
  assert.equal(c("Yes"), "yes");
  assert.equal(c("yes please"), "yes");
  assert.equal(c("go ahead"), "yes");
  assert.equal(c("no"), "no");
  for (const t of ["yes but not that one", "maybe", "know", "yes no", "I guess", ""]) assert.equal(c(t), null, t);
});

test("executor safety: consequential, sensitive, stale, covered, personal text", async () => {
  const p = makePage({ backendUrl });
  const targets = p.run("bfCollectTargets()");
  const by = (name) => targets.find((t) => t.name === name);

  assert.ok(!targets.some((t) => /password/i.test(t.name)), "password field is never offered as a target");
  assert.ok(by("Book now"), "book button is visible to the planner (so it can be refused)");

  let r = await p.run(`bfExecute({ type: "click", targetId: ${JSON.stringify(by("Book now").id)}, expect: { kind: "state_changed" } })`);
  assert.equal(r.outcome, "blocked");

  r = await p.run(`bfExecute({ type: "type_text", targetId: ${JSON.stringify(by("From").id)}, text: "me@mail.com" })`);
  assert.equal(r.outcome, "blocked");

  r = await p.run(`bfExecute({ type: "navigate", targetId: ${JSON.stringify(by("From").id)} })`);
  assert.equal(r.outcome, "blocked");

  // stale: label changes after the registry was built
  p.doc.querySelector('label[for="from"]').textContent = "Destination";
  r = await p.run(`bfExecute({ type: "type_text", targetId: ${JSON.stringify(by("From").id)}, text: "Delhi" })`);
  assert.equal(r.outcome, "failed");
  assert.match(r.verification.evidence, /changed since I looked/);

  // covered by an overlay
  const fresh = p.run("bfCollectTargets()");
  p.w.__hit = p.doc.getElementById("help");
  r = await p.run(`bfExecute({ type: "click", targetId: ${JSON.stringify(fresh.find((t) => t.name === "Search trains").id)}, expect: { kind: "state_changed" } })`);
  assert.equal(r.outcome, "failed");
  assert.match(r.verification.evidence, /covering/);
  p.w.__hit = null;
});

test("executor: type_text and select_option are verified from the live field; ambiguous clicks are 'unverified'", async () => {
  const p = makePage({ backendUrl });
  p.doc.querySelector('label[for="from"]').textContent = "From";
  const targets = p.run("bfCollectTargets()");
  const id = (n) => JSON.stringify(targets.find((t) => t.name === n).id);

  let r = await p.run(`bfExecute({ type: "type_text", targetId: ${id("From")}, text: "Delhi" })`);
  assert.equal(r.verification.status, "verified");
  assert.equal(p.doc.getElementById("from").value, "Delhi");

  r = await p.run(`bfExecute({ type: "select_option", targetId: ${id("Class")}, optionText: "sleeper" })`);
  assert.equal(r.verification.status, "verified");
  assert.equal(p.doc.getElementById("cls").value, "Sleeper");

  // clicking a button that does nothing must never be reported as verified
  r = await p.run(`bfExecute({ type: "click", targetId: ${id("Search trains")}, expect: { kind: "text_visible", text: "Results found" } })`);
  assert.equal(r.outcome, "executed");
  assert.equal(r.verification.status, "failed");
  r = await p.run(`bfExecute({ type: "click", targetId: ${id("Search trains")}, expect: { kind: "state_changed" } })`);
  assert.equal(r.verification.status, "failed");

  // text that was already on the page proves nothing
  r = await p.run(`bfExecute({ type: "click", targetId: ${id("Search trains")}, expect: { kind: "text_visible", text: "Departure Date" } })`);
  assert.equal(r.verification.status, "unverified");
});

test("navigation: pending record is resumed on the new page with an honest report", async () => {
  const p = makePage({ backendUrl });
  await p.w.chrome.storage.local.set({ bf_pending_7: { sessionId: "s1", actionId: "a1", expectKind: "state_changed", beforeUrl: "https://www.example-trains.test/old", savedAt: Date.now() } });
  p.run("globalThis.__resumed = null; startAgentLoop = (s, r) => { globalThis.__resumed = [s, r]; };");
  await p.run("bfResumeIfPending()");
  await waitFor(() => p.run("globalThis.__resumed"), 3000, "resume");
  const [s, report] = p.run("globalThis.__resumed");
  assert.equal(s.sessionId, "s1");
  assert.equal(report.outcome, "navigated");
  assert.equal(report.verification.status, "unverified");
  assert.equal(Object.keys(p.store).length, 0);

  // stale records (older than a minute) are ignored
  await p.w.chrome.storage.local.set({ bf_pending_7: { sessionId: "s2", actionId: "a2", beforeUrl: "x", savedAt: Date.now() - 120000 } });
  p.run("globalThis.__resumed = null");
  await p.run("bfResumeIfPending()");
  await sleep(200);
  assert.equal(p.run("globalThis.__resumed"), null);
});

test("speech cleaning: asterisks, hashes, backticks and URLs never reach the voice or the dialog", () => {
  const p = makePage({ backendUrl });
  const plain = (t) => p.run(`bfPlain(${JSON.stringify(t)})`);
  assert.equal(plain("**From** (Source Station) 2. **To**"), "From (Source Station) 2. To");
  assert.equal(plain("See https://www.confirmtkt.com/rbooking/ now"), "See www.confirmtkt.com now");
  assert.equal(plain("## Title\n- item one\n- item two"), "Title item one item two");
  p.run(`speak("**October 2026** is open")`);
  assert.equal(p.spoken[p.spoken.length - 1], "October 2026 is open");
});

test("page context for the planner: visible text only, never our dialog, scripts or typed values", () => {
  const p = makePage({ backendUrl, html: `<!doctype html><title>Trains</title><body><h1>Book a train</h1><script>var secret="SCRIPT-TEXT"</script><p>Choose your journey date</p><p hidden>HIDDEN-TEXT</p><input id="x" value="TYPED-VALUE"><div id="blindfold-agent">OUR-DIALOG</div></body>` });
  const c = p.run("bfPageContext()");
  assert.match(c.text, /Choose your journey date/);
  assert.doesNotMatch(c.text, /SCRIPT-TEXT|HIDDEN-TEXT|TYPED-VALUE|OUR-DIALOG/);
  assert.deepEqual(c.headings, ["Book a train"]);
});

test("targets: the control the user was on is flagged; controls are described in words a person can use", () => {
  const p = makePage({ backendUrl });
  p.doc.getElementById("dep").focus();
  p.run("bfLoop.prevFocus = document.activeElement");
  const t = p.run("bfCollectTargets()");
  assert.equal(t.find((x) => x.name === "Departure Date").focused, true);
  assert.equal(t.filter((x) => x.focused).length, 1);
  assert.equal(p.run('bfRoleWord("div")'), "item");
  assert.equal(p.run('bfRoleWord("a")'), "link");
});

test("executor: Blindfold's own dialog over a control is not 'something covering it'", async () => {
  const p = makePage({ backendUrl });
  p.doc.querySelector('label[for="from"]').textContent = "From";
  const dlg = p.doc.createElement("div");
  dlg.id = "blindfold-agent";
  p.doc.body.appendChild(dlg);
  p.w.__hit = dlg; // the browser says our dialog is on top of the button
  const targets = p.run("bfCollectTargets()");
  const r = await p.run(`bfExecute({ type: "click", targetId: ${JSON.stringify(targets.find((x) => x.name === "Search trains").id)}, expect: { kind: "state_changed" } })`);
  assert.equal(r.outcome, "executed");
  p.w.__hit = null;
});
