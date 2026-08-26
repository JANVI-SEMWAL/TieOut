"use client";

import { useMemo, useRef, useState } from "react";

const DEMO_QUESTIONS = [
  "How much money is at risk right now?",
  "How many payouts are missing?",
  "Which payouts arrived late?",
  "What are the biggest exceptions by value?",
  "What's our overall reconcile rate?",
];

function rupees(n) {
  return "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

export default function Home() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState(null);
  const [asking, setAsking] = useState(false);
  const [filterType, setFilterType] = useState("all");
  const [sortDir, setSortDir] = useState("desc");
  const [draft, setDraft] = useState(null);
  const [draftingAll, setDraftingAll] = useState(false);
  const ordersRef = useRef(null);
  const settleRef = useRef(null);
  const bankRef = useRef(null);

  async function runDemo() {
    setLoading(true); setError(""); setAnswer(null); setFilterType("all");
    try {
      const res = await fetch("/api/run", { method: "POST" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "run failed");
      setData(json);
    } catch (e) { setError(String(e.message || e)); }
    finally { setLoading(false); }
  }

  async function runUpload() {
    const o = ordersRef.current?.files?.[0];
    const s = settleRef.current?.files?.[0];
    const b = bankRef.current?.files?.[0];
    if (!o || !s || !b) { setError("Please choose all three CSV files (orders, settlements, bank)."); return; }
    setLoading(true); setError(""); setAnswer(null); setFilterType("all");
    try {
      const fd = new FormData();
      fd.append("orders", o); fd.append("settlements", s); fd.append("bank", b);
      const res = await fetch("/api/run", { method: "POST", body: fd });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "run failed");
      setData(json);
    } catch (e) { setError(String(e.message || e)); }
    finally { setLoading(false); }
  }

  async function ask(q) {
    const query = (q ?? question).trim();
    if (!query) return;
    setAsking(true); setAnswer(null); setError("");
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: query }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "ask failed");
      setAnswer({ q: query, a: json.answer });
    } catch (e) { setError(String(e.message || e)); }
    finally { setAsking(false); }
  }

  const f = data?.summary?.facts;
  const m = data?.summary?.metrics;
  const allExceptions = data?.exceptions || [];

  // chart: money at risk by exception type (single-series magnitude)
  const chart = useMemo(() => {
    if (!f?.exc_by_reason) return [];
    return Object.entries(f.exc_by_reason)
      .map(([reason, v]) => ({ reason, amount: v.amount, count: v.count }))
      .sort((a, b) => b.amount - a.amount);
  }, [f]);
  const chartMax = chart.length ? Math.max(...chart.map((d) => d.amount)) : 1;

  // available types for the filter
  const types = useMemo(() => {
    const s = new Set(allExceptions.map((e) => e.reason));
    return ["all", ...Array.from(s).sort()];
  }, [allExceptions]);

  // filter + sort for the table
  const rows = useMemo(() => {
    let r = allExceptions.filter((e) => filterType === "all" || e.reason === filterType);
    r = [...r].sort((a, b) => (sortDir === "desc" ? b.amount - a.amount : a.amount - b.amount));
    return r;
  }, [allExceptions, filterType, sortDir]);

  function exportCsv() {
    const header = ["order_id", "reason", "amount", "explanation", "suggested_action"];
    const esc = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
    const lines = [header.join(",")].concat(
      rows.map((e) => [e.order_id, e.reason, e.amount, e.explanation, e.suggested_action].map(esc).join(","))
    );
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "tieout_exceptions.csv";
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  async function draftOne(order) {
    setDraft({ loading: true, order });
    try {
      const res = await fetch("/api/draft", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "draft failed");
      const d = json.drafts?.[0];
      if (!d) throw new Error("no draft produced");
      setDraft({ loading: false, ...d });
    } catch (e) { setDraft({ loading: false, error: String(e.message || e), order }); }
  }

  async function draftAll() {
    setDraftingAll(true); setError("");
    try {
      const res = await fetch("/api/draft", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: "all" }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "draft failed");
      const pack = (json.drafts || []).map((d) =>
        `=== ${d.order_id}  (${d.reason}, ${rupees(d.amount)})\nChannel: ${d.channel}\n` +
        `Subject: ${d.subject}\n\n${d.body}\n`
      ).join("\n----------------------------------------\n\n");
      const blob = new Blob([pack], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "tieout_recovery_pack.txt";
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) { setError(String(e.message || e)); }
    finally { setDraftingAll(false); }
  }

  function copyDraft() {
    if (!draft) return;
    try { navigator.clipboard.writeText(`Subject: ${draft.subject}\n\n${draft.body}`); } catch (e) {}
  }

  return (
    <main className="wrap">
      <div className="eyebrow">Razorpay AI Buildathon 2026 · Track 04 — AI Finance Controller</div>
      <h1>TieOut</h1>
      <p className="sub">
        Reconcile a merchant&apos;s orders, gateway settlements and bank statement end to end —
        with a bounded, gated AI layer and a live Settlement Q&amp;A. When the records match,
        they <em>tie out</em>.
      </p>

      <section className="panel">
        <h2>Run a reconciliation</h2>
        <p>Generate a realistic synthetic batch, or upload your own three CSVs.</p>
        <div className="row">
          <button className="primary" onClick={runDemo} disabled={loading}>
            {loading ? <><span className="spinner" />Reconciling…</> : "Generate demo data & reconcile"}
          </button>
          <span className="hint">250 transactions across 3 sources, with realistic mismatches.</span>
        </div>

        <div className="uploads">
          <label>orders.csv<input ref={ordersRef} type="file" accept=".csv" /></label>
          <label>settlements.csv<input ref={settleRef} type="file" accept=".csv" /></label>
          <label>bank.csv<input ref={bankRef} type="file" accept=".csv" /></label>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="ghost" onClick={runUpload} disabled={loading}>Reconcile uploaded files</button>
          <span className="hint">Uploaded data is scored without ground truth (accuracy panel hidden).</span>
        </div>
        {error && <div className="err">{error}</div>}
      </section>

      {f && (
        <>
          <div className="kpis">
            <div className="kpi">
              <div className="kv">{(f.reconcile_rate * 100).toFixed(1)}%</div>
              <div className="kl">Reconcile rate</div>
              <div className="kh">{f.reconciled} of {f.total} transactions</div>
            </div>
            <div className="kpi warn">
              <div className="kv">{rupees(f.money_at_risk)}</div>
              <div className="kl">Money at risk</div>
              <div className="kh">across {f.exceptions} exceptions</div>
            </div>
            <div className="kpi good">
              <div className="kv">{m ? (m.recall * 100).toFixed(0) + "%" : "—"}</div>
              <div className="kl">Real losses caught</div>
              <div className="kh">{m ? "recall on held-out losses" : "no ground truth"}</div>
            </div>
            <div className="kpi">
              <div className="kv">{data.summary.resolved_by_ai}</div>
              <div className="kl">AI-resolved</div>
              <div className="kh">garbled payouts recovered</div>
            </div>
          </div>
          <div className="badge">
            AI layer: {data.summary.llm ? "LLM active" : "rule-based fallback"} · {data.summary.n_audit} audit events
          </div>

          {chart.length > 0 && (
            <>
              <h2 className="sec">Money at risk by type</h2>
              <p className="secsub">Where the exposure concentrates — the biggest bars are where to look first.</p>
              <div className="card chart">
                {chart.map((d) => (
                  <div className="bar-row" key={d.reason} title={`${d.reason}: ${rupees(d.amount)} across ${d.count}`}>
                    <div className="bar-label mono">{d.reason}</div>
                    <div className="bar-track">
                      <div className="bar-fill" style={{ width: Math.max(2, (d.amount / chartMax) * 100) + "%" }} />
                    </div>
                    <div className="bar-val mono">{rupees(d.amount)}</div>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="sec-head">
            <div>
              <h2 className="sec" style={{ margin: 0 }}>Exceptions the agent flagged</h2>
              <p className="secsub" style={{ margin: "4px 0 0" }}>
                Ranked by money at risk, with a plain-English reason and a next action.
              </p>
            </div>
          </div>
          <div className="controls">
            <label className="ctl">
              Type
              <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
                {types.map((t) => <option key={t} value={t}>{t === "all" ? "all types" : t}</option>)}
              </select>
            </label>
            <button className="ghost sm" onClick={() => setSortDir(sortDir === "desc" ? "asc" : "desc")}>
              Amount {sortDir === "desc" ? "↓ high to low" : "↑ low to high"}
            </button>
            <span className="hint">{rows.length} shown</span>
            <div className="push actions">
              <button className="ghost sm" onClick={draftAll} disabled={draftingAll || rows.length === 0}>
                {draftingAll ? "Drafting…" : "✎ Draft all follow-ups"}
              </button>
              <button className="ghost sm" onClick={exportCsv} disabled={rows.length === 0}>⭳ Export CSV</button>
            </div>
          </div>
          <div className="card tblwrap">
            <table>
              <thead>
                <tr><th>Order</th><th>Type</th><th>Amount</th><th>Explanation &amp; suggested action</th><th></th></tr>
              </thead>
              <tbody>
                {rows.slice(0, 40).map((e) => (
                  <tr key={e.order_id}>
                    <td className="mono">{e.order_id}</td>
                    <td><span className="tag">{e.reason}</span></td>
                    <td className="mono num">{rupees(e.amount)}</td>
                    <td>{e.explanation}<span className="act">&rarr; {e.suggested_action}</span></td>
                    <td><button className="ghost xs" onClick={() => draftOne(e.order_id)}>Draft</button></td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={5} style={{ color: "var(--muted)" }}>No exceptions match this filter.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <h2 className="sec">Ask the ledger</h2>
          <p className="secsub">Grounded, read-only Settlement Q&amp;A — answers computed live from the reconciled data.</p>
          <div className="qa-input">
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && ask()}
              placeholder="e.g. Which payouts arrived late?"
            />
            <button className="primary" onClick={() => ask()} disabled={asking}>
              {asking ? <><span className="spinner" />Asking…</> : "Ask"}
            </button>
          </div>
          <div className="chips">
            {DEMO_QUESTIONS.map((q) => (
              <button key={q} className="chip" onClick={() => { setQuestion(q); ask(q); }}>{q}</button>
            ))}
          </div>
          {answer && (
            <div className="answer">
              <div className="q">{answer.q}</div>
              <div className="a">{answer.a}</div>
            </div>
          )}

          {m && (
            <>
              <h2 className="sec">Measured accuracy</h2>
              <p className="secsub">Graded against ground truth — not cherry-picked.</p>
              <div className="card">
                <div className="mrow"><span>Reconcile rate</span><b className="mono">{(m.reconcile_rate * 100).toFixed(1)}%</b></div>
                <div className="mrow"><span>Exception precision</span><b className="mono">{(m.precision * 100).toFixed(1)}%</b></div>
                <div className="mrow"><span>Exception recall</span><b className="mono">{(m.recall * 100).toFixed(1)}%</b></div>
                <div className="mrow"><span>F1</span><b className="mono">{(m.f1 * 100).toFixed(1)}%</b></div>
                <div className="mrow"><span>False-match rate</span><b className="mono">{(m.false_match_rate * 100).toFixed(1)}%</b></div>
              </div>
            </>
          )}
        </>
      )}

      {draft && (
        <div className="modal-bg" onClick={() => setDraft(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <div className="modal-title">Recovery follow-up</div>
                <div className="modal-sub mono">{draft.order_id || draft.order}{draft.channel ? " · " + draft.channel : ""}</div>
              </div>
              <button className="x" onClick={() => setDraft(null)}>✕</button>
            </div>
            {draft.loading && <div className="modal-body"><span className="spinner dark" />Drafting…</div>}
            {draft.error && <div className="modal-body err">{draft.error}</div>}
            {!draft.loading && !draft.error && (
              <>
                <div className="modal-body">
                  <div className="draft-subj">{draft.subject}</div>
                  <pre className="draft-body">{draft.body}</pre>
                </div>
                <div className="modal-foot">
                  <button className="primary" onClick={copyDraft}>Copy</button>
                  <span className="hint">Review before sending — TieOut only drafts, it never sends.</span>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <p className="foot">TieOut · bounded &amp; gated: the AI proposes, never edits money · full trail in audit.csv</p>
    </main>
  );
}
