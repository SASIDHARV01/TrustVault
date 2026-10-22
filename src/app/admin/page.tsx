import type { Metadata } from "next";

import { WorkspaceShell } from "@/components/app/workspace-shell";
import { requireAdministrator } from "@/lib/server/session";

export const metadata: Metadata = { title: "Administration" };

const capabilities = [
  ["User oversight", "Account management and disabling arrive with the administration phase."],
  ["Document visibility", "Administrators will see metadata; content needs an explicit reason-bearing override."],
  ["Audit verification", "System activity and chain verification will live here after the audit phase."],
];

export default async function AdminPage() {
  const session = await requireAdministrator("/admin");

  return (
    <WorkspaceShell active="admin" session={session}>
      <section className="workspace-body shell">
        <div className="workspace-heading">
          <div>
            <p className="eyebrow"><span /> Administrator boundary</p>
            <h1>Administration</h1>
            <p>
              This route checks the active database session and the trusted
              ADMIN role on the server before rendering.
            </p>
          </div>
          <span className="role-chip">Admin only</span>
        </div>

        <div className="admin-capabilities">
          {capabilities.map(([title, description], index) => (
            <article key={title}>
              <span>0{index + 1}</span>
              <h2>{title}</h2>
              <p>{description}</p>
            </article>
          ))}
        </div>

        <p className="admin-guardrail">
          <strong>Important guardrail:</strong> Administrator status will not silently
          grant document edit, delete, or sharing permissions. Viewing confidential
          content will require a recorded reason and a dedicated audited action.
        </p>
      </section>
    </WorkspaceShell>
  );
}
