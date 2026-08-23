"""
Synthetic data generator for a 3-source merchant reconciliation problem.

Produces three CSVs that model a real Razorpay-style money flow:

  1. orders.csv        -> the merchant's INTERNAL ledger (what they think they sold)
  2. settlements.csv   -> the PAYMENT GATEWAY report (Razorpay-style: gross, fee, tax, net, payout UTR)
  3. bank.csv          -> the merchant's BANK STATEMENT (batched payouts land here as credits)

The money flow (and where reconciliation gets hard):
  order  ->  one payment/settlement row (linked by order_id)
  MANY settlements  ->  ONE bank credit (a payout batch, linked by a UTR reference number)

Realistic "mess" is injected on purpose, and every injected problem is LABELLED in
ground_truth.csv so you can measure your agent honestly (match rate, precision/recall
on exception detection). That labelled held-out truth is what Track 4's bar demands:
"throughput plus measured accuracy plus an honest exception list."

Usage:
    python src/generate_data.py --n 250 --seed 42 --out data/
    python src/generate_data.py --n 120 --seed 7  --out data/holdout/   # untuned eval set
"""
import argparse
import csv
import os
import random
from datetime import date, timedelta

# ---- Exception types we deliberately inject. These are the "loss/mismatch" cases. ----
CLEAN = "clean"                         # everything matches end to end
FEE_MISMATCH = "fee_mismatch"           # gateway fee/tax miscomputed -> net doesn't tie out
MISSING_PAYOUT = "missing_payout"       # settled by gateway but never hit the bank
UNEXPECTED_CREDIT = "unexpected_credit" # bank credit with no matching settlement
REFUND_NOT_REFLECTED = "refund_not_reflected"  # order refunded but still paid out
DUPLICATE_PAYMENT = "duplicate_payment" # same order paid twice
GARBLED_NARRATION = "garbled_narration" # bank narration hides the UTR (fuzzy-match territory)
TIMING_LAG = "timing_lag"               # payout lands a few days later than expected

INJECTED = [
    FEE_MISMATCH, MISSING_PAYOUT, UNEXPECTED_CREDIT,
    REFUND_NOT_REFLECTED, DUPLICATE_PAYMENT, GARBLED_NARRATION, TIMING_LAG,
]

FEE_RATE = 0.02      # 2% gateway fee
GST_ON_FEE = 0.18    # 18% GST on the fee


def _utr(rng):
    return "UTR" + "".join(rng.choice("0123456789") for _ in range(12))


def _garble(narration, rng):
    # Simulate a bank feed that mangles the reference (real bank statements do this constantly)
    junk = "".join(rng.choice("XZ*#/ ") for _ in range(rng.randint(2, 5)))
    return narration.replace("UTR", "RZP" + junk)[: rng.randint(18, 28)]


def generate(n, seed):
    rng = random.Random(seed)
    start = date(2026, 7, 1)

    orders, settlements, bank, truth = [], [], [], []
    # payouts groups settlement rows into batches that share one bank credit (one UTR)
    payouts = {}  # utr -> {"net": float, "date": date, "settlement_ids": [...]}

    for i in range(n):
        oid = f"ORD{100000 + i}"
        amount = round(rng.uniform(200, 8000), 2)
        odate = start + timedelta(days=rng.randint(0, 25))

        # Pick this record's fate. ~85% clean (realistic), rest gets one injected problem.
        kind = CLEAN if rng.random() < 0.85 else rng.choice(INJECTED)

        order_status = "paid"
        if kind == REFUND_NOT_REFLECTED:
            order_status = "refunded"

        orders.append({
            "order_id": oid,
            "customer": f"cust_{rng.randint(1, 9999)}",
            "order_amount": f"{amount:.2f}",
            "order_date": odate.isoformat(),
            "status": order_status,
        })

        # UNEXPECTED_CREDIT has no gateway settlement at all (bank money from nowhere)
        if kind == UNEXPECTED_CREDIT:
            utr = _utr(rng)
            bank.append({
                "bank_txn_id": f"BNK{500000 + len(bank)}",
                "value_date": (odate + timedelta(days=2)).isoformat(),
                "narration": f"NEFT CR {utr} UNKNOWN",
                "credit_amount": f"{round(rng.uniform(200, 5000), 2):.2f}",
                "debit_amount": "0.00",
            })
            truth.append({"order_id": oid, "exception": kind})
            continue

        # Normal settlement math
        fee = round(amount * FEE_RATE, 2)
        tax = round(fee * GST_ON_FEE, 2)
        if kind == FEE_MISMATCH:
            fee = round(fee + rng.uniform(5, 40), 2)  # gateway over/under-charged
        net = round(amount - fee - tax, 2)

        pay_status = "refunded" if kind == REFUND_NOT_REFLECTED else "captured"
        utr = _utr(rng)
        sdate = odate + timedelta(days=1)

        def add_settlement(suffix=""):
            sid = f"PAY{200000 + len(settlements)}"
            settlements.append({
                "payment_id": sid,
                "order_id": oid,
                "gross_amount": f"{amount:.2f}",
                "fee": f"{fee:.2f}",
                "tax_on_fee": f"{tax:.2f}",
                "net_amount": f"{net:.2f}",
                "settlement_utr": utr,
                "settled_date": sdate.isoformat(),
                "status": pay_status,
            })
            return sid

        add_settlement()
        if kind == DUPLICATE_PAYMENT:
            add_settlement("dup")  # same order settled twice under same UTR

        # Build the payout batch that will (usually) land in the bank
        included_net = net * (2 if kind == DUPLICATE_PAYMENT else 1)
        # A refunded payment should NOT be paid out; if it still is -> that's the anomaly
        payout_net = 0.0 if kind == REFUND_NOT_REFLECTED else included_net

        if kind != MISSING_PAYOUT:  # missing_payout: gateway settled but bank never got it
            bank_date = sdate + timedelta(days=(rng.randint(3, 6) if kind == TIMING_LAG else 1))
            narration = f"PAYOUT {utr} RAZORPAY"
            if kind == GARBLED_NARRATION:
                narration = _garble(narration, rng)
            # refund-not-reflected still pays out the money (the bug we want caught)
            credit = included_net if kind == REFUND_NOT_REFLECTED else payout_net
            if credit > 0:
                bank.append({
                    "bank_txn_id": f"BNK{500000 + len(bank)}",
                    "value_date": bank_date.isoformat(),
                    "narration": narration,
                    "credit_amount": f"{credit:.2f}",
                    "debit_amount": "0.00",
                })

        truth.append({"order_id": oid, "exception": kind})

    return orders, settlements, bank, truth


def _write(path, rows, fields):
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=250)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--out", default="data/")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    orders, settlements, bank, truth = generate(args.n, args.seed)

    _write(os.path.join(args.out, "orders.csv"), orders,
           ["order_id", "customer", "order_amount", "order_date", "status"])
    _write(os.path.join(args.out, "settlements.csv"), settlements,
           ["payment_id", "order_id", "gross_amount", "fee", "tax_on_fee",
            "net_amount", "settlement_utr", "settled_date", "status"])
    _write(os.path.join(args.out, "bank.csv"), bank,
           ["bank_txn_id", "value_date", "narration", "credit_amount", "debit_amount"])
    _write(os.path.join(args.out, "ground_truth.csv"), truth,
           ["order_id", "exception"])

    n_clean = sum(1 for t in truth if t["exception"] == CLEAN)
    print(f"Wrote {len(orders)} orders, {len(settlements)} settlements, "
          f"{len(bank)} bank rows to {args.out}")
    print(f"  clean: {n_clean}  |  injected exceptions: {len(truth) - n_clean}")


if __name__ == "__main__":
    main()
