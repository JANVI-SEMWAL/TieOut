"""
Deterministic reconciliation core (the backbone -- NO AI yet).

Pipeline:
  Stage 1  join orders <-> settlements on order_id
  Stage 2  recompute expected net (gross - fee - tax) and flag fee mismatches
  Stage 3  group settlements into payout batches by UTR -> expected bank credit
  Stage 4  match payout batches to bank credits (exact UTR + amount tolerance)
           -> if the money arrived but LATE, mark it matched_late (advisory, not a loss)
  Stage 5  everything unmatched -> an EXCEPTION with a machine reason (audit trail)

Statuses:
  matched       money tied out on time
  matched_late  money tied out but the payout landed late (informational)
  exception     genuinely unresolved -> goes to the AI layer / human

reconcile() returns (results, audit, context). `context` carries the payout batches
and unclaimed bank credits so the LLM fuzzy layer (src/llm_matcher.py) can work on the
residual only. Every decision is appended to `audit` for the audit trail.
"""
import argparse
import csv
import os
import re
from collections import defaultdict
from datetime import date

AMOUNT_TOL = 1.00       # rupee tolerance for "amounts tie out"
LATE_DAYS = 2           # payout later than this many days -> matched_late
FEE_RATE = 0.02
GST_ON_FEE = 0.18
UTR_RE = re.compile(r"(UTR[0-9]{12})")


def _read(path):
    with open(path, newline="") as f:
        return list(csv.DictReader(f))


def _f(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def _d(s):
    try:
        y, m, d = (int(p) for p in s.split("-"))
        return date(y, m, d)
    except Exception:
        return None


def reconcile(data_dir):
    orders = {o["order_id"]: o for o in _read(os.path.join(data_dir, "orders.csv"))}
    settlements = _read(os.path.join(data_dir, "settlements.csv"))
    bank = _read(os.path.join(data_dir, "bank.csv"))

    audit = []
    results = {}

    def log(oid, stage, decision, detail=""):
        audit.append({"order_id": oid, "stage": stage, "decision": decision, "detail": detail})

    # ---- Stage 1+2: join + fee check ----
    settle_by_order = defaultdict(list)
    for s in settlements:
        settle_by_order[s["order_id"]].append(s)

    for oid, order in orders.items():
        amount = _f(order["order_amount"])
        srows = settle_by_order.get(oid, [])
        if not srows:
            results[oid] = {"status": "exception", "reason": "no_settlement_for_order", "amount": amount}
            log(oid, "join", "exception", "order has no gateway settlement")
            continue
        if len(srows) > 1:
            results[oid] = {"status": "exception", "reason": "duplicate_payment", "amount": amount}
            log(oid, "join", "exception", f"{len(srows)} settlements share this order")
            continue
        s = srows[0]
        gross = _f(s["gross_amount"])
        exp_fee = round(gross * FEE_RATE, 2)
        exp_tax = round(exp_fee * GST_ON_FEE, 2)
        exp_net = round(gross - exp_fee - exp_tax, 2)
        if abs(exp_net - _f(s["net_amount"])) > AMOUNT_TOL:
            results[oid] = {"status": "exception", "reason": "fee_mismatch", "amount": amount,
                            "detail": f"expected net {exp_net} vs reported {s['net_amount']}"}
            log(oid, "fee_check", "exception", results[oid]["detail"])
            continue
        if order["status"] == "refunded" or s["status"] == "refunded":
            results[oid] = {"status": "pending", "reason": "refunded_check_payout", "amount": amount}
        else:
            results[oid] = {"status": "pending", "reason": "awaiting_bank_match", "amount": amount}

    # ---- Stage 3: build expected payout batches by UTR ----
    payout = defaultdict(lambda: {"net": 0.0, "orders": [], "settled_date": None})
    for s in settlements:
        oid = s["order_id"]
        if results.get(oid, {}).get("status") == "pending":
            b = payout[s["settlement_utr"]]
            b["net"] += _f(s["net_amount"])
            b["orders"].append(oid)
            sd = _d(s["settled_date"])
            if sd and (b["settled_date"] is None or sd > b["settled_date"]):
                b["settled_date"] = sd

    # ---- Stage 4: match bank credits to payout batches by UTR ----
    bank_by_utr = {}
    unmatched_bank = []
    for bk in bank:
        m = UTR_RE.search(bk["narration"])
        if m:
            bank_by_utr[m.group(1)] = bk
        else:
            unmatched_bank.append(bk)

    for utr, batch in payout.items():
        bk = bank_by_utr.get(utr)
        if bk is None:
            for oid in batch["orders"]:
                results[oid] = {**results[oid], "status": "exception", "reason": "missing_payout"}
                log(oid, "bank_match", "exception", f"no bank credit for UTR {utr}")
            continue
        if abs(_f(bk["credit_amount"]) - batch["net"]) <= AMOUNT_TOL:
            bdate, sdate = _d(bk["value_date"]), batch["settled_date"]
            lag = (bdate - sdate).days if (bdate and sdate) else 0
            for oid in batch["orders"]:
                if results[oid]["reason"] == "refunded_check_payout":
                    results[oid] = {**results[oid], "status": "exception", "reason": "refund_not_reflected"}
                    log(oid, "bank_match", "exception", "refunded order was paid out")
                elif lag > LATE_DAYS:
                    results[oid] = {**results[oid], "status": "matched_late", "reason": "ok_late",
                                    "detail": f"payout arrived {lag} days after settlement"}
                    log(oid, "bank_match", "matched_late", results[oid]["detail"])
                else:
                    results[oid] = {**results[oid], "status": "matched", "reason": "ok"}
                    log(oid, "bank_match", "matched", f"UTR {utr} tied out")
        else:
            for oid in batch["orders"]:
                results[oid] = {**results[oid], "status": "exception", "reason": "payout_amount_mismatch",
                                "detail": f"bank {bk['credit_amount']} vs expected {round(batch['net'],2)}"}
                log(oid, "bank_match", "exception", results[oid]["detail"])

    for oid, r in results.items():
        if r["status"] == "pending":
            results[oid] = {**r, "status": "exception"}

    for bk in unmatched_bank:
        log(bk["bank_txn_id"], "bank_match", "exception",
            "bank credit with no/garbled UTR -> route to fuzzy matcher")

    context = {
        "orders": orders,
        "settlements": settlements,
        "bank": bank,
        "payout_batches": dict(payout),
        "bank_by_utr": bank_by_utr,
        "unmatched_bank": unmatched_bank,
    }
    return results, audit, context


def summarize(results):
    total = len(results)
    matched = sum(1 for r in results.values() if r["status"] == "matched")
    late = sum(1 for r in results.values() if r["status"] == "matched_late")
    reconciled = matched + late
    print("\n=== Reconciliation summary ===")
    print(f"records:      {total}")
    print(f"reconciled:   {reconciled}  ({reconciled/total*100:.1f}%)  [matched {matched} + late {late}]")
    print(f"exceptions:   {total - reconciled}")
    reasons = defaultdict(int)
    for r in results.values():
        if r["status"] == "exception":
            reasons[r["reason"]] += 1
    print("exception breakdown:")
    for reason, c in sorted(reasons.items(), key=lambda x: -x[1]):
        print(f"    {reason:<28} {c}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data/")
    ap.add_argument("--out", default="data/recon_output.csv")
    args = ap.parse_args()
    results, audit, context = reconcile(args.data)
    summarize(results)
    with open(args.out, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["order_id", "status", "reason", "amount"])
        w.writeheader()
        for oid, r in results.items():
            w.writerow({"order_id": oid, "status": r["status"],
                        "reason": r["reason"], "amount": r.get("amount", "")})
    print(f"\nwrote per-record results -> {args.out}")
    print(f"audit events: {len(audit)}  |  unclaimed bank credits: {len(context['unmatched_bank'])}")


if __name__ == "__main__":
    main()
