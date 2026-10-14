# NanniSCII plan (simplified scope, 12 Oct 2026)

**Goal:** an image filled with real CFPB complaints translated into Akkadian cuneiform (redactions kept as breaks), plus an English reference page listing the complaints used.

**Out of scope (next project):** desperation score, emotion models, HDBSCAN template filter.

Don't move on until the test passes.

## Done
- [x] 1. Install CuneiScribe. Sign conversion works.
- [x] 2. Translation model chosen: `praeclarum/cuneiform` + spelling fix + redactions as breaks (split method).
- [x] 3. Data: FOIA archive Export 2 (May 2018–Apr 2021) → `data/raw/sample_narratives.csv`.

## To do
- [ ] 4. **Extract & clean** (local, no ML). Keep: complaint ID, date, product, narrative. Drop credit reporting; drop narratives citing "15 U.S.C.", "FCRA", "1681"; drop very short ones.
  TEST: counts printed at each stage; 20 random complaints read, none are template letters.
- [ ] 5. **Image → ink grid.** The picture becomes a grid of ink / blank cells.
  TEST: mask saved as PNG and the image is recognisable; ink cell count printed.
- [ ] 6. **Random picker + translation** (Colab). Draw random complaints, translate sentence by sentence, count the signs, stop when there are enough to fill the ink cells.
  TEST: total signs ≥ ink cells; same seed → same complaints; every sentence logged (Akkadian, cuneiform, gaps, coverage, validator verdict, low-confidence marked).
- [ ] 7. **Render.** Signs fill the dark areas.
  TEST: tiny grid first (centred, nothing clipped, no empty boxes except redactions), then full size. Decide how the redaction break looks.
- [ ] 8. **Reference page.** The English complaints in the order they appear in the image, each with date, product and complaint ID.
  TEST: every complaint in the image is on the page, in the right order.
- [ ] 9. **Batch & freeze.** Final settings and seed saved; outputs in `outputs/`.
  TEST: rerun gives identical files.
- [ ] 10. **Wrap up.** Tie up the essay; update the artist statement (model sentence, archive / tense changes).

## Decisions
- Fallback / low-confidence translations: keep and mark.
- Redactions: kept as breaks in the clay.
- Template filter: simple rules, not ML.

## Parked for the next project
Desperation score (reading notes in `docs/NanniSCII_reading_notes.xlsx`), emotion classification, HDBSCAN.
