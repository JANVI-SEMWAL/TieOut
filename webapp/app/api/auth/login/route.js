import { NextResponse } from "next/server";
import { findUserByEmail, createUser } from "../../../../lib/db.js";
import { verifyPassword, hashPassword, makeToken, COOKIE } from "../../../../lib/auth.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GUEST_EMAIL = "guest@tieout.local";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));

    // "Continue as guest" — instant access for a quick demo, no signup
    if (body.guest) {
      let user = findUserByEmail(GUEST_EMAIL);
      if (!user) { const { salt, hash } = hashPassword("guest-" + Date.now()); user = createUser(GUEST_EMAIL, salt, hash); }
      const res = NextResponse.json({ ok: true, email: user.email, guest: true });
      res.cookies.set(COOKIE, makeToken(user.id), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 7 * 24 * 60 * 60 });
      return res;
    }

    const { email, password } = body;
    const user = findUserByEmail(email || "");
    if (!user || !verifyPassword(password || "", user.salt, user.hash)) {
      return NextResponse.json({ ok: false, error: "Wrong email or password." }, { status: 401 });
    }
    const res = NextResponse.json({ ok: true, email: user.email });
    res.cookies.set(COOKIE, makeToken(user.id), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 7 * 24 * 60 * 60 });
    return res;
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}
