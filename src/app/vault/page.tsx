import type { Metadata } from "next";

import { WorkspaceShell } from "@/components/app/workspace-shell";
import { VaultDashboard } from "@/components/vault/vault-dashboard";
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

        <div className="workspace-heading workspace-heading--dashboard">
          <div>
            <p className="eyebrow"><span /> Private document workspace</p>
            <h1>Your secure vault</h1>
            <p>
              Organize, share, and inspect confidential files. Every request is
              authorized against the latest permissions and recorded for accountability.
            </p>
          </div>
          <span className="session-chip"><i /> Protected session</span>
        </div>
        <VaultDashboard userId={session.user.id} />
      </section>
    </WorkspaceShell>
  );
}
