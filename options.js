const $ = (id) => document.getElementById(id);

async function load() {
  const { blocklist, blockMessage, autoReturn, unlockOnPause } = await chrome.storage.local.get({
    blocklist: [],
    blockMessage: "",
    autoReturn: false,
    unlockOnPause: false
  });
  $("blocklist").value = blocklist.join("\n");
  $("message").value = blockMessage;
  $("auto-return").checked = autoReturn;
  $("unlock-on-pause").checked = unlockOnPause;
}

$("save").addEventListener("click", async () => {
  const status = $("status");
  status.textContent = "";
  status.className = "";
  let blocklist;
  try {
    blocklist = parseDomains($("blocklist").value);
  } catch (e) {
    status.textContent = e.message;
    status.className = "error";
    return;
  }
  await chrome.storage.local.set({
    blockMessage: $("message").value.trim(),
    autoReturn: $("auto-return").checked,
    unlockOnPause: $("unlock-on-pause").checked
  });
  // The background applies the new blocklist to a running work phase
  // (re-installs DNR rules and sweeps tabs), so edits take effect live.
  const resp = await chrome.runtime
    .sendMessage({ cmd: "set-blocklist", blocklist })
    .catch((e) => ({ ok: false, error: String(e) }));
  if (!resp?.ok) {
    status.textContent = `Could not save: ${resp?.error || "no response"}`;
    status.className = "error";
    return;
  }
  status.textContent = "Saved.";
  status.className = "saved";
});

load();
