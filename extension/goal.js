// Goal capture (2.3 voice, 2.4 typed fallback) + read-back confirmation.
function speak(text, onEnd) {
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-IN";
    if (onEnd) { u.onend = onEnd; u.onerror = onEnd; }
    speechSynthesis.speak(u);
  } catch (e) { if (onEnd) onEnd(); }
}

function openGoalDialog(snapshot) {
  if (document.getElementById("blindfold-dialog")) return;
  const previouslyFocused = document.activeElement;
  let step = "goal";
  let goal = "";
  let recognition = null;
  let errored = false;

  const box = document.createElement("div");
  box.id = "blindfold-dialog";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.setAttribute("aria-labelledby", "bf-title");
  box.style.cssText =
    "position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:2147483647;" +
    "width:min(520px,92vw);background:#0B1F3A;color:#fff;border:3px solid #FF8A00;" +
    "border-radius:12px;padding:20px;font:18px/1.4 Arial,sans-serif;box-shadow:0 8px 30px #000a;";
  box.innerHTML =
    '<h2 id="bf-title" style="margin:0 0 10px;font-size:22px;color:#FF8A00">Blindfold</h2>' +
    '<p id="bf-status" role="status" aria-live="polite" style="margin:0 0 12px">What do you need help with?</p>' +
    '<label for="bf-goal" style="display:block;margin-bottom:6px">Your goal (press Enter to continue)</label>' +
    '<input id="bf-goal" type="text" style="width:100%;box-sizing:border-box;padding:10px;font-size:18px;border-radius:6px;border:2px solid #14B8A6">' +
    '<div style="margin-top:12px;display:flex;gap:10px">' +
    '<button id="bf-speak" type="button" style="padding:10px 14px;font-size:16px;background:#14B8A6;border:0;border-radius:6px">Speak</button>' +
    '<button id="bf-cancel" type="button" style="padding:10px 14px;font-size:16px;background:#fff;border:0;border-radius:6px">Cancel</button>' +
    "</div>";
  document.body.appendChild(box);

  const input = box.querySelector("#bf-goal");
  const status = box.querySelector("#bf-status");
  const setStatus = (t) => (status.textContent = t);

  function stopListening() {
    if (recognition) { try { recognition.abort(); } catch (e) {} recognition = null; }
  }

  function close(message) {
    stopListening();
    speechSynthesis.cancel();
    document.removeEventListener("keydown", onKey, true);
    box.remove();
    if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus();
    if (message) announce(message);
  }

  function askConfirm() {
    step = "confirm";
    const msg = "You said: " + goal + ". Press Enter to send, or Escape to cancel. You can also edit the text.";
    setStatus(msg);
    speak(msg);
    input.focus();
  }

  function submitFromInput() {
    const v = input.value.trim();
    if (!v) { speak("Please say or type your goal."); return; }
    if (step === "confirm" && v === goal) {
      chrome.runtime.sendMessage({ type: "GOAL_READY", snapshot, goal: normalizeGoal(goal, snapshot)});
      close("Sending your request.");
    } else {
      goal = v;
      askConfirm();
    }
  }

  function startListening() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      const m = "Voice input is not available. Type your goal and press Enter.";
      setStatus(m); speak(m); input.focus(); return;
    }
    stopListening();
    errored = false;
    recognition = new SR();
    recognition.lang = "en-IN";
    recognition.interimResults = true;
    recognition.onresult = (e) => {
      let t = "";
      for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
      input.value = t;
    };
    recognition.onerror = (e) => {
      errored = true;
      const m = "I couldn't use the microphone. Type your goal and press Enter.";
      setStatus(m); speak(m); input.focus();
    };
    recognition.onend = () => {
      if (errored || step !== "goal") return;
      if (input.value.trim()) { goal = input.value.trim(); askConfirm(); }
      else {
        const m = "I didn't catch that. Press the Speak button to try again, or type your goal.";
        setStatus(m); speak(m); input.focus();
      }
    };
    setStatus("Listening...");
    recognition.start();
  }

  function onKey(e) {
    if (e.key === "Escape") {
      e.preventDefault(); e.stopPropagation();
      close("Cancelled. Nothing was sent.");
    }
  }
  document.addEventListener("keydown", onKey, true);

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); stopListening(); submitFromInput(); }
  });
  box.querySelector("#bf-speak").addEventListener("click", () => { step = "goal"; input.value = ""; startListening(); });
  box.querySelector("#bf-cancel").addEventListener("click", () => close("Cancelled. Nothing was sent."));

  const intro = snapshot.situation ? snapshot.situation.spoken : "What do you need help with?";
  setStatus(intro);
  input.focus();
  speak(intro + " Speak after the pause, or type and press Enter.", startListening);
}