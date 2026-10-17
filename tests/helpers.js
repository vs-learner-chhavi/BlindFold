const http = require("http");
const path = require("path");
const fs = require("fs");
const vm = require("vm");
let JSDOM; // loaded lazily so backend tests do not need jsdom

const PORT = 3917;
process.env.PORT = String(PORT);
process.env.TINYFISH_API_KEY = "test-key";

function listen(handler) {
  return new Promise((resolve) => {
    const s = http.createServer(handler);
    s.listen(0, "127.0.0.1", () => resolve({ server: s, url: `http://127.0.0.1:${s.address().port}` }));
  });
}

// Mock TinyFish: every run completes immediately with a canned inspection.
// With { hang: true } the run never finishes, proving the loop does not wait for it.
async function mockTinyFish(result, { hang = false } = {}) {
  const m = await listen((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.method === "POST") return res.end(JSON.stringify({ run_id: "run-1" }));
    res.end(JSON.stringify({ status: hang ? "RUNNING" : "COMPLETED", result }));
  });
  process.env.TINYFISH_BASE_URL = m.url;
  return m;
}

// Mock Gemini: `responder(requestBody, req)` returns the model's JSON object, or
// { __status, message } for an HTTP error, or { __raw } for a raw JSON reply (e.g. a model list).
async function mockGemini(responder) {
  const m = await listen((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch { /* ignore */ }
      let out;
      try { out = responder(body, req); } catch (e) { res.statusCode = 500; return res.end("{}"); }
      if (out && out.__status) { res.statusCode = out.__status; return res.end(JSON.stringify({ error: { message: out.message || "error" } })); }
      if (out && out.__raw) return res.end(JSON.stringify(out.__raw));
      res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] } }] }));
    });
  });
  process.env.GEMINI_BASE_URL = m.url;
  return m;
}

const modelOf = (req) => (String(req.url).match(/models\/([^:/?]+)/) || [])[1];
const promptOf = (body) => JSON.parse(body.contents[0].parts[0].text);

// A tiny scripted "Gemini" for the date-picker page: open the calendar, then click 19, then finish.
// It reads the same TARGETS / HISTORY the real model gets.
function scriptedDatePlanner(body) {
  const c = promptOf(body);
  const t = c.TARGETS;
  const last = c.HISTORY[c.HISTORY.length - 1];
  if (last && /"19"/.test(last.did || "") && last.verification.status === "verified") {
    return { status: "done", goalAchieved: true, spoken: "The date is set." };
  }
  const field = t.find((x) => x.name === "Departure Date");
  const day = t.find((x) => x.name === "19" && !x.disabled);
  if (day) {
    return { status: "propose", intro: "A calendar is open.", action: { type: "click", targetId: day.id, reason: "You asked for 19 October.", expectedOutcome: "The date should change.", expect: { kind: "field_contains", targetId: field && field.id, text: "19" } } };
  }
  return { status: "propose", action: { type: "click", targetId: field.id, reason: "The calendar has to open first.", expectedOutcome: "The calendar should open.", expect: { kind: "text_visible", text: "October" } } };
}

const PAGE = `<!doctype html><body>
<form id="f">
  <label for="from">From</label><input id="from" type="text">
  <label for="dep">Departure Date</label><input id="dep" type="text" readonly value="Sun, 18 Oct">
  <label for="cls">Class</label><select id="cls"><option>Any</option><option>Sleeper</option><option>AC 3 Tier</option></select>
  <label for="pw">Password</label><input id="pw" type="password">
  <button type="button" id="search">Search trains</button>
  <button type="submit" id="book">Book now</button>
</form>
<a id="help" href="https://example.org/help">Help centre</a>
<div id="calwrap"></div>
</body>`;

// Boots the REAL extension scripts in jsdom with a fake chrome that proxies to a real backend.
function makePage({ backendUrl, html = PAGE } = {}) {
  ({ JSDOM } = require("jsdom"));
  const dom = new JSDOM(html, { url: "https://www.example-trains.test/book", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  const spoken = [];
  const store = {};

  // jsdom gaps
  Object.defineProperty(w.HTMLElement.prototype, "innerText", { get() { return this.textContent; }, configurable: true });
  if (!w.CSS) w.CSS = { escape: (s) => String(s).replace(/[^\w-]/g, "\\$&") };
  w.HTMLElement.prototype.scrollIntoView = function () {};
  w.Element.prototype.getBoundingClientRect = function () {
    for (let el = this; el && el.nodeType === 1; el = el.parentElement) {
      if (el.hasAttribute("hidden") || el.style.display === "none") return { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
    }
    if (!this.isConnected) return { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
    return { width: 60, height: 24, top: 10, left: 10, right: 70, bottom: 34 };
  };
  w.document.elementFromPoint = () => w.__hit || null;
  w.speechSynthesis = {
    cancel() {},
    speak(u) { spoken.push(u.text); setTimeout(() => u.onend && u.onend(), 0); },
  };
  w.SpeechSynthesisUtterance = function (t) { this.text = t; };

  const handler = async (msg) => {
    if (msg.type === "BF_TAB_ID") return { tabId: 7 };
    if (msg.type === "BF_API") {
      const r = await fetch(backendUrl + msg.path, {
        method: msg.method,
        headers: { "Content-Type": "application/json", Origin: "chrome-extension://testextensionid", Host: `localhost:${PORT}` },
        body: msg.method === "POST" ? JSON.stringify(msg.body || {}) : undefined,
      });
      return { ok: r.ok, status: r.status, data: await r.json().catch(() => null) };
    }
  };
  w.chrome = {
    runtime: { sendMessage: (m) => handler(m), onMessage: { addListener() {} } },
    storage: { local: {
      async get(k) { return k in store ? { [k]: store[k] } : {}; },
      async set(o) { Object.assign(store, JSON.parse(JSON.stringify(o))); },
      async remove(k) { delete store[k]; },
    } },
  };

  const ctx = dom.getInternalVMContext();
  const dir = path.join(__dirname, "..", "extension");
  for (const f of ["sensitive.js", "a11yTree.js", "capture.js", "describe.js", "goal.js", "targets.js", "executor.js", "loop.js"]) {
    new vm.Script(fs.readFileSync(path.join(dir, f), "utf8"), { filename: f }).runInContext(ctx);
  }
  // content.js defines announce(); include it but skip its auto-resume side effect
  const content = fs.readFileSync(path.join(dir, "content.js"), "utf8").replace(/\nbfResumeIfPending\(\);\s*$/, "\n");
  new vm.Script(content, { filename: "content.js" }).runInContext(ctx);

  const run = (code) => new vm.Script(code).runInContext(ctx);

  // fake date picker: opens on click of #dep, cells react to listeners (no onclick attribute)
  const doc = w.document;
  doc.getElementById("dep").addEventListener("click", () => {
    if (doc.getElementById("cal")) return;
    const cal = doc.createElement("div");
    cal.id = "cal";
    cal.setAttribute("role", "dialog");
    cal.innerHTML = "<div>October 2026</div>";
    for (let d = 1; d <= 31; d++) {
      const c = doc.createElement("div");
      c.textContent = String(d);
      c.style.cursor = "pointer";
      if (d < 19) c.setAttribute("aria-disabled", "true");
      else c.addEventListener("click", () => {
        doc.getElementById("dep").value = `Mon, ${d} Oct`;
        cal.remove();
      });
      cal.appendChild(c);
    }
    doc.getElementById("calwrap").appendChild(cal);
  });

  return { dom, w, doc, run, spoken, store, press: (key) => doc.dispatchEvent(new w.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })) };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond, ms = 8000, what = "condition") {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const v = await cond();
    if (v) return v;
    await sleep(30);
  }
  throw new Error("timed out waiting for " + what);
}

module.exports = { PORT, listen, mockTinyFish, mockGemini, modelOf, promptOf, scriptedDatePlanner, makePage, waitFor, sleep };
