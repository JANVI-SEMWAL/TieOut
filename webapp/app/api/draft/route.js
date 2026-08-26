import { NextResponse } from "next/server";
import { currentUser } from "../../../lib/auth.js";
import { getRun, getActiveRun } from "../../../lib/db.js";
import { draft } from "../../../lib/pyengine.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  const user = currentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not logged in." }, { status: 401 });
  try {
    const { order, runId } = await request.json().catch(() => ({}));
    const run = runId ? getRun(user.id, runId) : getActiveRun(user.id);
    if (!run) return NextResponse.json({ ok: false, error: "Run a reconciliation first." }, { status: 400 });
    const data = await draft(run.dataDir, order && String(order).trim() ? String(order).trim() : "all");
    return NextResponse.json({ ok: true, ...data });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err?.stderr || err?.message || err) }, { status: 500 });
  }
}
