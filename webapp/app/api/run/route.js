import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const run = promisify(execFile);

// python project root is the parent of the Next.js app (webapp/)
const PYROOT = path.resolve(process.cwd(), "..");
const WORK = path.join(PYROOT, "data", "web");

async function py(args) {
  return run("python3", args, { cwd: PYROOT, maxBuffer: 1024 * 1024 * 16 });
}

export async function POST(request) {
  try {
    await fs.mkdir(WORK, { recursive: true });

    let usedUpload = false;
    // multipart upload path (three CSVs)
    const ctype = request.headers.get("content-type") || "";
    if (ctype.includes("multipart/form-data")) {
      const form = await request.formData();
      const names = { orders: "orders.csv", settlements: "settlements.csv", bank: "bank.csv" };
      const got = [];
      for (const [key, fname] of Object.entries(names)) {
        const f = form.get(key);
        if (f && typeof f.arrayBuffer === "function") {
          const buf = Buffer.from(await f.arrayBuffer());
          await fs.writeFile(path.join(WORK, fname), buf);
          got.push(key);
        }
      }
      if (got.length === 3) {
        usedUpload = true;
        // uploaded data has no ground truth -> remove any stale one so metrics are skipped
        await fs.rm(path.join(WORK, "ground_truth.csv"), { force: true });
      }
    }

    if (!usedUpload) {
      // generate a fresh synthetic batch (varying seed for variety)
      const seed = String((Date.now() % 90000) + 1000);
      await py(["src/generate_data.py", "--n", "250", "--seed", seed, "--out", WORK + "/"]);
    }

    // run the full reconciliation pipeline
    await py(["src/pipeline.py", "--data", WORK + "/", "--out", WORK + "/"]);

    const raw = await fs.readFile(path.join(WORK, "results.json"), "utf8");
    const data = JSON.parse(raw);
    return NextResponse.json({ ok: true, usedUpload, ...data });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err?.stderr || err?.message || err) },
      { status: 500 }
    );
  }
}
