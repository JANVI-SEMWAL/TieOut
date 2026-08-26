"""
Settlement Q&A agent -- ask the reconciled ledger questions in plain English.

Grounded and read-only: every answer is computed from the reconciliation results and
cites its evidence. Deterministic handlers cover the common finance-ops questions (so the
demo always works); free-form questions route to the LLM WITH the computed facts as
context when a key is present (never ungrounded guessing).
"""
import json
import os
from collections import defaultdict

try:
    from . import llm_matcher
except ImportError:  # allow running as a script
    import llm_matcher


def facts(results, context):
    """Compute the ground-truth numbers every answer is built from."""
    total = len(results)
    by_status = defaultdict(int)
    exc_by_reason = defaultdict(lambda: {"count": 0, "amount": 0.0, "orders": []})
    money_at_risk = 0.0
    for oid, r in results.items():
        by_status[r["status"]] += 1
        if r["status"] == "exception":
            amt = r.get("amount", 0.0)
            money_at_risk += amt
            e = exc_by_reason[r["reason"]]
            e["count"] += 1
            e["amount"] += amt
            e["orders"].append({"order_id": oid, "amount": amt})
    reconciled = by_status["matched"] + by_status["matched_late"]
    return {
        "total": total,
        "reconciled": reconciled,
        "reconcile_rate": reconciled / total if total else 0,
        "matched": by_status["matched"],
        "matched_late": by_status["matched_late"],
        "exceptions": by_status["exception"],
        "money_at_risk": round(money_at_risk, 2),
        "exc_by_reason": {k: {"count": v["count"], "amount": round(v["amount"], 2),
                              "orders": sorted(v["orders"], key=lambda x: -x["amount"])[:5]}
                          for k, v in exc_by_reason.items()},
    }


def answer(question, results, context, f=None):
    """Return {"answer": str, "evidence": dict}. Grounded, read-only."""
    f = f or facts(results, context)
    q = question.lower()

    if any(k in q for k in ["at risk", "how much money", "total exposure", "flagged for recovery"]):
        top = sorted(f["exc_by_reason"].items(), key=lambda x: -x[1]["amount"])[:3]
        parts = ", ".join(f"{k} (Rs {v['amount']:,.0f})" for k, v in top)
        return {"answer": f"Rs {f['money_at_risk']:,.2f} is at risk across {f['exceptions']} "
                          f"flagged transactions. Biggest buckets: {parts}.",
                "evidence": {"money_at_risk": f["money_at_risk"], "top_buckets": dict(top)}}

    if "missing" in q and "payout" in q:
        e = f["exc_by_reason"].get("missing_payout", {"count": 0, "amount": 0.0, "orders": []})
        return {"answer": f"{e['count']} payouts are missing (settled by the gateway but never "
                          f"credited to the bank), worth Rs {e['amount']:,.2f}.",
                "evidence": e}

    if "late" in q:
        return {"answer": f"{f['matched_late']} payouts arrived late but did reconcile correctly "
                          f"-- flagged as advisories, not losses.",
                "evidence": {"matched_late": f["matched_late"]}}

    if any(k in q for k in ["biggest", "largest", "top exception", "worst"]):
        all_orders = []
        for reason, v in f["exc_by_reason"].items():
            for o in v["orders"]:
                all_orders.append((o["order_id"], reason, o["amount"]))
        all_orders.sort(key=lambda x: -x[2])
        top = all_orders[:5]
        lst = "; ".join(f"{oid} ({reason}, Rs {amt:,.0f})" for oid, reason, amt in top)
        return {"answer": f"Top exceptions by value: {lst}.",
                "evidence": {"top": top}}

    if any(k in q for k in ["reconcile rate", "match rate", "how well", "how much reconciled"]):
        return {"answer": f"{f['reconcile_rate']*100:.1f}% of transactions reconciled "
                          f"({f['reconciled']} of {f['total']}: {f['matched']} matched + "
                          f"{f['matched_late']} late). {f['exceptions']} need attention.",
                "evidence": {k: f[k] for k in ["reconcile_rate", "reconciled", "total",
                                               "matched", "matched_late", "exceptions"]}}

    # ---- free-form: ground the LLM in the computed facts (never guess) ----
    if llm_matcher.llm_available():
        system = ("You are a settlement reconciliation analyst. Answer ONLY from the JSON facts "
                  "provided. If the facts don't contain the answer, say so. Be concise.")
        user = f"Question: {question}\n\nFacts:\n{json.dumps(f, indent=2)}"
        txt = llm_matcher._call_llm(system, user, 400)
        if txt:
            return {"answer": txt.strip(), "evidence": {"grounded_in": "facts()"}}

    return {"answer": "I can answer questions about money at risk, missing payouts, late payouts, "
                      "the biggest exceptions, or the reconcile rate.",
            "evidence": {}}


DEMO_QUESTIONS = [
    "How much money is at risk right now?",
    "How many payouts are missing?",
    "Which payouts arrived late?",
    "What are the biggest exceptions by value?",
    "What's our overall reconcile rate?",
]


def run_demo(results, context):
    f = facts(results, context)
    out = []
    for q in DEMO_QUESTIONS:
        out.append({"q": q, **answer(q, results, context, f)})
    return out


if __name__ == "__main__":
    import sys
    from reconcile import reconcile
    data = sys.argv[1] if len(sys.argv) > 1 else "data/"
    res, audit, ctx = reconcile(data)
    for item in run_demo(res, ctx):
        print(f"\nQ: {item['q']}\nA: {item['answer']}")
