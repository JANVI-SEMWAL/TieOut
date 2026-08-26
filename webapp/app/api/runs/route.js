import { NextResponse } from "next/server";
import { currentUser } from "../../../lib/auth.js";
import { listRuns } from "../../../lib/db.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = currentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not logged in." }, { status: 401 });
  const runs = listRuns(user.id).map((r) => {
    const recovered = r.exceptions.filter((e) => e.recovered);
    return {
      id: r.id, createdAt: r.createdAt,
      reconcile_rate: r.summary?.facts?.reconcile_rate ?? 0,
      money_at_risk: r.summary?.facts?.money_at_risk ?? 0,
      exceptions: r.exceptions.length,
      recovered_count: recovered.length,
      recovered_amount: recovered.reduce((s, e) => s + (e.amount || 0), 0),
    };
  });
  return NextResponse.json({ ok: true, runs, activeRunId: user.activeRunId });
}
