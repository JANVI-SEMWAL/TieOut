"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

function rupees(n) { return "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 }); }

export default function Home() {
  const [runs, setRuns] = useState(null);
  const [active, setActive] = useState(null);

  useEffect(() => {
    fetch("/api/runs").then((r) => r.json()).then((j) => setRuns(j.ok ? j.runs : []));
    fetch("/api/active").then((r) => r.json()).then((j) => setActive(j.ok ? j.run : null));
  }, []);

  const recoveredTotal = (runs || []).reduce((s, r) => s + (r.recovered_amount || 0), 0);
  const f = active?.summary?.facts;

  return (
    <main className="page">
      <div className="eyebrow">Razorpay AI Buildathon 2026 · Track 04</div>
      <h1 className="page-h">Welcome back</h1>
      <p className="page-sub">Your settlement reconciliation cockpit — find lost money, and track it back.</p>

      <div className="kpis">
        <div className="kpi">
          <div className="kv">{f ? (f.reconcile_rate * 100).toFixed(1) + "%" : "—"}</div>
          <div className="kl">Latest reconcile rate</div>
          <div className="kh">{f ? `${f.reconciled}/${f.total} transactions` : "no runs yet"}</div>
        </div>
        <div className="kpi warn">
          <div className="kv">{f ? rupees(f.money_at_risk) : "—"}</div>
          <div className="kl">Money at risk (latest)</div>
          <div className="kh">{f ? `${f.exceptions} open exceptions` : "run a reconciliation"}</div>
        </div>
        <div className="kpi good">
          <div className="kv">{rupees(recoveredTotal)}</div>
          <div className="kl">Recovered to date</div>
          <div className="kh">across all your runs</div>
        </div>
        <div className="kpi">
          <div className="kv">{runs ? runs.length : "—"}</div>
          <div className="kl">Reconciliations run</div>
          <div className="kh">saved to your account</div>
        </div>
      </div>

      {runs && runs.length === 0 && (
        <div className="cta-banner">
          <div>
            <b>Start here.</b> You haven&apos;t run a reconciliation yet.
          </div>
          <Link href="/reconcile" className="primary btn-link">Run your first reconciliation →</Link>
        </div>
      )}

      <h2 className="sec">Where to next</h2>
      <div className="cards">
        <Link href="/reconcile" className="navcard">
          <div className="navcard-t">Reconcile</div>
          <div className="navcard-d">Run a new reconciliation — generate demo data or upload your three CSVs.</div>
        </Link>
        <Link href="/exceptions" className="navcard">
          <div className="navcard-t">Exceptions</div>
          <div className="navcard-d">See every flagged transaction, the reason, and a one-click recovery draft.</div>
        </Link>
        <Link href="/recovery" className="navcard">
          <div className="navcard-t">Recovery tracker</div>
          <div className="navcard-d">Tick off what you&apos;ve chased and watch the money recovered climb.</div>
        </Link>
        <Link href="/history" className="navcard">
          <div className="navcard-t">History</div>
          <div className="navcard-d">Every past run, saved — reopen any one to review or continue.</div>
        </Link>
      </div>
    </main>
  );
}
