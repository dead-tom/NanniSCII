"""
Step 3: make a small random sample of CFPB complaints WITH narratives from a big
FOIA archive export (.zip or the unzipped .csv).
Reads the file in chunks, so it uses little memory even on a slow laptop.

Usage (from the NanniSCII folder, .venv active):
    python3 generator/make_sample.py "path/to/CCDB_Export_2_May_2018_through_April_2021.zip"
Optional: --frac 0.03 (share of narrative rows to keep)  --before 2022-01-01
Output:   data/raw/sample_narratives.csv  (kept off GitHub)
"""
import argparse, zipfile, sys
import pandas as pd

ap = argparse.ArgumentParser()
ap.add_argument("zip_path")
ap.add_argument("--frac", type=float, default=0.03)
ap.add_argument("--before", default="2022-01-01")
ap.add_argument("--out", default="data/raw/sample_narratives.csv")
args = ap.parse_args()

if args.zip_path.lower().endswith(".csv"):          # already unzipped
    z, csvs = None, [args.zip_path]
else:
    z = zipfile.ZipFile(args.zip_path)
    csvs = [n for n in z.namelist() if n.lower().endswith(".csv")]
    print("Files in zip:", z.namelist())
    if not csvs:
        sys.exit("No CSV inside the zip.")


def find(cols, *words):
    for c in cols:
        if all(w in c.lower() for w in words):
            return c
    return None


kept, seen, with_text = [], 0, 0
for name in csvs:
    print(f"\nReading {name} ...")
    reader = pd.read_csv(z.open(name) if z else name, chunksize=100_000, low_memory=False, dtype=str)
    for i, chunk in enumerate(reader):
        if i == 0:
            print("Columns:", list(chunk.columns))
            narr = find(chunk.columns, "narrative")
            date = find(chunk.columns, "date", "received")
            if not narr:
                sys.exit("No narrative column found.")
            print(f"Using narrative column '{narr}', date column '{date}'")
        seen += len(chunk)
        chunk = chunk[chunk[narr].notna() & (chunk[narr].str.strip() != "")]
        if date:
            d = pd.to_datetime(chunk[date], errors="coerce")
            chunk = chunk[d < args.before]
        with_text += len(chunk)
        kept.append(chunk.sample(frac=args.frac, random_state=i))
        print(f"  rows read: {seen:,}   with narrative (before {args.before}): {with_text:,}", end="\r")

sample = pd.concat(kept)
sample.to_csv(args.out, index=False)
print(f"\n\nSaved {len(sample):,} complaints to {args.out}")
print("\n--- three examples ---")
for t in sample[narr].sample(min(3, len(sample)), random_state=0):
    print(t[:600], "\n")
