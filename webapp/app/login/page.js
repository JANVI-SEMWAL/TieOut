"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(body) {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Login failed");
      router.push("/"); router.refresh();
    } catch (e) { setError(String(e.message || e)); setBusy(false); }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="brand big">Tie<span>Out</span></div>
        <p className="auth-tag">Settlement reconciliation, end to end.</p>
        <h1 className="auth-h">Log in</h1>
        <form onSubmit={(e) => { e.preventDefault(); submit({ email, password }); }}>
          <label className="fld">Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required />
          </label>
          <label className="fld">Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required />
          </label>
          {error && <div className="err">{error}</div>}
          <button className="primary wide" type="submit" disabled={busy}>{busy ? "Logging in…" : "Log in"}</button>
        </form>
        <button className="ghost wide" onClick={() => submit({ guest: true })} disabled={busy}>Continue as guest</button>
        <p className="auth-alt">New here? <Link href="/signup">Create an account</Link></p>
      </div>
    </div>
  );
}
