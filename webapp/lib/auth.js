// Password hashing (scrypt) + signed session cookie — all with Node's built-in crypto.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { cookies } from "next/headers";
import { findUserById } from "./db.js";

export const COOKIE = "tieout_session";
const DB_DIR = path.join(process.cwd(), ".data");

function secret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  const f = path.join(DB_DIR, "secret");
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString("hex"));
  return fs.readFileSync(f, "utf8");
}

// ---- passwords ----
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}
export function verifyPassword(password, salt, hash) {
  const h = crypto.scryptSync(password, salt, 64).toString("hex");
  try { return crypto.timingSafeEqual(Buffer.from(h), Buffer.from(hash)); } catch { return false; }
}

// ---- sessions (token = base64(payload).signature) ----
export function makeToken(userId) {
  const payload = Buffer.from(JSON.stringify({ uid: userId, exp: Date.now() + 7 * 864e5 })).toString("base64url");
  const sig = crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}
export function readToken(token) {
  if (!token || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch { return null; }
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!data.exp || data.exp < Date.now()) return null;
    return data.uid;
  } catch { return null; }
}

// current user from the request cookies (server components + route handlers)
export function currentUser() {
  const token = cookies().get(COOKIE)?.value;
  const uid = readToken(token);
  if (!uid) return null;
  const u = findUserById(uid);
  if (!u) return null;
  return { id: u.id, email: u.email, activeRunId: u.activeRunId || null };
}
