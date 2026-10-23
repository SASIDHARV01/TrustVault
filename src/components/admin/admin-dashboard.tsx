"use client";

import { useCallback, useEffect, useState } from "react";

import {
  apiJson,
  fetchPrivateContent,
  formatBytes,
  formatDate,
  queryString,
  readableError,
  type AuditCheckpoint,
  type AuditEvent,
  type DocumentVersion,
  type Pagination,
  type VaultDocument,
} from "@/lib/client-api";
import { ActivityList } from "@/components/vault/vault-dashboard";

type AdminView = "documents" | "activity" | "integrity";
type Verification =
  | { valid: true; eventCount: number; headHash: string }
  | { valid: false; eventCount: number; invalidEventId: string; reason: string };

export function AdminDashboard() {
  const [view, setView] = useState<AdminView>("documents");
  const [documents, setDocuments] = useState<VaultDocument[]>([]);
  const [documentPagination, setDocumentPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [eventPagination, setEventPagination] = useState<Pagination>({ page: 1, limit: 30, total: 0, totalPages: 0 });
  const [checkpoints, setCheckpoints] = useState<AuditCheckpoint[]>([]);
  const [verification, setVerification] = useState<Verification | null>(null);
  const [selected, setSelected] = useState<VaultDocument | null>(null);
  const [query, setQuery] = useState("");
  const [owner, setOwner] = useState("");
  const [category, setCategory] = useState("");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [state, setState] = useState<"ACTIVE" | "DELETED">("ACTIVE");
  const [action, setAction] = useState("");
  const [outcome, setOutcome] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const show = useCallback((kind: "success" | "error", text: string) => {
    setNotice({ kind, text });
    window.setTimeout(() => setNotice(null), 5000);
  }, []);

  const loadDocuments = useCallback(async (page = 1) => {
    const result = await apiJson<{ data: { documents: VaultDocument[]; pagination: Pagination } }>(
      `/api/documents${queryString({ q: query, owner, category, createdFrom: dateBoundary(createdFrom, false), createdTo: dateBoundary(createdTo, true), state, sort: "updatedAt", order: "desc", page, limit: 20 })}`,
    );
    setDocuments(result.data.documents); setDocumentPagination(result.data.pagination);
  }, [category, createdFrom, createdTo, owner, query, state]);

  const loadActivity = useCallback(async (page = 1) => {
    const result = await apiJson<{ data: { events: AuditEvent[]; pagination: Pagination } }>(
      `/api/admin/activity${queryString({ action, outcome, page, limit: 30 })}`,
    );
    setEvents(result.data.events); setEventPagination(result.data.pagination);
  }, [action, outcome]);

  const loadCheckpoints = useCallback(async () => {
    const result = await apiJson<{ data: { checkpoints: AuditCheckpoint[] } }>("/api/admin/audit/checkpoints");
    setCheckpoints(result.data.checkpoints);
  }, []);

  useEffect(() => {
    setLoading(true);
    const operation = view === "documents" ? loadDocuments() : view === "activity" ? loadActivity() : loadCheckpoints();
    void operation.catch((error) => show("error", readableError(error))).finally(() => setLoading(false));
  }, [loadActivity, loadCheckpoints, loadDocuments, show, view]);

  async function verify() {
    setBusy(true);
    try {
      const result = await apiJson<{ data: { verification: Verification } }>("/api/admin/audit/verify", { method: "POST" });
      setVerification(result.data.verification);
      show(result.data.verification.valid ? "success" : "error", result.data.verification.valid ? "Every stored audit link and signature is valid." : "Audit chain verification failed.");
      await loadActivity();
    } catch (error) { show("error", readableError(error)); } finally { setBusy(false); }
  }

  async function checkpoint() {
    setBusy(true);
    try {
      await apiJson("/api/admin/audit/checkpoints", { method: "POST" });
      await loadCheckpoints(); show("success", "The current verified chain head was checkpointed to private object storage.");
    } catch (error) { show("error", readableError(error)); } finally { setBusy(false); }
  }

  return (
    <>
      {notice ? <div className={`toast toast--${notice.kind}`} role="status"><span>{notice.kind === "success" ? "✓" : "!"}</span>{notice.text}</div> : null}
      <div className="admin-switcher" role="tablist">
        <button className={view === "documents" ? "is-active" : ""} onClick={() => setView("documents")} type="button"><span>01</span>Document oversight</button>
        <button className={view === "activity" ? "is-active" : ""} onClick={() => setView("activity")} type="button"><span>02</span>System activity</button>
        <button className={view === "integrity" ? "is-active" : ""} onClick={() => setView("integrity")} type="button"><span>03</span>Audit integrity</button>
      </div>

      {view === "documents" ? <section className="admin-panel"><div className="admin-panel__heading"><div><p className="card-kicker">Metadata visibility</p><h2>All authorized records</h2><p>Administrators can discover metadata, but cannot silently edit, delete, or share someone else&apos;s document.</p></div><strong>{documentPagination.total}</strong></div><div className="admin-filters"><input aria-label="Search document names" onChange={(event) => setQuery(event.target.value)} placeholder="Search document names…" type="search" value={query} /><select onChange={(event) => setState(event.target.value as "ACTIVE" | "DELETED")} value={state}><option value="ACTIVE">Active</option><option value="DELETED">Deleted</option></select></div><details className="advanced-filters advanced-filters--admin"><summary>More search filters <span>owner, category, and creation date</span></summary><div><label>Owner<input onChange={(event) => setOwner(event.target.value)} placeholder="Name or email" value={owner} /></label><label>Category<input onChange={(event) => setCategory(event.target.value)} placeholder="Category name" value={category} /></label><label>Created from<input onChange={(event) => setCreatedFrom(event.target.value)} type="date" value={createdFrom} /></label><label>Created to<input onChange={(event) => setCreatedTo(event.target.value)} type="date" value={createdTo} /></label><button className="text-button" onClick={() => { setOwner(""); setCategory(""); setCreatedFrom(""); setCreatedTo(""); }} type="button">Clear filters</button></div></details>{loading ? <div className="detail-loading">Loading metadata…</div> : <div className="admin-document-table"><div className="table-row table-row--head"><span>Document</span><span>Owner</span><span>Category</span><span>Access boundary</span><span>Updated</span></div>{documents.map((document) => <button className="table-row" key={document.id} onClick={() => setSelected(document)} type="button"><span><strong>{document.name}</strong><small>{document.state}</small></span><span><strong>{document.owner.name}</strong><small>{document.owner.email}</small></span><span>{document.category?.name ?? "—"}</span><span><i className="access-badge">Metadata only</i></span><time>{formatDate(document.updatedAt)}</time></button>)}{!documents.length ? <p className="inline-empty">No documents match this view.</p> : null}</div>}<Pager pagination={documentPagination} onPage={(page) => void loadDocuments(page)} /></section> : null}

      {view === "activity" ? <section className="admin-panel"><div className="admin-panel__heading"><div><p className="card-kicker">Append-only evidence</p><h2>System activity</h2><p>Allowed, denied, and failed security decisions across the application.</p></div><strong>{eventPagination.total}</strong></div><div className="admin-filters"><select onChange={(event) => setAction(event.target.value)} value={action}><option value="">All actions</option>{["AUTH_SIGN_IN", "DOCUMENT_CREATE", "DOCUMENT_READ", "DOCUMENT_DOWNLOAD", "DOCUMENT_UPDATE", "DOCUMENT_DELETE", "DOCUMENT_RESTORE", "DOCUMENT_UPLOAD", "PERMISSION_GRANT", "PERMISSION_REVOKE", "ADMIN_OVERRIDE_READ", "AUDIT_VERIFY", "AUDIT_CHECKPOINT_CREATE", "CATEGORY_CREATE", "CATEGORY_UPDATE", "CATEGORY_DELETE"].map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select><select onChange={(event) => setOutcome(event.target.value)} value={outcome}><option value="">All outcomes</option><option value="ALLOWED">Allowed</option><option value="DENIED">Denied</option><option value="FAILED">Failed</option></select></div>{loading ? <div className="detail-loading">Reading audit events…</div> : <ActivityList events={events} />}<Pager pagination={eventPagination} onPage={(page) => void loadActivity(page)} /></section> : null}

      {view === "integrity" ? <section className="admin-panel"><div className="integrity-grid"><article className="integrity-card"><span className="integrity-card__icon">⌁</span><p className="card-kicker">Cryptographic chain</p><h2>Verify every event</h2><p>Recomputes every HMAC signature and previous-hash link from genesis to the current head.</p><button className="button button--primary" disabled={busy} onClick={() => void verify()} type="button">{busy ? "Verifying…" : "Run full verification"}</button>{verification ? <div className={`verification-result verification-result--${verification.valid ? "valid" : "invalid"}`}><strong>{verification.valid ? "Chain valid" : "Chain invalid"}</strong><span>{verification.eventCount} events checked</span>{verification.valid ? <code>{verification.headHash}</code> : <code>{verification.invalidEventId} · {verification.reason}</code>}</div> : null}</article><article className="integrity-card"><span className="integrity-card__icon">◇</span><p className="card-kicker">External evidence</p><h2>R2 checkpoints</h2><p>Writes the verified chain head to the protected audit-checkpoints prefix in private storage.</p><button className="button button--ghost" disabled={busy} onClick={() => void checkpoint()} type="button">Create checkpoint</button><div className="checkpoint-list">{checkpoints.length ? checkpoints.map((item) => <div key={item.id}><span><strong>Through event {item.throughEventId}</strong><small>{formatDate(item.createdAt)}</small></span><code>{item.chainHash.slice(0, 16)}…</code></div>) : <p className="inline-empty">No external checkpoints yet.</p>}</div></article></div><p className="admin-guardrail"><strong>Separation of authority:</strong> administrator visibility supports incident response and compliance. Document ownership still controls editing, deletion, and sharing; content access requires a recorded reason.</p></section> : null}

      {selected ? <AdminDocumentDialog document={selected} onClose={() => setSelected(null)} show={show} /> : null}
    </>
  );
}

function dateBoundary(value: string, endOfDay: boolean) {
  if (!value) return undefined;
  return new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00"}`).toISOString();
}

function Pager({ pagination, onPage }: { pagination: Pagination; onPage: (page: number) => void }) {
  if (pagination.totalPages <= 1) return null;
  return <nav className="pagination" aria-label="Results pages"><button disabled={pagination.page <= 1} onClick={() => onPage(pagination.page - 1)} type="button">← Previous</button><span>Page {pagination.page} of {pagination.totalPages}</span><button disabled={pagination.page >= pagination.totalPages} onClick={() => onPage(pagination.page + 1)} type="button">Next →</button></nav>;
}

function AdminDocumentDialog({ document, onClose, show }: { document: VaultDocument; onClose: () => void; show: (kind: "success" | "error", text: string) => void }) {
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(true);
  useEffect(() => { void apiJson<{ data: { versions: DocumentVersion[] } }>(`/api/documents/${document.id}/versions`).then((result) => setVersions(result.data.versions)).catch((error) => show("error", readableError(error))).finally(() => setBusy(false)); }, [document.id, show]);
  async function open(version: DocumentVersion, download: boolean) {
    if (reason.trim().length < 10) return show("error", "Enter a specific override reason of at least 10 characters.");
    setBusy(true);
    try {
      const content = await fetchPrivateContent(`/api/documents/${document.id}/versions/${version.id}/content${download ? "?disposition=attachment" : ""}`, { "X-TrustVault-Override-Reason": reason.trim() });
      const url = URL.createObjectURL(content.blob); const link = window.document.createElement("a"); link.href = url;
      if (download) link.download = content.filename ?? version.originalFilename; else { link.target = "_blank"; link.rel = "noopener"; }
      link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      show("success", `Administrator ${download ? "download" : "preview"} was recorded in the audit trail.`);
    } catch (error) { show("error", readableError(error)); } finally { setBusy(false); }
  }
  return <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} role="presentation"><section aria-label={document.name} aria-modal="true" className="dialog dialog--wide" role="dialog"><header className="dialog__header"><div><p className="card-kicker">Administrator metadata view</p><h2>{document.name}</h2></div><button aria-label="Close dialog" className="dialog__close" onClick={onClose} type="button">×</button></header><div className="admin-document-detail"><div className="detail-facts"><div><span>Owner</span><strong>{document.owner.name}</strong><small>{document.owner.email}</small></div><div><span>State</span><strong>{document.state}</strong></div><div><span>Category</span><strong>{document.category?.name ?? "Uncategorized"}</strong></div><div><span>Updated</span><strong>{formatDate(document.updatedAt)}</strong></div></div><div className="override-reason"><label>Required content-access reason<textarea maxLength={500} minLength={10} onChange={(event) => setReason(event.target.value)} placeholder="Describe the incident, compliance request, or support case…" rows={3} value={reason} /></label><p>This reason is evaluated on the server and written to the immutable audit trail. It does not grant edit, delete, or sharing authority.</p></div><div className="version-list">{busy && !versions.length ? <div className="detail-loading">Loading version metadata…</div> : versions.map((version) => <article key={version.id}><span className="version-number">v{version.versionNumber}</span><div><strong>{version.originalFilename}</strong><small>{formatBytes(version.sizeBytes)} · {formatDate(version.createdAt)}</small></div><span className="row-actions"><button disabled={busy || reason.trim().length < 10} onClick={() => void open(version, false)} type="button">Override preview</button><button disabled={busy || reason.trim().length < 10} onClick={() => void open(version, true)} type="button">Override download</button></span></article>)}</div></div></section></div>;
}
