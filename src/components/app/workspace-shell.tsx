import Link from "next/link";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { BrandMark } from "@/components/brand-mark";
import { isAdministrator } from "@/lib/auth-policy";
import type { AuthSession } from "@/lib/server/auth";

export function WorkspaceShell({
  session,
  active,
  children,
}: {
  session: AuthSession;
  active: "vault" | "admin";
  children: React.ReactNode;
}) {
  const initials = session.user.name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return (
    <main className="workspace">
      <header className="app-nav">
        <Link href="/vault" aria-label="TrustVault workspace">
          <BrandMark />
        </Link>
        <nav aria-label="Workspace navigation">
          <Link className={active === "vault" ? "is-active" : ""} href="/vault">
            My vault
          </Link>
          {isAdministrator(session.user.role) ? (
            <Link className={active === "admin" ? "is-active" : ""} href="/admin">
              Administration
            </Link>
          ) : null}
        </nav>
        <div className="app-nav__account">
          <span className="avatar" aria-hidden="true">{initials}</span>
          <span className="app-nav__identity">
            <strong>{session.user.name}</strong>
            <small>{session.user.role === "ADMIN" ? "Administrator" : "Member"}</small>
          </span>
          <SignOutButton />
        </div>
      </header>
      {children}
    </main>
  );
}
