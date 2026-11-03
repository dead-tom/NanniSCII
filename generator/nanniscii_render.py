#!/usr/bin/env python3
"""
nanniscii_render.py: an image redrawn in cuneiform signs from the translated complaints.

Version 3: patch matching. Every part of the image, backdrop included, is read
as image. No CNN needed: this is classic template matching.

HOW IT WORKS
  1. The photo is converted to grey and given asciify-style tone treatment
     (contrast stretch -> S-curve -> gamma) at full resolution.
  2. The image is cut into a grid of cells (square, one sign per cell). Each
     cell is kept as a small patch (default 12x12 pixels), not a single average,
     so its internal shape survives: an edge, a highlight, a petal curve.
  3. Every distinct sign in the complaints is rendered at several sizes,
     giving a library of small ink bitmaps (plus "blank").
  4. Each cell is SCORED against every bitmap: how far its ink pattern is from
     the cell's darkness pattern (mean squared error after a slight blur, so
     near-misses count). The lowest-scoring sign and size wins. Dark cells get
     big dense signs; mid-tones smaller or sparser ones; edges get signs whose
     strokes fall on the dark side of the edge.
  5. Among near-equal winners one is chosen at random (seeded), so there are
     no repeating stripes. Redactions appear as breaks at the same rate as in
     the complaints.

OUTPUTS
  <name>_nanniscii.png  the artwork (A4 at 300 dpi)
  <name>_tones.png      the darkness the signs are trying to match

Deps:  pip install pillow numpy pandas
Run from the NanniSCII folder:
  python3 generator/nanniscii_render.py "generator/images/Standing_male_worshiper_high_contrast.jpg"
"""
import argparse, os, re, sys
import numpy as np
import pandas as pd
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

HERE = os.path.dirname(os.path.abspath(__file__))
FONT = os.path.join(HERE, "fonts", "NotoSansCuneiform-Regular.ttf")
GAP = "<gap>"
PAGE_MM = {"a4-portrait": (210, 297), "a4-landscape": (297, 210),
           "a3-portrait": (297, 420), "a3-landscape": (420, 297)}
FILL = 0.92            # a full-size sign fills 92% of its cell


# ------------------------------------------------------------------ the image
def load_grey(path, channel):
    rgb = np.asarray(ImageOps.exif_transpose(Image.open(path)).convert("RGB"), dtype=float)
    if channel == "min":
        return rgb.min(axis=2)
    return 0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]


def tone(g, a):
    """asciify's tone treatment, on 0..1 brightness."""
    lo, hi = np.percentile(g, [a.contrast_lo, a.contrast_hi])
    g = np.clip((g - lo) / max(hi - lo, 1e-6), 0, 1)
    if a.curve > 0:
        sig = lambda t: 1 / (1 + np.exp(-t))
        l0, l1 = sig(a.curve * -a.curve_mid), sig(a.curve * (1 - a.curve_mid))
        g = (sig(a.curve * (g - a.curve_mid)) - l0) / (l1 - l0)
    if a.gamma != 1:
        g = np.power(np.clip(g, 0, 1), a.gamma)
    return 1 - g if a.invert else g


def image_patches(a, P):
    g = load_grey(a.image, a.channel)
    H, W = g.shape
    cols, rows = a.width, max(1, round(a.width * H / W))
    g = np.asarray(Image.fromarray(g.astype(np.float32), mode="F")
                   .resize((cols * P, rows * P), Image.Resampling.BOX), dtype=float)
    dark = 1 - tone(g, a)                               # 1 = black, 0 = paper
    blurred = np.asarray(Image.fromarray((dark * 255).astype(np.uint8))
                         .filter(ImageFilter.GaussianBlur(a.blur)), dtype=float) / 255
    patches = blurred.reshape(rows, P, cols, P).transpose(0, 2, 1, 3).reshape(rows * cols, P * P)
    return patches, dark, rows, cols


# ---------------------------------------------------------------- the signs
def sign_stream(csv_path):
    out = []
    for line in pd.read_csv(csv_path)["cuneiform"].dropna():
        for word in line.split():
            if word == "[x]":
                out.append(GAP)
            else:
                out += [ch for ch in re.sub(r"\[[^\]]*\]", "", word) if 0x12000 <= ord(ch) <= 0x1254F]
    if not out:
        sys.exit("No cuneiform signs found in the CSV.")
    return out


_fonts = {}
def fitted_font(draw, sign, box):
    """Largest font size at which `sign` fits in a square of side `box` px."""
    key = (sign, round(box, 1))
    if key not in _fonts:
        size = max(4, int(box))
        while size > 4:
            l, t, r, b = draw.textbbox((0, 0), sign, font=ImageFont.truetype(FONT, size))
            if r - l <= box and b - t <= box:
                break
            size -= 1
        _fonts[key] = ImageFont.truetype(FONT, size)
    return _fonts[key]


def sign_library(signs, scales, P, blur, hi=96):
    """Render each sign at each scale, centred in a cell, as a P x P ink bitmap."""
    lib, bitmaps = [("", 0.0)], [np.zeros(P * P)]       # entry 0 = blank paper
    for s in signs:
        for sc in scales:
            im = Image.new("L", (hi, hi), 0); d = ImageDraw.Draw(im)
            d.text((hi / 2, hi / 2), s, font=fitted_font(d, s, hi * FILL * sc), fill=255, anchor="mm")
            small = im.resize((P, P), Image.Resampling.BOX).filter(ImageFilter.GaussianBlur(blur * P / P))
            lib.append((s, sc)); bitmaps.append(np.asarray(small, float).ravel() / 255)
    return lib, np.array(bitmaps)


# ------------------------------------------------------------------- main
def build_parser():
    ap = argparse.ArgumentParser(description="Image to cuneiform art by patch matching.")
    ap.add_argument("image")
    ap.add_argument("--text-csv", default=os.path.join(HERE, "..", "data", "translations.csv"),
                    help="the translated lines (default data/translations.csv)")
    ap.add_argument("-o", "--output", help="default outputs/ascii/<image>_nanniscii.png")
    ap.add_argument("-w", "--width", type=int, default=90, help="signs across (default 90)")
    ap.add_argument("--channel", choices=("luma", "min"), default="luma")
    ap.add_argument("--contrast-lo", type=float, default=1.0)
    ap.add_argument("--contrast-hi", type=float, default=99.0)
    ap.add_argument("--curve", type=float, default=4.0)
    ap.add_argument("--curve-mid", type=float, default=0.5)
    ap.add_argument("--gamma", type=float, default=1.0)
    ap.add_argument("--invert", action="store_true", help="light signs on black")
    ap.add_argument("--ink", type=float, default=1.0,
                    help="how much ink the darkest tone asks for: >1 darker overall, <1 lighter")
    ap.add_argument("--scales", default="1,0.85,0.7,0.55,0.42,0.3",
                    help="sizes a sign may be drawn at, as fractions of the cell")
    ap.add_argument("--patch", type=int, default=12, help="pixels per cell used for matching")
    ap.add_argument("--blur", type=float, default=1.0, help="tolerance for near-miss alignment")
    ap.add_argument("--shape", type=float, default=0.03,
                    help="how much a sign's stroke direction matters vs its tone (0 = tone only)")
    ap.add_argument("--tolerance", type=float, default=0.002,
                    help="signs scoring within this of the best count as equally good (variety)")
    ap.add_argument("--redaction", choices=("hole", "x", "none"), default="hole")
    ap.add_argument("--size", choices=["auto", *PAGE_MM], default="auto")
    ap.add_argument("--dpi", type=int, default=300)
    ap.add_argument("--margin", type=float, default=0.04)
    ap.add_argument("--seed", type=int, default=1, help="same seed = same image")
    return ap


def match_grid(a):
    """Everything up to the drawing: read the image, score every cell, choose
    signs and redaction breaks. Shared by the PNG and vector scripts, so the
    same settings and seed always give the same layout.
    Returns rows, cols and a list of placements (row, col, sign, scale, kind)
    where kind is "sign" or "break"."""
    for p, what in [(a.image, "Image"), (a.text_csv, "Text CSV"), (FONT, "Font")]:
        if not os.path.exists(p):
            sys.exit(f"{what} not found: {p}\n(Quote paths with spaces.)")

    P = a.patch
    patches, dark, rows, cols = image_patches(a, P)
    stream = sign_stream(a.text_csv)
    signs = [t for t in stream if t != GAP]
    vocab = list(dict.fromkeys(signs))
    gap_rate = 0 if a.redaction == "none" else (len(stream) - len(signs)) / len(stream)
    scales = [float(x) for x in a.scales.split(",")]
    lib, B = sign_library(vocab, scales, P, a.blur)

    # The densest sign covers only ~25% of its cell, so darkness is mapped onto
    # the ink the signs can actually deliver.
    cmax = B.mean(axis=1).max()
    T = np.clip(patches * cmax * a.ink, 0, 1)

    # SCORE every cell against every bitmap, in two parts:
    #   tone:  how far the sign's overall ink is from the cell's darkness
    #   shape: how well the sign's strokes line up with the cell's light/dark
    #          pattern (correlation), weighted by how much pattern the cell has,
    #          so flat areas are judged on tone alone and edges on shape too
    mT, mB = T.mean(1), B.mean(1)
    Tc, Bc = T - mT[:, None], B - mB[:, None]
    nT, nB = np.linalg.norm(Tc, axis=1), np.linalg.norm(Bc, axis=1)
    corr = (Tc @ Bc.T) / (np.maximum(nT, 1e-9)[:, None] * np.maximum(nB, 1e-9)[None, :])
    texture = nT / max(nT.max(), 1e-9)
    scores = ((mT[:, None] - mB[None, :]) / cmax) ** 2 - a.shape * texture[:, None] * corr
    best = scores.min(axis=1, keepdims=True)
    near = scores <= best + a.tolerance
    rng = np.random.default_rng(a.seed)
    choice = np.array([rng.choice(np.flatnonzero(row)) for row in near])

    placements = []
    for k, idx in enumerate(choice):
        sgn, sc = lib[idx]
        if not sgn:
            continue
        r, c = divmod(k, cols)
        kind = "break" if rng.random() < gap_rate else "sign"
        placements.append((r, c, sgn, sc, kind))
    info = dict(n_vocab=len(vocab), n_scales=len(scales), n_lib=len(lib) - 1,
                blank=int((choice == 0).sum()), dark=dark,
                sizes=pd.Series([sc for (_, _, _, sc, k) in placements if k == "sign"])
                        .value_counts().sort_index(ascending=False))
    return rows, cols, placements, info


def page_geometry(a, rows, cols):
    """Page size in mm and the cell grid position, shared by PNG and vector output."""
    size = a.size if a.size != "auto" else ("a4-portrait" if rows >= cols else "a4-landscape")
    mm_w, mm_h = PAGE_MM[size]
    cell = min(mm_w * (1 - 2 * a.margin) / cols, mm_h * (1 - 2 * a.margin) / rows)
    x0, y0 = (mm_w - cols * cell) / 2, (mm_h - rows * cell) / 2
    return size, mm_w, mm_h, cell, x0, y0


def main():
    a = build_parser().parse_args()
    rows, cols, placements, info = match_grid(a)
    dark = info["dark"]
    size, mm_w, mm_h, cell_mm, x0_mm, y0_mm = page_geometry(a, rows, cols)
    px = a.dpi / 25.4                                     # pixels per mm
    pw, ph = round(mm_w * px), round(mm_h * px)
    cell, x0, y0 = cell_mm * px, x0_mm * px, y0_mm * px
    paper, ink_col = ((0, 0, 0), (255, 255, 255)) if a.invert else ((255, 255, 255), (0, 0, 0))
    canvas = Image.new("RGB", (pw, ph), paper)
    d = ImageDraw.Draw(canvas)
    xfont = ImageFont.load_default(size=max(6, int(cell * 0.8)))

    placed = breaks = 0
    for r, c, s, sc, kind in placements:
        cx, cy = x0 + (c + 0.5) * cell, y0 + (r + 0.5) * cell
        if kind == "break":
            breaks += 1
            if a.redaction == "x":
                d.text((cx, cy), "x", font=xfont, fill=ink_col, anchor="mm")
            continue
        d.text((cx, cy), s, font=fitted_font(d, s, cell * FILL * sc), fill=ink_col, anchor="mm")
        placed += 1

    stem = os.path.splitext(os.path.basename(a.image))[0].replace(" ", "_")
    out = a.output or os.path.join("outputs", "ascii", f"{stem}_nanniscii.png")
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    canvas.save(out, dpi=(a.dpi, a.dpi))
    Image.fromarray(((1 - dark) * 255).astype(np.uint8)).resize((cols * 8, rows * 8)).save(
        os.path.splitext(out)[0] + "_tones.png")

    used = info["sizes"]
    print(f"wrote {out}  ({size}, {cols}x{rows} signs, cell {cell:.0f}px)")
    print(f"      {os.path.splitext(out)[0]}_tones.png  (the darkness the signs are matching)")
    print(f"{info['n_vocab']} distinct signs x {info['n_scales']} sizes = {info['n_lib']} candidates per cell")
    print("sizes used: " + ", ".join(f"{s:.0%}: {n}" for s, n in used.items()))
    print(f"signs placed {placed:,}, redaction breaks {breaks:,}, blank cells {info['blank']:,}")
    print(f"Signs needed for this image at this width: {placed + breaks:,}")


if __name__ == "__main__":
    main()
