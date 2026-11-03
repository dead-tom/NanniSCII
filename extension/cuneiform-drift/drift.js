/*
 * Cuneiform Drift — a quiet particle layer that lives over any page.
 * Words now and then shed tiny clay wedges, the edges carry wedge "motion cues"
 * while you scroll, and once in a while a cuneiform sign grows in an empty margin
 * and crumbles away, and now and then a patch of text melts into a molten cuneiform sign, drips,
 * sparkles away and heals. Everything happens on its own; no clicking needed.
 *
 * Usage: const d = CuneiformDrift({ intensity: 0.35 }); d.set({...}); d.destroy();
 */
(function (global) {
  "use strict";
  if (global.CuneiformDrift) return;

  const SIGNS = ["\u{1202D}", "\u{121A0}", "\u{12097}", "\u{12217}", "\u{1230B}", "\u{12000}", "\u{1208D}",
    "\u{1207E}", "\u{122A9}", "\u{12111}", "\u{12313}", "\u{12146}", "\u{122D7}", "\u{121B3}"];
  const DEFAULTS = { intensity: 0.35, words: true, cues: true, blooms: true, melt: true, fontFamily: null };
  // wedge directions used by scribes: horizontal, vertical, diagonal, and the corner wedge
  const ANGLES = [0, Math.PI / 2, Math.PI / 4, Math.PI * 0.82];
  const PALETTES = {
    light: [[122, 74, 38], [158, 102, 52], [96, 64, 40], [44, 82, 140]],   // fired clay, umber, lapis
    dark: [[240, 210, 154], [214, 160, 98], [250, 236, 206], [126, 164, 222]], // gold leaf, ochre, lapis
  };
  const lerp = (a, b, t) => a + (b - a) * t;
  const rnd = (a, b) => a + Math.random() * (b - a);

  function CuneiformDrift(opts) {
    let o = Object.assign({}, DEFAULTS, opts || {});
    const reduceMQ = matchMedia("(prefers-reduced-motion: reduce)");
    let reduce = reduceMQ.matches;

    /* ---- overlay, isolated from page styles ---- */
    const host = document.createElement("cuneiform-drift-layer");
    host.setAttribute("aria-hidden", "true");
    host.style.cssText = "all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483646;display:block;contain:strict;";
    const root = host.attachShadow({ mode: "closed" });
    const cv = document.createElement("canvas");
    cv.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;";
    root.appendChild(cv);
    document.documentElement.appendChild(host);
    const ctx = cv.getContext("2d");
    let W = 0, H = 0;
    function resize() {
      const dpr = Math.min(2, global.devicePixelRatio || 1);
      W = global.innerWidth; H = global.innerHeight;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();

    /* ---- theme: read the page's real background ---- */
    let dark = false;
    function rgbOf(s) {
      const m = s && s.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      return m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
    }
    function detectTheme() {
      let el = document.elementFromPoint(W / 2, H / 2) || document.body;
      while (el && el.nodeType === 1) {
        const c = rgbOf(getComputedStyle(el).backgroundColor);
        if (c && (c.length < 4 || c[3] > 0.5)) {
          dark = (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255 < 0.45;
          return;
        }
        el = el.parentElement;
      }
      dark = /dark/.test(getComputedStyle(document.documentElement).colorScheme || "");
    }
    detectTheme();
    const pal = () => (dark ? PALETTES.dark : PALETTES.light);

    /* ---- particles (stored in viewport coordinates, follow page scroll) ---- */
    const parts = [];
    const MAXP = 900;
    function emit(x, y, colFrom, opt) {
      if (parts.length >= MAXP + 1800 * boost()) return;
      const p = pal();
      parts.push({
        x, y, delay: opt.delay || 0,
        vx: reduce ? 0 : rnd(-6, 6) + (opt.vx || 0),
        vy: reduce ? 0 : rnd(-16, -5) + (opt.vy || 0),
        life: 0, max: opt.life || (reduce ? rnd(0.8, 1.4) : rnd(1.6, 3.2)), sq: !!opt.square, star: !!opt.star, fall: !!opt.fall,
        size: rnd(1.2, 2.4) * (opt.scale || 1),
        ang: ANGLES[(Math.random() * ANGLES.length) | 0] + rnd(-0.15, 0.15),
        spin: reduce ? 0 : rnd(-0.6, 0.6),
        from: colFrom || p[0], to: opt.to || (opt.square ? colFrom || p[0] : p[(Math.random() * p.length) | 0]),
        ph: rnd(0, 6.28), fr: rnd(4, 10),
      });
    }

    /* ---- find a visible word under a point ---- */
    const isWordChar = (ch) => /[\p{L}\p{N}'’\-]/u.test(ch);
    // Many sites (archive.org, YouTube, Reddit…) build pages from web components whose text sits
    // inside shadow roots, out of reach of the usual lookups. Collect the open ones (cached).
    let rootsCache = [], rootsAt = -1e9;
    function shadowRoots() {
      const t = performance.now();
      if (t - rootsAt < 4000) return rootsCache;
      rootsAt = t;
      const out = [];
      const visit = (root, depth) => {
        if (depth > 10 || out.length > 400) return;
        for (const el of root.querySelectorAll("*")) {
          if (el.shadowRoot && el !== host) { out.push(el.shadowRoot); visit(el.shadowRoot, depth + 1); }
        }
      };
      try { visit(document, 0); } catch (_) {}
      rootsCache = out;
      return out;
    }
    function deepElementFromPoint(x, y) {
      let el = document.elementFromPoint(x, y), guard = 0;
      while (el && el.shadowRoot && guard++ < 12) {
        const inner = el.shadowRoot.elementFromPoint(x, y);
        if (!inner || inner === el) break;
        el = inner;
      }
      return el;
    }
    function composedContains(a, b) {
      for (let n = b; n; n = n instanceof ShadowRoot ? n.host : n.parentNode) if (n === a) return true;
      return false;
    }
    // find the character under a point by hand, inside one element's text
    function manualCaret(el, x, y) {
      const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const rg = document.createRange();
      let n, k = 0;
      while ((n = tw.nextNode()) && k++ < 60) {
        rg.selectNodeContents(n);
        let hit = false;
        for (const b of rg.getClientRects()) if (x >= b.left && x <= b.right && y >= b.top && y <= b.bottom) { hit = true; break; }
        if (!hit) continue;
        for (let i = 0; i < Math.min(n.data.length, 600); i++) {
          rg.setStart(n, i); rg.setEnd(n, i + 1);
          const b = rg.getBoundingClientRect();
          if (x >= b.left && x <= b.right && y >= b.top && y <= b.bottom) return { node: n, offset: i };
        }
      }
      return null;
    }
    function caretAt(x, y) {
      let c = null;
      const roots = shadowRoots();
      if (roots.length && document.caretPositionFromPoint) {
        try {
          const p = document.caretPositionFromPoint(x, y, { shadowRoots: roots });
          if (p && p.offsetNode) c = { node: p.offsetNode, offset: p.offset };
        } catch (_) {}
      }
      if (!c || c.node.nodeType !== 3) {
        if (document.caretRangeFromPoint) {
          const r = document.caretRangeFromPoint(x, y);
          if (r) c = { node: r.startContainer, offset: r.startOffset };
        } else if (document.caretPositionFromPoint) {
          const p = document.caretPositionFromPoint(x, y);
          if (p) c = { node: p.offsetNode, offset: p.offset };
        }
      }
      // landed on a component instead of its text: look inside it
      if ((!c || !c.node || c.node.nodeType !== 3) && roots.length) {
        const el = deepElementFromPoint(x, y);
        if (el && el.getRootNode() instanceof ShadowRoot) c = manualCaret(el, x, y) || c;
      }
      return c;
    }
    function wordAt(x, y) {
      const c = caretAt(x, y);
      if (!c || !c.node || c.node.nodeType !== 3) return null;
      const node = c.node, el = node.parentElement;
      if (!el || el.isContentEditable || el.closest("script,style,noscript,textarea,input,select,[data-drift-ignore]")) return null;
      const text = node.data;
      let s = Math.min(c.offset, text.length), e = s;
      while (s > 0 && isWordChar(text[s - 1])) s--;
      while (e < text.length && isWordChar(text[e])) e++;
      if (e - s < 2 || e - s > 28) return null;
      const range = document.createRange();
      range.setStart(node, s); range.setEnd(node, e);
      const rects = range.getClientRects();
      if (rects.length !== 1) return null;
      const b = rects[0];
      if (x < b.left - 2 || x > b.right + 2 || y < b.top - 2 || y > b.bottom + 2) return null;
      if (b.width < 6 || b.height < 6 || b.bottom < 0 || b.top > H) return null;
      const top = deepElementFromPoint(x, y);
      if (!top || !(top === el || composedContains(el, top) || composedContains(top, el))) return null;
      return { text: text.slice(s, e), rect: b, el, node, start: s };
    }

    /* ---- turn a word's glyphs into particle seeds ---- */
    const off = document.createElement("canvas");
    const octx = off.getContext("2d", { willReadFrequently: true });
    function glyphPoints(w, n) {
      const cs = getComputedStyle(w.el), b = w.rect, sc = 2;
      off.width = Math.ceil(b.width * sc) + 4; off.height = Math.ceil(b.height * sc) + 4;
      octx.setTransform(sc, 0, 0, sc, 0, 0);
      octx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      octx.textBaseline = "alphabetic";
      octx.fillStyle = "#000";
      const m = octx.measureText(w.text);
      const fs = parseFloat(cs.fontSize) || 16;
      const asc = m.fontBoundingBoxAscent || fs * 0.8, desc = m.fontBoundingBoxDescent || fs * 0.2;
      const y = (b.height - (asc + desc)) / 2 + asc;
      octx.save(); octx.scale(b.width / Math.max(1, m.width), 1); octx.fillText(w.text, 0, y); octx.restore();
      const d = octx.getImageData(0, 0, off.width, off.height).data, pts = [];
      for (let py = 0; py < off.height; py += 2)
        for (let px = 0; px < off.width; px += 2)
          if (d[(py * off.width + px) * 4 + 3] > 140) pts.push([b.left + px / sc, b.top + py / sc]);
      for (let i = pts.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [pts[i], pts[j]] = [pts[j], pts[i]]; }
      const col = rgbOf(cs.color);
      return { pts: pts.slice(0, n), col: col ? col.slice(0, 3) : null };
    }
    const cooldown = new WeakMap();
    function shed(w, strength) {
      const prev = cooldown.get(w.node);
      const now = performance.now();
      if (prev && prev.start === w.start && now - prev.t < 6000) return false;
      cooldown.set(w.node, { start: w.start, t: now });
      const n = Math.round((16 + 40 * o.intensity) * strength);
      const g = glyphPoints(w, n);
      const sweepDir = Math.random() < 0.5 ? 1 : -1;
      for (const [x, y] of g.pts) {
        const u = (x - w.rect.left) / w.rect.width;
        emit(x, y, g.col, { delay: (sweepDir > 0 ? u : 1 - u) * 0.7 });
      }
      wake();
      return g.pts.length > 0;
    }
    // pick a spot that really has text on it, by looking through the page's visible text
    // (random screen spots miss on sparse layouts like search results)
    const SKIP_TAGS = /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|INPUT|SELECT|OPTION|svg)$/i;
    function visibleTextPoint(top, bottom) {
      const cand = [];
      let n, seen = 0;
      for (const root of [document.body || document.documentElement, ...shadowRoots()]) {
      const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while ((n = tw.nextNode()) && seen < 8000 && cand.length < 500) {
        seen++;
        if (n.data.length < 3 || !/[\p{L}\p{N}]{2}/u.test(n.data)) continue;
        const el = n.parentElement;
        if (!el || SKIP_TAGS.test(el.tagName) || el.isContentEditable) continue;
        const r = el.getBoundingClientRect();
        if (r.bottom < top || r.top > bottom || r.right < 0 || r.left > W || r.width < 4 || r.height < 4) continue;
        cand.push(n);
      }
      }
      for (let tries = 0; tries < 12 && cand.length; tries++) {
        const node = cand[(Math.random() * cand.length) | 0];
        const i = (Math.random() * node.data.length) | 0;
        if (!isWordChar(node.data[i] || "")) continue;
        const rg = document.createRange();
        rg.setStart(node, i); rg.setEnd(node, i + 1);
        const b = rg.getBoundingClientRect();
        if (b.width < 1 || b.height < 4 || b.top < top || b.bottom > bottom || b.left < 0 || b.right > W) continue;
        return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
      }
      return null;
    }
    function shedRandomWord() {
      for (let i = 0; i < 14; i++) {
        const p = i < 6 ? visibleTextPoint(H * 0.06, H * 0.94) : null;
        const x = p ? p.x : rnd(W * 0.04, W * 0.96), y = p ? p.y : rnd(H * 0.06, H * 0.94);
        const w = wordAt(x, y);
        if (w && shed(w, 1)) return true;
      }
      return false;
    }

    /* ---- margin blooms: a small sign grows in empty space ---- */
    const BN = 36;
    function signMask() {
      const c = document.createElement("canvas"); c.width = c.height = BN;
      const g = c.getContext("2d");
      g.fillStyle = g.strokeStyle = "#fff";
      let ok = false;
      if (o.fontFamily && document.fonts && document.fonts.check(`32px "${o.fontFamily}"`, SIGNS[0])) {
        const ch = SIGNS[(Math.random() * SIGNS.length) | 0];
        g.font = `${BN}px "${o.fontFamily}"`;
        const m = g.measureText(ch);
        const bw = m.actualBoundingBoxLeft + m.actualBoundingBoxRight, bh = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
        if (bw > 2 && bh > 2) {
          const sc = 0.86 * BN / Math.max(bw, bh);
          g.font = `${BN * sc}px "${o.fontFamily}"`;
          g.fillText(ch, BN / 2 - (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) * sc / 2,
            BN / 2 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) * sc / 2);
          ok = true;
        }
      }
      if (!ok) {
        for (let i = 0, n = 3 + ((Math.random() * 3) | 0); i < n; i++) {
          const a = ANGLES[(Math.random() * 3) | 0], x = rnd(6, BN - 20), y = rnd(6, BN - 20), L = rnd(10, 20), hd = rnd(3, 4.5);
          const ca = Math.cos(a), sa = Math.sin(a);
          g.beginPath(); g.moveTo(x - sa * hd, y + ca * hd); g.lineTo(x + sa * hd, y - ca * hd); g.lineTo(x + ca * hd * 1.6, y + sa * hd * 1.6); g.fill();
          g.lineWidth = 1.8; g.beginPath(); g.moveTo(x, y); g.lineTo(x + ca * L, y + sa * L); g.stroke();
        }
      }
      const d = g.getImageData(0, 0, BN, BN).data, t = new Uint8Array(BN * BN);
      let cnt = 0;
      for (let i = 0; i < BN * BN; i++) if (d[i * 4 + 3] > 110) { t[i] = 1; cnt++; }
      return { t, cnt };
    }
    function spotIsEmpty(x, y, s) {
      for (let i = 0; i <= 3; i++) for (let j = 0; j <= 3; j++) {
        const px = x + s * i / 3, py = y + s * j / 3;
        const el = document.elementFromPoint(px, py);
        if (!el) return false;
        if (el.closest("img,video,canvas,svg,iframe,input,textarea,button,a,select,[data-drift-ignore]")) return false;
        const c = caretAt(px, py);
        if (c && c.node && c.node.nodeType === 3 && c.node.data.trim()) {
          const r = document.createRange();
          r.selectNodeContents(c.node);
          for (const b of r.getClientRects())
            if (px > b.left - 10 && px < b.right + 10 && py > b.top - 10 && py < b.bottom + 10) return false;
        }
      }
      return true;
    }
    const blooms = [];
    function startBloom() {
      if (blooms.length >= 1 + Math.round(o.intensity * 2)) return;
      const cs = W < 600 ? 1.6 : 2, s = BN * cs;
      for (let tries = 0; tries < 30; tries++) {
        const x = rnd(8, W - s - 8), y = rnd(H * 0.08, H * 0.92 - s);
        if (!spotIsEmpty(x, y, s)) continue;
        const m = signMask();
        if (!m.cnt) return;
        const alive = new Uint8Array(BN * BN), born = new Float32Array(BN * BN), key = new Float32Array(BN * BN);
        const cells = []; for (let i = 0; i < BN * BN; i++) if (m.t[i]) cells.push(i);
        const p = pal();
        blooms.push({ x, y, cs, t: m.t, total: m.cnt, alive, born, key, count: 0, cells,
          phase: "grow", t0: performance.now() / 1000, col: p[(Math.random() * p.length) | 0], acc: 0 });
        wake();
        return;
      }
    }
    function stepBloom(b, now) {
      const { t, alive } = b;
      if (b.phase === "grow") {
        // any untouched piece of the sign gets its own seed, like separate wedges pressed into clay
        if (b.count === 0 || Math.random() < 0.02) {
          const i = b.cells[(Math.random() * b.cells.length) | 0];
          if (!alive[i]) { alive[i] = 1; b.born[i] = now; b.count++; }
        }
        const add = [];
        for (let i = 0; i < BN * BN; i++) {
          if (!t[i] || alive[i]) continue;
          const x = i % BN, y = (i / BN) | 0;
          let n = 0;
          if (x > 0 && alive[i - 1]) n++;
          if (x < BN - 1 && alive[i + 1]) n++;
          if (y > 0 && alive[i - BN]) n++;
          if (y < BN - 1 && alive[i + BN]) n++;
          if (n && Math.random() < 0.06 + 0.08 * n) add.push(i);
        }
        for (const i of add) { alive[i] = 1; b.born[i] = now; b.count++; }
        if (b.count >= b.total || now - b.t0 > 16) { b.phase = "hold"; b.until = now + rnd(3, 5); }
      } else if (b.phase === "hold") {
        if (now > b.until) {
          b.phase = "fade"; b.f0 = now;
          const a = rnd(0, 6.28), ca = Math.cos(a), sa = Math.sin(a);
          for (let i = 0; i < BN * BN; i++)
            b.key[i] = 0.6 * ((i % BN) / BN * ca + ((i / BN) | 0) / BN * sa + 0.7) + 0.4 * Math.random();
        }
      } else if (b.phase === "fade") {
        const thr = (now - b.f0) / 3.2 * 1.2;
        for (let i = 0; i < BN * BN; i++) {
          if (alive[i] && b.key[i] < thr) {
            alive[i] = 0; b.count--;
            if (Math.random() < 0.18) emit(b.x + (i % BN + 0.5) * b.cs, b.y + (((i / BN) | 0) + 0.5) * b.cs, b.col, { scale: 0.9 });
          }
        }
        if (b.count <= 0) b.phase = "dead";
      }
    }
    function drawBloom(b, now) {
      const a = 0.16 + 0.24 * o.intensity, s = b.cs * 0.82, k = (b.cs - s) / 2;
      ctx.fillStyle = `rgb(${b.col[0]},${b.col[1]},${b.col[2]})`;
      ctx.globalAlpha = a;
      ctx.beginPath();
      const fresh = [];
      for (let i = 0; i < BN * BN; i++) {
        if (!b.alive[i]) continue;
        if (now - b.born[i] < 0.35) { fresh.push(i); continue; }
        ctx.rect(b.x + (i % BN) * b.cs + k, b.y + ((i / BN) | 0) * b.cs + k, s, s);
      }
      ctx.fill();
      if (fresh.length) {
        ctx.globalAlpha = Math.min(1, a * 2.2);
        ctx.beginPath();
        for (const i of fresh) ctx.rect(b.x + (i % BN) * b.cs + k, b.y + ((i / BN) | 0) * b.cs + k, s, s);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    /* ---- motion cues: wedge marks at the edges that travel with your scroll ---- */
    let lastSX = global.scrollX, lastSY = global.scrollY;
    let pendX = 0, pendY = 0, innerDY = 0, vel = 0, cueOff = 0, cueA = 0, cueDir = 1;
    const innerTops = new WeakMap();
    function onScroll(e) {
      const t = e.target;
      if (t === document || t === document.documentElement || t === document.scrollingElement || t === global) {
        const dx = global.scrollX - lastSX, dy = global.scrollY - lastSY;
        lastSX = global.scrollX; lastSY = global.scrollY;
        pendX += dx; pendY += dy;
      } else if (t && t.nodeType === 1) {
        const prev = innerTops.get(t);
        innerTops.set(t, t.scrollTop);
        if (prev !== undefined) innerDY += t.scrollTop - prev;
      }
      wake();
    }
    function drawCues() {
      if (cueA < 0.01) return;
      const p = pal(), c = p[0];
      const spacing = W < 600 ? 44 : 56, inset = W < 600 ? 7 : 10;
      ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
      const base = cueA * (0.22 + 0.4 * o.intensity);
      const n = Math.ceil(H / spacing) + 2;
      const shift = ((cueOff % spacing) + spacing) % spacing;
      for (let side = 0; side < 2; side++) {
        const x = side ? W - inset : inset;
        for (let k = -1; k < n; k++) {
          const y = k * spacing + shift;
          const edge = Math.min(1, y / 80, (H - y) / 80);
          if (edge <= 0) continue;
          ctx.globalAlpha = base * edge;
          ctx.beginPath();
          wedge(x, y, 2.2, cueDir > 0 ? -Math.PI / 2 : Math.PI / 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    }
    function wedge(x, y, s, a) {
      const c = Math.cos(a), si = Math.sin(a);
      ctx.moveTo(x - si * s * 0.6 - c * s, y + c * s * 0.6 - si * s);
      ctx.lineTo(x + si * s * 0.6 - c * s, y - c * s * 0.6 - si * s);
      ctx.lineTo(x + c * s * 1.8, y + si * s * 1.8);
      ctx.closePath();
    }

    /* ---- melt: now and then a random patch of text is drawn out pixel by pixel, the pixels swirl
            together and grow into a molten cuneiform sign (cell by cell, like Cuneiform Bloom),
            the sign cools, drips like lava, sparkles away, and the text heals ---- */
    const rgbS = (c) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
    const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    function bgUnder(el) {
      while (el && el.nodeType === 1) {
        const c = rgbOf(getComputedStyle(el).backgroundColor);
        if (c && (c.length < 4 || c[3] > 0.9)) return c.slice(0, 3);
        el = el.parentElement;
      }
      return dark ? [18, 16, 14] : [255, 255, 255];
    }
    const signFontOK = () => !!(o.fontFamily && document.fonts && document.fonts.check(`20px "${o.fontFamily}"`, SIGNS[0]));

    // the living palette from Cuneiform Bloom: clay → ochre → gold → pale → lapis, cyclic
    const STOPS = [[120, 72, 40], [200, 147, 90], [240, 210, 154], [250, 238, 210], [91, 132, 196], [150, 100, 60]];
    const PALC = [];
    for (let i = 0; i < 64; i++) {
      const f = (i / 64) * STOPS.length, k = Math.floor(f), u = f - k;
      PALC.push(mix(STOPS[k % STOPS.length], STOPS[(k + 1) % STOPS.length], u));
    }
    const palAt = (h) => PALC[(((h % 1) + 1) % 1) * 64 | 0];
    // a slow swirling current for the pixels to ride on
    const flowAng = (x, y, t) => 1.6 * (Math.sin(x * 0.031 + t * 0.9) + Math.sin(y * 0.027 - t * 0.7) + Math.sin((x + y) * 0.019 + t * 0.5));

    // an abstract patch: a few stretched, rotated lobes melted together, with a ragged, noisy edge
    function blobFn(r) {
      const lobes = [];
      const n = 2 + ((Math.random() * 3) | 0);
      const base = rnd(-0.5, 0.5);                                   // mostly along the lines of text
      for (let i = 0; i < n; i++) {
        const a = base + rnd(-0.9, 0.9), along = rnd(-0.75, 0.75) * r, side = rnd(-0.35, 0.35) * r;
        lobes.push({
          x: Math.cos(base) * along - Math.sin(base) * side, y: Math.sin(base) * along + Math.cos(base) * side,
          ca: Math.cos(a), sa: Math.sin(a),
          rx: r * rnd(0.45, 0.85) * (i ? 1 : 1.15), ry: r * rnd(0.16, 0.38),
        });
      }
      const f1 = rnd(0.09, 0.16), f2 = rnd(0.08, 0.15), f3 = rnd(0.2, 0.32), p1 = rnd(0, 6.28), p2 = rnd(0, 6.28), p3 = rnd(0, 6.28);
      return (dx, dy) => {
        let F = 0;
        for (const L of lobes) {
          const ux = dx - L.x, uy = dy - L.y;
          const u = (ux * L.ca + uy * L.sa) / L.rx, v = (-ux * L.sa + uy * L.ca) / L.ry;
          F += 1 / (u * u + v * v + 0.02);
        }
        const noise = 0.6 * Math.sin(dx * f1 + p1) * Math.sin(dy * f2 + p2) + 0.4 * Math.sin((dx * 0.7 + dy * 1.3) * f3 + p3);
        return Math.pow(F, -0.5) * (1 + 0.22 * noise);
      };
    }
    // take every text pixel inside an irregular patch, from whatever words it overlaps
    function captureBlob(cx, cy, r) {
      const shape = blobFn(r), words = [], seen = new Set();
      for (let gy = -r * 1.7; gy <= r * 1.7; gy += 7) for (let gx = -r * 1.9; gx <= r * 1.9; gx += 11) {
        if (shape(gx, gy) > 1.75) continue;
        const w = wordAt(cx + gx, cy + gy);
        if (!w) continue;
        const k = w.start + "|" + w.node.data.length + "|" + w.rect.left + "|" + w.rect.top;
        if (seen.has(k)) continue;
        seen.add(k); words.push(w);
        if (words.length >= 26) break;
      }
      const pts = [], ring = [], cells = [], C = 3;
      for (const w of words) {
        const cs = getComputedStyle(w.el);
        const col = (rgbOf(cs.color) || (dark ? [230, 230, 230] : [20, 20, 20])).slice(0, 3);
        const bg = bgUnder(w.el), b = w.rect;
        for (const [x, y] of glyphPoints(w, 4000).pts) {
          const d = shape(x - cx, y - cy);
          if (d <= 1) pts.push({ x, y, col, d });
          else if (d < 1.7 && Math.random() < 0.7) ring.push({ x, y, d, f: 1 - (d - 1) / 0.7, col: mix(col, dark ? [255, 170, 90] : [160, 64, 14], 0.6) });
        }
        for (let y = b.top; y < b.bottom; y += C) for (let x = b.left - 1; x < b.right + 1; x += C) {
          const d = shape(x + C / 2 - cx, y + C / 2 - cy);
          if (d <= 1.04) cells.push({ x, y, w: C, h: Math.min(C, b.bottom - y), bg, d });
        }
      }
      for (let i = pts.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [pts[i], pts[j]] = [pts[j], pts[i]]; }
      const byCol = new Map();
      for (const q of ring.slice(0, 1400)) { const k = cellStyle(q.col); if (!byCol.has(k)) byCol.set(k, []); byCol.get(k).push(q); }
      return { pts: pts.slice(0, 900), ring: byCol, cells, cx, cy, r, words };
    }

    const SN = 30;
    function signMaskBig() {
      const c = document.createElement("canvas"); c.width = c.height = SN;
      const g = c.getContext("2d");
      g.fillStyle = g.strokeStyle = "#fff";
      let ok = false;
      if (signFontOK()) {
        const ch = SIGNS[(Math.random() * SIGNS.length) | 0];
        g.font = `${SN}px "${o.fontFamily}"`;
        const m = g.measureText(ch);
        const bw = m.actualBoundingBoxLeft + m.actualBoundingBoxRight, bh = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
        if (bw > 2 && bh > 2) {
          const sc = 0.9 * SN / Math.max(bw, bh);
          g.font = `${SN * sc}px "${o.fontFamily}"`;
          g.fillText(ch, SN / 2 - (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) * sc / 2, SN / 2 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) * sc / 2);
          ok = true;
        }
      }
      if (!ok) {
        for (let i = 0, n = 3 + ((Math.random() * 3) | 0); i < n; i++) {
          const a = ANGLES[(Math.random() * 3) | 0], x = rnd(5, SN - 16), y = rnd(5, SN - 16), L = rnd(9, 16), hd = rnd(2.6, 3.6);
          const ca = Math.cos(a), sa = Math.sin(a);
          g.beginPath(); g.moveTo(x - sa * hd, y + ca * hd); g.lineTo(x + sa * hd, y - ca * hd); g.lineTo(x + ca * hd * 1.6, y + sa * hd * 1.6); g.fill();
          g.lineWidth = 1.8; g.beginPath(); g.moveTo(x, y); g.lineTo(x + ca * L, y + sa * L); g.stroke();
        }
      }
      const d = g.getImageData(0, 0, SN, SN).data, mask = new Uint8Array(SN * SN), list = [];
      for (let i = 0; i < SN * SN; i++) if (d[i * 4 + 3] > 110) { mask[i] = 1; list.push(i); }
      return { mask, list };
    }

    const melts = [];
    const colCache = new Map();
    function cellStyle(c) {
      const k = ((c[0] / 6) | 0) * 2000 + ((c[1] / 6) | 0) * 45 + ((c[2] / 6) | 0);
      let s = colCache.get(k);
      if (!s) { s = rgbS(c); if (colCache.size > 4000) colCache.clear(); colCache.set(k, s); }
      return s;
    }
    function meltAt(cx, cy, now, force) {
      if (melts.length >= maxMelts() + (force ? 1 : 0)) return false;
      // small or widely spaced text: let the patch grow until it has caught enough pixels
      let r = (W < 600 ? 22 : 30) * rnd(0.85, 1.25) * (0.9 + 0.4 * o.intensity), A = null;
      for (let k = 0; k < 3; k++, r *= 1.35) {
        A = captureBlob(cx, cy, r);
        if (A.pts.length >= 60) break;
      }
      if (A.pts.length < 24) return false;
      // the darkest ink in the patch on a light page, the strongest ink on a dark page
      let ink = A.pts[0].col;
      for (const p of A.pts) if (dark ? lum(p.col) > lum(ink) : lum(p.col) < lum(ink)) ink = p.col;
      if (!dark) ink = ink.map((v) => v * 0.6);
      const S = signMaskBig();
      if (!S.list.length) return false;
      const cs = W < 600 ? 1.8 : 2.2, size = SN * cs;
      const sx = Math.min(W - size - 4, Math.max(4, cx - size / 2)), sy = Math.min(H - size - 60, Math.max(4, cy - size * 0.62));
      const h0 = Math.random();
      const fl = A.pts.map((p) => {
        const ti = S.list[(Math.random() * S.list.length) | 0];
        return { x: p.x, y: p.y, vx: 0, vy: 0, col: p.col, ti, tx: sx + (ti % SN + 0.5) * cs, ty: sy + (((ti / SN) | 0) + 0.5) * cs,
          spawn: 0.2 + Math.pow(p.d, 0.8) * 2.6 + Math.random() * 0.15, k: rnd(0.6, 1.4), live: false, landed: false, hue: h0 + rnd(-0.06, 0.06) };
      });
      melts.push({
        t0: now, A, B: null, S, sx, sy, cs, ink, fl, hue0: h0,
        alive: new Uint8Array(SN * SN), born: new Float32Array(SN * SN), hue: new Float32Array(SN * SN), count: 0,
        phase: "gather", grownAt: 0, dripAt: 0, healAt: 0, acc: 0, drag: [], heal: null, drip: null,
      });
      wake();
      return true;
    }
    // Presence: Whisper ≈ a melt every 20 s, the default ≈ every 10 s, Lively ≈ every 2–3 s with up to 5 at once
    // the top of the slider is a "showtime" boost: up to 5x faster and many more at once
    const boost = () => { const t = Math.min(1, Math.max(0, (o.intensity - 0.7) / 0.3)); return t * t * (3 - 2 * t); };
    const meltGap = () => 20 * Math.pow(0.12, o.intensity) / (1 + 4 * boost());
    const maxMelts = () => 2 + Math.round(3 * o.intensity) + Math.round(7 * boost());
    // returns "ok", "busy" (already melting in as many places as allowed) or "notext"
    function meltRandom(now, force) {
      if (melts.length >= maxMelts() + (force ? 1 : 0)) return "busy";
      for (let i = 0; i < 12; i++) {
        const p = i < 8 ? visibleTextPoint(H * 0.12, H * 0.8) : null;
        const x = p ? p.x : rnd(W * 0.08, W * 0.92), y = p ? p.y : rnd(H * 0.12, H * 0.78);
        if (!wordAt(x, y)) continue;
        if (meltAt(x, y, now, force)) return "ok";
      }
      return "notext";
    }
    function growStep(M, e) {
      const { alive, hue, born, S } = M, add = [];
      for (const i of S.list) {
        if (alive[i]) continue;
        const x = i % SN, y = (i / SN) | 0;
        let n = 0, hs = 0, hc = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= SN || ny >= SN) continue;
          const j = ny * SN + nx;
          if (alive[j]) { n++; hs += Math.sin(hue[j] * 6.283); hc += Math.cos(hue[j] * 6.283); }
        }
        if (n && Math.random() < 0.04 + 0.05 * n) add.push(i, Math.atan2(hs, hc) / 6.283 + rnd(-0.045, 0.045));
      }
      for (let k = 0; k < add.length; k += 2) if (!alive[add[k]]) { alive[add[k]] = 1; born[add[k]] = e; hue[add[k]] = add[k + 1]; M.count++; }
    }
    function startDrip(M, e) {
      const { alive, cs } = M;
      const top = new Int16Array(SN).fill(-1), bot = new Int16Array(SN).fill(-1);
      for (let i = 0; i < SN * SN; i++) if (alive[i]) { const x = i % SN, y = (i / SN) | 0; if (top[x] < 0) top[x] = y; bot[x] = y; }
      let acc = Array.from({ length: SN }, () => Math.random());
      for (let k = 0; k < 3; k++) acc = acc.map((v, i) => (acc[Math.max(0, i - 1)] + v * 2 + acc[Math.min(SN - 1, i + 1)]) / 4);
      const g = (W < 600 ? 11 : 15) * (0.8 + 0.4 * o.intensity);
      M.drip = { top, bot, acc: acc.map((v) => g * (0.2 + 1.9 * v * v)), wob: Array.from({ length: SN }, () => rnd(0, 6.28)), dropAt: Array.from({ length: SN }, () => rnd(14, 34)), dropped: new Uint8Array(SN) };
      // the lava catches a little of the text just below and drags it down
      const B = captureBlob(M.sx + SN * cs * rnd(0.3, 0.7), M.sy + SN * cs + 8, M.A.r * 0.55);
      if (B.pts.length > 8) {
        M.B = B;
        M.drag = B.pts.map((p) => ({ x: p.x, y: p.y, vx: rnd(-4, 4), vy: rnd(-2, 6), col: p.col, start: e + 0.6 + p.d * 1.4 + Math.random() * 0.6, life: rnd(1.8, 3), live: false, dead: false }));
      }
    }
    function dripOffset(M, x, y, td) {
      const D = M.drip, t = D.top[x], b = D.bot[x];
      if (b < 0) return 0;
      const f = Math.pow((y - t + 1) / (b - t + 1), 1.7);
      return 0.5 * D.acc[x] * td * td * f;
    }
    const HOT_D = [255, 214, 140], HOT_L = [232, 128, 44];
    function cellColor(M, i, e, heatBoost) {
      const age = e - M.born[i];
      if (age < 0.25) return mix(dark ? [255, 248, 230] : [255, 230, 190], dark ? HOT_D : HOT_L, age / 0.25);
      const sh = 0.04 * Math.sin(e * 1.1 + (i % SN) * 0.21 + ((i / SN) | 0) * 0.17);
      const base = mix(M.ink, palAt(M.hue[i] + sh), dark ? 0.35 : 0.22);
      const heat = Math.min(1, Math.exp(-age / 1.5) + (heatBoost || 0));
      return mix(base, dark ? HOT_D : HOT_L, heat * 0.85);
    }
    function stepMelt(M, now, dt) {
      const e = now - M.t0;
      // pixels ride the current toward the sign and grow it where they land
      if (M.phase === "gather" || M.phase === "grow") {
        let flying = 0;
        for (const p of M.fl) {
          if (p.landed || e < p.spawn) { if (!p.landed) flying++; continue; }
          p.live = true; flying++;
          const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy);
          const r0 = Math.min(1, (e - p.spawn) / 2.2), ramp = r0 * r0;
          const a = flowAng(p.x, p.y, e * 0.6);
          const swirl = 30 * (0.35 + 0.65 * Math.min(1, d / 50)) * Math.min(1, r0 * 2.5) * (1 - 0.55 * ramp);
          p.vx += (dx * 1.7 * p.k * ramp - p.vx * 1.9) * dt + Math.cos(a) * swirl * dt;
          p.vy += (dy * 1.7 * p.k * ramp - p.vy * 1.9) * dt + Math.sin(a) * swirl * dt - 3 * r0 * dt;
          p.x += p.vx * dt; p.y += p.vy * dt;
          if ((d < 1.8 && e - p.spawn > 1.2) || e - p.spawn > 5.5) {
            p.landed = true;
            if (!M.alive[p.ti]) { M.alive[p.ti] = 1; M.born[p.ti] = e; M.hue[p.ti] = p.hue; M.count++; }
          }
        }
        if (M.count) {
          M.phase = "grow";
          M.acc += dt * 11;
          while (M.acc >= 1) { M.acc -= 1; growStep(M, e); }
        }
        if (!flying && (M.count >= M.S.list.length * 0.97 || e > 9) && M.phase === "grow") { M.phase = "hold"; M.grownAt = e; }
        if (e > 12) { M.phase = "hold"; M.grownAt = e; }
      } else if (M.phase === "hold") {
        if (e - M.grownAt > 1.8) { M.phase = "drip"; M.dripAt = e; startDrip(M, e); }
      } else if (M.phase === "drip") {
        const td = e - M.dripAt, D = M.drip, cs = M.cs;
        // drops let go of the tips and fall glowing
        for (let x = 0; x < SN; x++) {
          if (D.bot[x] < 0 || D.dropped[x] > 2) continue;
          const off = dripOffset(M, x, D.bot[x], td);
          if (off > D.dropAt[x] * (1 + D.dropped[x] * 0.8)) {
            D.dropped[x]++;
            const px = M.sx + (x + 0.5) * cs, py = M.sy + (D.bot[x] + 1) * cs + off;
            emit(px, py, dark ? HOT_D : HOT_L, { square: true, vx: rnd(-2, 2), vy: rnd(12, 26), life: rnd(1.2, 2), to: palAt(M.hue0 + rnd(-0.1, 0.1)), scale: 1.2, fall: true });
          }
        }
        // cells that have fallen far enough turn into sparks
        const lim = (W < 600 ? 46 : 64);
        for (let i = 0; i < SN * SN; i++) {
          if (!M.alive[i]) continue;
          const x = i % SN, y = (i / SN) | 0, off = dripOffset(M, x, y, td);
          if (off > lim * rnd(0.85, 1.15) || td > 5.4) {
            M.alive[i] = 0; M.count--;
            if (Math.random() < 0.5) emit(M.sx + (x + 0.5) * cs, M.sy + (y + 0.5) * cs + off, cellColor(M, i, e, 0.5), { square: true, vx: rnd(-8, 8), vy: rnd(-12, 6), life: rnd(0.8, 1.8), to: palAt(M.hue[i]), scale: 0.9, star: true });
          }
        }
        // caught text is dragged down with the lava
        for (const p of M.drag) {
          if (p.dead || e < p.start) continue;
          p.live = true;
          const a = flowAng(p.x, p.y, e);
          p.vx += Math.cos(a) * 12 * dt; p.vy += (30 + Math.sin(a) * 8) * dt;
          p.vx *= 0.97; p.vy *= 0.97;
          p.x += p.vx * dt; p.y += p.vy * dt;
          if (e - p.start > p.life) {
            p.dead = true;
            if (Math.random() < 0.6) emit(p.x, p.y, p.col, { square: true, vy: rnd(-10, 4), life: rnd(0.6, 1.3), to: palAt(M.hue0 + rnd(-0.15, 0.15)), scale: 0.8, star: true });
          }
        }
        if (M.count <= 0 && M.drag.every((p) => p.dead || !p.live) && td > 2.5) { M.phase = "rest"; M.healAt = e + 0.8; }
        if (td > 6.5) { M.phase = "rest"; M.healAt = e + 0.6; }
      } else if (M.phase === "rest") {
        if (e > M.healAt) {
          M.phase = "heal"; M.healT = e;
          // the missing pixels swirl back home
          const back = [];
          for (const R of [M.A, M.B]) if (R) for (const p of R.pts) if (Math.random() < 0.6) {
            const a = rnd(0, 6.28), d = rnd(8, 28);
            back.push({ hx: p.x, hy: p.y, x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d - 8, vx: 0, vy: 0, col: p.col, k: rnd(0.7, 1.3), delay: Math.random() * 0.9 });
          }
          M.heal = back;
        }
      } else if (M.phase === "heal") {
        const th = e - M.healT;
        for (const p of M.heal) {
          if (th < p.delay) continue;
          const a = flowAng(p.x, p.y, e), dx = p.hx - p.x, dy = p.hy - p.y;
          const kk = 3.2 * p.k * Math.min(1, (th - p.delay) / 1.2);
          p.vx += (dx * kk - p.vx * 2.6) * dt + Math.cos(a) * 10 * dt * Math.max(0, 1 - th / 2);
          p.vy += (dy * kk - p.vy * 2.6) * dt + Math.sin(a) * 10 * dt * Math.max(0, 1 - th / 2);
          p.x += p.vx * dt; p.y += p.vy * dt;
        }
        if (th > 3.4) M.phase = "dead";
      }
    }
    const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
    // how strongly the melt is "on": rises slowly, falls slowly
    function envOf(M, e) {
      let v = smooth(e / 3.5);
      if (M.phase === "heal") v *= 1 - smooth((e - M.healT) / 3.0);
      if (M.phase === "dead") v = 0;
      return v;
    }
    // heat haze: faint scorched copies of the nearby text pixels shimmer over the real text
    function drawHaze(M, e, env) {
      if (env < 0.02) return;
      for (const [style, list] of M.A.ring) {
        ctx.fillStyle = style;
        for (const band of [0, 1]) {
          ctx.globalAlpha = env * (band ? 0.55 : 0.28);
          ctx.beginPath();
          for (const q of list) {
            if ((q.f > 0.5) !== !!band) continue;
            const w = Math.sin(q.y * 0.45 + e * 4.2) * 0.8 * env * q.f;
            ctx.rect(q.x - 0.5 + w, q.y - 0.5 + w * 0.3, 1, 1);
          }
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    }
    function drawGlow(M, env) {
      if (env < 0.02) return;
      const size = SN * M.cs, cx = M.sx + size / 2, cy = M.sy + size / 2, R = M.A.r * 2.1;
      const c = dark ? HOT_D : [190, 96, 30];
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
      g.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${(dark ? 0.1 : 0.075) * env})`);
      g.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    }
    function drawCover(R, show) {
      // show(d) → whether a cell at normalised radius d is covered right now
      for (const c of R.cells) {
        if (!show(c.d)) continue;
        ctx.fillStyle = cellStyle(c.bg);
        ctx.fillRect(c.x, c.y, c.w + 0.3, c.h + 0.3);
      }
    }
    function drawMelt(M, now) {
      const e = now - M.t0, cs = M.cs;
      // burn a hole where the pixels leave; heal it from the rim inward at the end
      const env = envOf(M, e);
      drawHaze(M, e, env);
      const burn = Math.min(1.1, Math.pow(Math.max(0, (e - 0.2) / 2.6), 1 / 0.8));
      let healK = 0;
      if (M.phase === "heal") healK = Math.min(1, Math.max(0, (e - M.healT - 1.3) / 1.7));
      ctx.globalAlpha = 1;
      drawCover(M.A, (d) => d < burn && d < 1.05 - healK * 1.1);
      if (M.B) {
        const bb = M.phase === "drip" ? Math.min(1.1, (e - M.dripAt - 0.5) / 1.6) : 1.1;
        drawCover(M.B, (d) => d < bb && d < 1.05 - healK * 1.1);
      }
      drawGlow(M, env);
      // flying pixels, warming as they travel
      if (M.phase === "gather" || M.phase === "grow") {
        for (const p of M.fl) {
          if (!p.live || p.landed) continue;
          const heat = Math.min(1, (e - p.spawn) / 2.5);
          ctx.fillStyle = cellStyle(mix(p.col, dark ? HOT_D : HOT_L, heat * 0.7));
          ctx.fillRect(p.x - 0.75, p.y - 0.75, 1.5, 1.5);
        }
      }
      // the sign itself, cell by cell
      if (M.count > 0) {
        const s = cs * 0.92, k = (cs - s) / 2, D = M.phase === "drip" ? M.drip : null, td = D ? e - M.dripAt : 0;
        for (let i = 0; i < SN * SN; i++) {
          if (!M.alive[i]) continue;
          const x = i % SN, y = (i / SN) | 0;
          let off = 0, boost = 0, wdt = s, xo = 0;
          if (D) {
            off = dripOffset(M, x, y, td);
            const offUp = y > 0 ? dripOffset(M, x, y - 1, td) : 0;
            boost = Math.min(0.9, (off - offUp) / 6);
            wdt = s * Math.max(0.45, 1 - (off - offUp) * 0.05);
            xo = Math.sin(td * 3 + D.wob[x] + y * 0.2) * Math.min(1.2, td * 0.8);
            // a strand back up to the cell above keeps the lava continuous
            if (off - offUp > 0.5 && y > 0 && M.alive[i - SN]) {
              ctx.globalAlpha = 1;
              ctx.fillStyle = cellStyle(cellColor(M, i, e, boost));
              ctx.fillRect(M.sx + x * cs + (cs - wdt * 0.7) / 2 + xo, M.sy + y * cs + offUp, wdt * 0.7, off - offUp + 0.5);
            }
          }
          ctx.globalAlpha = Math.min(1, (e - M.born[i]) / 0.7);
          ctx.fillStyle = cellStyle(cellColor(M, i, e, boost));
          ctx.fillRect(M.sx + x * cs + (cs - wdt) / 2 + xo, M.sy + y * cs + k + off, wdt, s);
        }
      }
      ctx.globalAlpha = 1;
      // dragged text
      for (const p of M.drag) {
        if (!p.live || p.dead) continue;
        const t = Math.min(1, (e - p.start) / p.life);
        ctx.fillStyle = cellStyle(mix(p.col, dark ? HOT_D : HOT_L, t * 0.8));
        ctx.fillRect(p.x - 0.75, p.y - 0.75, 1.5, 1.5);
      }
      // returning pixels
      if (M.phase === "heal") {
        const th = e - M.healT;
        ctx.globalAlpha = Math.min(1, th * 2) * (1 - smooth((th - 2.4) / 1.0));
        for (const p of M.heal) {
          if (th < p.delay) continue;
          ctx.fillStyle = cellStyle(p.col);
          ctx.fillRect(p.x - 0.65, p.y - 0.65, 1.3, 1.3);
        }
        ctx.globalAlpha = 1;
      }
    }

    /* ---- scheduler (cheap timers when idle, frames only while something moves) ---- */
    let running = false, raf = 0, lastT = 0, nextWord = 0, nextBloom = 0, nextClay = 0, lastTheme = 0;
    function plan(now) {
      const k = o.intensity;
      nextWord = now + 8 * Math.pow(0.15, k) / (1 + 4 * boost()) * rnd(0.6, 1.4);
      if (!nextBloom) nextBloom = now + rnd(8, 16);
      if (!nextClay) nextClay = now + rnd(2, 5);
    }
    function tick() {
      if (document.hidden) return;
      if (!host.isConnected) document.documentElement.appendChild(host);
      const now = performance.now() / 1000;
      if (now - lastTheme > 6) { lastTheme = now; detectTheme(); }
      if (o.words && now > nextWord) { shedRandomWord(); plan(now); }
      if (o.blooms && now > nextBloom) {
        startBloom();
        nextBloom = now + 60 * Math.pow(0.15, o.intensity) / (1 + 4 * boost()) * rnd(0.7, 1.3);
      }
      if (o.melt && !reduce && now > nextClay) {
        nextClay = meltRandom(now) === "ok" ? now + meltGap() * rnd(0.6, 1.4) : now + 2;
      }
    }
    function wake() {
      if (running) return;
      running = true; lastT = performance.now() / 1000;
      raf = requestAnimationFrame(frame);
    }
    function frame() {
      const now = performance.now() / 1000;
      const dt = Math.min(0.05, now - lastT); lastT = now;

      // scroll bookkeeping
      const dy = pendY + innerDY;
      for (const p of parts) { p.x -= pendX; p.y -= pendY; }
      if (pendX || pendY) for (const M of melts) {
        M.sx -= pendX; M.sy -= pendY;
        for (const q of M.fl) { q.x -= pendX; q.y -= pendY; q.tx -= pendX; q.ty -= pendY; }
        for (const q of M.drag) { q.x -= pendX; q.y -= pendY; }
        for (const list of M.A.ring.values()) for (const q of list) { q.x -= pendX; q.y -= pendY; }
        if (M.heal) for (const q of M.heal) { q.x -= pendX; q.y -= pendY; q.hx -= pendX; q.hy -= pendY; }
        for (const R of [M.A, M.B]) if (R) {
          for (const q of R.pts) { q.x -= pendX; q.y -= pendY; }
          for (const c of R.cells) { c.x -= pendX; c.y -= pendY; }
        }
      }
      for (const b of blooms) { b.x -= pendX; b.y -= pendY; if (b.y < -100 || b.y > H + 30) b.phase = "dead"; }
      const v = dt > 0 ? dy / dt : 0;
      vel = lerp(vel, v, 0.25);
      if (o.cues && !reduce) {
        cueOff -= dy;
        if (Math.abs(dy) > 0.5) cueDir = dy > 0 ? 1 : -1;
        const target = Math.min(1, Math.abs(vel) / 900);
        cueA = target > cueA ? lerp(cueA, target, 0.3) : Math.max(0, cueA - dt / 1.4);
      } else cueA = 0;
      pendX = pendY = innerDY = 0;

      // blooms at ~20 steps/second
      for (const b of blooms) {
        b.acc += dt * 20;
        while (b.acc >= 1) { b.acc -= 1; stepBloom(b, now); }
      }
      for (let i = blooms.length - 1; i >= 0; i--) if (blooms[i].phase === "dead") blooms.splice(i, 1);

      // particles
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        if (p.delay > 0) { p.delay -= dt; continue; }
        p.life += dt;
        if (p.life >= p.max || p.y < -20 || p.y > H + 20) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }
        if (p.fall) p.vy += 120 * dt;
        p.vx += Math.sin(p.y * 0.021 + now * 0.7) * 10 * dt;
        p.vy += (Math.cos(p.x * 0.017 - now * 0.5) * 6 - 5) * dt;
        p.vx *= 0.98; p.vy *= 0.98;
        p.x += p.vx * dt; p.y += p.vy * dt; p.ang += p.spin * dt;
      }

      for (const M of melts) stepMelt(M, now, dt);
      for (let i = melts.length - 1; i >= 0; i--) if (melts[i].phase === "dead") melts.splice(i, 1);

      // draw
      ctx.clearRect(0, 0, W, H);
      for (const b of blooms) drawBloom(b, now);
      for (const M of melts) drawMelt(M, now);
      const amax = 0.5 + 0.45 * o.intensity;
      for (const p of parts) {
        if (p.delay > 0) continue;
        const u = p.life / p.max;
        const fade = Math.min(1, p.life / 0.18) * (1 - u) * (1 - u * 0.3);
        const tw = 0.72 + 0.28 * Math.sin(p.ph + now * p.fr);
        const a = amax * fade * tw;
        if (a < 0.015) continue;
        const m = Math.min(1, u / 0.4);
        ctx.fillStyle = `rgb(${lerp(p.from[0], p.to[0], m) | 0},${lerp(p.from[1], p.to[1], m) | 0},${lerp(p.from[2], p.to[2], m) | 0})`;
        ctx.globalAlpha = a;
        if (p.sq) {
          const t2 = 0.5 + 0.5 * Math.sin(p.ph + now * p.fr);
          ctx.globalAlpha = amax * fade * (0.25 + 0.75 * t2 * t2);
          ctx.globalCompositeOperation = dark ? "lighter" : "source-over";
          const z = p.size;
          if (p.star && t2 > 0.8) { const L = z * 2.8; ctx.fillRect(p.x - L, p.y - 0.5, L * 2, 1); ctx.fillRect(p.x - 0.5, p.y - L, 1, L * 2); }
          ctx.fillRect(p.x - z / 2, p.y - z / 2, z, z);
          ctx.globalCompositeOperation = "source-over";
          continue;
        }
        ctx.beginPath();
        wedge(p.x, p.y, p.size, p.ang);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      drawCues();

      if (parts.length || blooms.length || melts.length || cueA > 0.01) raf = requestAnimationFrame(frame);
      else { running = false; ctx.clearRect(0, 0, W, H); }
    }

    /* ---- wiring ---- */
    const onResize = () => { resize(); wake(); };
    const onReduce = () => { reduce = reduceMQ.matches; };
    const onVis = () => { if (!document.hidden) { lastSX = global.scrollX; lastSY = global.scrollY; } };
    global.addEventListener("resize", onResize);
    global.addEventListener("scroll", onScroll, { capture: true, passive: true });
    document.addEventListener("visibilitychange", onVis);
    reduceMQ.addEventListener && reduceMQ.addEventListener("change", onReduce);
    plan(performance.now() / 1000);
    const timer = setInterval(tick, 250);

    return {
      set(next) { o = Object.assign(o, next || {}); plan(performance.now() / 1000); wake(); },
      shedNow() { return shedRandomWord(); },
      bloomNow() { startBloom(); },
      meltNow() { return meltRandom(performance.now() / 1000, true); },
      meltAtPoint(x, y) { return meltAt(x, y, performance.now() / 1000); },
      destroy() {
        clearInterval(timer); cancelAnimationFrame(raf); running = false;
        global.removeEventListener("resize", onResize);
        global.removeEventListener("scroll", onScroll, { capture: true });
        document.removeEventListener("visibilitychange", onVis);
        reduceMQ.removeEventListener && reduceMQ.removeEventListener("change", onReduce);
        host.remove();
      },
    };
  }

  global.CuneiformDrift = CuneiformDrift;
})(typeof window !== "undefined" ? window : self);
