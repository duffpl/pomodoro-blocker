const $ = (id) => document.getElementById(id);

function fmt(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

let timer = null;

async function render() {
  const { session, settings, blocklist } = await chrome.storage.local.get({
    session: null,
    settings: { sessionMin: 60, workMin: 30, breakMin: 5 },
    blocklist: []
  });
  clearInterval(timer);

  $("stop-confirm").hidden = true;
  $("stop-phrase").value = "";
  $("stop-confirmed").disabled = true;

  if (!session) {
    $("idle-view").hidden = false;
    $("running-view").hidden = true;
    $("sessionMin").value = settings.sessionMin;
    $("workMin").value = settings.workMin;
    $("breakMin").value = settings.breakMin;
    $("blocklist").value = blocklist.join("\n");
    return;
  }

  $("idle-view").hidden = true;
  $("running-view").hidden = false;
  const update = () => {
    const now = Date.now();
    const current = session.schedule.find((p) => p.endsAt > now);
    if (!current) {
      // Session just ended while popup was open. Stop ticking instead of
      // recursing into render(): storage may still hold the expired
      // session for up to ~2s until the background phase-end alarm clears
      // it, and re-rendering into another running-view branch would spin
      // up a fresh setInterval every second, hammering storage.get in a
      // tight loop until the background finally nulls the session.
      clearInterval(timer);
      $("phase-label").textContent = "Session complete";
      $("countdown").textContent = "0:00";
      return;
    }
    $("phase-label").textContent = current.phase === "working" ? "Focus time" : "Break";
    $("countdown").textContent = fmt(current.endsAt - now);
    const last = session.schedule[session.schedule.length - 1];
    const ends = new Date(last.endsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    $("session-info").textContent = `Session ends at ${ends}`;
  };
  update();
  timer = setInterval(update, 1000);
}

$("start").addEventListener("click", async () => {
  $("error").textContent = "";
  const settings = {
    sessionMin: parseInt($("sessionMin").value, 10),
    workMin: parseInt($("workMin").value, 10),
    breakMin: parseInt($("breakMin").value, 10)
  };
  if (Object.values(settings).some((v) => !Number.isInteger(v) || v < 1)) {
    $("error").textContent = "All durations must be positive whole minutes.";
    return;
  }
  if (settings.breakMin >= settings.workMin) {
    $("error").textContent = "Break must be shorter than the interval between breaks.";
    return;
  }
  let blocklist;
  try {
    blocklist = parseDomains($("blocklist").value);
  } catch (e) {
    $("error").textContent = e.message;
    return;
  }
  if (blocklist.length === 0) {
    $("error").textContent = "Add at least one site to block.";
    return;
  }
  const resp = await chrome.runtime.sendMessage({ cmd: "start", settings, blocklist })
    .catch((e) => ({ ok: false, error: String(e) }));
  if (!resp?.ok) {
    $("error").textContent = `Could not start session: ${resp?.error || "no response"}`;
    return;
  }
  render();
});

$("stop").addEventListener("click", () => {
  $("stop-confirm").hidden = false;
  $("stop-phrase").focus();
});

$("stop-phrase").addEventListener("input", () => {
  $("stop-confirmed").disabled = $("stop-phrase").value.trim() !== "I give up";
});

$("stop-confirmed").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ cmd: "stop" }).catch(() => {});
  render();
});

document.querySelectorAll(".presets").forEach((group) => {
  group.addEventListener("click", (e) => {
    if (e.target.matches(".preset")) $(group.dataset.target).value = e.target.textContent;
  });
});

$("open-options").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

render();
