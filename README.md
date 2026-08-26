# TieOut — Multi-Source Settlement Reconciliation

**Razorpay AI Buildathon 2026 · Track 04: AI Finance Controller**

> *"Tie out"* is what accountants say when two sets of records match perfectly. That's the job.

An agent that closes the reconciliation loop for a merchant — tying together their
**internal orders**, their **payment-gateway settlements** (Razorpay-style), and their
**bank statement** across a 250-record batch — then reports a **reconcile rate**, an
**honest exception list** with plain-English fixes, a grounded **Settlement Q&A**, and a
full **audit trail** of every decision.

> Track 4's bar: *"Throughput plus measured accuracy plus an honest exception list.
> One cherry-picked match proves nothing."* This is built to hit exactly that.

## Results at a glance

| Metric | Tuning set (seed 42) | Held-out set (seed 7) |
|---|---|---|
| Reconcile rate | **90.8%** | **88.5%** |
| Exception precision | **100%** | **100%** |
| Exception recall | **100%** | **100%** |
| False-match rate | **0.0%** | **0.0%** |

Every real loss is caught; nothing clean is false-flagged; the numbers hold on data the
agent was never tuned on. Open **`data/report.html`** for the visual dashboard.

---

## Run it (30 seconds, no dependencies, no API key)

```bash
bash run_demo.sh
```

That generates the data, reconciles, grades on a held-out batch, and writes the dashboard.
Or step by step:

```bash
python3 src/generate_data.py --n 250 --seed 42 --out data/   # 1. synthetic 3-source batch
python3 src/pipeline.py       --data data/ --out data/        # 2. full reconciliation loop
python3 src/metrics.py        --results data/recon_output.csv --truth data/ground_truth.csv  # 3. grade
python3 tests/run_tests.py                                    # run the test suite
```

Everything runs on the Python standard library. To swap the rule-based AI fallback for a
real LLM, copy `.env.example` to `.env`, set `ANTHROPIC_API_KEY`, and `pip install anthropic`.

---

## The problem

A merchant has three sources of truth that should agree but never do:

| Source | File | What it claims |
|---|---|---|
| Internal ledger | `orders.csv` | what was sold |
| Payment gateway | `settlements.csv` | gross → fee → GST → **net**, grouped into payout batches by **UTR** |
| Bank | `bank.csv` | batched payouts that actually landed as credits |

The hard part: **many settlements collapse into one bank credit** (a payout batch keyed by
a UTR), fees and GST shave the amounts, and refunds, duplicates, missing payouts and
mangled bank narrations creep in. Reconciliation means tying every rupee back together —
and being honest about what won't tie.

### Loss classes the agent handles

`fee_mismatch` · `missing_payout` · `unexpected_credit` · `refund_not_reflected` ·
`duplicate_payment` · `garbled_narration` (AI-resolved) · `timing_lag` (advisory, not a loss)

Every one is **labelled** in `ground_truth.csv`, so accuracy is measured, not asserted.

---

## Architecture

```
        orders.csv    settlements.csv    bank.csv
             └──────────────┼──────────────┘
                            ▼
   ┌──────────────────────────────────────────────────┐
   │  1. DETERMINISTIC CORE   (src/reconcile.py)         │
   │     join → fee-check → batch by UTR → bank-match    │
   │     · on time → matched   · late but arrived → matched_late │
   │     · unresolved → exception (+ machine reason)     │
   └───────────────┬─────────────────────────────────────┘
                   │  residual only (few records)
                   ▼
   ┌──────────────────────────────────────────────────┐
   │  2. AI LAYER   (src/llm_matcher.py)  [bounded/gated]│
   │     · fuzzy-resolve garbled-UTR credits (confidence)│
   │     · explain each exception in plain English       │
   │     · PROPOSES only — never edits money; gated ≥0.80 │
   └───────────────┬─────────────────────────────────────┘
                   ▼
   ┌──────────────────────────────────────────────────┐
   │  3. SETTLEMENT Q&A   (src/qa_agent.py)              │
   │     grounded, read-only answers over the results    │
   └───────────────┬─────────────────────────────────────┘
                   ▼
   ┌──────────────────────────────────────────────────┐
   │  4. ORCHESTRATOR   (src/pipeline.py)               │
   │     stopping rules · graceful degradation · audit   │
   │     → recon_output.csv · exceptions.csv · audit.csv │
   │     → results.json · report.html (dashboard)        │
   └──────────────────────────────────────────────────┘
                   ▼
        5. METRICS  (src/metrics.py)  on a held-out batch
```

### Why the AI is meaningful *and* safe

The deterministic core resolves the bulk cheaply and explainably. The LLM runs **only on
the residual** it can't resolve, which keeps calls few and every decision reviewable:

- **Bounded** — the AI never sees clean records; a stopping rule caps fuzzy passes.
- **Gated** — a fuzzy match is applied only at confidence ≥ 0.80; below that it stays a
  human exception. The model **proposes**, the pipeline **decides**. No amount is ever
  auto-edited.
- **Grounded** — the Q&A agent answers only from computed facts, never free guessing.
- **Graceful** — every stage is wrapped; if the LLM or a row fails, the run degrades to the
  rule-based path instead of crashing. Runs identically with or without an API key.
- **Audited** — `audit.csv` records the stage, decision and reason for every record.

---

## What each file does

```
tieout/
├── run_demo.sh            one-command end-to-end demo
├── requirements.txt       stdlib to run; anthropic optional
├── .env.example           optional LLM config
├── src/
│   ├── generate_data.py   synthetic 3-source data + labelled ground truth
│   ├── reconcile.py       deterministic matching core + audit trail
│   ├── llm_matcher.py     bounded/gated AI: fuzzy match + exception explainer
│   ├── qa_agent.py        grounded Settlement Q&A
│   ├── pipeline.py        orchestrator + HTML dashboard generator
│   └── metrics.py         honest evaluation on held-out data
├── tests/
│   └── run_tests.py       9 invariant checks (precision, recall, gating, audit)
└── data/                  generated CSVs + report.html (gitignored)
```

## Outputs

- `data/report.html` — the demo dashboard (KPIs, exception table, Q&A, metrics)
- `data/recon_output.csv` — per-record verdict
- `data/exceptions.csv` — the honest exception list with explanations + actions
- `data/audit.csv` — every decision, for the audit trail
- `data/results.json` — machine-readable summary

## Limitations (kept honest)

- Data is synthetic; the generator models common Indian payment-flow mess (fee+GST,
  batched UTR payouts, refunds) but not every real-world edge case.
- The rule-based fuzzy fallback keys on surviving digits + amount; a real deployment would
  add value-date windows and payee metadata, and lean more on the LLM adjudicator.
- Single-currency, single-gateway. Multi-gateway/multi-currency is future work.

## Pitch (5 minutes)

1. The problem — three sources that never agree (30s).
2. Live demo — run `run_demo.sh`, open `report.html` (2m).
3. The number — 90.8% reconciled, 100% of real losses caught, 0% false-match, held-out (1m).
4. One failure handled gracefully — a garbled-UTR credit the AI recovers, and a
   low-confidence one it correctly refuses and escalates (1m).
5. Architecture — bounded, gated, audited (30s).
```
```
