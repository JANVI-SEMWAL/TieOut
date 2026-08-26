import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { currentUser } from "../../../lib/auth.js";
import { addRun, RUN_DATA_ROOT } from "../../../lib/db.js";
import { generate, pipeline } from "../../../lib/pyengine.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  const user = currentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not logged in." }, { status: 401 });

  try {
    const dataDir = path.join(RUN_DATA_ROOT, crypto.randomUUID());
    await fs.mkdir(dataDir, { recursive: true });

    let usedUpload = false;
    const ctype = request.headers.get("content-type") || "";
    if (ctype.includes("multipart/form-data")) {
      const form = await request.formData();
      const names = { orders: "orders.csv", settlements: "settlements.csv", bank: "bank.csv" };
      let got = 0;
      for (const [key, fname] of Object.entries(names)) {
        const f = form.get(key);
        if (f && typeof f.arrayBuffer === "function") {
          await fs.writeFile(path.join(dataDir, fname), Buffer.from(await f.arrayBuffer()));
          got++;
        }
      }
      usedUpload = got === 3;
    }

    if (!usedUpload) await generate(dataDir, (Date.now() % 90000) + 1000);
    const results = await pipeline(dataDir);

    const run = addRun(user.id, results, dataDir);
    return NextResponse.json({ ok: true, runId: run.id, usedUpload, ...results });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err?.stderr || err?.message || err) }, { status: 500 });
  }
}
