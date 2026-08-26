#!/usr/bin/env bash
# One command: generate data, reconcile end to end, grade it, build the dashboard.
set -e
cd "$(dirname "$0")"

echo "▸ 1/3  generating synthetic 3-source batch (250 records)…"
python3 src/generate_data.py --n 250 --seed 42 --out data/

echo "▸ 2/3  running the reconciliation pipeline…"
python3 src/pipeline.py --data data/ --out data/

echo "▸ 3/3  grading on a held-out batch (seed 7, never tuned on)…"
python3 src/generate_data.py --n 200 --seed 7 --out data/holdout/
python3 src/pipeline.py --data data/holdout/ --out data/holdout/ >/dev/null
python3 src/metrics.py --results data/holdout/recon_output.csv --truth data/holdout/ground_truth.csv

echo ""
echo "✓ Done. Open data/report.html to see the demo dashboard."
