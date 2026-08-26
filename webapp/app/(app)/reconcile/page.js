"use client";

import Link from "next/link";
import { useRef, useState } from "react";

function rupees(n) { return "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 }); }

export default function Reconcile() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const ordersRef = useRef(null);
  const settleRef = useRef(null);
  const bankRef = useRef(null);

  async function post(body, isForm) {
    setLoading(true); setError(""); setResult(null);
    try {
      const res = await fetch("/api/run", isForm ? { method: "POST", body } : { method: "POST" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "run failed");
      setResult(json);
    } catch (e) { setError(String(e.message || e)); }
    finally { setLoading(false); }
  }

  function runUpload() {
    const o = ordersRef.current?.files?.[0], s = settleRef.current?.files?.[0], b = bankRef.current?.files?.[0];
    if (!o || !s || !b) { setError("Please choose all three CSV files."); return; }
    const fd = new FormData(); fd.append("orders", o); fd.append("settlements", s); fd.append("bank", b);
    post(fd, true);
  }

  const f = result?.summary?.facts;
  const m = result?.summary?.metrics;

  return (
    <main className="page">
      <h1 className="page-h">Reconcile</h1>
      <p className="page-sub">Generate a realistic synthetic batch, or upload your own three CSVs. Each run is saved to your account.</p>

      <section className="panel">
        <h2>Run a reconciliation</h2>
        <div className="row">
          <button className="primary" onClick={() => post(null, false)} disabled={loading}>
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
          <span className="hint">Uploaded data is scored without ground truth.</span>
        </div>
        {error && <div className="err">{error}</div>}
      </section>

      {f && (
        <>
          <div className="kpis">
            <div className="kpi"><div className="kv">{(f.reconcile_rate * 100).toFixed(1)}%</div><div className="kl">Reconcile rate</div><div className="kh">{f.reconciled}/{f.total}</div></div>
            <div className="kpi warn"><div className="kv">{rupees(f.money_at_risk)}</div><div className="kl">Money at risk</div><div className="kh">{f.exceptions} exceptions</div></div>
            <div className="kpi good"><div className="kv">{m ? (m.recall * 100).toFixed(0) + "%" : "—"}</div><div className="kl">Real losses caught</div><div className="kh">{m ? "held-out recall" : "no ground truth"}</div></div>
            <div className="kpi"><div className="kv">{result.summary.resolved_by_ai}</div><div className="kl">AI-resolved</div><div className="kh">garbled payouts</div></div>
          </div>
          <div className="cta-banner">
            <div><b>Done.</b> This run is saved. Next: review the exceptions or start recovering.</div>
            <div className="row">
              <Link href="/exceptions" className="primary btn-link">View exceptions →</Link>
              <Link href="/recovery" className="ghost btn-link">Recovery tracker</Link>
            </div>
          </div>
        </>
      )}
    </main>
  );
}
