"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

function rupees(n) { return "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 }); }
function when(iso) { try { return new Date(iso).toLocaleString("en-IN"); } catch { return iso; } }

export default function History() {
  const [runs, setRuns] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/runs").then((r) => r.json()).then((j) => { if (j.ok) { setRuns(j.runs); setActiveId(j.activeRunId); } });
  }, []);

  async function open(id) {
    await fetch(`/api/runs/${id}?activate=1`);
    router.push("/exceptions");
  }

  if (!runs) return <main className="page"><p className="page-sub">Loading…</p></main>;

  return (
    <main className="page">
      <h1 className="page-h">History</h1>
      <p className="page-sub">Every reconciliation you&apos;ve run, saved to your account.</p>

      {runs.length === 0 ? (
        <div className="cta-banner"><div>No runs yet.</div><Link href="/reconcile" className="primary btn-link">Run your first →</Link></div>
      ) : (
        <div className="card tblwrap">
          <table>
            <thead><tr><th>When</th><th>Reconcile rate</th><th>Money at risk</th><th>Exceptions</th><th>Recovered</th><th></th></tr></thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className={r.id === activeId ? "row-active" : ""}>
                  <td>{when(r.createdAt)}{r.id === activeId && <span className="chip-inline">active</span>}</td>
                  <td className="mono">{(r.reconcile_rate * 100).toFixed(1)}%</td>
                  <td className="mono num">{rupees(r.money_at_risk)}</td>
                  <td className="mono">{r.exceptions}</td>
                  <td className="mono">{r.recovered_count}/{r.exceptions} · {rupees(r.recovered_amount)}</td>
                  <td><button className="ghost xs" onClick={() => open(r.id)}>Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
