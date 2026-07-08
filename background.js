importScripts("schedule.js");

// Pomodoro Blocker service worker

// ---- blocking ----------------------------------------------------------

async function applyBlockRules(blocklist) {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const rules = blocklist.map((domain, i) => ({
    id: i + 1,
    priority: 1,
    action: { type: "redirect", redirect: { extensionPath: "/blocked.html" } },
    // "||domain" matches the domain and all its subdomains
    condition: { urlFilter: "||" + domain, resourceTypes: ["main_frame"] }
  }));
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
      chrome.tabs.update(tab.id, { url: blockedUrl });
    }
  }
}

// ---- session state machine ---------------------------------------------

const DEFAULTS = {
  session: null,
  settings: { sessionMin: 60, workMin: 30, breakMin: 5 },
  blocklist: []
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

let stateGeneration = 0;

async function startSession(settings, blocklist) {
  stateGeneration++;
  const schedule = buildSchedule(Date.now(), settings);
  await chrome.storage.local.set({ session: { schedule }, settings, blocklist });
  await applyBlockRules(blocklist);
  await sweepTabs(blocklist);
  chrome.alarms.create("phase-end", { when: schedule[0].endsAt });
  chrome.alarms.create("tick", { periodInMinutes: 1 });
  updateBadge(schedule[0]);
}

async function endSession(completed) {
  stateGeneration++;
  await chrome.storage.local.set({ session: null });
  await clearBlockRules();
  await chrome.alarms.clear("phase-end");
  await chrome.alarms.clear("tick");
  chrome.action.setBadgeText({ text: "" });
  if (completed) notify("Session complete", "Nice work. Sites are unblocked.");
}

// Idempotent: recomputes everything from persisted absolute timestamps.
// announce=true only when called from the phase-end alarm, so restarts and
// worker wake-ups don't re-fire notifications.
async function syncState({ announce = false } = {}) {
  const gen = stateGeneration;
  const { session, blocklist } = await chrome.storage.local.get(DEFAULTS);
  if (!session || gen !== stateGeneration) return;
  const current = currentPhase(session);
  if (!current) {
    await endSession(announce);
    return;
  }
  if (current.phase === "working") {
    await applyBlockRules(blocklist);
    await sweepTabs(blocklist);
    if (announce && gen === stateGeneration) notify("Back to work", "Break's over — sites are blocked again.");
  } else {
    await clearBlockRules();
    if (announce && gen === stateGeneration) {
      const min = Math.round((current.endsAt - Date.now()) / 60000);
      notify("Break time", `Sites unblocked for ${min} minutes.`);
    }
  }
  if (gen !== stateGeneration) return;
  chrome.alarms.create("phase-end", { when: current.endsAt });
  chrome.alarms.create("tick", { periodInMinutes: 1 });
  updateBadge(current);
}

// ---- events --------------------------------------------------------------

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "phase-end") {
    syncState({ announce: true });
  } else if (alarm.name === "tick") {
    chrome.storage.local
      .get(DEFAULTS)
      .then(({ session }) => updateBadge(currentPhase(session)));
  }
});

chrome.runtime.onStartup.addListener(() => syncState());
chrome.runtime.onInstalled.addListener(() => syncState());

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg.cmd === "start") {
      await startSession(msg.settings, msg.blocklist);
    } else if (msg.cmd === "stop") {
      await endSession(false);
    }
    sendResponse({ ok: true });
  })();
  return true; // keep the message channel open for the async response
});
