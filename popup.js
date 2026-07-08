const $ = (id) => document.getElementById(id);

const RING_CIRCUMFERENCE = 465; // 2π·74, matches the SVG in popup.html

function fmt(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function show(el, on) {
  el.style.display = on ? "flex" : "none";
}

// Stepper values live in .stepper-num spans (id = the field name).
const getVal = (id) => parseInt($(id).textContent, 10) || 0;
const setVal = (id, v) => { $(id).textContent = String(Math.max(1, v)); };

// Highlight the preset chip matching each stepper's current value, and
// refresh the computed summary.
function refreshSetup() {
  document.querySelectorAll(".stepper").forEach((stepper) => {
    const value = $(stepper.dataset.field).textContent;
    stepper.parentElement.querySelectorAll(".preset").forEach((preset) => {
      preset.classList.toggle("active", preset.dataset.preset === value);
    });
  });
  updateSummary();
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

// Focus blocks / breaks derived the same way buildSchedule splits time:
// each full "break every" cycle is one work period + one break, then the
// remainder is a final work period. Total is the session length (breaks sit
// inside it, so they don't extend the clock).
function updateSummary() {
  const sessionMin = getVal("session-length");
  const workMin = getVal("break-every");
  const breakMin = getVal("break-length");
  let blocks = 1, breaks = 0, left = sessionMin;
  if (workMin > breakMin) {
    while (left > workMin) { blocks++; breaks++; left -= workMin; }
  }
  const h = Math.floor(sessionMin / 60);
  const m = sessionMin % 60;
  const total = h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
  $("summary-blocks").textContent = plural(blocks, "focus block");
  $("summary-breaks").textContent = plural(breaks, "break");
  $("summary-total").textContent = `${total} total`;
}

let timer = null;

async function render() {
  const { session, settings, blocklist } = await chrome.storage.local.get({
    session: null,
    settings: { sessionMin: 60, workMin: 30, breakMin: 5 },
    blocklist: DEFAULT_BLOCKLIST
  });
  clearInterval(timer);

  show($("stop-confirm"), false);
  $("stop-phrase").value = "";
  $("stop-confirmed").disabled = true;

  show($("sites-edit"), false);
  $("blocking-list").style.display = "";
  $("edit-sites").textContent = "Edit";
  $("sites-edit-error").textContent = "";

  if (!session) {
    show($("setup-view"), true);
    show($("running-view"), false);
    setVal("session-length", settings.sessionMin);
    setVal("break-every", settings.workMin);
    setVal("break-length", settings.breakMin);
    refreshSetup();
    return;
  }

  show($("setup-view"), false);
  show($("running-view"), true);

  $("blocking-list").replaceChildren(
    ...blocklist.map((d) => {
      const tag = document.createElement("span");
      tag.className = "site-tag";
      tag.textContent = d;
      return tag;
    })
  );
  const last = session.schedule[session.schedule.length - 1];
  const ends = new Date(last.endsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  $("timer-ends").textContent = `session ends ${ends}`;

  // Session timeline: a bar per work period, a dot per break.
  const startedAt = session.startedAt ?? session.schedule[0].endsAt;
  const segs = session.schedule.map((p, idx) => ({
    phase: p.phase,
    startsAt: idx > 0 ? session.schedule[idx - 1].endsAt : startedAt,
    endsAt: p.endsAt
  }));
  $("timeline-track").replaceChildren(
    ...segs.map((seg) => {
      if (seg.phase === "working") {
        const bar = document.createElement("div");
        bar.className = "seg-bar";
        seg.el = document.createElement("div");
        seg.el.className = "seg-fill";
        bar.appendChild(seg.el);
        return bar;
      }
      seg.el = document.createElement("div");
      seg.el.className = "seg-dot";
      return seg.el;
    })
  );
  const totalMin = Math.round((last.endsAt - startedAt) / 60000);
  const updateTimeline = (now) => {
    for (const seg of segs) {
      if (seg.phase === "working") {
        const dur = seg.endsAt - seg.startsAt;
        const frac = dur > 0 ? Math.min(1, Math.max(0, (now - seg.startsAt) / dur)) : 0;
        seg.el.style.width = (frac * 100).toFixed(1) + "%";
      } else {
        seg.el.classList.toggle("passed", now >= seg.endsAt);
      }
    }
    const elapsedMin = Math.min(totalMin, Math.max(0, Math.floor((now - startedAt) / 60000)));
    $("timeline-elapsed").textContent = `${elapsedMin} / ${totalMin} min`;
  };

  const paused = !!session.pausedAt;
  $("pause-mark").classList.toggle("on", paused);
  $("pause-btn").classList.toggle("paused", paused);
  $("pause-btn-label").textContent = paused ? "Resume" : "Pause";

  const update = () => {
    // While paused the schedule is frozen at pausedAt, so render that instant.
    const now = session.pausedAt ?? Date.now();
    updateTimeline(now);
    const i = session.schedule.findIndex((p) => p.endsAt > now);
    if (i === -1) {
      // Session just ended while popup was open. Stop ticking instead of
      // recursing into render(): storage may still hold the expired session
      // until the background phase-end alarm clears it.
      clearInterval(timer);
      $("status-badge").textContent = "Done";
      $("timer-time").textContent = "0:00";
      $("timer-sub").textContent = "session complete";
      $("blocking-count").textContent = "Sites unblocked";
      $("ring-progress").style.strokeDashoffset = RING_CIRCUMFERENCE;
      return;
    }
    const current = session.schedule[i];
    const working = current.phase === "working";
    const isLast = i === session.schedule.length - 1;
    $("timer-time").textContent = fmt(current.endsAt - now);
    $("status-badge").textContent = paused ? "Paused" : working ? "Focusing" : "Break";
    $("timer-sub").textContent = working
      ? (isLast ? "until session ends" : "until break")
      : "until focus resumes";
    $("blocking-count").textContent = working
      ? `Blocking ${blocklist.length} site${blocklist.length === 1 ? "" : "s"}`
      : "Break — sites unblocked";

    // Ring drains as the phase elapses (offset 0 = full ring).
    const startsAt = i > 0 ? session.schedule[i - 1].endsAt : session.startedAt;
    const duration = current.endsAt - startsAt;
    const elapsed = duration > 0 ? Math.min(1, Math.max(0, (now - startsAt) / duration)) : 0;
    $("ring-progress").style.strokeDashoffset = String(RING_CIRCUMFERENCE * elapsed);
  };
  update();
  if (!paused) timer = setInterval(update, 1000);
}

$("start-btn").addEventListener("click", async () => {
  $("error").textContent = "";
  const settings = {
    sessionMin: getVal("session-length"),
    workMin: getVal("break-every"),
    breakMin: getVal("break-length")
  };
  if (Object.values(settings).some((v) => !Number.isInteger(v) || v < 1)) {
    $("error").textContent = "All durations must be positive whole minutes.";
    return;
  }
  if (settings.breakMin >= settings.workMin) {
    $("error").textContent = "Break must be shorter than the interval between breaks.";
    return;
  }
  const { blocklist } = await chrome.storage.local.get({ blocklist: DEFAULT_BLOCKLIST });
  if (blocklist.length === 0) {
    $("error").textContent = "Add at least one site to block in settings.";
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

async function togglePause() {
  const { session } = await chrome.storage.local.get({ session: null });
  if (!session) return;
  const cmd = session.pausedAt ? "resume" : "pause";
  await chrome.runtime.sendMessage({ cmd }).catch(() => {});
  render();
}
$("pause-btn").addEventListener("click", togglePause);
$("ring-click").addEventListener("click", togglePause);

$("end-btn").addEventListener("click", () => {
  show($("stop-confirm"), true);
  $("stop-phrase").focus();
});

$("stop-phrase").addEventListener("input", () => {
  $("stop-confirmed").disabled = $("stop-phrase").value.trim() !== "I give up";
});

$("stop-phrase").addEventListener("keydown", (e) => {
  // Enter confirms the stop, but only once the phrase is valid (same guard
  // as the button's disabled state).
  if (e.key === "Enter" && !$("stop-confirmed").disabled) stopSession();
});

async function stopSession() {
  await chrome.runtime.sendMessage({ cmd: "stop" }).catch(() => {});
  render();
}
$("stop-confirmed").addEventListener("click", stopSession);

document.querySelectorAll(".field").forEach((field) => {
  const stepper = field.querySelector(".stepper");
  if (!stepper) return;
  const id = stepper.dataset.field;
  const step = parseInt(stepper.dataset.step, 10);
  field.addEventListener("click", (e) => {
    if (e.target.matches(".preset")) {
      setVal(id, parseInt(e.target.dataset.preset, 10));
      refreshSetup();
    } else if (e.target.matches(".stepper-btn")) {
      setVal(id, getVal(id) + parseInt(e.target.dataset.dir, 10) * step);
      refreshSetup();
    }
  });
});

document.querySelectorAll(".settings-link, #settings-link").forEach((link) => {
  link.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
});

// Live blocklist editing during a session: the background's set-blocklist
// command re-installs DNR rules and sweeps tabs mid-work-phase.
$("edit-sites").addEventListener("click", async (e) => {
  e.preventDefault();
  const editing = $("sites-edit").style.display === "flex";
  if (!editing) {
    const { blocklist } = await chrome.storage.local.get({ blocklist: [] });
    $("sites-edit-input").value = blocklist.join("\n");
  }
  $("sites-edit-error").textContent = "";
  show($("sites-edit"), !editing);
  $("blocking-list").style.display = editing ? "" : "none";
  $("edit-sites").textContent = editing ? "Edit" : "Cancel";
});

$("sites-edit-apply").addEventListener("click", async () => {
  $("sites-edit-error").textContent = "";
  let blocklist;
  try {
    blocklist = parseDomains($("sites-edit-input").value);
  } catch (e) {
    $("sites-edit-error").textContent = e.message;
    return;
  }
  if (blocklist.length === 0) {
    $("sites-edit-error").textContent = "Add at least one site to block.";
    return;
  }
  const resp = await chrome.runtime.sendMessage({ cmd: "set-blocklist", blocklist })
    .catch((e) => ({ ok: false, error: String(e) }));
  if (!resp?.ok) {
    $("sites-edit-error").textContent = `Could not apply: ${resp?.error || "no response"}`;
    return;
  }
  render();
});

render();
