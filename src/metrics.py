"""
Evaluation harness -- turns a run into HONEST numbers, graded against ground_truth.csv.

Severity model (what SHOULD happen to each labelled record):
  benign  -> should reconcile (money is fine): clean, timing_lag, garbled_narration
  loss    -> should be flagged as an exception:  fee_mismatch, missing_payout,
             unexpected_credit, refund_not_reflected, duplicate_payment

Reports: reconcile rate, exception precision/recall/F1, false-match rate (a real loss
wrongly called reconciled -- the costly error), and recall by exception type. Run on a
HELD-OUT seed you never tuned on.

    python src/metrics.py --results data/recon_output.csv --truth data/ground_truth.csv
"""
import argparse
import csv
from collections import defaultdict

BENIGN = {"clean", "timing_lag", "garbled_narration"}


def _read(path):
    with open(path, newline="") as f:
        return list(csv.DictReader(f))


def evaluate(results_path, truth_path, verbose=True):
    results = {r["order_id"]: r for r in _read(results_path)}
    truth = {t["order_id"]: t["exception"] for t in _read(truth_path)}

    tp = fp = fn = tn = false_match = 0
    # per type: "correct" = the DESIRED outcome (loss -> flagged, benign -> reconciled)
    per_type = defaultdict(lambda: {"total": 0, "correct": 0, "kind": "loss"})

    reconciled = sum(1 for r in results.values()
                     if r["status"] in ("matched", "matched_late"))

    for oid, true_exc in truth.items():
        r = results.get(oid)
        is_loss = true_exc not in BENIGN
        flagged = (r is None) or (r["status"] == "exception")
        if true_exc != "clean":
            pt = per_type[true_exc]
            pt["total"] += 1
            pt["kind"] = "loss" if is_loss else "benign"
            # desired: losses should be flagged; benign should NOT be flagged
            if (is_loss and flagged) or (not is_loss and not flagged):
                pt["correct"] += 1
        if is_loss:
            if flagged:
                tp += 1
            else:
                fn += 1
                false_match += 1
        else:
            if flagged:
                fp += 1
            else:
                tn += 1

    total = len(truth)
    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall = tp / (tp + fn) if (tp + fn) else 0.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0
    m = {"total": total, "reconcile_rate": reconciled / total if total else 0,
         "precision": precision, "recall": recall, "f1": f1,
         "false_match_rate": false_match / total if total else 0,
         "tp": tp, "fp": fp, "fn": fn, "tn": tn}

    if verbose:
        print("=== Honest metrics (held-out) ===")
        print(f"records:              {total}")
        print(f"reconcile rate:       {m['reconcile_rate']*100:.1f}%")
        print(f"exception precision:  {precision*100:.1f}%   (flagged that were real losses)")
        print(f"exception recall:     {recall*100:.1f}%   (real losses caught)")
        print(f"F1:                   {f1*100:.1f}%")
        print(f"false-match rate:     {m['false_match_rate']*100:.1f}%   (real losses called OK)")
        print(f"confusion:            TP={tp} FP={fp} FN={fn} TN={tn}")
        print("\nper exception type (correctly handled):")
        for t, s in sorted(per_type.items()):
            pct = s["correct"] / s["total"] * 100 if s["total"] else 0
            note = "flagged" if s["kind"] == "loss" else "reconciled (benign)"
            print(f"    {t:<22} {s['correct']}/{s['total']}  ({pct:.0f}%)  [{note}]")
    m["per_type"] = {k: dict(v) for k, v in per_type.items()}
    return m


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--results", default="data/recon_output.csv")
    ap.add_argument("--truth", default="data/ground_truth.csv")
    a = ap.parse_args()
    evaluate(a.results, a.truth)


if __name__ == "__main__":
    main()
