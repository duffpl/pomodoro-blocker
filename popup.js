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

// Highlight the chip matching its input's current value.
function markActiveChips() {
  document.querySelectorAll(".input-row").forEach((row) => {
    const value = row.querySelector(".num-input").value;
    row.querySelectorAll(".chip").forEach((chip) => {
      chip.classList.toggle("active", chip.dataset.preset === value);
    });
  });
}

let timer = null;

async function render() {
  const { session, settings, blocklist } = await chrome.storage.local.get({
    session: null,
    settings: { sessionMin: 60, workMin: 30, breakMin: 5 },
    blocklist: []
  });
  clearInterval(timer);

  show($("stop-confirm"), false);
  $("stop-phrase").value = "";
  $("stop-confirmed").disabled = true;

  if (!session) {
    show($("setup-view"), true);
    show($("running-view"), false);
    $("session-length").value = settings.sessionMin;
    $("break-every").value = settings.workMin;
    $("break-length").value = settings.breakMin;
    $("blocked-sites").value = blocklist.join("\n");
    markActiveChips();
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

  const update = () => {
    const now = Date.now();
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
    $("status-badge").textContent = working ? "Focusing" : "Break";
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
  timer = setInterval(update, 1000);
}

$("start-btn").addEventListener("click", async () => {
  $("error").textContent = "";
  const settings = {
    sessionMin: parseInt($("session-length").value, 10),
    workMin: parseInt($("break-every").value, 10),
    breakMin: parseInt($("break-length").value, 10)
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
    blocklist = parseDomains($("blocked-sites").value);
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

$("end-btn").addEventListener("click", () => {
  show($("stop-confirm"), true);
  $("stop-phrase").focus();
});

$("stop-phrase").addEventListener("input", () => {
  $("stop-confirmed").disabled = $("stop-phrase").value.trim() !== "I give up";
});

$("stop-confirmed").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ cmd: "stop" }).catch(() => {});
  render();
});

document.querySelectorAll(".input-row").forEach((row) => {
  const input = row.querySelector(".num-input");
  input.addEventListener("input", markActiveChips);
  row.addEventListener("click", (e) => {
    if (e.target.matches(".chip")) {
      input.value = e.target.dataset.preset;
      markActiveChips();
    }
  });
});

$("settings-link").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

render();
