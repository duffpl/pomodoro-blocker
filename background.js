importScripts("schedule.js");

// Pomodoro Blocker service worker

// ---- blocking ----------------------------------------------------------

async function applyBlockRules(blocklist) {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const blockedBase = chrome.runtime.getURL("blocked.html");
  const rules = blocklist.map((domain, i) => {
    const esc = domain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return {
      id: i + 1,
      priority: 1,
      action: {
        type: "redirect",
        // \1 = the entire original URL, carried raw to the block page so it
        // can offer a way back once the break starts
        redirect: { regexSubstitution: blockedBase + "?from=\\1" }
      },
      condition: {
        // host is the domain or a subdomain, then port/path/query or end —
        // same anchoring as "||domain^" (no prefix over-matches)
        regexFilter: "^(https?://(?:[^/]*\\.)?" + esc + "(?:[/:?#].*)?)$",
        isUrlFilterCaseSensitive: false,
        resourceTypes: ["main_frame"]
      }
    };
  });
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existing.map((r) => r.id),
      addRules: rules
    });
  } catch (e) {
    // updateDynamicRules is all-or-nothing; one bad entry must not disable
    // blocking for the rest. Retry one-by-one, skipping failures.
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existing.map((r) => r.id)
    });
    for (const rule of rules) {
      try {
        await chrome.declarativeNetRequest.updateDynamicRules({ addRules: [rule] });
      } catch (err) {
        console.warn("Skipping unblockable entry:", rule.condition.urlFilter, err);
      }
    }
  }
}

async function clearBlockRules() {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  if (existing.length) {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existing.map((r) => r.id)
    });
  }
}

async function sweepTabs(blocklist) {
  const tabs = await chrome.tabs.query({});
  const blockedUrl = chrome.runtime.getURL("blocked.html");
  for (const tab of tabs) {
    if (!tab.id || !tab.url) continue;
    let host;
    try {
      host = new URL(tab.url).hostname;
    } catch {
      continue;
    }
    if (blocklist.some((d) => host === d || host.endsWith("." + d))) {
      // carry the URL raw, matching the DNR redirect's ?from= format
      chrome.tabs.update(tab.id, { url: blockedUrl + "?from=" + tab.url });
    }
  }
}

// ---- session state machine ---------------------------------------------

const DEFAULTS = {
  session: null,
  settings: { sessionMin: 60, workMin: 30, breakMin: 5 },
  blocklist: [],
  unlockOnPause: false
};

function notify(title, message) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon128.png",
    title,
    message
  });
}

function currentPhase(session, now = Date.now()) {
  if (!session) return null;
  return session.schedule.find((p) => p.endsAt > now) || null;
}

function updateBadge(current) {
  if (!current) {
    chrome.action.setBadgeText({ text: "" });
    return;
  }
  const min = Math.max(1, Math.ceil((current.endsAt - Date.now()) / 60000));
  chrome.action.setBadgeBackgroundColor({
    color: current.phase === "working" ? "#2e7d32" : "#1565c0"
  });
  chrome.action.setBadgeText({ text: String(min) });
}

async function startSession(settings, blocklist) {
  const startedAt = Date.now();
  const schedule = buildSchedule(startedAt, settings);
  await chrome.storage.local.set({ session: { schedule, startedAt }, settings, blocklist });
  await applyBlockRules(blocklist);
  await sweepTabs(blocklist);
  chrome.alarms.create("phase-end", { when: schedule[0].endsAt });
  chrome.alarms.create("tick", { periodInMinutes: 1 });
  updateBadge(schedule[0]);
}

async function endSession(completed) {
  await chrome.storage.local.set({ session: null });
  await clearBlockRules();
  await chrome.alarms.clear("phase-end");
  await chrome.alarms.clear("tick");
  chrome.action.setBadgeText({ text: "" });
  if (completed) notify("Session complete", "Nice work. Sites are unblocked.");
}

// Pausing freezes the schedule: pausedAt marks the freeze point, and resume
// shifts every absolute timestamp forward by the paused duration. Sites stay
// blocked while paused unless the unlockOnPause option is set.
async function pauseSession() {
  const { session, unlockOnPause } = await chrome.storage.local.get(DEFAULTS);
  if (!session || session.pausedAt || !currentPhase(session)) return;
  session.pausedAt = Date.now();
  await chrome.storage.local.set({ session });
  await chrome.alarms.clear("phase-end");
  await chrome.alarms.clear("tick");
  if (unlockOnPause) await clearBlockRules();
  chrome.action.setBadgeBackgroundColor({ color: "#616161" });
  chrome.action.setBadgeText({ text: "||" });
}

async function resumeSession() {
  const { session } = await chrome.storage.local.get(DEFAULTS);
  if (!session?.pausedAt) return;
  const delta = Date.now() - session.pausedAt;
  const resumed = {
    startedAt: session.startedAt + delta,
    schedule: session.schedule.map((p) => ({ ...p, endsAt: p.endsAt + delta }))
  };
  await chrome.storage.local.set({ session: resumed });
  await syncState();
}

// Blocklist edits from the options page apply live: if a work phase is
// running (and actually blocking), re-install the rules and sweep tabs.
async function setBlocklist(blocklist) {
  await chrome.storage.local.set({ blocklist });
  const { session, unlockOnPause } = await chrome.storage.local.get(DEFAULTS);
  const now = session?.pausedAt ?? Date.now();
  const blocking =
    currentPhase(session, now)?.phase === "working" &&
    !(session?.pausedAt && unlockOnPause);
  if (blocking) {
    await applyBlockRules(blocklist);
    await sweepTabs(blocklist);
  }
}

// Idempotent: recomputes everything from persisted absolute timestamps.
// announce=true only when called from the phase-end alarm, so restarts and
// worker wake-ups don't re-fire notifications.
async function syncState({ announce = false } = {}) {
  const { session, blocklist, unlockOnPause } = await chrome.storage.local.get(DEFAULTS);
  if (!session) return;
  if (session.pausedAt) {
    // Frozen at pausedAt: judge the phase at that instant (real time may
    // have run far past the stored endsAt values), restore the paused
    // blocking state, and make sure no alarms fire until resume.
    const frozen = currentPhase(session, session.pausedAt);
    if (frozen?.phase === "working" && !unlockOnPause) {
      await applyBlockRules(blocklist);
      await sweepTabs(blocklist);
    } else {
      await clearBlockRules();
    }
    await chrome.alarms.clear("phase-end");
    await chrome.alarms.clear("tick");
    chrome.action.setBadgeBackgroundColor({ color: "#616161" });
    chrome.action.setBadgeText({ text: "||" });
    return;
  }
  const current = currentPhase(session);
  if (!current) {
    await endSession(announce);
    return;
  }
  if (current.phase === "working") {
    await applyBlockRules(blocklist);
    await sweepTabs(blocklist);
    if (announce) notify("Back to work", "Break's over — sites are blocked again.");
  } else {
    await clearBlockRules();
    if (announce) {
      const min = Math.round((current.endsAt - Date.now()) / 60000);
      notify("Break time", `Sites unblocked for ${min} minutes.`);
    }
  }
  chrome.alarms.create("phase-end", { when: current.endsAt });
  chrome.alarms.create("tick", { periodInMinutes: 1 });
  updateBadge(current);
}

// ---- events --------------------------------------------------------------

let opChain = Promise.resolve();
// Serialize state-mutating operations so a phase-end sync and a start/stop
// message can never interleave at an await and corrupt block-rule/alarm state.
function serialize(fn) {
  const run = opChain.then(fn, fn);
  opChain = run.catch(() => {});
  return run;
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "phase-end") {
    serialize(() => syncState({ announce: true }));
  } else if (alarm.name === "tick") {
    chrome.storage.local
      .get(DEFAULTS)
      .then(({ session }) => updateBadge(currentPhase(session)));
  }
});

chrome.runtime.onStartup.addListener(() => serialize(() => syncState()));
chrome.runtime.onInstalled.addListener(() => serialize(() => syncState()));

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  serialize(async () => {
    if (msg.cmd === "start") await startSession(msg.settings, msg.blocklist);
    else if (msg.cmd === "stop") await endSession(false);
    else if (msg.cmd === "pause") await pauseSession();
    else if (msg.cmd === "resume") await resumeSession();
    else if (msg.cmd === "set-blocklist") await setBlocklist(msg.blocklist);
  }).then(
    () => sendResponse({ ok: true }),
    (e) => sendResponse({ ok: false, error: String(e) })
  );
  return true; // keep the message channel open for the async response
});
