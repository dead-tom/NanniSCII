#!/usr/bin/env python3
"""
nanniscii_vector.py: the same artwork as nanniscii_render.py, as a VECTOR file.

Every sign is drawn as its actual outline (taken from the cuneiform font), not
as pixels, so the file stays sharp at any size: zoom in forever, or print it
as large as you like.

It uses exactly the same image reading, scoring and settings as
nanniscii_render.py (it imports them), so with the same settings and --seed you
get the same layout as the PNG.

Formats
  --format pdf   (default) opens in Preview, prints anywhere, good for print shops
  --format svg   for the web, Illustrator, Inkscape, Figma
  --format both

Deps:  pip install pillow numpy pandas fonttools reportlab
Run from the NanniSCII folder, with the same settings you used for the PNG:
  python3 generator/nanniscii_vector.py "generator/images/Standing_male_worshiper_high_contrast.jpg" -w 56
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from nanniscii_render import build_parser, match_grid, page_geometry, FONT, FILL

try:
    from fontTools.ttLib import TTFont
    from fontTools.pens.boundsPen import BoundsPen
    from fontTools.pens.svgPathPen import SVGPathPen
except ImportError:
    sys.exit("Missing fontTools: pip install fonttools reportlab")


class Glyphs:
    """Sign outlines from the font, plus how to place each one in a cell."""
    def __init__(self, path):
        self.font = TTFont(path)
        self.gs = self.font.getGlyphSet()
        self.cmap = self.font.getBestCmap()
        self._bounds = {}

    def name(self, sign):
        return self.cmap.get(ord(sign))

    def bounds(self, sign):
        if sign not in self._bounds:
            bp = BoundsPen(self.gs)
            self.gs[self.name(sign)].draw(bp)
            self._bounds[sign] = bp.bounds
        return self._bounds[sign]

    def placement(self, sign, cx, cy, box):
        """Scale and offset (page units, y down) that centre the sign's outline
        on (cx, cy) and fit it inside a square of side `box`."""
        x0, y0, x1, y1 = self.bounds(sign)
        k = box / max(x1 - x0, y1 - y0)
        tx = cx - k * (x0 + x1) / 2
        ty = cy + k * (y0 + y1) / 2          # font y points up, page y points down
        return k, tx, ty


def write_svg(path, a, rows, cols, placements, glyphs):
    size, W, H, cell, x0, y0 = page_geometry(a, rows, cols)
    paper, ink = ("#000", "#fff") if a.invert else ("#fff", "#000")
    defs, used, body = [], set(), []
    for r, c, s, sc, kind in placements:
        cx, cy = x0 + (c + 0.5) * cell, y0 + (r + 0.5) * cell
        if kind == "break":
            if a.redaction == "x":
                body.append(f'<text x="{cx:.3f}" y="{cy:.3f}" font-size="{cell*0.8:.3f}" '
                            f'text-anchor="middle" dominant-baseline="central" '
                            f'font-family="Helvetica, Arial, sans-serif">x</text>')
            continue
        if glyphs.name(s) is None:
            continue
        gid = "g%X" % ord(s)
        if gid not in used:
            pen = SVGPathPen(glyphs.gs)
            glyphs.gs[glyphs.name(s)].draw(pen)
            defs.append(f'<path id="{gid}" d="{pen.getCommands()}"/>')
            used.add(gid)
        k, tx, ty = glyphs.placement(s, cx, cy, cell * FILL * sc)
        body.append(f'<use href="#{gid}" xlink:href="#{gid}" transform="matrix({k:.6g} 0 0 {-k:.6g} {tx:.4f} {ty:.4f})"/>')
    with open(path, "w", encoding="utf-8") as f:
        f.write(f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{W}mm" height="{H}mm" '
                f'viewBox="0 0 {W} {H}">\n<rect width="{W}" height="{H}" fill="{paper}"/>\n'
                f'<defs>\n' + "\n".join(defs) + f'\n</defs>\n<g fill="{ink}">\n'
                + "\n".join(body) + "\n</g>\n</svg>\n")


def write_pdf(path, a, rows, cols, placements, glyphs):
    try:
        from reportlab.pdfgen import canvas
        from reportlab.lib.units import mm
        from fontTools.pens.basePen import BasePen
    except ImportError:
        sys.exit("Missing reportlab: pip install reportlab")
    size, W, H, cell, x0, y0 = page_geometry(a, rows, cols)
    pdf = canvas.Canvas(path, pagesize=(W * mm, H * mm))
    pdf.setTitle(os.path.splitext(os.path.basename(path))[0])
    paper, ink = ((0, 0, 0), (1, 1, 1)) if a.invert else ((1, 1, 1), (0, 0, 0))
    pdf.setFillColorRGB(*paper); pdf.rect(0, 0, W * mm, H * mm, stroke=0, fill=1)
    pdf.setFillColorRGB(*ink)
    class CanvasPen(BasePen):
        """Draws a font outline into a reportlab canvas path (curves converted to cubic)."""
        def __init__(self, gs, path):
            super().__init__(gs); self.p = path
        def _moveTo(self, pt): self.p.moveTo(*pt)
        def _lineTo(self, pt): self.p.lineTo(*pt)
        def _curveToOne(self, p1, p2, p3): self.p.curveTo(*p1, *p2, *p3)
        def _closePath(self): self.p.close()

    forms = set()
    def form_for(sign):
        """Each distinct sign is stored once in the PDF and reused (keeps files small)."""
        name = "g%X" % ord(sign)
        if name not in forms:
            bx0, by0, bx1, by1 = glyphs.bounds(sign)
            pdf.beginForm(name, bx0, by0, bx1, by1)
            pdf.setFillColorRGB(*ink)
            path = pdf.beginPath()
            glyphs.gs[glyphs.name(sign)].draw(CanvasPen(glyphs.gs, path))
            pdf.drawPath(path, stroke=0, fill=1, fillMode=1)   # non-zero fill, as in fonts
            pdf.endForm()
            forms.add(name)
        return name

    for _, _, s, _, kind in placements:                 # define every form up front
        if kind == "sign" and glyphs.name(s) is not None:
            form_for(s)

    for r, c, s, sc, kind in placements:
        cx, cy = x0 + (c + 0.5) * cell, y0 + (r + 0.5) * cell
        if kind == "break":
            if a.redaction == "x":
                pdf.setFont("Helvetica", cell * 0.8 * mm)
                pdf.drawCentredString(cx * mm, (H - cy) * mm - cell * 0.28 * mm, "x")
            continue
        if glyphs.name(s) is None:
            continue
        k, tx, ty = glyphs.placement(s, cx, cy, cell * FILL * sc)
        pdf.saveState()
        pdf.translate(tx * mm, (H - ty) * mm)            # PDF y points up
        pdf.scale(k * mm, k * mm)
        pdf.doForm(form_for(s))
        pdf.restoreState()
    pdf.showPage(); pdf.save()


def main():
    ap = build_parser()
    ap.description = "Image to cuneiform art, as a vector PDF / SVG."
    ap.add_argument("--format", choices=("pdf", "svg", "both"), default="pdf")
    a = ap.parse_args()

    rows, cols, placements, info = match_grid(a)
    glyphs = Glyphs(FONT)
    stem = os.path.splitext(os.path.basename(a.image))[0].replace(" ", "_")
    base = os.path.splitext(a.output)[0] if a.output else os.path.join("outputs", "vector", f"{stem}_nanniscii")
    os.makedirs(os.path.dirname(base) or ".", exist_ok=True)

    written = []
    if a.format in ("svg", "both"):
        write_svg(base + ".svg", a, rows, cols, placements, glyphs); written.append(base + ".svg")
    if a.format in ("pdf", "both"):
        write_pdf(base + ".pdf", a, rows, cols, placements, glyphs); written.append(base + ".pdf")

    size = page_geometry(a, rows, cols)[0]
    n_signs = sum(k == "sign" for *_, k in placements)
    for w in written:
        print(f"wrote {w}  ({size}, {cols}x{rows} signs, vector)")
    print(f"signs placed {n_signs:,}, redaction breaks {len(placements) - n_signs:,}")


if __name__ == "__main__":
    main()
