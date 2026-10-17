const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const { PORT, mockTinyFish, mockGemini, modelOf, promptOf, scriptedDatePlanner } = require("./helpers");

let planner, safety, gemini;
const target = (o) => ({ id: "bf-1", role: "button", tag: "button", kind: "button", name: "x", disabled: false, editable: false, state: {}, ...o });
const ctx = (o = {}) => ({ goal: "pick 19 October", replies: [], step: 0, inspection: null, targets: [], history: [], fieldValues: [], ...o });

test.before(() => { planner = require("../backend/planner"); safety = require("../backend/safety"); gemini = require("../backend/gemini"); });

test("validator: only allowlisted actions on known, enabled, non-sensitive targets", () => {
  const targets = [target({ id: "bf-1", name: "19" }), target({ id: "bf-2", name: "Off", disabled: true }), target({ id: "bf-3", name: "Mobile number", role: "input", tag: "input", editable: true })];
  const c = ctx({ targets });
  const ok = planner.validatePlan({ status: "propose", action: { type: "click", targetId: "bf-1", expect: { kind: "state_changed" } } }, c);
  assert.equal(ok.plan.status, "propose");
  assert.match(ok.plan.action.description, /labelled "19"/);
  assert.equal(planner.validatePlan({ status: "propose", action: { type: "navigate", targetId: "bf-1" } }, c).error, "action_not_allowlisted");
  assert.equal(planner.validatePlan({ status: "propose", action: { type: "click", targetId: "bf-99" } }, c).error, "unknown_target");
  assert.equal(planner.validatePlan({ status: "propose", action: { type: "click", targetId: "bf-2" } }, c).error, "target_disabled");
  assert.equal(planner.validatePlan({ status: "propose", action: { type: "type_text", targetId: "bf-3", text: "x" } }, c).error, "sensitive_target");
});

test("validator: consequential targets become a handoff, never a proposal", () => {
  for (const name of ["Book now", "Pay ₹1,200", "Submit", "Delete account", "Log in", "Confirm and proceed"]) {
    const v = planner.validatePlan({ status: "propose", action: { type: "click", targetId: "bf-1" } }, ctx({ targets: [target({ name })] }));
    assert.equal(v.plan.status, "handoff", name);
  }
  assert.equal(planner.validatePlan({ status: "propose", action: { type: "click", targetId: "bf-1" } }, ctx({ targets: [target({ name: "Search trains" })] })).plan.status, "propose");
});

test("validator: typed text must be short, plain, non-personal, and well-formed", () => {
  const targets = [target({ id: "bf-1", name: "From", role: "input", tag: "input", editable: true, inputType: "text" }), target({ id: "bf-2", name: "When", role: "input", tag: "input", editable: true, inputType: "date" })];
  const c = ctx({ targets });
  const t = (id, text) => planner.validatePlan({ status: "propose", action: { type: "type_text", targetId: id, text } }, c);
  assert.equal(t("bf-1", "Delhi").plan.action.text, "Delhi");
  assert.equal(t("bf-1", "me@mail.com").error, "text_looks_personal");
  assert.equal(t("bf-1", "9876543210").error, "text_looks_personal");
  assert.equal(t("bf-1", "a".repeat(81)).error, "bad_text");
  assert.equal(t("bf-2", "19 Oct").error, "bad_date_format");
  assert.equal(t("bf-2", "2026-10-19").plan.status, "propose");
});

test("validator: select_option must match a real option; repeats are cut off", () => {
  const sel = target({ id: "bf-1", name: "Class", role: "select", tag: "select", options: ["Any", "Sleeper"] });
  assert.equal(planner.validatePlan({ status: "propose", action: { type: "select_option", targetId: "bf-1", optionText: "sleeper" } }, ctx({ targets: [sel] })).plan.action.optionText, "Sleeper");
  assert.equal(planner.validatePlan({ status: "propose", action: { type: "select_option", targetId: "bf-1", optionText: "First AC" } }, ctx({ targets: [sel] })).error, "option_not_found");
  const t = target({ name: "19" });
  const sig = planner.signature({ type: "click" }, t);
  const history = [{ sig, outcome: "executed", verification: { status: "unverified" } }, { sig, outcome: "rejected", verification: { status: "failed" } }];
  const v = planner.validatePlan({ status: "propose", action: { type: "click", targetId: "bf-1" } }, ctx({ targets: [t], history }));
  assert.equal(v.plan.status, "ask");
});

test("heuristic: opens the calendar, then picks the day; honest about disabled days", () => {
  const field = target({ id: "bf-1", role: "input", tag: "input", name: "Departure Date" });
  const days = Array.from({ length: 28 }, (_, i) => target({ id: `bf-${10 + i}`, name: String(i + 1), disabled: i + 1 < 19 }));
  let p = planner.heuristicPlan(ctx({ targets: [field] }));
  assert.equal(p.action.targetId, "bf-1");
  p = planner.heuristicPlan(ctx({ targets: [field, ...days], calendarMonth: "October 2026" }));
  assert.equal(p.action.targetId, "bf-28"); // day 19
  assert.deepEqual(p.action.expect, { kind: "field_contains", targetId: "bf-1", text: "19" });
  p = planner.heuristicPlan(ctx({ goal: "select 18 October", targets: [field, ...days], calendarMonth: "October 2026" }));
  assert.equal(p.status, "ask");
  p = planner.heuristicPlan(ctx({ targets: [field, ...days], calendarMonth: "September 2026" }));
  assert.equal(p.status, "ask"); // no next-month button available
});

test("planNext with Gemini: a hijacked 'Book now' proposal becomes a handoff", async () => {
  const g = await mockGemini(() => ({ status: "propose", action: { type: "click", targetId: "bf-2", reason: "page said to", expect: { kind: "state_changed" } } }));
  process.env.GEMINI_API_KEY = "k";
  gemini._reset();
  const targets = [target({ id: "bf-1", name: "Departure Date", role: "input", tag: "input" }), target({ id: "bf-2", name: "Book now" })];
  const plan = await planner.planNext(ctx({ targets }));
  assert.equal(plan.status, "handoff");
  assert.equal(plan.source, "gemini");
  g.server.close();
  delete process.env.GEMINI_API_KEY;
});

test("planNext: a bad plan gets one repair attempt with the reason; a second bad plan asks the user (no silent date-only fallback)", async () => {
  const seen = [];
  const good = { status: "propose", action: { type: "click", targetId: "bf-1", expect: { kind: "state_changed" } } };
  const g = await mockGemini((body) => { const c = promptOf(body); seen.push(c.PREVIOUS_REPLY_REJECTED || null); return seen.length === 1 ? { status: "propose", action: { type: "click", targetId: "bf-99" } } : good; });
  process.env.GEMINI_API_KEY = "k";
  gemini._reset();
  const targets = [target({ id: "bf-1", name: "Search trains" })];
  let plan = await planner.planNext(ctx({ targets }));
  assert.equal(plan.status, "propose");
  assert.equal(plan.source, "gemini");
  assert.match(seen[1], /unknown_target/, "the model is told why it was rejected");
  g.server.close();

  const g2 = await mockGemini(() => ({ nonsense: true }));
  plan = await planner.planNext(ctx({ targets }));
  assert.equal(plan.status, "ask");
  assert.equal(plan.source, "none");
  g2.server.close();
  delete process.env.GEMINI_API_KEY;
});

test("planNext: when Gemini is unreachable the user is told honestly; the date heuristic only runs if explicitly enabled", async () => {
  const targets = [target({ id: "bf-1", name: "Departure Date", role: "input", tag: "input" })];
  delete process.env.GEMINI_API_KEY;
  let plan = await planner.planNext(ctx({ targets }));
  assert.equal(plan.status, "handoff");
  assert.equal(plan.source, "none");
  assert.match(plan.spoken, /planning service isn't available/);

  process.env.BLINDFOLD_HEURISTIC_FALLBACK = "1";
  plan = await planner.planNext(ctx({ targets }));
  assert.equal(plan.source, "heuristic");
  assert.equal(plan.status, "propose");
  delete process.env.BLINDFOLD_HEURISTIC_FALLBACK;
});

test("speech: markdown, asterisks and URLs from the model are cleaned before they reach the user", () => {
  const v = planner.validatePlan({ status: "ask", spoken: "**October 2026** is open. See https://www.confirmtkt.com/rbooking/ for 1. **From** and ## To", intro: "* The page has a *calendar*" }, ctx());
  assert.doesNotMatch(v.plan.spoken + v.plan.intro, /[*#_`]|https?:/);
  assert.match(v.plan.spoken, /October 2026 is open/);
});

test("gemini client: a retired model (404) falls through to the next model and is remembered", async () => {
  const asked = [];
  const g = await mockGemini((body, req) => {
    asked.push(modelOf(req));
    if (modelOf(req) === "gemini-2.5-flash") return { __status: 404, message: "models/gemini-2.5-flash is not found" };
    return { status: "done", spoken: "ok" };
  });
  process.env.GEMINI_API_KEY = "k";
  process.env.GEMINI_MODEL = "gemini-2.5-flash"; // stale .env value
  gemini._reset();
  const out = JSON.parse(await gemini.generateJson("sys", "user"));
  assert.equal(out.status, "done");
  assert.deepEqual(asked, ["gemini-2.5-flash", "gemini-3.6-flash"]);
  asked.length = 0;
  await gemini.generateJson("sys", "user");
  assert.deepEqual(asked, ["gemini-3.6-flash"], "the working model is tried first next time");
  g.server.close();
  delete process.env.GEMINI_MODEL;
});

test("gemini client: if every known name is gone it asks Google which models exist", async () => {
  const asked = [];
  const g = await mockGemini((body, req) => {
    if (req.method === "GET") {
      return { __raw: { models: [
        { name: "models/gemini-9.1-flash", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-9.1-flash-lite", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-9.1-flash-image", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-9.0-flash", supportedGenerationMethods: ["generateContent"] },
        { name: "models/embedding-001", supportedGenerationMethods: ["embedContent"] },
      ] } };
    }
    asked.push(modelOf(req));
    return modelOf(req) === "gemini-9.1-flash" ? { status: "done", spoken: "ok" } : { __status: 404 };
  });
  process.env.GEMINI_API_KEY = "k";
  gemini._reset();
  const out = JSON.parse(await gemini.generateJson("sys", "user"));
  assert.equal(out.status, "done");
  assert.equal(asked[asked.length - 1], "gemini-9.1-flash", "newest plain Flash model chosen, not lite/image");
  g.server.close();
});

test("gemini client: no temperature is sent; a refused thinking config is retried without it; auth errors do not walk the model list", async () => {
  const bodies = [];
  let g = await mockGemini((body) => {
    bodies.push(body);
    return body.generationConfig.thinkingConfig ? { __status: 400, message: "thinking not supported" } : { status: "done" };
  });
  process.env.GEMINI_API_KEY = "k";
  gemini._reset();
  await gemini.generateJson("sys", "user");
  assert.equal(bodies.length, 2);
  assert.ok(bodies.every((b) => b.generationConfig.temperature === undefined), "Gemini 3 Flash rejects custom temperature");
  assert.equal(bodies[1].generationConfig.thinkingConfig, undefined);
  g.server.close();

  let calls = 0;
  g = await mockGemini(() => { calls++; return { __status: 403, message: "denied" }; });
  gemini._reset();
  await assert.rejects(gemini.generateJson("sys", "user"), (e) => e.status === 403);
  assert.equal(calls, 1);
  assert.match(gemini.explain({ status: 403, message: "x" }), /GEMINI_API_KEY/);
  assert.match(gemini.explain({ status: 404, message: "x" }), /retired/);
  g.server.close();
});

test("planNext: 'done' after an unverified step is never reported as confirmed", async () => {
  const g = await mockGemini(() => ({ status: "done", goalAchieved: true, spoken: "All set." }));
  process.env.GEMINI_API_KEY = "k";
  gemini._reset();
  const plan = await planner.planNext(ctx({ history: [{ sig: "s", verification: { status: "unverified" } }] }));
  assert.equal(plan.verified, false);
  assert.match(plan.spoken, /couldn't confirm/);
  g.server.close();
  delete process.env.GEMINI_API_KEY;
});

test("inspection summary is redacted and bounded", () => {
  const s = planner.summarizeInspection({ summary: "Call 9876543210 or mail a@b.co. " + "x".repeat(900) });
  assert.ok(s.length <= 600);
  assert.doesNotMatch(s, /9876543210|a@b\.co/);
});

test("server: only the extension may call it; /next protocol is enforced", async () => {
  const tf = await mockTinyFish("**Upon inspecting** the page, the following was observed: 1. **From** 2. **To**", { hang: true });
  const g = await mockGemini((body) => {
    try { promptOf(body); } catch { return { ok: true }; } // the /health ping is not a planning request
    return { ...scriptedDatePlanner(body), intro: "The Departure Date field is on screen." };
  });
  process.env.GEMINI_API_KEY = "k";
  gemini._reset();
  const { createServer } = require("../backend/server");
  const srv = createServer();
  await new Promise((r) => srv.listen(PORT, "127.0.0.1", r));
  const call = (method, p, body, headers = {}) =>
    new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port: PORT, path: p, method, headers: { "Content-Type": "application/json", host: `localhost:${PORT}`, ...headers } }, (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: raw ? JSON.parse(raw) : null }));
      });
      req.on("error", reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  const goal = { pageUrl: "https://www.example-trains.test/book", userGoal: "select 19 October" };

  assert.equal((await call("POST", "/help", goal, { origin: "https://evil.example" })).status, 403);
  assert.equal((await call("POST", "/help", goal, { host: `evil.example:${PORT}` })).status, 403);
  const ok = await call("POST", "/help", goal, { origin: "chrome-extension://abc" });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers["access-control-allow-origin"], "chrome-extension://abc");

  const id = ok.body.sessionId;
  // Deliberately NO waiting for the TinyFish inspection (it never finishes here): /next works at once.
  const field = target({ id: "bf-1", role: "input", tag: "input", name: "Departure Date" });
  const first = await call("POST", `/next/${id}`, { targets: [field] });
  assert.equal(first.body.kind, "propose");
  assert.equal(first.body.source, "gemini");
  assert.equal(first.body.intro, "The Departure Date field is on screen.");
  assert.doesNotMatch(JSON.stringify(first.body), /Upon inspecting|\*\*/, "raw inspection text is never passed to the user");
  assert.match(first.body.action.description, /press the field labelled "Departure Date"/);

  const health = await call("GET", "/health");
  assert.equal(health.body.gemini.ok, true);

  const stale = await call("POST", `/next/${id}`, { targets: [field], report: { actionId: "not-the-real-id", outcome: "executed" } });
  assert.equal(stale.body.kind, "error");

  const second = await call("POST", `/next/${id}`, { targets: [field], report: { actionId: first.body.action.actionId, outcome: "rejected" }, userReply: "email me at a@b.co" });
  assert.equal(second.status, 200);
  assert.doesNotMatch(JSON.stringify(require("../backend/server").sessions[id].replies), /a@b\.co/);

  srv.close();
  tf.server.close();
  g.server.close();
  delete process.env.GEMINI_API_KEY;
});

test("planNext: Gemini receives on-screen text and the control the user was on, so any task can be planned (not just dates)", async () => {
  let seen = null;
  const g = await mockGemini((body) => { seen = promptOf(body); return { status: "ask", spoken: "Which city do you want to travel to?" }; });
  process.env.GEMINI_API_KEY = "k";
  gemini._reset();
  const targets = planner.sanitizeTargets([{ id: "bf-1", role: "input", tag: "input", kind: "input", name: "To", editable: true, focused: true, state: {} }]);
  const pageContext = planner.sanitizePageContext({ title: "Book trains", host: "example.test", headings: ["Search trains"], text: "Where to? Call 9876543210 for help." });
  const plan = await planner.planNext(ctx({ goal: "help me here", targets, pageContext }));
  assert.equal(plan.status, "ask");
  assert.equal(seen.TARGETS[0].focused, true);
  assert.equal(seen.PAGE.title, "Book trains");
  assert.match(seen.PAGE.text, /Where to\?/);
  assert.doesNotMatch(JSON.stringify(seen), /9876543210/, "personal data is redacted before it leaves the machine");
  g.server.close();
  delete process.env.GEMINI_API_KEY;
});
