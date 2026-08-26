"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function Signup() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Sign up failed");
      router.push("/"); router.refresh();
    } catch (e) { setError(String(e.message || e)); setBusy(false); }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="brand big">Tie<span>Out</span></div>
        <p className="auth-tag">Settlement reconciliation, end to end.</p>
        <h1 className="auth-h">Create your account</h1>
        <form onSubmit={submit}>
          <label className="fld">Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required />
          </label>
          <label className="fld">Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="at least 6 characters" required />
          </label>
          {error && <div className="err">{error}</div>}
          <button className="primary wide" type="submit" disabled={busy}>{busy ? "Creating…" : "Sign up"}</button>
        </form>
        <p className="auth-alt">Already have an account? <Link href="/login">Log in</Link></p>
      </div>
    </div>
  );
}
