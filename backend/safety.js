// Shared safety rules. The extension enforces the same rules locally (targets.js);
// this is the backend's independent second lock.

const PATTERNS = [
  [/\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b/g, "[card]"],
  [/\b\d{4}\s?\d{4}\s?\d{4}\b/g, "[id]"],
  [/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]"],
  [/(\+?\d{1,3}[ -]?)?\b\d{10}\b/g, "[phone]"],
];

const SENSITIVE_FIELD =
  /passw|passcode|pwd|otp|one.?time|\bpin\b|cvv|cvc|card|expiry|aadhaar|aadhar|ssn|\bpan\b|e-?mail|phone|mobile/i;

// Steps BlindFold will never perform, however the planner words them.
const CONSEQUENTIAL =
  /\b(pay|payment|book|buy|purchase|order|checkout|check out|confirm|submit|send|delete|remove|cancel|log ?in|sign ?in|sign ?up|register|proceed|place order|transfer|donate|subscribe|unsubscribe|apply now)\b/i;

function redact(value) {
  if (typeof value === "string") return PATTERNS.reduce((s, [re, tag]) => s.replace(re, tag), value);
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out = {};
    for (const k in value) out[k] = redact(value[k]);
    return out;
  }
  return value;
}

function isConsequential(...texts) {
  return texts.some((t) => CONSEQUENTIAL.test(String(t || "")));
}

module.exports = { PATTERNS, SENSITIVE_FIELD, CONSEQUENTIAL, redact, isConsequential };
