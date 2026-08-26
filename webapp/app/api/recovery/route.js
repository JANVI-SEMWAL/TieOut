import { NextResponse } from "next/server";
import { currentUser } from "../../../lib/auth.js";
import { setRecovered } from "../../../lib/db.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  const user = currentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not logged in." }, { status: 401 });
  try {
    const { runId, orderId, recovered } = await request.json();
    const run = setRecovered(user.id, runId, orderId, recovered);
    if (!run) return NextResponse.json({ ok: false, error: "Run not found." }, { status: 404 });
    const rec = run.exceptions.filter((e) => e.recovered);
    return NextResponse.json({
      ok: true,
      recovered_count: rec.length,
      recovered_amount: rec.reduce((s, e) => s + (e.amount || 0), 0),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}
