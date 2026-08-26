"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/reconcile", label: "Reconcile" },
  { href: "/exceptions", label: "Exceptions" },
  { href: "/recovery", label: "Recovery" },
  { href: "/history", label: "History" },
];

export default function NavBar({ email }) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="nav">
      <div className="nav-inner">
        <Link href="/" className="brand">Tie<span>Out</span></Link>
        <nav className="nav-links">
          {LINKS.map((l) => {
            const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
            return (
              <Link key={l.href} href={l.href} className={"nav-link" + (active ? " active" : "")}>
                {l.label}
              </Link>
            );
          })}
        </nav>
        <div className="nav-user">
          <span className="nav-email" title={email}>{email}</span>
          <button className="ghost sm" onClick={logout}>Log out</button>
        </div>
      </div>
    </header>
  );
}
