import { NextResponse } from "next/server";
import { currentUser } from "../../../../lib/auth.js";
import { getRun, setActiveRun } from "../../../../lib/db.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET a single run; ?activate=1 also makes it the user's active run
export async function GET(request, { params }) {
  const user = currentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not logged in." }, { status: 401 });
  const run = getRun(user.id, params.id);
  if (!run) return NextResponse.json({ ok: false, error: "Run not found." }, { status: 404 });
  const { searchParams } = new URL(request.url);
  if (searchParams.get("activate") === "1") setActiveRun(user.id, run.id);
  return NextResponse.json({ ok: true, run });
}
