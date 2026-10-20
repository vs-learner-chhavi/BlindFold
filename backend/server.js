require("./env").loadEnv(); 

const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const db = require("./db");

const agent = require("./agent");
const planner = require("./planner");
const gemini = require("./gemini");
const { redact, SENSITIVE_FIELD } = require("./safety");

const reporting = require("../reporting");
const { toIncident, getTrackerDashboardData, getWebsiteDetails } = require("./incident");

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "127.0.0.1";
const MAX_STEPS = 12;
const MAX_BODY = 1_000_000;
const sessions = {}; 

const delivery = new reporting.DeliveryService();
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

    const host = new URL(incident.page_url).hostname;
    const dir = path.join(__dirname, "..", "reporting", "output");
    fs.mkdirSync(dir, { recursive: true });
    
    fs.writeFileSync(path.join(dir, `${host}.md`), reporting.toMarkdown(report));
    console.log(`Report written: reporting/output/${host}.md (${why})`);
    
    db.finishSession(session.id, session.completed).catch(() => {});

    const confirmed = report.barriers.filter((b) => b.verified);
    if (!confirmed.length) {
      const t = incident.accessibility_tree || [];
      console.log("Not queued for sending: no confirmed barrier found, needs manual review.");
      console.log("Checked", t.length, "items | roles:", [...new Set(t.map((n) => n.role))].join(","));
      return;
    }

    try {
      const saved = await db.saveReport(report, session.request.userRef);
      if (saved) console.log("Saved to database:", saved.problems, "confirmed problem(s)");
    } catch (e) { console.warn("database save skipped:", e.message); }

    let contacts = null;
    try {
      if (!contactsCache[host]) contactsCache[host] = await reporting.findContacts(incident.page_url);
      contacts = contactsCache[host];
      db.saveContact(report.website.domain, contacts).catch(() => {});
    } catch (e) { console.warn("contact finder skipped:", e.message); }

    delivery.ingest({ ...report, barriers: confirmed }, incident.user_ref, contacts);
    console.log("Report queued for", host);
  } catch (e) { console.warn("report error:", e.message); }
}

setInterval(() => delivery.run().catch(console.error), 3600 * 1000);
setInterval(() => db.cleanup().catch(() => {}), 3600 * 1000);

function cleanRequest(body) {
  const safeValues = (body.safeValues || []).filter((v) => !SENSITIVE_FIELD.test(v.field || ""));
  return {
    ...redact({ ...body, safeValues, userRef: undefined }),
    userRef: body.userRef,
    reportingEnabled: body.reportingEnabled === true,
  };
}


function requestAllowed(req) {
  const host = String(req.headers.host || "").toLowerCase();

  const allowedHosts = [
    "localhost:3000",
    "127.0.0.1:3000",
    "blindfold-gppx.onrender.com",
  ];

  const extraHosts = (process.env.ALLOWED_HOSTS || "")
    .split(",")
    .map(h => h.trim().toLowerCase())
    .filter(Boolean);

  if (!allowedHosts.includes(host) && !extraHosts.includes(host)) {
    return false;
  }

  const origin = req.headers.origin;
  if (!origin || origin === "null") return true;

  const allowedOrigins = [
    "https://blindfold-public.vercel.app",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ];

  if (allowedOrigins.includes(origin)) return true;

  // Keep support for the Chrome extension.
  if (origin.startsWith("chrome-extension://")) {
    const extensionId = process.env.ALLOWED_EXTENSION_ID;
    return !extensionId || origin === `chrome-extension://${extensionId}`;
  }

  return false;
}



function send(res, code, data, origin) {
  const allowedOrigins = [
    "https://blindfold-public.vercel.app",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ];

  const isExtension =
    origin && origin.startsWith("chrome-extension://");

  const extensionId = process.env.ALLOWED_EXTENSION_ID;
  const extensionAllowed =
    isExtension &&
    (!extensionId || origin === `chrome-extension://${extensionId}`);

  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Headers": "Content-Type, x-admin-token",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };

  if (allowedOrigins.includes(origin) || extensionAllowed) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
  }

  res.writeHead(code, headers);
  res.end(JSON.stringify(data));
}


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
    req.on("end", async () => {
      if (tooBig) return;
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch { return reply(400, { error: "Bad JSON" }); }

      if (req.method === "GET" && req.url === "/health") {
        return gemini.check().then((g) => reply(200, { backend: "ok", gemini: g }));
      }

      if (req.method === "POST" && req.url === "/help") {
        if (!body.pageUrl || !body.userGoal) return reply(400, { error: "pageUrl and userGoal required" });
        const limit = Number(process.env.FREE_RESCUES_PER_MONTH) || 15;
        return db.useRescue(body.userRef, limit).then((u) => {
          if (!u.allowed) return reply(429, { error: "limit", used: u.used, limit: u.limit });

          const sessionId = crypto.randomUUID();
          sessions[sessionId] = {
            id: sessionId,
            status: "in_progress",
            request: cleanRequest(body),
            confirmed: null,
            result: null,
            summary: "Looking at the page.",
            runId: null,
            error: null,
            createdAt: new Date().toISOString(),
            step: 0,
            replies: [],
            history: [],
            pending: null,
            completed: false,
            reported: false,
          };
          const session = sessions[sessionId];

          let host = "";
          try { host = new URL(body.pageUrl).hostname; } catch {}
          db.saveSession(sessionId, host).catch((e) => console.warn("db session:", e.message));

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
              console.error("BlindFold agent start failed:", error.message);
            }
          })();
          return reply(200, { sessionId, status: "in_progress", rescuesLeft: u.limit - u.used });
        });
      }

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

      const confirmMatch = req.url.match(/^\/confirm\/([\w-]+)$/);
      if (req.method === "POST" && confirmMatch) {
        const s = sessions[confirmMatch[1]];
        if (!s) return reply(404, { error: "Unknown session" });
        s.confirmed = body.answer === "yes";
        s.status = s.confirmed ? "in_progress" : "failed";
        return reply(200, { confirmed: s.confirmed });
      }
      
      if (req.method === "GET" && req.url === "/api/tracker") {
        const pool = db.pool || db; 
        return getTrackerDashboardData(pool).then(
          (dashboardData) => reply(200, { success: true, data: dashboardData }),
          (err) => {
            console.error("Dashboard API Error:", err);
            reply(500, { success: false, message: "Failed to load tracker data." });
          }
        );
      }
      
      if (req.method === "GET" && req.url.startsWith("/api/details/")) {
        const rawDomain = decodeURIComponent(req.url.slice("/api/details/".length));
        return getWebsiteDetails(rawDomain).then(
          (result) => reply(200, { 
            success: true, 
            data: result.problems, 
            email_status: result.email_status 
          }),
          (err) => {
            console.error("Details API Error:", err);
            reply(500, { success: false, message: "Failed to load details." });
          }
        );
      }

      // NEW: Fetch contacts for Dashboard panel
      if (req.method === "GET" && req.url === "/api/contacts") {
        const pool = db.pool || db;
        return pool.query("SELECT domain, contact FROM websites WHERE contact IS NOT NULL")
          .then((r) => reply(200, { success: true, data: r.rows }))
          .catch((err) => {
            console.error("Contacts API Error:", err);
            reply(500, { success: false, message: "Failed to load contacts." });
          });
      }
      
      if (req.method === "GET" && req.url === "/tracker") {
        return db.getTracker().then(
          (rows) => reply(200, { problems: rows }),
          () => reply(500, { error: "Tracker unavailable" })
        );
      }

      if (req.method === "GET" && req.url === "/usage") {
        if (!process.env.ADMIN_TOKEN || req.headers["x-admin-token"] !== process.env.ADMIN_TOKEN) {
          return reply(403, { error: "Forbidden" });
        }
        return db.usageSummary().then((s) => {
          const cost = Number(process.env.COST_PER_RESCUE) || 0.02;
          reply(200, s ? { ...s, estimatedCostUSD: +(s.rescues * cost).toFixed(2) } : { note: "database off" });
        });
      }

      const updateMatch = req.url.match(/^\/(update-problem|fixed)\/([^/?#]+)$/);
      if (req.method === "POST" && updateMatch) {
        const fingerprint = decodeURIComponent(updateMatch[2]);
        const expectedToken = process.env.ADMIN_TOKEN;
        const providedToken = req.headers["x-admin-token"];

        if (expectedToken && providedToken !== expectedToken) {
          return reply(403, { error: "Invalid or missing Admin Token" });
        }
        
        const validStatuses = ["reported", "acknowledged", "fixed", "verified"];
        const targetStatus = validStatuses.includes(body.status) ? body.status : "fixed";
        
        const updateProblemInDb = async () => {
          const pool = db.pool || db;
          if (typeof pool.query === "function") {
            const res = await pool.query(
              "UPDATE problems SET status = $2 WHERE fingerprint = $1 RETURNING fingerprint, status",
              [fingerprint, targetStatus]
            );
            if (res.rows && res.rows.length > 0) {
              console.log(">>> DB RECORD UPDATED:", res.rows[0]);
              return res.rows[0];
            }
          }
          if (typeof db.markFixed === "function") {
            const result = await db.markFixed(fingerprint, targetStatus);
            console.log(">>> DB RECORD UPDATED (markFixed):", result);
            return result;
          }
          return null;
        };

        return updateProblemInDb().then(
          (r) => (r ? reply(200, { success: true, problem: r }) : reply(404, { error: "Unknown problem fingerprint" })),
          (err) => {
            console.error("Status update error:", err.message);
            reply(500, { error: "Update failed" });
          }
        );
      }

      const emailMatch = req.url.match(/^\/api\/log-email$/);
      if (req.method === "POST" && emailMatch) {
        // Safe placeholder response since contacted_at is removed from schema
        return reply(200, { success: true });
      }

      // Fetch report dynamically from PostgreSQL database and append Tinyfish JSON
      const reportMatch = req.url.match(/^\/api\/report\/(.+)$/);
      if (req.method === "GET" && reportMatch) {
        const targetDomain = decodeURIComponent(reportMatch[1]);
        try {
          const dbData = await db.getReportAndContact(targetDomain);
          
          if (!dbData || !dbData.report) {
            return reply(404, { success: false, error: "No report found in database." });
          }
          
          const parsedReport = typeof dbData.report === 'string' ? JSON.parse(dbData.report) : dbData.report;
          let markdownContent = reporting.toMarkdown(parsedReport);
          
          if (dbData.contact) {
            let contactObj = typeof dbData.contact === 'string' ? JSON.parse(dbData.contact) : dbData.contact;
            const formattedContact = {
              [targetDomain]: {
                isGovernment: contactObj.isGovernment || false,
                contactValue: contactObj.bestContact?.value || `admin@${targetDomain}`,
                lastEmailAt: null,
                contactType: contactObj.bestContact?.type || "email",
                contactConfidence: contactObj.bestContact?.confidence || "low"
              }
            };
            markdownContent += "\n\n---\n### Tinyfish Contact Data\n```json\n" + JSON.stringify(formattedContact, null, 2) + "\n```\n";
          } else {
            markdownContent += "\n\n---\n### Tinyfish Contact Data\n*No Tinyfish data found yet. Click 'Dispatch Email' to generate it.*";
          }

          return reply(200, { success: true, report: markdownContent });
        } catch (e) {
          console.error("Report fetch error:", e);
          return reply(500, { success: false, error: e.message });
        }
      }

      // Trigger Tinyfish & Nodemailer dispatch manually
      const dispatchMatch = req.url.match(/^\/api\/dispatch-email\/(.+)$/);
      if (req.method === "POST" && dispatchMatch) {
        const domainTarget = decodeURIComponent(dispatchMatch[1]);
        try {
          const contactData = await reporting.findContacts(`https://${domainTarget}`);
          const emailFound = contactData?.bestContact?.value || `admin@${domainTarget}`;
          
          await delivery.run();

          const pool = db.pool || db;
          // Omitting contacted_at to prevent DB constraint errors
          await pool.query(
            "UPDATE websites SET contact = $2 WHERE domain=$1", 
            [domainTarget, JSON.stringify(contactData)]
          );
          
          return reply(200, { success: true, email: emailFound });
        } catch (e) {
          console.error("Dispatch Error:", e);
          return reply(500, { success: false, error: e.message });
        }
      }

      reply(404, { error: "Not found" });
    });
  });
}

const VERIFY_STATUSES = ["verified", "unverified", "failed"];
const OUTCOMES = ["executed", "rejected", "blocked", "failed", "navigated"];

async function handleNext(s, body) {
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
    s.pending = null; 
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

  const targets = planner.sanitizeTargets(body.targets);
  const fieldValues = (Array.isArray(body.safeValues) ? body.safeValues : [])
    .filter((v) => v && !SENSITIVE_FIELD.test(v.field || ""))
    .slice(0, 30)
    .map((v) => redact({ field: String(v.field || "").slice(0, 80), value: String(v.value || "").slice(0, 80) }));

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
    await db.init().catch((e) => console.error("Database failed:", e.message));
    const g = await gemini.check();
    if (g.ok) console.log(`Gemini planner ready (model: ${g.model})`);
    else console.error(`Gemini planner NOT working: ${g.reason}`);
  });
}

module.exports = { createServer, sessions };