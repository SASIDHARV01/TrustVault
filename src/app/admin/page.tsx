import type { Metadata } from "next";

import { AdminDashboard } from "@/components/admin/admin-dashboard";
import { WorkspaceShell } from "@/components/app/workspace-shell";
import { requireAdministrator } from "@/lib/server/session";

export const metadata: Metadata = { title: "Administration" };

export default async function AdminPage() {
  const session = await requireAdministrator("/admin");

  return (
    <WorkspaceShell active="admin" session={session}>
      <section className="workspace-body shell">
        <div className="workspace-heading workspace-heading--dashboard">
          <div>
            <p className="eyebrow"><span /> Security operations</p>
            <h1>Control room</h1>
            <p>
              Investigate document metadata, inspect system-wide decisions, and
              verify the tamper-evident audit chain without bypassing owner controls.
            </p>
          </div>
          <span className="role-chip">Administrator only</span>
        </div>
        <AdminDashboard />
      </section>
    </WorkspaceShell>
  );
}
