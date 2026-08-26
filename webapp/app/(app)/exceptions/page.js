"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

function rupees(n) { return "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 }); }

export default function Exceptions() {
  const [run, setRun] = useState(undefined); // undefined=loading, null=none
  const [filterType, setFilterType] = useState("all");
  const [sortDir, setSortDir] = useState("desc");
  const [draft, setDraft] = useState(null);
  const [draftingAll, setDraftingAll] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/active").then((r) => r.json()).then((j) => setRun(j.ok ? j.run : null));
  }, []);

  const f = run?.summary?.facts;
  const all = run?.exceptions || [];

  const chart = useMemo(() => {
    if (!f?.exc_by_reason) return [];
    return Object.entries(f.exc_by_reason).map(([reason, v]) => ({ reason, amount: v.amount, count: v.count }))
      .sort((a, b) => b.amount - a.amount);
  }, [f]);
  const chartMax = chart.length ? Math.max(...chart.map((d) => d.amount)) : 1;
  const types = useMemo(() => ["all", ...Array.from(new Set(all.map((e) => e.reason))).sort()], [all]);
  const rows = useMemo(() => {
    let r = all.filter((e) => filterType === "all" || e.reason === filterType);
    return [...r].sort((a, b) => (sortDir === "desc" ? b.amount - a.amount : a.amount - b.amount));
  }, [all, filterType, sortDir]);

  function exportCsv() {
    const esc = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
    const lines = [["order_id", "reason", "amount", "explanation", "suggested_action"].join(",")]
      .concat(rows.map((e) => [e.order_id, e.reason, e.amount, e.explanation, e.suggested_action].map(esc).join(",")));
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = "tieout_exceptions.csv";
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }
  async function draftOne(order) {
    setDraft({ loading: true, order });
    try {
      const res = await fetch("/api/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order, runId: run.id }) });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "draft failed");
      setDraft({ loading: false, ...(json.drafts?.[0] || {}) });
    } catch (e) { setDraft({ loading: false, error: String(e.message || e), order }); }
  }
  async function draftAll() {
    setDraftingAll(true); setError("");
    try {
      const res = await fetch("/api/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order: "all", runId: run.id }) });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "draft failed");
      const pack = (json.drafts || []).map((d) => `=== ${d.order_id}  (${d.reason}, ${rupees(d.amount)})\nChannel: ${d.channel}\nSubject: ${d.subject}\n\n${d.body}\n`).join("\n----------------------------------------\n\n");
      const url = URL.createObjectURL(new Blob([pack], { type: "text/plain" }));
      const a = document.createElement("a"); a.href = url; a.download = "tieout_recovery_pack.txt";
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (e) { setError(String(e.message || e)); }
    finally { setDraftingAll(false); }
  }
  function copyDraft() { if (draft) { try { navigator.clipboard.writeText(`Subject: ${draft.subject}\n\n${draft.body}`); } catch (e) {} } }

  if (run === undefined) return <main className="page"><p className="page-sub">Loading…</p></main>;
  if (run === null) return (
    <main className="page">
      <h1 className="page-h">Exceptions</h1>
      <div className="cta-banner"><div>No reconciliation yet.</div><Link href="/reconcile" className="primary btn-link">Run one →</Link></div>
    </main>
  );

  return (
    <main className="page">
      <h1 className="page-h">Exceptions</h1>
      <p className="page-sub">{rupees(f.money_at_risk)} at risk across {f.exceptions} flagged transactions.</p>

      {chart.length > 0 && (
        <div className="card chart" style={{ marginBottom: 22 }}>
          {chart.map((d) => (
            <div className="bar-row" key={d.reason} title={`${d.reason}: ${rupees(d.amount)}`}>
              <div className="bar-label mono">{d.reason}</div>
              <div className="bar-track"><div className="bar-fill" style={{ width: Math.max(2, (d.amount / chartMax) * 100) + "%" }} /></div>
              <div className="bar-val mono">{rupees(d.amount)}</div>
            </div>
          ))}
        </div>
      )}

      <div className="controls">
        <label className="ctl">Type
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
            {types.map((t) => <option key={t} value={t}>{t === "all" ? "all types" : t}</option>)}
          </select>
        </label>
        <button className="ghost sm" onClick={() => setSortDir(sortDir === "desc" ? "asc" : "desc")}>Amount {sortDir === "desc" ? "↓" : "↑"}</button>
        <span className="hint">{rows.length} shown</span>
        <div className="push actions">
          <button className="ghost sm" onClick={draftAll} disabled={draftingAll || rows.length === 0}>{draftingAll ? "Drafting…" : "✎ Draft all"}</button>
          <button className="ghost sm" onClick={exportCsv} disabled={rows.length === 0}>⭳ Export CSV</button>
        </div>
      </div>
      {error && <div className="err">{error}</div>}

      <div className="card tblwrap">
        <table>
          <thead><tr><th>Order</th><th>Type</th><th>Amount</th><th>Explanation &amp; suggested action</th><th></th></tr></thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.order_id}>
                <td className="mono">{e.order_id}</td>
                <td><span className="tag">{e.reason}</span></td>
                <td className="mono num">{rupees(e.amount)}</td>
                <td>{e.explanation}<span className="act">&rarr; {e.suggested_action}</span></td>
                <td><button className="ghost xs" onClick={() => draftOne(e.order_id)}>Draft</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {draft && (
        <div className="modal-bg" onClick={() => setDraft(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div><div className="modal-title">Recovery follow-up</div><div className="modal-sub mono">{draft.order_id || draft.order}{draft.channel ? " · " + draft.channel : ""}</div></div>
              <button className="x" onClick={() => setDraft(null)}>✕</button>
            </div>
            {draft.loading && <div className="modal-body"><span className="spinner dark" />Drafting…</div>}
            {draft.error && <div className="modal-body err">{draft.error}</div>}
            {!draft.loading && !draft.error && (
              <>
                <div className="modal-body"><div className="draft-subj">{draft.subject}</div><pre className="draft-body">{draft.body}</pre></div>
                <div className="modal-foot"><button className="primary" onClick={copyDraft}>Copy</button><span className="hint">Review before sending — TieOut only drafts, it never sends.</span></div>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
