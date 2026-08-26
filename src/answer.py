"""
Single-question entrypoint for the web backend.

    python src/answer.py "<question>" <data_dir>

Reconciles the data dir fresh (fast) and prints ONE JSON object with the grounded
answer + evidence, so the Node/Express layer can serve live Settlement Q&A.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from reconcile import reconcile
import llm_matcher
import qa_agent


def main():
    question = sys.argv[1] if len(sys.argv) > 1 else "What's our overall reconcile rate?"
    data_dir = sys.argv[2] if len(sys.argv) > 2 else "data/"
    try:
        results, audit, ctx = reconcile(data_dir)
        # apply the SAME bounded AI fuzzy-resolution the pipeline does, so Q&A numbers
        # match the dashboard exactly
        proposals = llm_matcher.resolve_garbled_credits(ctx["unmatched_bank"], ctx["payout_batches"])
        llm_matcher.apply_fuzzy_resolutions(results, proposals, ctx["payout_batches"], audit)
        out = qa_agent.answer(question, results, ctx)
    except Exception as e:
        out = {"answer": f"Could not answer: {e}", "evidence": {}}
    print(json.dumps(out))


if __name__ == "__main__":
    main()
