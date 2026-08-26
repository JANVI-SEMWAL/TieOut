import { redirect } from "next/navigation";
import { currentUser } from "../../lib/auth.js";
import NavBar from "../../components/NavBar.js";

export const dynamic = "force-dynamic";

export default function AppLayout({ children }) {
  const user = currentUser();
  if (!user) redirect("/login");
  return (
    <>
      <NavBar email={user.email} />
      <div className="app-main">{children}</div>
    </>
  );
}
