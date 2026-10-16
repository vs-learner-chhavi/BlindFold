const http = require("http");
const crypto = require("crypto");

const PORT = 3000;
const sessions = {}; // in-memory for now

// Second safety lock: redact personal data before storing or logging
const PATTERNS = [
  [/\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b/g, "[card]"],
  [/\b\d{4}\s?\d{4}\s?\d{4}\b/g, "[id]"],
  [/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]"],
  [/(\+?\d{1,3}[ -]?)?\b\d{10}\b/g, "[phone]"],
];
const SENSITIVE_FIELD = /passw|passcode|pwd|otp|one.?time|\bpin\b|cvv|cvc|card|expiry|aadhaar|aadhar|ssn|\bpan\b|e-?mail|phone|mobile/i;

function redact(value) {
  if (typeof value === "string") {
    return PATTERNS.reduce((s, [re, tag]) => s.replace(re, tag), value);
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out = {};
    for (const k in value) out[k] = redact(value[k]);
    return out;
  }
  return value;
}

function cleanRequest(body) {
  const safeValues = (body.safeValues || []).filter((v) => !SENSITIVE_FIELD.test(v.field || ""));
  return redact({ ...body, safeValues });
}

function send(res, code, data) {
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  res.end(JSON.stringify(data));
}

http.createServer((req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {});

  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { return send(res, 400, { error: "Bad JSON" }); }

    // POST /help -> create a rescue session
    if (req.method === "POST" && req.url === "/help") {
      if (!body.pageUrl || !body.userGoal) return send(res, 400, { error: "pageUrl and userGoal required" });
      const sessionId = crypto.randomUUID();
      sessions[sessionId] = {
        status: "in_progress",
        request: cleanRequest(body),
        confirmed: null,
        createdAt: new Date().toISOString(),
      };
      console.log("New session", sessionId, JSON.stringify(sessions[sessionId].request, null, 2));
      return send(res, 200, { sessionId, status: "in_progress" });
    }

    // GET /status/:id
    const statusMatch = req.url.match(/^\/status\/([\w-]+)$/);
    if (req.method === "GET" && statusMatch) {
      const s = sessions[statusMatch[1]];
      if (!s) return send(res, 404, { error: "Unknown session" });
      return send(res, 200, { status: s.status, confirmed: s.confirmed });
    }

    // POST /confirm/:id  { "answer": "yes" | "no" }
    const confirmMatch = req.url.match(/^\/confirm\/([\w-]+)$/);
    if (req.method === "POST" && confirmMatch) {
      const s = sessions[confirmMatch[1]];
      if (!s) return send(res, 404, { error: "Unknown session" });
      s.confirmed = body.answer === "yes";
      s.status = s.confirmed ? "in_progress" : "failed";
      return send(res, 200, { confirmed: s.confirmed });
    }

    send(res, 404, { error: "Not found" });
  });
}).listen(PORT, () => console.log("Blindfold backend on http://localhost:" + PORT));