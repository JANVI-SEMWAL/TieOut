@echo off
REM Windows twin of run_demo.sh — generate data, reconcile, grade, build the dashboard.
cd /d "%~dp0"

echo 1/3  generating synthetic 3-source batch (250 records)...
python src\generate_data.py --n 250 --seed 42 --out data\

echo 2/3  running the reconciliation pipeline...
python src\pipeline.py --data data\ --out data\

echo 3/3  grading on a held-out batch (seed 7, never tuned on)...
python src\generate_data.py --n 200 --seed 7 --out data\holdout\
python src\pipeline.py --data data\holdout\ --out data\holdout\ >nul
python src\metrics.py --results data\holdout\recon_output.csv --truth data\holdout\ground_truth.csv

echo.
echo Done. Open data\report.html in your browser to see the dashboard.
pause
