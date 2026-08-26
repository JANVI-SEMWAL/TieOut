import { NextResponse } from "next/server";
import { currentUser } from "../../../lib/auth.js";
import { getActiveRun } from "../../../lib/db.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = currentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not logged in." }, { status: 401 });
  const run = getActiveRun(user.id);
  return NextResponse.json({ ok: true, run: run || null, email: user.email });
}
