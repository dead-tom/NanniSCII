(async () => {
  const $ = (id) => document.getElementById(id);
  let s = Object.assign({}, DRIFT_DEFAULTS, (await chrome.storage.sync.get(DRIFT_KEY))[DRIFT_KEY]);
  let host = "";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && /^https?:/.test(tab.url)) host = new URL(tab.url).hostname;
  } catch (_) {}

  const words = (v) => (v < 0.25 ? "Whisper" : v < 0.45 ? "Quiet" : v < 0.7 ? "Present" : "Lively");
  function render() {
    $("enabled").checked = s.enabled;
    $("intensity").value = s.intensity;
    $("intOut").textContent = words(+s.intensity);
    for (const k of ["melt", "words", "cues", "blooms"]) $(k).checked = s[k];
    const paused = host && s.disabledSites.includes(host);
    $("host").textContent = host || "This page can't be changed";
    $("siteBtn").hidden = !host;
    $("siteBtn").textContent = paused ? "Resume here" : "Pause here";
    $("state").textContent = !s.enabled ? "Off everywhere" : paused ? "Paused on this site" : "On for every page";
    document.querySelector("main").style.opacity = s.enabled ? "1" : ".5";
  }
  const save = () => { chrome.storage.sync.set({ [DRIFT_KEY]: s }); render(); };

  $("enabled").addEventListener("change", (e) => { s.enabled = e.target.checked; chrome.action.setBadgeText({ text: s.enabled ? "" : "off" }); save(); });
  $("intensity").addEventListener("input", (e) => { s.intensity = +e.target.value; $("intOut").textContent = words(s.intensity); });
  $("intensity").addEventListener("change", save);
  for (const k of ["melt", "words", "cues", "blooms"]) $(k).addEventListener("change", (e) => { s[k] = e.target.checked; save(); });
  $("siteBtn").addEventListener("click", () => {
    const i = s.disabledSites.indexOf(host);
    if (i >= 0) s.disabledSites.splice(i, 1); else s.disabledSites.push(host);
    save();
  });
  $("showBtn").addEventListener("click", async () => {
    const msg = $("showMsg");
    msg.textContent = "";
    if (!s.enabled) { msg.textContent = "Turn it on first (switch at the top)."; return; }
    if (host && s.disabledSites.includes(host)) { msg.textContent = "It's paused on this site."; return; }
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !/^https?:/.test(tab.url || "")) { msg.textContent = "Chrome doesn't allow effects on this kind of page. Try a normal website."; return; }
      let r;
      try { r = await chrome.tabs.sendMessage(tab.id, { type: "drift-show" }); }
      catch (_) {
        // the page was open before the extension: start it here, then try again
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["drift.js", "content.js"] });
        await new Promise((res) => setTimeout(res, 400));
        r = await chrome.tabs.sendMessage(tab.id, { type: "drift-show" });
      }
      const res = r && r.result;
      msg.textContent = res === "ok" ? "Watch the text: a patch is starting to melt. It fades in slowly."
        : res === "busy" ? "It's already melting in a few places. Watch the page."
        : "Couldn't find enough text on screen here, so a word shed a few wedges instead.";
    } catch (_) {
      msg.textContent = "Couldn't start here. Reload the page and try again.";
    }
  });
  render();
})();
