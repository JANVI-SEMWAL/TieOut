// Shared bridge to the Python reconciliation engine (src/*.py).
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";

const run = promisify(execFile);
export const PYROOT = path.resolve(process.cwd(), "..");

function py(args) {
  return run("python3", args, { cwd: PYROOT, maxBuffer: 1024 * 1024 * 32 });
}

export async function generate(dataDir, seed) {
  await py(["src/generate_data.py", "--n", "250", "--seed", String(seed), "--out", dataDir + "/"]);
}

export async function pipeline(dataDir) {
  await py(["src/pipeline.py", "--data", dataDir + "/", "--out", dataDir + "/"]);
  const raw = await fs.readFile(path.join(dataDir, "results.json"), "utf8");
  return JSON.parse(raw);
}

export async function ask(dataDir, question) {
  const { stdout } = await py(["src/answer.py", question, dataDir + "/"]);
  return JSON.parse(stdout);
}

export async function draft(dataDir, order) {
  const { stdout } = await py(["src/draft.py", dataDir + "/", order || "all"]);
  return JSON.parse(stdout);
}
