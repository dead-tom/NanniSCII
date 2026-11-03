importScripts("settings.js");
chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== "toggle-drift") return;
  const r = await chrome.storage.sync.get(DRIFT_KEY);
  const s = Object.assign({}, DRIFT_DEFAULTS, r[DRIFT_KEY]);
  s.enabled = !s.enabled;
  await chrome.storage.sync.set({ [DRIFT_KEY]: s });
  chrome.action.setBadgeText({ text: s.enabled ? "" : "off" });
});
chrome.runtime.onStartup.addListener(async () => {
  const r = await chrome.storage.sync.get(DRIFT_KEY);
  const s = Object.assign({}, DRIFT_DEFAULTS, r[DRIFT_KEY]);
  chrome.action.setBadgeText({ text: s.enabled ? "" : "off" });
});
chrome.action.setBadgeBackgroundColor && chrome.action.setBadgeBackgroundColor({ color: "#7a4a26" });

// Start straight away in tabs that were already open when the extension was installed or updated,
// so nobody has to reload their pages first.
chrome.runtime.onInstalled.addListener(async () => {
  try {
    const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
    for (const t of tabs) {
      chrome.scripting.executeScript({ target: { tabId: t.id }, files: ["drift.js", "content.js"] }).catch(() => {});
    }
  } catch (_) {}
});
