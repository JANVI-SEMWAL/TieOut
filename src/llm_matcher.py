"""
AI layer -- the "meaningful AI", kept bounded, gated and auditable.

Runs ONLY on the residual the deterministic core could not resolve. Two jobs:

  1. resolve_garbled_credits() : bank credits whose UTR was mangled -> propose which
     payout batch they belong to, with a confidence score and a reason.
  2. explain_exception()       : turn each real exception into a plain-English reason
     + a suggested next action for the human exception report.

GATE (bounded money safety): the model only *proposes*. apply_fuzzy_resolutions() accepts
a proposal only when confidence >= CONFIDENCE_FLOOR; everything else stays a human
exception. Nothing here ever edits an amount or "fixes" the ledger.

Works with NO API key (deterministic fallback). Set ANTHROPIC_API_KEY (and optionally
ANTHROPIC_MODEL) to use a real LLM for the fuzzy adjudication and explanations.
"""
import json
import os
import re

CONFIDENCE_FLOOR = 0.80
_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-3-5-haiku-20241022")


def llm_available():
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


def _call_llm(system, user, max_tokens=500):
    """Return raw text from the model, or None if no key / any failure (-> fallback)."""
    if not llm_available():
        return None
    try:
        from anthropic import Anthropic
        client = Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
        msg = client.messages.create(
            model=_MODEL, max_tokens=max_tokens, system=system,
            messages=[{"role": "user", "content": user}],
        )
        return msg.content[0].text
    except Exception as e:  # never let the AI layer crash the pipeline
        print(f"  [llm] falling back (reason: {e})")
        return None


def _extract_json(text):
    if not text:
        return None
    m = re.search(r"\{.*\}", text, re.DOTALL)
    try:
        return json.loads(m.group(0)) if m else None
    except Exception:
        return None


# ---------------- job 1: garbled bank credit -> payout batch ----------------
def resolve_garbled_credits(unmatched_bank, payout_batches):
    """Return proposals: [{bank_txn_id, matched_utr, confidence, reason}]."""
    proposals = []
    for bk in unmatched_bank:
        amt = float(bk.get("credit_amount", 0) or 0)
        # candidates = payout batches whose expected net is close to this credit
        cands = [(utr, b) for utr, b in payout_batches.items()
                 if abs(b["net"] - amt) <= 1.0]
        base = _fallback_fuzzy(bk, payout_batches, cands)

        # If a model is available and it's a genuine close call, let it adjudicate.
        if llm_available() and len(cands) > 1:
            adj = _llm_adjudicate(bk, cands)
            if adj:
                base = adj
        proposals.append(base)
    return proposals


def _fallback_fuzzy(bank_row, payout_batches, cands=None):
    digits = re.findall(r"\d{4,}", bank_row.get("narration", ""))
    amt = float(bank_row.get("credit_amount", 0) or 0)
    if cands is None:
        cands = list(payout_batches.items())
    best, best_score, reason = None, 0.0, "no candidate"
    for utr, batch in cands:
        score = 0.0
        if any(d in utr for d in digits):
            score += 0.6
        if abs(batch["net"] - amt) <= 1.0:
            score += 0.4
            reason = f"amount {amt:.2f} ties to batch net {batch['net']:.2f}"
        if score > best_score:
            best, best_score = utr, score
    ok = best_score >= CONFIDENCE_FLOOR
    return {
        "bank_txn_id": bank_row.get("bank_txn_id"),
        "matched_utr": best if ok else None,
        "confidence": round(best_score, 2),
        "reason": reason if ok else f"low confidence ({best_score:.2f}) -> keep as human exception",
    }


def _llm_adjudicate(bank_row, cands):
    system = ("You reconcile bank payouts. Given a bank credit with a mangled reference and "
              "candidate payout batches, pick the single best match. Respond ONLY as JSON: "
              '{"matched_utr": str|null, "confidence": 0-1 float, "reason": str}. '
              "Use null if none is a confident match.")
    cand_txt = "\n".join(f"- UTR {u}: expected net {b['net']:.2f}" for u, b in cands)
    user = (f"Bank credit narration: {bank_row.get('narration')}\n"
            f"Credit amount: {bank_row.get('credit_amount')}\n\nCandidates:\n{cand_txt}")
    data = _extract_json(_call_llm(system, user, 300))
    if not data or "confidence" not in data:
        return None
    return {"bank_txn_id": bank_row.get("bank_txn_id"),
            "matched_utr": data.get("matched_utr"),
            "confidence": round(float(data["confidence"]), 2),
            "reason": data.get("reason", "llm adjudicated")}


def apply_fuzzy_resolutions(results, proposals, payout_batches, audit):
    """GATED: apply only proposals at/above the floor. Returns count resolved."""
    resolved = 0
    for p in proposals:
        if p["matched_utr"] and p["confidence"] >= CONFIDENCE_FLOOR:
            for oid in payout_batches.get(p["matched_utr"], {}).get("orders", []):
                if results.get(oid, {}).get("status") == "exception":
                    results[oid] = {**results[oid], "status": "matched", "reason": "ok_fuzzy",
                                    "detail": f"fuzzy-matched via {p['bank_txn_id']} "
                                              f"(conf {p['confidence']}): {p['reason']}"}
                    audit.append({"order_id": oid, "stage": "fuzzy_match", "decision": "matched",
                                  "detail": results[oid]["detail"]})
                    resolved += 1
        else:
            audit.append({"order_id": p["bank_txn_id"], "stage": "fuzzy_match", "decision": "held",
                          "detail": p["reason"]})
    return resolved


# ---------------- job 2: plain-English exception explanations ----------------
_FALLBACK = {
    "missing_payout": ("Gateway settled this payment but no matching bank credit arrived.",
                       "Chase the payout with the gateway; confirm the UTR was disbursed."),
    "fee_mismatch": ("Reported net does not equal gross minus expected fee + GST.",
                     "Recompute fees; raise a fee-correction ticket with the gateway."),
    "duplicate_payment": ("The same order has more than one settlement.",
                          "Void/refund the duplicate; confirm the customer was charged once."),
    "refund_not_reflected": ("Order was refunded but the money was still paid out.",
                             "Claw back the payout or book a receivable against the gateway."),
    "payout_amount_mismatch": ("Bank credit amount does not equal the expected batch net.",
                               "Break down the batch line items; find the missing/extra order."),
    "no_settlement_for_order": ("Internal order exists with no gateway settlement.",
                                "Check capture status; the payment may have failed silently."),
    "unexpected_credit": ("Bank credit with no matching settlement or order.",
                          "Identify the source; could be a manual transfer or misposting."),
}


def explain_exception(reason, row=None):
    if llm_available():
        system = ("You are a finance-ops assistant. Explain a reconciliation exception in one "
                  "clear sentence and give one concrete next action. Respond ONLY as JSON: "
                  '{"explanation": str, "suggested_action": str}.')
        user = f"Exception type: {reason}\nContext: {json.dumps(row or {})}"
        data = _extract_json(_call_llm(system, user, 250))
        if data and "explanation" in data:
            return {"explanation": data["explanation"],
                    "suggested_action": data.get("suggested_action", "")}
    text, action = _FALLBACK.get(reason, ("Unclassified exception.", "Review manually."))
    return {"explanation": text, "suggested_action": action}


if __name__ == "__main__":
    print("llm available:", llm_available())
    print(json.dumps(explain_exception("missing_payout"), indent=2))
