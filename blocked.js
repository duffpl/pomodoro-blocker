// Original URL carried through the redirect: everything after "?from=".
// It is embedded raw (both by the DNR regexSubstitution and the tab sweep),
// so take the raw remainder — URLSearchParams would truncate at "&". The
// fragment survives separately in location.hash.
const rawFrom = location.search.startsWith("?from=")
  ? location.search.slice("?from=".length) + location.hash
  : "";
const fromUrl = /^https?:\/\//.test(rawFrom) ? rawFrom : "";

function displayUrl(u) {
  return u.replace(/^https?:\/\//, "");
}

async function update() {
  const { session, blockMessage, autoReturn, unlockOnPause } = await chrome.storage.local.get({
    session: null,
    blockMessage: "",
    autoReturn: false,
    unlockOnPause: false
  });
  document.getElementById("headline").textContent = blockMessage || "Nope. Not yet.";
  const el = document.getElementById("detail");
  const origin = document.getElementById("origin");
  // While paused the schedule is frozen at pausedAt, so judge phases there.
  const paused = !!(session && session.pausedAt);
  const now = paused ? session.pausedAt : Date.now();
  const current = session && session.schedule.find((p) => p.endsAt > now);
  const working = current && current.phase === "working";
  // Whether the DNR rules are actually installed right now.
  const blocking = working && !(paused && unlockOnPause);

  if (!session) {
    el.textContent = "No session running. You're free to go.";
  } else if (!current) {
    el.textContent = "Session finished. You're free to go.";
  } else if (!working) {
    el.textContent = "It's break time — this page is just stale. Go browse.";
  } else {
    const total = Math.max(0, Math.ceil((current.endsAt - now) / 1000));
    const m = Math.floor(total / 60);
    const s = String(total % 60).padStart(2, "0");
    const isLast = current === session.schedule[session.schedule.length - 1];
    const left = isLast ? `Session ends in ${m}:${s}.` : `Next break in ${m}:${s}.`;
    el.textContent = paused
      ? (blocking ? `Paused. ${left}` : "Paused — sites are unlocked. Go browse.")
      : left;
  }

  if (!fromUrl) {
    origin.hidden = true;
    return;
  }
  origin.hidden = false;
  if (blocking) {
    origin.textContent = `Waiting for you: ${displayUrl(fromUrl)}`;
    return;
  }
  // Sites are unblocked (break, session over, or no session).
  if (autoReturn) {
    location.replace(fromUrl);
    return;
  }
  const a = document.createElement("a");
  a.href = fromUrl;
  a.textContent = displayUrl(fromUrl);
  origin.replaceChildren("Take me back: ", a);
}

update();
setInterval(update, 1000);
