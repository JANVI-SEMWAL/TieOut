import { NextResponse } from "next/server";
import { findUserByEmail, createUser } from "../../../../lib/db.js";
import { hashPassword, makeToken, COOKIE } from "../../../../lib/auth.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const { email, password } = await request.json();
    if (!email || !password) return NextResponse.json({ ok: false, error: "Email and password required." }, { status: 400 });
    if (String(password).length < 6) return NextResponse.json({ ok: false, error: "Password must be at least 6 characters." }, { status: 400 });
    if (findUserByEmail(email)) return NextResponse.json({ ok: false, error: "An account with this email already exists — try logging in." }, { status: 409 });

    const { salt, hash } = hashPassword(password);
    const user = createUser(email, salt, hash);
    const res = NextResponse.json({ ok: true, email: user.email });
    res.cookies.set(COOKIE, makeToken(user.id), {
      httpOnly: true, sameSite: "lax", path: "/", maxAge: 7 * 24 * 60 * 60,
    });
    return res;
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}
