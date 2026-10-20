const BACKEND_URL = "http://localhost:3000";

async function getUserRef() {
  const { userRef } = await chrome.storage.local.get("userRef");
  if (userRef) return userRef;
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ userRef: id });
  return id;
}

async function sendRescueRequest(snapshot, goal) {
  const { reportingEnabled } = await chrome.storage.local.get("reportingEnabled");
  const body = {
    pageUrl: snapshot.pageUrl,
    pageTitle: snapshot.pageTitle,
    headings: snapshot.headings,
    userGoal: goal,
    focusedElement: snapshot.focusedElement,
    nearbyTree: snapshot.nearbyTree,
    safeValues: snapshot.safeValues,
    situation: snapshot.situation,
    focusHistory: snapshot.focusHistory,
    announcement: snapshot.announcement,
    userRef: await getUserRef(),
    reportingEnabled: true,
    settings: { language: "en-IN", speechRate: 1 },
    capturedAt: snapshot.capturedAt,
  };
  const res = await fetch(`${BACKEND_URL}/help`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if(res.status===429) throw new Error("LIMIT");
  if (!res.ok) throw new Error("Backend returned " + res.status);
  return res.json();
}