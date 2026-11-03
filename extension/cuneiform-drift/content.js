(() => {
  // only once per page, even if the extension is injected into a tab that already has it
  if (window.__cuneiformDriftLoaded) return;
  window.__cuneiformDriftLoaded = true;
  const KEY = "cuneiformDrift";
  const DEF = { enabled: true, intensity: 0.3, words: true, cues: true, blooms: true, melt: true, disabledSites: [] };
  const FAMILY = "Cuneiform Drift Signs";
  let drift = null, fontReady = false, current = DEF;

  // Load the bundled font from bytes so page font policies do not block it.
  fetch(chrome.runtime.getURL("fonts/NotoSansCuneiform.woff2"))
    .then((r) => r.arrayBuffer())
    .then((buf) => { const f = new FontFace(FAMILY, buf); document.fonts.add(f); return f.load(); })
    .then(() => { fontReady = true; if (drift) drift.set({ fontFamily: FAMILY }); })
    .catch(() => {});

  function apply(s) {
    current = Object.assign({}, DEF, s);
    const on = current.enabled && !(current.disabledSites || []).includes(location.hostname);
    if (on) {
      const o = Object.assign({}, current, { fontFamily: fontReady ? FAMILY : null });
      if (drift) drift.set(o); else drift = window.CuneiformDrift(o);
    } else if (drift) { drift.destroy(); drift = null; }
  }
  chrome.storage.sync.get(KEY, (r) => apply(r[KEY]));
  chrome.storage.onChanged.addListener((ch, area) => { if (area === "sync" && ch[KEY]) apply(ch[KEY].newValue); });
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (!msg || msg.type !== "drift-show") return;
    if (!drift) { reply({ ok: false, reason: "off" }); return; }
    // melt something on screen now; if there is no text to melt, at least shed a word
    let result = "notext";
    try { result = drift.meltNow(); if (result !== "ok") drift.shedNow(); } catch (_) {}
    reply({ ok: true, result });
  });
})();
