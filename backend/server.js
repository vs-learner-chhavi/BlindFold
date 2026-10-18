require("./env").loadEnv(); // must run before agent.js reads process.env

const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");

const agent = require("./agent");
const planner = require("./planner");
const gemini = require("./gemini");
const { redact, SENSITIVE_FIELD } = require("./safety");

const reporting = require("../reporting");
const { toIncident } = require("./incident");

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "127.0.0.1";
const MAX_STEPS = 12;
const MAX_BODY = 1_000_000;
const sessions = {}; // in-memory for now

// ---------------------------------------------------------------------------
// Reporting (components 5, 6, 7)
// ---------------------------------------------------------------------------
const delivery = new reporting.DeliveryService(); // check this export name in reporting/index.js
const contactsCache = {};

const INTERACTIVE_ROLES = /^(button|link|textbox|combobox|select|switch|a|input|textarea|clickable)$/;

function hasConfirmedBarrier(incident) {
  return (incident.accessibility_tree || []).some(
    (n) => INTERACTIVE_ROLES.test(n.role) && (!n.name || n.keyboard_operable === false || n.readonly)
  );
}

async function reportIncident(session, why) {
  if (!session.request.reportingEnabled) { console.log("Report skipped: reporting is off"); return; }
  if (session.reported) return;
  session.reported = true;
  try {
    const incident = toIncident(session);
    const report = reporting.generateReport(incident);

    const dir = path.join(__dirname, "..", "reporting", "output");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "last-report.md"), reporting.toMarkdown(report));
    console.log("Report written: reporting/output/last-report.md (" + why + ")");

    if (!hasConfirmedBarrier(incident)) {
      console.log("Not queued for sending: no confirmed barrier found, needs manual review.");
      return;
    }
    const host = new URL(incident.page_url).hostname;
    let contacts = null;
    try {
      if (!contactsCache[host]) contactsCache[host] = await reporting.findContacts(incident.page_url);
      contacts = contactsCache[host];
    } catch (e) { console.warn("contact finder skipped:", e.message); }

    delivery.ingest(report, incident.user_ref, contacts);
    console.log("Report queued for", host);
  } catch (e) { console.warn("report error:", e.message); }
}

setInterval(() => delivery.run().catch(console.error), 3600 * 1000);

// ---------------------------------------------------------------------------
// Request cleaning and access control
// ---------------------------------------------------------------------------
function cleanRequest(body) {
  const safeValues = (body.safeValues || []).filter((v) => !SENSITIVE_FIELD.test(v.field || ""));
  return {
    ...redact({ ...body, safeValues, userRef: undefined }),
    userRef: body.userRef,
    reportingEnabled: body.reportingEnabled === true,
  };
}

// Only the Blindfold extension may talk to this backend. Web pages must not be able to
// drive it (CORS wildcard removed; Origin and Host are both checked).
function requestAllowed(req) {
  const host = String(req.headers.host || "");
  if (!new RegExp(`^(localhost|127\\.0\\.0\\.1):${PORT}$`).test(host)) return false; // DNS-rebinding guard
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser callers (curl, tests)
  const only = process.env.ALLOWED_EXTENSION_ID;
  return only ? origin === `chrome-extension://${only}` : origin.startsWith("chrome-extension://");
}

function send(res, code, data, origin) {
  const headers = { "Content-Type": "application/json" };
  if (origin && origin.startsWith("chrome-extension://")) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Headers"] = "Content-Type";
    headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS";
  }
  res.writeHead(code, headers);
  res.end(JSON.stringify(data));
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------
function createServer() {
  return http.createServer((req, res) => {
    const origin = req.headers.origin;
    const reply = (code, data) => send(res, code, data, origin);

    if (!requestAllowed(req)) return reply(403, { error: "Forbidden" });
    if (req.method === "OPTIONS") return reply(204, {});

    let raw = "";
    let tooBig = false;
    req.on("data", (c) => {
      raw += c;
      if (raw.length > MAX_BODY) { tooBig = true; req.destroy(); }
    });
    req.on("end", () => {
      if (tooBig) return;
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch { return reply(400, { error: "Bad JSON" }); }

      // GET /health -> is the planner (Gemini) actually working? Handy: curl http://localhost:3000/health
      if (req.method === "GET" && req.url === "/health") {
        return gemini.check().then((g) => reply(200, { backend: "ok", gemini: g }));
      }

      // POST /help -> create a rescue session and start the TinyFish inspection
      if (req.method === "POST" && req.url === "/help") {
        if (!body.pageUrl || !body.userGoal) return reply(400, { error: "pageUrl and userGoal required" });
        const sessionId = crypto.randomUUID();
        sessions[sessionId] = {
          status: "in_progress",
          request: cleanRequest(body),
          confirmed: null,
          result: null,
          summary: "Looking at the page.",
          runId: null,
          error: null,
          createdAt: new Date().toISOString(),
          // agent loop state
          step: 0,
          replies: [],
          history: [],
          pending: null,
          completed: false,
          reported: false,
        };
        const session = sessions[sessionId];

        // TEMPORARY TEST LINE: uncomment to prove the report pipeline before the full rescue works.
        // Remove it afterwards, or the report is made before the rescue finishes.
        // reportIncident(session, "test at /help");

        (async () => {
          try {
            session.runId = await agent.startRun(session.request);
            session.status = "in_progress";
            session.summary = "I've started checking the page.";
            void processRun(sessionId);
          } catch (error) {
            session.status = "failed";
            session.error = "Unable to start the website check.";
            session.summary = "I couldn't start the website check. Please try again.";
            // Log only the error message, never the request, API key, snapshot or page contents.
            console.error("BlindFold agent start failed:", error.message);
          }
        })();
        return reply(200, { sessionId, status: "in_progress" });
      }

      // GET /status/:id
      const statusMatch = req.url.match(/^\/status\/([\w-]+)$/);
      if (req.method === "GET" && statusMatch) {
        const s = sessions[statusMatch[1]];
        if (!s) return reply(404, { error: "Unknown session" });
        return reply(200, {
          sessionId: statusMatch[1],
          status: s.status,
          confirmed: s.confirmed,
          summary: s.summary,
          result: s.result,
          diagnostic: s.diagnostic || null,
        });
      }

      // POST /next/:id  -> report the last action's outcome (optional), get the next single step.
      // body: { targets, calendarMonth, safeValues, userReply, report }
      const nextMatch = req.url.match(/^\/next\/([\w-]+)$/);
      if (req.method === "POST" && nextMatch) {
        const s = sessions[nextMatch[1]];
        if (!s) return reply(404, { error: "Unknown session" });
        return handleNext(s, body).then(
          (out) => reply(200, out),
          (err) => {
            console.error("BlindFold /next failed:", String(err.message).slice(0, 160));
            reply(500, { error: "Planning failed" });
          }
        );
      }

      // POST /confirm/:id  { "answer": "yes" | "no" }   (legacy, unused by the agent loop)
      const confirmMatch = req.url.match(/^\/confirm\/([\w-]+)$/);
      if (req.method === "POST" && confirmMatch) {
        const s = sessions[confirmMatch[1]];
        if (!s) return reply(404, { error: "Unknown session" });
        s.confirmed = body.answer === "yes";
        s.status = s.confirmed ? "in_progress" : "failed";
        return reply(200, { confirmed: s.confirmed });
      }

      reply(404, { error: "Not found" });
    });
  });
}

const VERIFY_STATUSES = ["verified", "unverified", "failed"];
const OUTCOMES = ["executed", "rejected", "blocked", "failed", "navigated"];

async function handleNext(s, body) {
  // 1) Record what happened to the previously proposed action.
  if (body.report) {
    const r = body.report;
    if (!s.pending || r.actionId !== s.pending.actionId) {
      return { kind: "error", error: "stale_report", spoken: "That update was out of date, so I ignored it." };
    }
    s.history.push({
      ...s.pending,
      outcome: OUTCOMES.includes(r.outcome) ? r.outcome : "failed",
      verification: {
        status: VERIFY_STATUSES.includes(r.verification?.status) ? r.verification.status : "failed",
        evidence: String(redact(r.verification?.evidence || "")).slice(0, 200),
      },
    });
    s.pending = null;
  } else if (s.pending) {
    s.pending = null; // extension went away mid-step; treat the old proposal as abandoned
  }

  if (typeof body.userReply === "string" && body.userReply.trim()) {
    s.replies = [...s.replies, String(redact(body.userReply)).trim().slice(0, 200)].slice(-8);
  }

  if (s.step >= MAX_STEPS) {
    s.completed = false;
    reportIncident(s, "step limit");
    return {
      kind: "done",
      verified: false,
      spoken: "I've reached my limit of steps for one request, so I'll stop here. Nothing else will happen.",
      step: s.step,
    };
  }

  // 2) Plan exactly one next step.
  const targets = planner.sanitizeTargets(body.targets);
  const fieldValues = (Array.isArray(body.safeValues) ? body.safeValues : [])
    .filter((v) => v && !SENSITIVE_FIELD.test(v.field || ""))
    .slice(0, 30)
    .map((v) => redact({ field: String(v.field || "").slice(0, 80), value: String(v.value || "").slice(0, 80) }));

  // The TinyFish inspection runs in the background and is NEVER waited for. If it happens to be
  // ready it is passed along as extra context; the live page is always the main source.
  const plan = await planner.planNext({
    goal: s.request.userGoal,
    replies: s.replies,
    step: s.step,
    inspection: s.status === "needs_review" ? s.result : null,
    pageContext: planner.sanitizePageContext(body.pageContext),
    calendarMonth: typeof body.calendarMonth === "string" ? body.calendarMonth.slice(0, 40) : null,
    fieldValues,
    targets,
    history: s.history,
  });

  const out = { kind: plan.status, intro: plan.intro || "", spoken: plan.spoken || "", source: plan.source, step: s.step };

  if (plan.status === "propose") {
    const a = plan.action;
    s.pending = { actionId: a.actionId, step: s.step, sig: a.sig, type: a.type, label: a.targetLabel, description: a.description };
    s.step += 1;
    out.action = {
      actionId: a.actionId, type: a.type, targetId: a.targetId, targetLabel: a.targetLabel,
      text: a.text, optionText: a.optionText, reason: a.reason, expectedOutcome: a.expectedOutcome,
      expect: a.expect, description: a.description,
    };
  }

  if (plan.status === "done") {
    out.verified = !!plan.verified;
    s.completed = !!plan.verified;
    reportIncident(s, plan.verified ? "rescued" : "ended unverified");
  }

  console.log("BlindFold step:", { step: out.step, kind: out.kind, source: out.source });
  return out;
}

async function processRun(sessionId) {
  const session = sessions[sessionId];

  if (!session || !session.runId) return;

  const deadline = Date.now() + 180_000;

  try {
    while (Date.now() < deadline) {
      const data = await agent.getRun(session.runId);
      const normalized = agent.normalizeRun(data);

      session.status = normalized.status;
      session.summary = normalized.summary;
      session.result = normalized.result;
      session.diagnostic = normalized.diagnostic || null;

      if (normalized.status !== "in_progress") {
        console.log("BlindFold run finished:", {
          sessionId,
          runId: session.runId,
          status: normalized.status,
          diagnostic: session.diagnostic,
        });
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 2500));
    }

    session.status = "failed";
    session.summary = "The website check timed out.";
    session.diagnostic = { code: "POLL_TIMEOUT" };

    console.error("BlindFold polling timed out:", {
      sessionId,
      runId: session.runId,
    });
  } catch (error) {
    session.status = "failed";
    session.summary = "The website check failed. Please try again.";

    // Log only safe diagnostic information.
    session.diagnostic = {
      code: "POLL_ERROR",
      message: String(error.message || "Unknown error").slice(0, 200),
    };

    console.error("BlindFold polling error:", {
      sessionId,
      runId: session.runId,
      message: session.diagnostic.message,
    });
  }
}

if (require.main === module) {
  createServer().listen(PORT, HOST, async () => {
    console.log(`Blindfold backend on http://localhost:${PORT}`);
    const g = await gemini.check();
    if (g.ok) console.log(`Gemini planner ready (model: ${g.model})`);
    else console.error(`Gemini planner NOT working: ${g.reason}`);
  });
}

module.exports = { createServer, sessions };