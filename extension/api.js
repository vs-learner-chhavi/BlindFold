const BACKEND_URL = "http://localhost:3000"; // replace with M1's hosted URL later

async function sendRescueRequest(snapshot, goal) {
  const body = {
    pageUrl: snapshot.pageUrl,
    pageTitle: snapshot.pageTitle,
    userGoal: goal,
    focusedElement: snapshot.focusedElement,
    nearbyTree: snapshot.nearbyTree,
    safeValues: snapshot.safeValues,
    situation: snapshot.situation,
    settings: { language: "en-IN", speechRate: 1 },
    capturedAt: snapshot.capturedAt,
  };
  const res = await fetch(`${BACKEND_URL}/help`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Backend returned " + res.status);
  return res.json(); // expected: { sessionId: "..." }
}