import type { Metadata } from "next";
import Link from "next/link";

import { WorkspaceShell } from "@/components/app/workspace-shell";
import { isAdministrator } from "@/lib/auth-policy";
import { requireSession } from "@/lib/server/session";

export const metadata: Metadata = { title: "My vault" };

export default async function VaultPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const session = await requireSession("/vault");
  const notice = (await searchParams).notice;

  return (
    <WorkspaceShell active="vault" session={session}>
      <section className="workspace-body shell">
        {notice === "admin-required" ? (
          <p className="workspace-notice" role="status">
            Administrator access is required for that area. Your vault access is unchanged.
          </p>
        ) : null}

        <div className="workspace-heading">
          <div>
            <p className="eyebrow"><span /> Authenticated workspace</p>
            <h1>Good to see you, {session.user.name.split(" ")[0]}.</h1>
            <p>
              Your identity was checked against the active PostgreSQL session
              before this page was rendered.
            </p>
          </div>
          <span className="session-chip"><i /> Session active</span>
        </div>

        <div className="workspace-grid">
          <article className="empty-vault-card">
            <span className="empty-vault-card__icon" aria-hidden="true">□</span>
            <p className="card-kicker">Document workspace</p>
            <h2>Your protected vault is ready.</h2>
            <p>
              Uploads, categories, and document permissions arrive in the next
              implementation phases. Authentication is now guarding the boundary.
            </p>
            <button className="button button--primary" disabled type="button">
              Upload arrives in Phase 4
            </button>
          </article>

          <aside className="security-summary">
            <p className="card-kicker">Current security context</p>
            <dl>
              <div><dt>Identity</dt><dd>{session.user.email}</dd></div>
              <div><dt>System role</dt><dd>{session.user.role}</dd></div>
              <div><dt>Session expiry</dt><dd>{new Date(session.session.expiresAt).toLocaleDateString("en-IN")}</dd></div>
              <div><dt>Cache policy</dt><dd>Database validated</dd></div>
            </dl>
            {isAdministrator(session.user.role) ? (
              <Link className="text-link" href="/admin">Open administration →</Link>
            ) : (
              <p className="security-summary__note">
                Document permissions will be evaluated separately from this system role.
              </p>
            )}
          </aside>
        </div>
      </section>
    </WorkspaceShell>
  );
}
