"""
Recovery-draft generator — turns a flagged exception into the actual follow-up you'd
send to recover the money. Bounded & gated: it only DRAFTS text for a human to review
and send; it never contacts anyone or moves money.

    python src/draft.py <data_dir> <order_id|all>

Prints JSON: {"drafts": [{order_id, reason, amount, channel, subject, body}]}.
Uses the free LLM when a key is set (see .env.example); otherwise deterministic templates.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from reconcile import reconcile
import llm_matcher

CHANNEL = {
    "missing_payout": "Email → gateway support",
    "payout_amount_mismatch": "Email → gateway support",
    "fee_mismatch": "Email → gateway support (fee dispute)",
    "duplicate_payment": "Internal note → finance ops",
    "refund_not_reflected": "Internal note → finance ops",
    "no_settlement_for_order": "Internal note → payments team",
    "unexpected_credit": "Internal note → finance ops",
}


def _rupees(n):
    try:
        return "Rs " + format(float(n), ",.2f")
    except Exception:
        return "Rs " + str(n)


def _templates(exc, s):
    """Deterministic fallback drafts. `s` is the matching settlement row (may be {})."""
    oid = exc["order_id"]
    amt = _rupees(exc["amount"])
    utr = s.get("settlement_utr", "N/A")
    sdate = s.get("settled_date", "N/A")
    pid = s.get("payment_id", "N/A")
    r = exc["reason"]

    if r == "missing_payout":
        return ("Missing payout for settled payment " + pid,
                f"Hello,\n\nOrder {oid} (payment {pid}) was marked settled on {sdate} for a net "
                f"payout of {amt} under UTR {utr}, but no matching credit has reached our bank "
                f"account. Could you trace this disbursement and confirm the UTR was released?\n\n"
                f"Thanks,\nFinance Ops")
    if r == "payout_amount_mismatch":
        return ("Payout amount mismatch — UTR " + utr,
                f"Hello,\n\nThe bank credit under UTR {utr} does not match the expected net payout "
                f"for order {oid} ({amt}). Please share the line-item breakdown for this payout so "
                f"we can identify the difference.\n\nThanks,\nFinance Ops")
    if r == "fee_mismatch":
        return ("Fee discrepancy on payment " + pid,
                f"Hello,\n\nFor order {oid} (payment {pid}), the net settled amount does not equal "
                f"gross minus the expected fee + GST. Please review the fee applied and issue a "
                f"correction if warranted. Order value: {amt}.\n\nThanks,\nFinance Ops")
    if r == "duplicate_payment":
        return ("Duplicate settlement on order " + oid,
                f"Team,\n\nOrder {oid} has more than one settlement recorded ({amt}). Please confirm "
                f"the customer was charged only once and void/refund the duplicate.\n\n— Finance Ops")
    if r == "refund_not_reflected":
        return ("Refunded order was still paid out — " + oid,
                f"Team,\n\nOrder {oid} was refunded but the payout ({amt}) still went through. Please "
                f"claw back the payout or book a receivable against the gateway.\n\n— Finance Ops")
    if r == "no_settlement_for_order":
        return ("Order with no settlement — " + oid,
                f"Team,\n\nInternal order {oid} ({amt}) has no matching gateway settlement. Please "
                f"check the capture status; the payment may have failed silently.\n\n— Finance Ops")
    if r == "unexpected_credit":
        return ("Unexplained bank credit",
                f"Team,\n\nA bank credit has no matching settlement or order (near {amt}). Please "
                f"identify the source — it may be a manual transfer or a misposting.\n\n— Finance Ops")
    return ("Reconciliation exception — " + oid,
            f"Team,\n\nOrder {oid} ({amt}) needs review: {r}.\n\n— Finance Ops")


def _llm_draft(exc, s):
    system = ("You are a finance-ops assistant. Write a SHORT, professional follow-up to recover "
              "money flagged during settlement reconciliation. Use the exact IDs and amounts given. "
              "Under 120 words. Respond ONLY as JSON: {\"subject\": str, \"body\": str}.")
    user = json.dumps({
        "order_id": exc["order_id"], "problem": exc["reason"], "amount": exc["amount"],
        "payment_id": s.get("payment_id"), "settlement_utr": s.get("settlement_utr"),
        "settled_date": s.get("settled_date"),
        "channel": CHANNEL.get(exc["reason"], "internal note"),
    })
    data = llm_matcher._extract_json(llm_matcher._call_llm(system, user, 400))
    if data and data.get("subject") and data.get("body"):
        return data["subject"], data["body"]
    return _templates(exc, s)


def main():
    data_dir = sys.argv[1] if len(sys.argv) > 1 else "data/"
    which = sys.argv[2] if len(sys.argv) > 2 else "all"

    results, audit, ctx = reconcile(data_dir)
    proposals = llm_matcher.resolve_garbled_credits(ctx["unmatched_bank"], ctx["payout_batches"])
    llm_matcher.apply_fuzzy_resolutions(results, proposals, ctx["payout_batches"], audit)

    settle_by_order = {}
    for s in ctx["settlements"]:
        settle_by_order.setdefault(s["order_id"], s)

    excs = [{"order_id": oid, "reason": r["reason"], "amount": r.get("amount", 0.0)}
            for oid, r in results.items() if r["status"] == "exception"]
    excs.sort(key=lambda x: -x["amount"])
    if which != "all":
        excs = [e for e in excs if e["order_id"] == which]

    drafts = []
    for e in excs:
        s = settle_by_order.get(e["order_id"], {})
        try:
            subject, body = _llm_draft(e, s) if llm_matcher.llm_available() else _templates(e, s)
        except Exception:
            subject, body = _templates(e, s)
        drafts.append({**e, "channel": CHANNEL.get(e["reason"], "Internal note"),
                       "subject": subject, "body": body})

    print(json.dumps({"drafts": drafts, "llm": llm_matcher.llm_available()}))


if __name__ == "__main__":
    main()
