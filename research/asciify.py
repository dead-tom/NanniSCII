#!/usr/bin/env python3
"""
asciify.py — image to ASCII art via classic luminance-ramp mapping.

Traditional pipeline, no edge detection:
  grayscale -> aspect-corrected block-average downsample -> contrast
  stretch -> optional gamma -> luminance-to-character ramp, with optional
  Floyd-Steinberg dithering for extra apparent detail.

Output:
  - .txt  -> plain ASCII text
  - .jpg / .png -> ASCII rendered onto a page canvas (default A4 landscape)

Deps:  pip install pillow numpy

Examples:
  python asciify.py                                 # uses the defaults below
  python asciify.py photo.jpg -o out.txt
  python asciify.py photo.jpg -o out.jpg --dither
  python asciify.py photo.jpg -o out.png --size a4-portrait --dpi 300
"""

import argparse
import os
import re
import sys

import numpy as np
from PIL import Image, ImageOps, ImageDraw, ImageFont

# ---------------------------------------------------------------------------
# Defaults (edit these to change the no-argument behaviour)
# ---------------------------------------------------------------------------
DEFAULT_INPUT = "input.png"
DEFAULT_OUTPUT = "output_ascii.png"
DEFAULT_SIZE = "a4-portrait"
DEFAULT_DPI = 300

# Ramps ordered DARK -> LIGHT. Index 0 = densest ink, for dark-on-light
# (paper) viewing. Use --invert for light-on-dark terminals.
RAMPS = {
    "dense":    "$@B%8&WM#*oahkbdpqwmZO0QLCJUYXzcvunxrjft/\\|()1{}[]?-_+~<>i!lI;:,\"^`'. ",
    "standard": "@%#*+=-:. ",
    "blocks":   "\u2588\u2593\u2592\u2591 ",
}

# Page sizes in millimetres (width, height).
PAGE_MM = {
    "a4-landscape": (297, 210),
    "a4-portrait": (210, 297),
    "a3-landscape": (420, 297),
    "a3-portrait": (297, 420),
}

# Monospace font candidates, macOS first, then Linux, then generic.
MONO_FONTS = [
    "/System/Library/Fonts/Menlo.ttc",
    "/System/Library/Fonts/Monaco.ttf",
    "/System/Library/Fonts/SFNSMono.ttf",
    "/System/Library/Fonts/Supplemental/Courier New.ttf",
    "/Library/Fonts/Courier New.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf",
]


def find_mono_font():
    for p in MONO_FONTS:
        if os.path.exists(p):
            return p
    return None


def load_gray(path):
    img = Image.open(path)
    img = ImageOps.exif_transpose(img)
    return img.convert("L")


def block_average(img, width, char_aspect):
    """Downsample so each output char = the AVERAGE of its source cell.
    Image.BOX resampling is exactly area-averaging (the traditional method)."""
    w, h = img.size
    new_h = max(1, int(round(width * (h / w) * char_aspect)))
    return img.resize((width, new_h), Image.Resampling.BOX)


def contrast_stretch(arr, low=5.0, high=95.0):
    lo, hi = np.percentile(arr, [low, high])
    if hi <= lo:
        return arr
    return np.clip((arr - lo) * 255.0 / (hi - lo), 0, 255)


def s_curve(arr, strength, midpoint=0.5):
    """Sigmoidal contrast: deepens shadows AND lifts highlights around the
    midpoint (the classic photographic contrast curve). strength=0 is linear.
    Input/output in 0..255."""
    if strength <= 0:
        return arr
    a = arr / 255.0
    sig = lambda t: 1.0 / (1.0 + np.exp(-t))
    lo = sig(strength * (0.0 - midpoint))
    hi = sig(strength * (1.0 - midpoint))
    out = (sig(strength * (a - midpoint)) - lo) / (hi - lo)
    return np.clip(out, 0, 1) * 255.0


def floyd_steinberg(arr, levels):
    """Quantise to `levels` grey levels with Floyd-Steinberg error diffusion."""
    a = arr.astype(np.float32) / 255.0
    H, W = a.shape
    n = levels - 1
    for y in range(H):
        for x in range(W):
            old = a[y, x]
            new = round(old * n) / n
            err = old - new
            a[y, x] = new
            if x + 1 < W:
                a[y, x + 1] += err * 7 / 16
            if y + 1 < H:
                if x - 1 >= 0:
                    a[y + 1, x - 1] += err * 3 / 16
                a[y + 1, x] += err * 5 / 16
                if x + 1 < W:
                    a[y + 1, x + 1] += err * 1 / 16
    return np.clip(np.round(a * n), 0, n).astype(int)


def process_gray(path, width, char_aspect, contrast, contrast_lo, contrast_hi,
                 curve, curve_mid, gamma):
    """Load -> downsample -> contrast -> S-curve -> gamma. Returns 0..255 array."""
    img = load_gray(path)
    img = block_average(img, width, char_aspect)
    arr = np.asarray(img, dtype=np.float32)
    if contrast:
        arr = contrast_stretch(arr, low=contrast_lo, high=contrast_hi)
    arr = s_curve(arr, curve, midpoint=curve_mid)
    if gamma != 1.0:
        arr = 255.0 * np.power(np.clip(arr / 255.0, 0, 1), gamma)
    return arr


def to_ascii_lines(arr, ramp, invert, dither):
    """Classic ramp mapping: brightness -> character."""
    chars = RAMPS[ramp]
    if invert:
        chars = chars[::-1]
    n = len(chars)
    if dither:
        idx = floyd_steinberg(arr, n)
    else:
        idx = np.clip((arr / 255.0 * (n - 1)).astype(int), 0, n - 1)
    return ["".join(chars[v] for v in row) for row in idx]


def load_text(path):
    """Read a source text (prose, poem, .py) and collapse whitespace runs to
    single spaces so it streams cleanly across the grid."""
    with open(path, encoding="utf-8", errors="replace") as f:
        s = f.read()
    s = re.sub(r"\s+", " ", s).strip()
    return s or "?"


def to_text_cells(arr, text, mode, dither, invert):
    """Lay the source text across the grid, image-modulated.
    Returns (glyph_lines, cell_colors). cell_colors is None for 'mask'
    (glyphs are solid black, gaps are spaces); for 'shade' it is a per-cell
    (v,v,v) grey so every glyph inks at the pixel's brightness.
    A shared cursor `i` walks the text so it reads in order."""
    H, W = arr.shape
    b = arr / 255.0                      # 0 = dark, 1 = light
    if invert:
        b = 1.0 - b
    i = 0

    if mode == "mask":
        src = text.replace(" ", "") or "?"   # ink cells always show a letter
        if dither:
            ink = floyd_steinberg(arr, 2) == 0   # dark cells get ink
        else:
            ink = b < 0.5
        glyphs = []
        for y in range(H):
            row = []
            for x in range(W):
                if ink[y, x]:
                    row.append(src[i % len(src)]); i += 1
                else:
                    row.append(" ")
            glyphs.append("".join(row))
        return glyphs, None

    # shade: every cell gets the next glyph, inked at the pixel's grey
    glyphs, colors = [], []
    for y in range(H):
        grow, crow = [], []
        for x in range(W):
            grow.append(text[i % len(text)]); i += 1
            v = int(round(b[y, x] * 255))
            crow.append((v, v, v))
        glyphs.append("".join(grow))
        colors.append(crow)
    return glyphs, colors


def render_to_image(lines, out_path, size="a4-landscape", dpi=300,
                    margin_frac=0.02, cell_colors=None):
    """Draw ASCII lines onto a page canvas, auto-sizing the font to fill it.
    If cell_colors is given (grid of RGB tuples), each glyph is drawn in its
    own colour (used for shade mode); otherwise glyphs are solid black."""
    font_path = find_mono_font()
    if font_path is None:
        sys.exit("error: no monospace font found; install one or edit MONO_FONTS")

    mm_w, mm_h = PAGE_MM[size]
    page_w = int(round(mm_w / 25.4 * dpi))
    page_h = int(round(mm_h / 25.4 * dpi))
    avail_w = page_w * (1 - 2 * margin_frac)
    avail_h = page_h * (1 - 2 * margin_frac)

    cols = max(len(l) for l in lines)
    rows = len(lines)

    # Measure the font's cell at a reference size, then scale to fit the page.
    ref = 100
    f_ref = ImageFont.truetype(font_path, ref)
    char_w = f_ref.getlength("M")                    # monospace: uniform advance
    asc, desc = f_ref.getmetrics()
    line_h = asc + desc
    scale = min(avail_w / (cols * char_w), avail_h / (rows * line_h))
    size_px = max(4, int(ref * scale))

    font = ImageFont.truetype(font_path, size_px)
    char_w = font.getlength("M")
    asc, desc = font.getmetrics()
    line_h = asc + desc

    block_w = cols * char_w
    block_h = rows * line_h
    x0 = (page_w - block_w) / 2
    y0 = (page_h - block_h) / 2

    canvas = Image.new("RGB", (page_w, page_h), "white")
    draw = ImageDraw.Draw(canvas)
    if cell_colors is None:
        for i, line in enumerate(lines):
            draw.text((x0, y0 + i * line_h), line, font=font, fill="black")
    else:
        for i, line in enumerate(lines):
            yy = y0 + i * line_h
            for j, ch in enumerate(line):
                if ch == " ":
                    continue
                draw.text((x0 + j * char_w, yy), ch, font=font,
                          fill=cell_colors[i][j])

    ext = os.path.splitext(out_path)[1].lower()
    if ext in (".jpg", ".jpeg"):
        canvas.save(out_path, quality=95, dpi=(dpi, dpi))
    else:
        canvas.save(out_path, dpi=(dpi, dpi))
    return page_w, page_h, size_px, cols, rows


def font_char_aspect():
    """Actual charW/lineH of the chosen font, so the render keeps true
    image proportions. Falls back to 0.5 if no font is found."""
    fp = find_mono_font()
    if fp is None:
        return 0.5
    f = ImageFont.truetype(fp, 100)
    asc, desc = f.getmetrics()
    return f.getlength("M") / (asc + desc)


def main():
    ap = argparse.ArgumentParser(description="Image to ASCII (luminance ramp).")
    ap.add_argument("image", nargs="?", default=DEFAULT_INPUT,
                    help=f"input image (default: {DEFAULT_INPUT})")
    ap.add_argument("-o", "--output", default=DEFAULT_OUTPUT,
                    help=f"output file; .txt=text, .jpg/.png=rendered page "
                         f"(default: {DEFAULT_OUTPUT})")
    ap.add_argument("-w", "--width", type=int, default=200,
                    help="output width in characters (default 200)")
    ap.add_argument("--size", choices=PAGE_MM.keys(), default=DEFAULT_SIZE,
                    help=f"page size for image output (default {DEFAULT_SIZE})")
    ap.add_argument("--dpi", type=int, default=DEFAULT_DPI,
                    help=f"page resolution for image output (default {DEFAULT_DPI})")
    ap.add_argument("--ramp", choices=RAMPS.keys(), default="dense")
    ap.add_argument("--invert", action="store_true",
                    help="flip ramp for light-on-dark terminals")
    ap.add_argument("--gamma", type=float, default=1.0,
                    help="<1 brightens midtones, >1 darkens (default 1.0)")
    ap.add_argument("--no-contrast", dest="contrast", action="store_false",
                    help="disable auto contrast stretch")
    ap.add_argument("--contrast-lo", type=float, default=5.0,
                    help="low clip percentile; raise for punchier (default 5)")
    ap.add_argument("--contrast-hi", type=float, default=95.0,
                    help="high clip percentile; lower for punchier (default 95)")
    ap.add_argument("--curve", type=float, default=7.0,
                    help="S-curve strength: deeper shadows + brighter highlights; "
                         "0 = off, 4 gentle, 7 strong, 10+ dramatic (default 7)")
    ap.add_argument("--curve-mid", type=float, default=0.5,
                    help="S-curve midpoint 0..1; the tone that gets the most "
                         "contrast. Lower it toward a dark subject to punch its "
                         "detail without deepening lighter areas (default 0.5)")
    ap.add_argument("--margin", type=float, default=0.02,
                    help="page margin as fraction of page size (default 0.02)")
    ap.add_argument("--dither", action="store_true",
                    help="Floyd-Steinberg dithering for extra apparent detail")
    ap.add_argument("--text", metavar="FILE",
                    help="use this text file (prose, poem, .py) as the ink "
                         "instead of the ramp characters")
    ap.add_argument("--text-mode", choices=("shade", "mask"), default="shade",
                    help="shade = every cell a glyph, inked at pixel grey "
                         "(image only, full page of text); mask = glyphs only "
                         "where dark, spaces elsewhere (default shade)")
    args = ap.parse_args()

    ext = os.path.splitext(args.output)[1].lower()
    is_image = ext in (".jpg", ".jpeg", ".png")

    # For image output, match char cell to the font so proportions are true.
    char_aspect = font_char_aspect() if is_image else 0.5

    try:
        arr = process_gray(
            args.image, width=args.width, char_aspect=char_aspect,
            contrast=args.contrast, contrast_lo=args.contrast_lo,
            contrast_hi=args.contrast_hi, curve=args.curve,
            curve_mid=args.curve_mid, gamma=args.gamma,
        )
    except FileNotFoundError:
        sys.exit(f"error: file not found: {args.image}")

    cell_colors = None
    if args.text:
        try:
            text = load_text(args.text)
        except FileNotFoundError:
            sys.exit(f"error: text file not found: {args.text}")
        mode = args.text_mode
        if mode == "shade" and not is_image:
            print("note: shade needs image output; using mask for text file")
            mode = "mask"
        lines, cell_colors = to_text_cells(
            arr, text, mode=mode, dither=args.dither, invert=args.invert)
    else:
        lines = to_ascii_lines(arr, ramp=args.ramp, invert=args.invert,
                               dither=args.dither)

    if is_image:
        pw, ph, sz, cols, rows = render_to_image(
            lines, args.output, size=args.size, dpi=args.dpi,
            margin_frac=args.margin, cell_colors=cell_colors)
        print(f"wrote {args.output}  ({pw}x{ph}px, {args.size} @ {args.dpi}dpi, "
              f"{cols}x{rows} chars, font {sz}px)")
    elif ext == ".txt":
        with open(args.output, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
        print(f"wrote {args.output}")
    else:
        print("\n".join(lines))


if __name__ == "__main__":
    main()
