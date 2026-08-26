"""
ReconAgent orchestrator -- one command runs the whole loop and emits everything.

  reconcile (deterministic)  ->  AI fuzzy-resolve residual (bounded, gated)
   ->  explain exceptions  ->  Settlement Q&A  ->  metrics  ->  outputs + dashboard

Bounded & safe by design:
  * the AI layer only sees the residual the core couldn't resolve (few calls)
  * a stopping rule caps fuzzy passes (no loops)
  * proposals are gated by a confidence floor; the ledger is never auto-edited
  * every stage is wrapped so one failure degrades gracefully instead of crashing
  * every decision is written to audit.csv

Outputs (into --out): recon_output.csv, exceptions.csv, audit.csv, results.json, report.html

    python src/pipeline.py --data data/ --out data/
"""
import argparse
import csv
import json
import os

try:
    from . import reconcile as recon_mod
    from . import llm_matcher, qa_agent, metrics as metrics_mod
except ImportError:
    import reconcile as recon_mod
    import llm_matcher, qa_agent, metrics as metrics_mod

MAX_FUZZY_PASSES = 1  # stopping rule: residual doesn't grow, so one pass suffices


def _safe(stage, fn, *a, **k):
    try:
        return fn(*a, **k)
    except Exception as e:
        print(f"  [!] stage '{stage}' degraded gracefully: {e}")
        return None


def run(data_dir, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    print("→ reconciling (deterministic core)…")
    results, audit, ctx = recon_mod.reconcile(data_dir)

    print("→ AI fuzzy-resolving residual (bounded, gated)…")
    resolved = 0
    for _ in range(MAX_FUZZY_PASSES):
        proposals = _safe("fuzzy", llm_matcher.resolve_garbled_credits,
                          ctx["unmatched_bank"], ctx["payout_batches"]) or []
        r = _safe("apply_fuzzy", llm_matcher.apply_fuzzy_resolutions,
                  results, proposals, ctx["payout_batches"], audit) or 0
        resolved += r
        if r == 0:
            break
    print(f"   fuzzy-resolved {resolved} record(s)")

    print("→ explaining exceptions…")
    exceptions = []
    for oid, rr in results.items():
        if rr["status"] == "exception":
            exp = _safe("explain", llm_matcher.explain_exception, rr["reason"],
                        {"order_id": oid, "amount": rr.get("amount")}) or {}
            exceptions.append({
                "order_id": oid, "reason": rr["reason"], "amount": rr.get("amount", 0.0),
                "explanation": exp.get("explanation", ""),
                "suggested_action": exp.get("suggested_action", ""),
                "detail": rr.get("detail", ""),
            })
    exceptions.sort(key=lambda x: -x["amount"])

    print("→ running Settlement Q&A demo…")
    qa = _safe("qa", qa_agent.run_demo, results, ctx) or []
    f = qa_agent.facts(results, ctx)

    recon_mod.summarize(results)

    # ---- write outputs ----
    with open(os.path.join(out_dir, "recon_output.csv"), "w", newline="") as fp:
        w = csv.DictWriter(fp, fieldnames=["order_id", "status", "reason", "amount"])
        w.writeheader()
        for oid, rr in results.items():
            w.writerow({"order_id": oid, "status": rr["status"], "reason": rr["reason"],
                        "amount": rr.get("amount", "")})
    with open(os.path.join(out_dir, "exceptions.csv"), "w", newline="") as fp:
        w = csv.DictWriter(fp, fieldnames=["order_id", "reason", "amount",
                                           "explanation", "suggested_action", "detail"])
        w.writeheader()
        w.writerows(exceptions)
    with open(os.path.join(out_dir, "audit.csv"), "w", newline="") as fp:
        w = csv.DictWriter(fp, fieldnames=["order_id", "stage", "decision", "detail"])
        w.writeheader()
        w.writerows(audit)

    # ---- metrics (if ground truth present) ----
    m = None
    truth_path = os.path.join(data_dir, "ground_truth.csv")
    if os.path.exists(truth_path):
        print()
        m = metrics_mod.evaluate(os.path.join(out_dir, "recon_output.csv"), truth_path)

    summary = {"facts": f, "metrics": m, "resolved_by_ai": resolved,
               "n_exceptions": len(exceptions), "n_audit": len(audit),
               "llm": llm_matcher.llm_available()}
    with open(os.path.join(out_dir, "results.json"), "w") as fp:
        json.dump({"summary": summary, "exceptions": exceptions, "qa": qa}, fp, indent=2)

    html = build_dashboard(summary, exceptions, qa)
    with open(os.path.join(out_dir, "report.html"), "w") as fp:
        fp.write(html)
    print(f"\n✓ done. Open {os.path.join(out_dir, 'report.html')} for the demo dashboard.")
    return summary


# ------------------------------------------------------------------ dashboard
def build_dashboard(summary, exceptions, qa):
    f, m = summary["facts"], summary["metrics"]
    rate = f["reconcile_rate"] * 100
    ai_note = "LLM active" if summary["llm"] else "rule-based fallback (no API key)"

    def esc(s):
        return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))

    kpis = [
        ("Reconcile rate", f"{rate:.1f}%", "of transactions auto-reconciled", "accent"),
        ("Money at risk", f"Rs {f['money_at_risk']:,.0f}", f"across {f['exceptions']} exceptions", "warn"),
        ("Real losses caught", f"{(m['recall']*100 if m else 0):.0f}%", "recall on held-out losses", "good"),
        ("AI-resolved", f"{summary['resolved_by_ai']}", "garbled payouts recovered by AI", "accent"),
    ]
    kpi_html = "".join(
        f'<div class="kpi {cls}"><div class="kv">{esc(v)}</div>'
        f'<div class="kl">{esc(l)}</div><div class="kh">{esc(h)}</div></div>'
        for l, v, h, cls in kpis)

    exc_rows = "".join(
        f'<tr><td class="mono">{esc(e["order_id"])}</td>'
        f'<td><span class="tag">{esc(e["reason"])}</span></td>'
        f'<td class="mono num">Rs {e["amount"]:,.0f}</td>'
        f'<td>{esc(e["explanation"])}<span class="act">→ {esc(e["suggested_action"])}</span></td></tr>'
        for e in exceptions[:25])

    qa_html = "".join(
        f'<div class="qa"><div class="q">{esc(item["q"])}</div>'
        f'<div class="a">{esc(item["answer"])}</div></div>'
        for item in qa)

    metrics_html = ""
    if m:
        rows = [("Reconcile rate", f"{m['reconcile_rate']*100:.1f}%"),
                ("Exception precision", f"{m['precision']*100:.1f}%"),
                ("Exception recall", f"{m['recall']*100:.1f}%"),
                ("F1", f"{m['f1']*100:.1f}%"),
                ("False-match rate", f"{m['false_match_rate']*100:.1f}%")]
        metrics_html = "".join(
            f'<div class="mrow"><span>{esc(l)}</span><b class="mono">{esc(v)}</b></div>'
            for l, v in rows)

    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>ReconAgent — Reconciliation Report</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;700;800&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>
:root{{--ground:#F1F4F6;--surface:#FFF;--surface2:#F7F9FB;--ink:#0F151B;--muted:#586471;
--faint:#8A95A1;--line:#E1E7ED;--accent:#0E7C7B;--accent-ink:#0A5A59;--accent-soft:#DBEEED;
--good:#1E9D57;--warn:#B9760A;--warn-soft:#F6E9CF;}}
@media(prefers-color-scheme:dark){{:root{{--ground:#0A0E13;--surface:#131A21;--surface2:#0F161C;
--ink:#E9EEF2;--muted:#95A1AD;--faint:#68727D;--line:#222C35;--accent:#33B7B0;--accent-ink:#5FCFC8;
--accent-soft:#123230;--good:#37C07A;--warn:#E0A43A;--warn-soft:#33260D;}}}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--ground);color:var(--ink);
font-family:"IBM Plex Sans",system-ui,sans-serif;line-height:1.55}}
.mono{{font-family:"IBM Plex Mono",monospace;font-variant-numeric:tabular-nums}}
.wrap{{max-width:1000px;margin:0 auto;padding:clamp(20px,4vw,52px) clamp(16px,4vw,32px) 72px}}
.eyebrow{{font-family:"IBM Plex Mono",monospace;font-size:12px;letter-spacing:.14em;
text-transform:uppercase;color:var(--accent-ink)}}
h1{{font-family:"Archivo",sans-serif;font-weight:800;letter-spacing:-.02em;
font-size:clamp(28px,5vw,44px);margin:.3em 0 .1em;text-wrap:balance}}
.sub{{color:var(--muted);margin:0}}
.badge{{display:inline-block;margin-top:10px;font-family:"IBM Plex Mono",monospace;font-size:12px;
padding:4px 10px;border-radius:99px;background:var(--accent-soft);color:var(--accent-ink)}}
.kpis{{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:28px 0}}
@media(max-width:720px){{.kpis{{grid-template-columns:repeat(2,1fr)}}}}
.kpi{{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:18px 18px;
border-top:3px solid var(--accent)}}
.kpi.warn{{border-top-color:var(--warn)}}.kpi.good{{border-top-color:var(--good)}}
.kv{{font-family:"Archivo",sans-serif;font-weight:800;font-size:27px;line-height:1;letter-spacing:-.01em}}
.kl{{font-size:13px;font-weight:600;margin-top:8px}}.kh{{font-size:12px;color:var(--faint);margin-top:2px}}
h2{{font-family:"Archivo",sans-serif;font-weight:700;font-size:20px;letter-spacing:-.01em;
margin:38px 0 4px}}.h2sub{{color:var(--muted);font-size:13.5px;margin:0 0 16px}}
.card{{background:var(--surface);border:1px solid var(--line);border-radius:14px;overflow:hidden}}
table{{width:100%;border-collapse:collapse;font-size:13.5px}}
th{{text-align:left;font-family:"IBM Plex Mono",monospace;font-size:11px;letter-spacing:.06em;
text-transform:uppercase;color:var(--muted);padding:12px 14px;border-bottom:1px solid var(--line)}}
td{{padding:11px 14px;border-bottom:1px solid var(--line);vertical-align:top}}
tr:last-child td{{border-bottom:0}}.num{{text-align:right;white-space:nowrap}}
.tag{{font-family:"IBM Plex Mono",monospace;font-size:11.5px;background:var(--warn-soft);
color:var(--warn);padding:2px 8px;border-radius:6px;white-space:nowrap}}
.act{{display:block;color:var(--accent-ink);font-size:12.5px;margin-top:3px}}
.tblwrap{{overflow-x:auto}}
.qa{{padding:14px 18px;border-bottom:1px solid var(--line)}}.qa:last-child{{border-bottom:0}}
.q{{font-weight:600;font-size:14.5px}}.a{{color:var(--muted);font-size:14px;margin-top:3px}}
.grid2{{display:grid;grid-template-columns:1fr 1fr;gap:14px}}@media(max-width:720px){{.grid2{{grid-template-columns:1fr}}}}
.mrow{{display:flex;justify-content:space-between;padding:11px 18px;border-bottom:1px dashed var(--line);font-size:14px}}
.mrow:last-child{{border-bottom:0}}.mrow b{{font-size:15px}}
.foot{{margin-top:34px;color:var(--faint);font-size:12.5px;text-align:center}}
</style></head><body><div class="wrap">
<div class="eyebrow">Razorpay AI Buildathon 2026 · Track 04 — AI Finance Controller</div>
<h1>ReconAgent — settlement reconciliation report</h1>
<p class="sub">Orders vs. gateway settlements vs. bank statement, reconciled end to end.</p>
<span class="badge">AI layer: {esc(ai_note)} · {esc(summary['n_audit'])} audit events</span>
<div class="kpis">{kpi_html}</div>
<h2>Exceptions the agent flagged</h2>
<p class="h2sub">Every unresolved record, ranked by money at risk, with a plain-English reason and a next action. This is the honest exception list.</p>
<div class="card tblwrap"><table><thead><tr><th>Order</th><th>Type</th><th>Amount</th><th>Explanation &amp; suggested action</th></tr></thead><tbody>{exc_rows}</tbody></table></div>
<h2>Ask the ledger</h2>
<p class="h2sub">Settlement Q&amp;A — grounded, read-only answers computed from the reconciled data.</p>
<div class="card">{qa_html}</div>
<div class="grid2"><div><h2>Measured accuracy</h2><p class="h2sub">On a held-out batch, not cherry-picked.</p><div class="card">{metrics_html}</div></div></div>
<p class="foot">Generated by ReconAgent · bounded &amp; gated: the AI proposes, never edits money · full trail in audit.csv</p>
</div></body></html>"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data/")
    ap.add_argument("--out", default="data/")
    a = ap.parse_args()
    run(a.data, a.out)


if __name__ == "__main__":
    main()
