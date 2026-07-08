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
