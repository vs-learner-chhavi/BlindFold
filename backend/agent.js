
const TINYFISH_BASE_URL = "https://agent.tinyfish.ai/v1";




function buildGoal(request) {
  const userGoal = String(request?.userGoal || "").trim();

  if (!userGoal) {
    throw new Error("A user goal is required.");
  }

  const situation = String(
    request?.situation?.summary || ""
  ).trim().slice(0, 300);

  return [
    `Task: ${userGoal}`,
    situation ? `Context: ${situation}` : "",
    "Inspect the public webpage and report only what you observe.",
    "Do not click buttons or submit forms.",
    "Do not log in, enter personal information, or make a booking.",
    "Do not enter passwords, OTPs, or payment details."
  ].filter(Boolean).join("\n");
}






function validateTargetUrl(value) {
  let url;

  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid target URL");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only HTTP(S) pages are supported");
  }

  if (url.username || url.password) {
    throw new Error("URLs containing credentials are not allowed");
  }

  // Local and private-network protection must also be implemented
  // in the shared backend, including DNS and redirect validation.
  const hostname = url.hostname.toLowerCase();

  if (
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === "0.0.0.0" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    /^127\./.test(hostname) ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^169\.254\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
  ) {
    throw new Error("Private and local websites are not supported");
  }

  return url.toString();
}

async function tinyfishRequest(path, options = {}) {
  const apiKey = process.env.TINYFISH_API_KEY;

  if (!apiKey) {
    throw new Error("TINYFISH_API_KEY is not configured");
  }

  const response = await fetch(`${TINYFISH_BASE_URL}${path}`, {
    ...options,
    headers: {
      "X-API-Key": apiKey,
      "Content-Type": "application/json",
      ...options.headers,
    },
    signal: AbortSignal.timeout(30000),
  });

  const text = await response.text();
  let data;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error("TinyFish returned an invalid response");
  }

  if (!response.ok) {
    // Do not include request bodies, secrets, or raw page content
    // in an error that might be stored or returned to the extension.
    throw new Error(`TinyFish API error: HTTP ${response.status}`);
  }

  return data;
}

async function startRun(request) {
  const url = validateTargetUrl(request.pageUrl);
  const goal = buildGoal(request);

  const data = await tinyfishRequest("/automation/run-async", {
    method: "POST",
    body: JSON.stringify({
      url,
      goal,
    }),
  });

  if (!data.run_id) {
    throw new Error("TinyFish did not return a run ID");
  }

  return data.run_id;
}

async function getRun(runId) {
  return tinyfishRequest(
    `/runs/${encodeURIComponent(runId)}`
  );
}


function normalizeRun(data) {
  const providerStatus = String(data.status || "UNKNOWN").toUpperCase();

  if (providerStatus === "FAILED" || providerStatus === "CANCELLED") {
    // Keep the provider's error for local debugging, but don't
    // send arbitrary provider error text to the extension.
    const providerError = data.error;

    return {
      status: "failed",
      summary: "I couldn't complete that step. Please try again.",
      result: null,
      diagnostic: {
        providerStatus,
        providerError:
          typeof providerError === "string"
            ? providerError.slice(0, 500)
            : providerError?.message
              ? String(providerError.message).slice(0, 500)
              : null,
      },
    };
  }

  if (providerStatus !== "COMPLETED") {
    return {
      status: "in_progress",
      summary: "I'm still checking the page.",
      result: null,
      diagnostic: { providerStatus },
    };
  }

  const result = data.result ?? null;

  return {
    status: "needs_review",
    summary:
      "The website check finished. I need to verify the result " +
      "before confirming that your task is complete.",
    result,
    diagnostic: { providerStatus },
  };
}


module.exports = {
  buildGoal,
  startRun,
  getRun,
  normalizeRun,
};
