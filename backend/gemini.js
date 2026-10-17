// Gemini client for BlindFold.
//
// Why this exists: Google retires models on a schedule (gemini-2.5-flash was shut down on
// the Developer API on 16 Oct 2026) and a retired model answers HTTP 404. Hard-coding one
// model name means the product silently dies on a date nobody is watching. So this client:
//   1. tries the configured model, then a list of known-good models,
//   2. if all of those 404, asks Google which models this key can use and picks the best Flash,
//   3. remembers whatever worked, and tells you (in plain words) what happened and what to fix.
//
// It never logs the API key, the prompt or the page contents.

const DEFAULT_CHAIN = ["gemini-3.6-flash", "gemini-flash-latest", "gemini-3.5-flash", "gemini-3-flash-preview"];

class GeminiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

let resolvedModel = null; // last model that actually answered

const baseUrl = () => process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function request(path, { method = "GET", body, timeoutMs = 25000 } = {}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new GeminiError(0, "GEMINI_API_KEY is not set");
  let res;
  try {
    res = await fetch(`${baseUrl()}${path}`, {
      method,
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new GeminiError(0, e && e.name === "TimeoutError" ? "Gemini timed out" : "Could not reach Gemini (network)");
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON error body */ }
  if (!res.ok) {
    const msg = (data && data.error && data.error.message) || `HTTP ${res.status}`;
    throw new GeminiError(res.status, String(msg).slice(0, 200));
  }
  return data;
}

function buildBody(system, user, withThinking) {
  const generationConfig = { responseMimeType: "application/json", maxOutputTokens: 4096 };
  // Gemini 3.x Flash rejects custom temperature/top-p, so none is sent.
  if (withThinking) generationConfig.thinkingConfig = { thinkingLevel: "low" }; // fast: this is a short planning task
  return {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: user }] }],
    generationConfig,
  };
}

function extractText(data) {
  const cand = data && data.candidates && data.candidates[0];
  const parts = (cand && cand.content && cand.content.parts) || [];
  // Skip "thought" parts if the API returns them.
  return parts.filter((p) => !p.thought).map((p) => p.text || "").join("").trim();
}

// One model, with one retry for transient trouble and one simplified retry if the config is refused.
async function tryModel(model, system, user) {
  const path = `/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  let withThinking = true;
  let transientRetried = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const data = await request(path, { method: "POST", body: buildBody(system, user, withThinking) });
      const text = extractText(data);
      if (!text) throw new GeminiError(502, "Gemini returned an empty answer");
      return text;
    } catch (e) {
      if (!(e instanceof GeminiError)) throw e;
      if (e.status === 400 && withThinking && !/api key/i.test(e.message)) { withThinking = false; continue; }
      const transient = e.status === 0 || e.status === 429 || e.status >= 500;
      if (transient && !transientRetried) { transientRetried = true; await sleep(700); continue; }
      throw e;
    }
  }
  throw new GeminiError(502, "Gemini kept failing");
}

// "gemini-3.6-flash" -> [3, 6]
const versionOf = (name) => (name.match(/gemini-(\d+(?:\.\d+)?)/) || [0, "0"])[1].split(".").map(Number);
function newer(a, b) {
  const [a1 = 0, a2 = 0] = versionOf(a);
  const [b1 = 0, b2 = 0] = versionOf(b);
  if (a1 !== b1) return b1 - a1;
  if (a2 !== b2) return b2 - a2;
  return (/preview|exp/.test(a) ? 1 : 0) - (/preview|exp/.test(b) ? 1 : 0); // stable before preview
}

async function discoverModels() {
  const data = await request("/v1beta/models?pageSize=200", { timeoutMs: 10000 });
  return (data.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
    .map((m) => String(m.name || "").replace(/^models\//, ""))
    .filter((n) => /^gemini-\d/.test(n) && /flash/.test(n) && !/lite|image|live|audio|tts|embed|thinking|robotics|computer/.test(n))
    .sort(newer);
}

async function generateJson(system, user) {
  const tried = new Set();
  const wanted = [resolvedModel, process.env.GEMINI_MODEL, ...DEFAULT_CHAIN].filter(Boolean);
  let last = null;

  const attempt = async (model) => {
    tried.add(model);
    const text = await tryModel(model, system, user);
    if (resolvedModel !== model) {
      if (process.env.GEMINI_MODEL && process.env.GEMINI_MODEL !== model && tried.has(process.env.GEMINI_MODEL)) {
        console.warn(`BlindFold: GEMINI_MODEL=${process.env.GEMINI_MODEL} is not available any more. Using ${model}. Update GEMINI_MODEL in backend/.env.`);
      }
      resolvedModel = model;
    }
    return text;
  };

  for (const model of wanted) {
    if (tried.has(model)) continue;
    try { return await attempt(model); } catch (e) {
      last = e;
      if (e.status !== 404) throw e; // 404 = model gone/unknown, so try the next. Anything else is not a model-name problem.
    }
  }

  // Every known name was 404. Ask Google what this key can actually use.
  try {
    const available = (await discoverModels()).filter((m) => !tried.has(m)).slice(0, 3);
    for (const model of available) {
      try { return await attempt(model); } catch (e) { last = e; if (e.status !== 404) throw e; }
    }
  } catch (e) {
    if (e instanceof GeminiError && e.status !== 404) last = e;
  }
  throw last || new GeminiError(404, "No usable Gemini model found");
}

// Startup / /health check. Never throws.
async function check() {
  if (!process.env.GEMINI_API_KEY) return { ok: false, reason: "GEMINI_API_KEY is not set in backend/.env" };
  try {
    const text = await generateJson('Reply with only this JSON: {"ok":true}', "ping");
    JSON.parse(text);
    return { ok: true, model: resolvedModel };
  } catch (e) {
    return { ok: false, reason: explain(e) };
  }
}

// Plain-words diagnosis for the developer's terminal.
function explain(e) {
  const s = e && e.status;
  if (s === 404) return "No available Gemini model answered (404). The model in GEMINI_MODEL has probably been retired. Set GEMINI_MODEL=gemini-3.6-flash in backend/.env.";
  if (s === 400 && /api key/i.test(e.message)) return "Gemini rejected the API key. Check GEMINI_API_KEY in backend/.env.";
  if (s === 401 || s === 403) return `Gemini refused the request (${s}). Check that GEMINI_API_KEY is valid and the Gemini API is enabled for it.`;
  if (s === 429) return "Gemini rate limit or quota reached (429). Wait a minute or check your quota.";
  if (s === 0) return String(e.message);
  return `Gemini error ${s || ""}: ${String((e && e.message) || e).slice(0, 120)}`;
}

module.exports = { generateJson, check, explain, GeminiError, DEFAULT_CHAIN, _reset: () => { resolvedModel = null; } };
