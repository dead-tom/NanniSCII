# NanniSCII: project log

---

## Thu 8 Oct 2026

### Summary
Decided how lines will be chosen (by rule, using machine learning), designed the full ML pipeline, and found where the complaint narratives have gone. **The CFPB removed all narratives from the public database on 14 Sept 2026**; they now sit in its FOIA Reading Room archive. Downloaded the 2018–2021 archive file and made a working sample on the laptop. **Step 3 (get the complaints) is done**, via a different route than planned.

### Decisions
- **Fallback / low-confidence translations:** keep them and mark them in the log.
- **Line selection:** by rule, using an ML pipeline (chosen partly to practise picking the right algorithm for the job).
- **Look of the redaction break:** decide at the ASCII stage; it may become part of the visual rules there.
- **Artist statement updates:** do them at the very end, once the pipeline is fixed.

### ML pipeline design
The task splits into two separate jobs:

**Job 1: remove template / bot complaints (unit: whole complaint, unsupervised, output: human or template).**
Template letters (mostly credit repair, surging from about 2019) are near-copies of each other, so they form tight clusters; real people spread out.
- TF-IDF (ngrams 1–3, `min_df=5`, `max_df=0.5`, `sublinear_tf`, keep stop words) → truncated SVD (~100 dims) → L2 normalise → **HDBSCAN**.
- Why not k-means: it needs k in advance and forces every point into a cluster. HDBSCAN finds dense groups and leaves loose points as "noise". **The noise is the humans.**
- Optimisation means tuning settings (`min_cluster_size`, `min_samples`) and checking results (DBCV score, cluster vs noise share, reading samples from each), not training.

**Job 2: pick one sentence per complaint (unit: sentence, output: ranking).**
- Split into sentences → filter (6–35 words, at most one redaction, no boilerplate openers).
- Score three ways: **transformer emotion classifier** trained on GoEmotions (main), **VADER** (rule-based baseline, not a neural network), and simple linguistic features (I/me/my, ?, !, capitals, never/nobody/always).
- Scale every feature to **percentile ranks** → weighted "heat" score → top sentence per complaint.
- Validate without labels: agreement between the transformer and VADER (Spearman), weight sensitivity (±0.1), blind reading of the top 20 vs bottom 20.

**Two copies of the text:** Copy A (lowercase, no punctuation) for clustering; Copy B (untouched) for emotion, because capitals and punctuation carry emotion.

**Desperation score:** GoEmotions has no "desperation" label, so it has to be built from proxies (sadness, fear, nervousness, anger, annoyance, disappointment). This is the same move psychographic profiling makes (Kosinski et al. 2013; Cambridge Analytica). **Record the chosen weights; they are part of the essay.**

Prep reading: *The Illustrated Transformer* (Alammar); GoEmotions paper (Demszky et al. 2020); VADER paper (Hutto & Gilbert 2014); "How HDBSCAN works" (HDBSCAN docs).

### Finding the data
- **CFPB website:** list view showed no narratives, and the "Only show complaints with narratives" filter is gone. (Consumer groups complained in 2020–21 that the narratives were being buried in the interface.)
- **CFPB API from Colab:** 403 (blocked) → fixed with a browser User-Agent → 400 (`frm` has to be a multiple of `size`) → 200, but **no narrative field returned**.
- **Filtered CSV export:** limited to 100,000 rows, and **no narrative column**.
- **Reason:** on 14 Aug 2026 the CFPB announced it would stop publishing narratives (calling them unverified and one-sided; consumer groups opposed this). On 14 Sept 2026 it removed them and archived them in the **FOIA Reading Room**: complaints received 1 Dec 2011 – 14 Aug 2026, as zip files by date range.
  - Archive: https://www.consumerfinance.gov/foia-requests/foia-electronic-reading-room/cfpb-consumer-complaint-database-narratives-archive/
  - Pre-2022 files: Export 1 (Dec 2011–Apr 2018, narratives from 2015), **Export 2 (May 2018–Apr 2021) ← using this one**, Export 3 (May 2021–Oct 2022, keep 2021 only).
- **Colab is blocked** from the archive too (403), so the big file can't go through Colab.
- **Solution:** downloaded Export 2 in the browser to `/Volumes/DEAD TOM 1/RAW DATA/`. Wrote `src/make_sample.py`, which reads the file in chunks (low memory), keeps rows with a narrative received before 2022, and takes a random 3% → **`data/raw/sample_narratives.csv` created.** Runs in Terminal inside a project virtual environment (`.venv`).

### Notes for the essay / statement
- The voices were literally removed from the living public database weeks before this project started, and now exist only in an archive. "Passed through the archive" is now literally true: this is excavation.
- The statement sentences describing narratives as published (present tense) need rewriting.
- The sample is real people's words: keep `data/raw/` off GitHub.

### Still open
- Product categories to include (likely debt collection, mortgage, bank accounts, credit cards; exclude credit reporting?).
- Exact sentence filter rules.
- Desperation score weights and heat score weights.
- Number of pieces.
- How a redaction looks visually (ASCII stage).
- Artist statement: model sentence + archive/tense changes (at the end).
- Optional: GitHub issue to the CuneiScribe author about the model weights.

### Next
1. Upload `sample_narratives.csv` to Colab and read a batch of complaints.
2. Decide product categories and filter rules from what you notice.
3. Build Job 1 (template filter: TF-IDF → SVD → L2 → HDBSCAN).

---

## Wed 7 Oct 2026

### Summary
Pivoted from the earlier offline cuneiform generator to the CFPB → Akkadian → cuneiform → ASCII pipeline described in the artist statement. Set up the project, tested translation models, chose one, and fixed the problems found. **Step 2 (choose translation model) is complete.**

### Setup
- Project created at `~/Projects/NanniSCII` (folders, README, `.gitignore`, `requirements.txt`, `docs/plan.md`, `writeup/`), git initialised.
- Essay draft → `writeup/essay.md`. Artist statement → `writeup/artist_statement.md` (sentence about the model still to be updated).
- `data/raw/` and `models/` are excluded from GitHub (too large).

### CuneiScribe findings
- `pip install cuneiscribe` (v0.2.0) works. Sign conversion test passed: `LUGAL dan-nu` → 𒈗 𒆗𒉡.
- **The trained CuneiScribe translation model has not been released.** The package's default is a placeholder (`google/byt5-small`, untrained on Akkadian). No weights link on the GitHub README or ROADMAP.
- Confidence gating (classifier + validator) is part of the package and **does** work with any model.
- Validator bug: it crashes ("'set' object is not subscriptable") when it finds unexpected characters. Worked around in the notebook (`safe_validate`).
- Limit: the gating catches broken output, not wrong meaning. The classifier did not flag "overdraft fee" as a modern concept.

### Test 1: model comparison (`notebooks/cuneiscribe_model_test.ipynb`)
Results in `outputs/logs/model_test/`.

| Model | Result |
|---|---|
| `praeclarum/cuneiform` | **Pass.** Only model producing real Akkadian |
| `notninja/byt5-base-akkadian` | Fail. Output English sentences unrelated to input |
| `google/byt5-small` (control) | Fail, as expected. Repeated the prompt; confirms the test can tell good from bad |

Problems found with praeclarum:
1. ~76% sign coverage. Cause: praeclarum writes in scholarly CDLI spelling (`_kug-ud_`, `sz`, `s,`), CuneiScribe expects `KUG-UD`, `š`, `ṣ`. Spelling mismatch, not missing signs.
2. "XXXX" sent the model into a loop (`x x x x…`). In scholarly notation `x` = an illegible sign, so it read the redaction as a broken tablet.

### Test 2: fixes (`notebooks/step2b_praeclarum_fixes.ipynb`, v1 and v2)
Results in `outputs/logs/step2b/`.

Fixes added (`nanni.py`):
- Spelling conversion (CDLI → CuneiScribe) → coverage 100%.
- Scholarly damage marks `[ ] # ?` stripped (model sometimes writes them; they broke conversion and the validator).
- Every CFPB redaction (`XXXX`, `XX/XX/XXXX`, `{$XXXX}`) kept as one broken sign `x`.
- Output length capped so loops can't run away.
- Back-translation reads the model's original spelling (v1 fed it the converted spelling and garbled the back-translations; fixed in v2).

Two redaction methods compared:
- **split** (translate around the redaction, reinsert the break): worked.
- **single** (replace with a lone `x`, translate whole line): looped again. Dropped.

v2 results (all four lines pass technically: gaps correct, 100% coverage, no runaway, validator `render`):

| Line | Back-translation | Notes |
|---|---|---|
| 1. "…called them XXXX times and nobody will help me." | "The days are long, nobody will agree to me." | Good. Redaction logged cleanly as one break |
| 2. "…overdraft fee even though I had money…" | "…brought the silver into my possession… return the money tenfold…" | **Best.** No Akkadian for "overdraft fee" → silver and debts. The artist statement happening in practice. Not tested with a redaction |
| 3. "Why am I being treated with such contempt…" | "Why, for years, against me, against me, for years, I, I, I," | Details gone, exasperation left. Weird, but possibly strong |
| 4. "On XX/XX/XXXX I paid {$XXXX} and XXXX bank…" | "As to the … of the … of the …" | Too many redactions: split mode chops the line into fragments with no context |

### Decisions
- **Concept:** keep real translation (not a letter-for-letter cipher). The loss of meaning is the argument.
- **Model:** `praeclarum/cuneiform`, run through CuneiScribe's converter, validator and renderer.
- **Redactions:** keep XXXX as breaks in the clay (split method). Possible contrast element at the ASCII stage.
- **Line selection rule:** at most one redaction per line, with enough words around it.
- **Infrastructure:** run models in Google Colab (free tier is enough).

### Still open
- Fallback/low-confidence lines: keep / drop / keep and mark?
- Line selection: by hand, rule or random (within the rule above)?
- Number of pieces?
- How a redaction break looks visually (currently an empty box placeholder). Decide at the ASCII stage.
- Update the model sentence in `writeup/artist_statement.md`.
- Optional: open a GitHub issue asking the CuneiScribe author about releasing the model weights.

### Next
**Step 3:** download the CFPB complaints that have narratives. Test: XXXX redactions and complaint IDs present.
