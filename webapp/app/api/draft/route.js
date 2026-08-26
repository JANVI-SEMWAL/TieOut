import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const run = promisify(execFile);
const PYROOT = path.resolve(process.cwd(), "..");
const WORK = path.join(PYROOT, "data", "web");

export async function POST(request) {
  try {
    const { order } = await request.json().catch(() => ({}));
    try {
      await fs.access(path.join(WORK, "orders.csv"));
    } catch {
      return NextResponse.json({ ok: false, error: "Run a reconciliation first." }, { status: 400 });
    }
    const target = order && String(order).trim() ? String(order).trim() : "all";
    const { stdout } = await run(
      "python3",
      ["src/draft.py", WORK + "/", target],
      { cwd: PYROOT, maxBuffer: 1024 * 1024 * 32 }
    );
    const data = JSON.parse(stdout);
    return NextResponse.json({ ok: true, ...data });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err?.stderr || err?.message || err) },
      { status: 500 }
    );
  }
}
