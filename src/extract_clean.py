"""
Step 4: extract & clean (no machine learning).

Reads the archive sample, keeps four columns (complaint_id, date, product, narrative),
removes obvious template letters with simple rules, and saves a clean pool of complaints.

Usage (from the NanniSCII folder, with .venv active):
    python3 src/extract_clean.py
Options: --inp data/raw/sample_narratives.csv  --out data/raw/complaints_clean.csv
         --min-words 40  --show 20  --seed 1
"""
import argparse, html, re, sys
import pandas as pd

ap = argparse.ArgumentParser()
ap.add_argument("--inp", default="data/raw/sample_narratives.csv")
ap.add_argument("--out", default="data/raw/complaints_clean.csv")   # data/raw stays off GitHub
ap.add_argument("--min-words", type=int, default=40)
ap.add_argument("--show", type=int, default=20)
ap.add_argument("--seed", type=int, default=1)
args = ap.parse_args()

# --- rules (edit these if your reading suggests better ones) ---------------
EXCLUDE_PRODUCTS = r"credit reporting"                       # dominated by credit-repair templates
TEMPLATE_MARKERS = re.compile(
    r"15\s*U\.?\s*S\.?\s*C|\bFCRA\b|\b1681|Fair Credit Reporting Act|\bsection\s+60[149]\b",
    re.IGNORECASE)
REDACTION = re.compile(r"\{?\$?X{2,}(?:[/\-.]X{2,})*\}?")
# ---------------------------------------------------------------------------

df = pd.read_csv(args.inp, dtype=str, low_memory=False)

def find(*words):
    for c in df.columns:
        if all(w in c.lower() for w in words):
            return c
    sys.exit(f"Couldn't find a column containing {words}. Columns are: {list(df.columns)}")

cols = {find("complaint", "id"): "complaint_id", find("date", "received"): "date",
        find("product"): "product", find("narrative"): "narrative"}
# 'product' can also match 'sub-product'; prefer the exact one if present
for c in df.columns:
    if c.strip().lower() == "product":
        cols = {k: v for k, v in cols.items() if v != "product"}; cols[c] = "product"
df = df[list(cols)].rename(columns=cols)

counts = [("loaded", len(df))]
def step(name, frame):
    counts.append((name, len(frame)))
    return frame

df = step("has narrative", df[df["narrative"].notna() & (df["narrative"].str.strip() != "")])

# normalise text: fix HTML entities and odd whitespace, keep case, punctuation and redactions
df["narrative"] = (df["narrative"].map(html.unescape)
                   .str.replace(r"[ \t]+", " ", regex=True)
                   .str.replace(r"\s*\n\s*", "\n", regex=True)
                   .str.strip())

d = pd.to_datetime(df["date"], errors="coerce")
df = step("received before 2022", df[d < "2022-01-01"].assign(date=d.dt.strftime("%Y-%m-%d")))
df = step("not credit reporting", df[~df["product"].str.contains(EXCLUDE_PRODUCTS, case=False, na=False)])
df = step("no legal template markers", df[~df["narrative"].str.contains(TEMPLATE_MARKERS)])

key = df["narrative"].str.lower().str.replace(r"\W+", "", regex=True).str[:300]
df = step("no duplicates", df[~key.duplicated()])

df["n_words"] = df["narrative"].str.split().str.len()
df["n_redactions"] = df["narrative"].str.count(REDACTION)
df = step(f"at least {args.min_words} words", df[df["n_words"] >= args.min_words])

df.to_csv(args.out, index=False)

print("\nCLEANING STAGES")
for name, n in counts:
    print(f"  {name:<28}{n:>8,}")
print(f"\nSaved {len(df):,} complaints to {args.out}")
print("\nBY PRODUCT")
print(df["product"].value_counts().to_string())
print(f"\nWords per complaint: median {int(df['n_words'].median())}, "
      f"redactions per complaint: median {int(df['n_redactions'].median())}")

print(f"\nTEST: read these {args.show}. Are any template letters?\n" + "=" * 90)
for _, r in df.sample(min(args.show, len(df)), random_state=args.seed).iterrows():
    print(f"#{r['complaint_id']}  {r['date']}  {r['product']}")
    print(r["narrative"][:500] + (" …" if len(r["narrative"]) > 500 else ""))
    print("-" * 90)
