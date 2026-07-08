async function update() {
  const { session, blockMessage } = await chrome.storage.local.get({
    session: null,
    blockMessage: ""
  });
  document.getElementById("headline").textContent = blockMessage || "Nope. Not yet.";
  const el = document.getElementById("detail");
  if (!session) {
    el.textContent = "No session running. You're free to go.";
    return;
  }
  const now = Date.now();
  const current = session.schedule.find((p) => p.endsAt > now);
  if (!current) {
    el.textContent = "Session finished. You're free to go.";
    return;
  }
  if (current.phase === "break") {
    el.textContent = "It's break time — this page is just stale. Go browse.";
    return;
  }
  const total = Math.max(0, Math.ceil((current.endsAt - now) / 1000));
  const m = Math.floor(total / 60);
  const s = String(total % 60).padStart(2, "0");
  const isLast = current === session.schedule[session.schedule.length - 1];
  el.textContent = isLast ? `Session ends in ${m}:${s}.` : `Next break in ${m}:${s}.`;
}

update();
setInterval(update, 1000);
