// Returns true if a field must NEVER be captured
function isSensitiveField(el) {
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toLowerCase();
  if (!["input", "textarea", "select"].includes(tag)) return false;

  const type = (el.getAttribute("type") || "").toLowerCase();
  if (["password", "hidden", "file", "email", "tel"].includes(type)) return true;

  const ac = (el.getAttribute("autocomplete") || "").toLowerCase();
  if (/cc-|one-time-code|password/.test(ac)) return true;

  const hint = [el.name, el.id, el.placeholder, el.getAttribute("aria-label")]
    .join(" ")
    .toLowerCase();
  return /passw|passcode|pwd|otp|one.?time|\bpin\b|cvv|cvc|card|expiry|aadhaar|aadhar|ssn|\bpan\b|e-?mail|phone|mobile|contact/.test(hint);
}