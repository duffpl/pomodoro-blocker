async function update() {
  const { session } = await chrome.storage.local.get({ session: null });
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
  const min = Math.ceil((current.endsAt - now) / 60000);
  el.textContent = `Next break in ${min} minute${min === 1 ? "" : "s"}.`;
}

update();
setInterval(update, 1000);
