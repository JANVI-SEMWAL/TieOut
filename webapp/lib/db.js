// Tiny JSON-file data store — no database server needed. Holds users and saved runs.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const DB_DIR = path.join(process.cwd(), ".data");
const USERS = path.join(DB_DIR, "users.json");
const RUNS = path.join(DB_DIR, "runs.json");
// per-run CSV data lives next to the Python engine so answer.py / draft.py can read it
export const RUN_DATA_ROOT = path.resolve(process.cwd(), "..", "data", "runs");

function ensure() {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  if (!fs.existsSync(USERS)) fs.writeFileSync(USERS, "[]");
  if (!fs.existsSync(RUNS)) fs.writeFileSync(RUNS, "[]");
  if (!fs.existsSync(RUN_DATA_ROOT)) fs.mkdirSync(RUN_DATA_ROOT, { recursive: true });
}
function read(file) { ensure(); try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return []; } }
function write(file, data) { ensure(); fs.writeFileSync(file, JSON.stringify(data, null, 2)); }

// ---- users ----
export function findUserByEmail(email) {
  return read(USERS).find((u) => u.email === String(email).toLowerCase()) || null;
}
export function findUserById(id) {
  return read(USERS).find((u) => u.id === id) || null;
}
export function createUser(email, salt, hash) {
  const users = read(USERS);
  const user = { id: crypto.randomUUID(), email: String(email).toLowerCase(), salt, hash,
                 createdAt: new Date().toISOString() };
  users.push(user); write(USERS, users);
  return user;
}
export function setActiveRun(userId, runId) {
  const users = read(USERS);
  const u = users.find((x) => x.id === userId);
  if (u) { u.activeRunId = runId; write(USERS, users); }
}

// ---- runs ----
export function addRun(userId, payload, dataDir) {
  const runs = read(RUNS);
  const exceptions = (payload.exceptions || []).map((e) => ({ ...e, recovered: false, recoveredAt: null }));
  const run = {
    id: crypto.randomUUID(), userId, createdAt: new Date().toISOString(),
    summary: payload.summary, exceptions, qa: payload.qa || [], dataDir,
  };
  runs.push(run); write(RUNS, runs);
  setActiveRun(userId, run.id);
  return run;
}
export function getRun(userId, runId) {
  return read(RUNS).find((r) => r.id === runId && r.userId === userId) || null;
}
export function getActiveRun(userId) {
  const u = findUserById(userId);
  if (!u?.activeRunId) return null;
  return getRun(userId, u.activeRunId);
}
export function listRuns(userId) {
  return read(RUNS).filter((r) => r.userId === userId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
export function setRecovered(userId, runId, orderId, recovered) {
  const runs = read(RUNS);
  const run = runs.find((r) => r.id === runId && r.userId === userId);
  if (!run) return null;
  const exc = run.exceptions.find((e) => e.order_id === orderId);
  if (exc) { exc.recovered = !!recovered; exc.recoveredAt = recovered ? new Date().toISOString() : null; }
  write(RUNS, runs);
  return run;
}
