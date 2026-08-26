"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

function rupees(n) { return "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 }); }

export default function Recovery() {
  const [run, setRun] = useState(undefined);
  const [busy, setBusy] = useState("");

  useEffect(() => {
    fetch("/api/active").then((r) => r.json()).then((j) => setRun(j.ok ? j.run : null));
  }, []);

  const totals = useMemo(() => {
    const exc = run?.exceptions || [];
    const atRisk = exc.reduce((s, e) => s + (e.amount || 0), 0);
    const recovered = exc.filter((e) => e.recovered).reduce((s, e) => s + (e.amount || 0), 0);
    return { atRisk, recovered, count: exc.length, done: exc.filter((e) => e.recovered).length };
  }, [run]);

  async function toggle(orderId, recovered) {
    setBusy(orderId);
    // optimistic update
    setRun((r) => ({ ...r, exceptions: r.exceptions.map((e) => e.order_id === orderId ? { ...e, recovered } : e) }));
    try {
      await fetch("/api/recovery", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId: run.id, orderId, recovered }) });
    } catch (e) {
      setRun((r) => ({ ...r, exceptions: r.exceptions.map((e2) => e2.order_id === orderId ? { ...e2, recovered: !recovered } : e2) }));
    } finally { setBusy(""); }
  }

  if (run === undefined) return <main className="page"><p className="page-sub">Loading…</p></main>;
  if (run === null) return (
    <main className="page">
      <h1 className="page-h">Recovery tracker</h1>
      <div className="cta-banner"><div>No reconciliation yet.</div><Link href="/reconcile" className="primary btn-link">Run one →</Link></div>
    </main>
  );

  const pct = totals.atRisk ? (totals.recovered / totals.atRisk) * 100 : 0;
  const exc = [...run.exceptions].sort((a, b) => (a.recovered === b.recovered ? b.amount - a.amount : a.recovered ? 1 : -1));

  return (
    <main className="page">
      <h1 className="page-h">Recovery tracker</h1>
      <p className="page-sub">Tick off each exception as you chase and recover it. Your progress is saved.</p>

      <div className="kpis">
        <div className="kpi good"><div className="kv">{rupees(totals.recovered)}</div><div className="kl">Recovered</div><div className="kh">{totals.done} of {totals.count} items</div></div>
        <div className="kpi warn"><div className="kv">{rupees(totals.atRisk - totals.recovered)}</div><div className="kl">Still outstanding</div><div className="kh">{totals.count - totals.done} items open</div></div>
        <div className="kpi"><div className="kv">{rupees(totals.atRisk)}</div><div className="kl">Total flagged</div><div className="kh">this run</div></div>
      </div>

      <div className="prog"><div className="prog-top"><span>Recovery progress</span><b className="mono">{pct.toFixed(0)}%</b></div>
        <div className="prog-track"><div className="prog-fill" style={{ width: pct + "%" }} /></div>
      </div>

      <div className="card tblwrap" style={{ marginTop: 18 }}>
        <table>
          <thead><tr><th>Done</th><th>Order</th><th>Type</th><th>Amount</th><th>Suggested action</th></tr></thead>
          <tbody>
            {exc.map((e) => (
              <tr key={e.order_id} className={e.recovered ? "row-done" : ""}>
                <td><input type="checkbox" checked={!!e.recovered} disabled={busy === e.order_id} onChange={(ev) => toggle(e.order_id, ev.target.checked)} /></td>
                <td className="mono">{e.order_id}</td>
                <td><span className="tag">{e.reason}</span></td>
                <td className="mono num">{rupees(e.amount)}</td>
                <td>{e.suggested_action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
