"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  apiJson,
  fetchPrivateContent,
  formatBytes,
  formatDate,
  queryString,
  readableError,
  type AuditEvent,
  type Category,
  type DocumentGrant,
  type DocumentVersion,
  type Pagination,
  type VaultDocument,
} from "@/lib/client-api";

type DocumentListResponse = {
  data: { documents: VaultDocument[]; pagination: Pagination };
};

type DetailSection = "overview" | "versions" | "sharing" | "activity";

const emptyPagination: Pagination = { page: 1, limit: 12, total: 0, totalPages: 0 };

function useNotice() {
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const show = useCallback((kind: "success" | "error", text: string) => {
    setNotice({ kind, text });
    window.setTimeout(() => setNotice(null), 5000);
  }, []);
  return { notice, show };
}

function useDebouncedValue<T>(value: T, delayMilliseconds = 350) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timeoutId = window.setTimeout(
      () => setDebouncedValue(value),
      delayMilliseconds,
    );
    return () => window.clearTimeout(timeoutId);
  }, [delayMilliseconds, value]);

  return debouncedValue;
}

export function VaultDashboard({ userId }: { userId: string }) {
  const [documents, setDocuments] = useState<VaultDocument[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [pagination, setPagination] = useState(emptyPagination);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [owner, setOwner] = useState("");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [state, setState] = useState<"ACTIVE" | "DELETED">("ACTIVE");
  const [sort, setSort] = useState("updatedAt");
  const [page, setPage] = useState(1);
  const [showUpload, setShowUpload] = useState(false);
  const [showCategories, setShowCategories] = useState(false);
  const [selected, setSelected] = useState<VaultDocument | null>(null);
  const { notice, show } = useNotice();
  const debouncedQuery = useDebouncedValue(query);
  const debouncedCategoryName = useDebouncedValue(categoryName);
  const debouncedOwner = useDebouncedValue(owner);

  const loadCategories = useCallback(async () => {
    const result = await apiJson<{ data: { categories: Category[] } }>("/api/categories");
    setCategories(result.data.categories);
  }, []);

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    try {
      const result = await apiJson<DocumentListResponse>(
        `/api/documents${queryString({
          q: debouncedQuery,
          categoryId,
          category: debouncedCategoryName,
          owner: debouncedOwner,
          createdFrom: dateBoundary(createdFrom, false),
          createdTo: dateBoundary(createdTo, true),
          state,
          sort,
          order: sort === "name" ? "asc" : "desc",
          page,
          limit: 12,
        })}`,
      );
      setDocuments(result.data.documents);
      setPagination(result.data.pagination);
    } catch (error) {
      show("error", readableError(error));
    } finally {
      setLoading(false);
    }
  }, [categoryId, createdFrom, createdTo, debouncedCategoryName, debouncedOwner, debouncedQuery, page, show, sort, state]);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  useEffect(() => {
    void loadCategories().catch((error) => show("error", readableError(error)));
  }, [loadCategories, show]);

  const owned = useMemo(
    () => documents.filter((document) => document.access === "OWNER").length,
    [documents],
  );

  function refresh() {
    void Promise.all([loadDocuments(), loadCategories()]);
  }

  return (
    <>
      {notice ? (
        <div className={`toast toast--${notice.kind}`} role="status">
          <span>{notice.kind === "success" ? "✓" : "!"}</span>{notice.text}
        </div>
      ) : null}

      <div className="vault-stats" aria-label="Document summary">
        <article><span>Visible documents</span><strong>{pagination.total}</strong><small>Authorized results only</small></article>
        <article><span>Owned on this page</span><strong>{owned}</strong><small>You control sharing</small></article>
        <article><span>Categories</span><strong>{categories.length}</strong><small>Private to your account</small></article>
      </div>

      <div className="vault-toolbar">
        <label className="search-field">
          <span aria-hidden="true">⌕</span>
          <input
            aria-label="Search documents"
            onChange={(event) => { setQuery(event.target.value); setPage(1); }}
            placeholder="Search by document name…"
            type="search"
            value={query}
          />
        </label>
        <select aria-label="Filter by category" onChange={(event) => { setCategoryId(event.target.value); setPage(1); }} value={categoryId}>
          <option value="">All categories</option>
          {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
        <select aria-label="Document state" onChange={(event) => { setState(event.target.value as "ACTIVE" | "DELETED"); setPage(1); }} value={state}>
          <option value="ACTIVE">Active documents</option>
          <option value="DELETED">Trash</option>
        </select>
        <select aria-label="Sort documents" onChange={(event) => { setSort(event.target.value); setPage(1); }} value={sort}>
          <option value="updatedAt">Recently updated</option>
          <option value="createdAt">Recently created</option>
          <option value="name">Name A–Z</option>
        </select>
        <button className="icon-button" onClick={() => setShowCategories(true)} type="button">Categories</button>
        <button className="button button--primary vault-upload-button" onClick={() => setShowUpload(true)} type="button">＋ Upload document</button>
      </div>
      <details className="advanced-filters">
        <summary>More search filters <span>owner, category name, and creation date</span></summary>
        <div>
          <label>Owner name or email<input onChange={(event) => { setOwner(event.target.value); setPage(1); }} placeholder="Search authorized owners…" value={owner} /></label>
          <label>Category name<input onChange={(event) => { setCategoryName(event.target.value); setPage(1); }} placeholder="Search category names…" value={categoryName} /></label>
          <label>Created from<input onChange={(event) => { setCreatedFrom(event.target.value); setPage(1); }} type="date" value={createdFrom} /></label>
          <label>Created to<input onChange={(event) => { setCreatedTo(event.target.value); setPage(1); }} type="date" value={createdTo} /></label>
          <button className="text-button" onClick={() => { setOwner(""); setCategoryName(""); setCreatedFrom(""); setCreatedTo(""); setCategoryId(""); setPage(1); }} type="button">Clear filters</button>
        </div>
      </details>

      <section className="documents-panel" aria-busy={loading}>
        <div className="panel-heading">
          <div><p className="card-kicker">Secure workspace</p><h2>{state === "ACTIVE" ? "Your documents" : "Deleted documents"}</h2></div>
          <span>{pagination.total} result{pagination.total === 1 ? "" : "s"}</span>
        </div>

        {loading ? (
          <div className="document-grid" aria-label="Loading documents">
            {[1, 2, 3, 4].map((item) => <div className="document-tile document-tile--loading" key={item} />)}
          </div>
        ) : documents.length ? (
          <div className="document-grid">
            {documents.map((document) => (
              <button className="document-tile" key={document.id} onClick={() => setSelected(document)} type="button">
                <span className="document-tile__icon" aria-hidden="true">{document.state === "DELETED" ? "×" : "▤"}</span>
                <span className="access-badge">{document.access.replace("_", " ")}</span>
                <strong>{document.name}</strong>
                <small>{document.category?.name ?? "Uncategorized"}</small>
                <span className="document-tile__meta"><span>{document.owner.id === userId ? "You" : document.owner.name}</span><time>{formatDate(document.updatedAt)}</time></span>
              </button>
            ))}
          </div>
        ) : (
          <div className="panel-empty">
            <span aria-hidden="true">□</span>
            <h3>{state === "DELETED" ? "Your trash is empty." : "No documents match this view."}</h3>
            <p>{state === "DELETED" ? "Deleted documents you own can be restored from here." : "Try another filter or upload your first protected document."}</p>
            {state === "ACTIVE" ? <button className="button button--primary" onClick={() => setShowUpload(true)} type="button">Upload a document</button> : null}
          </div>
        )}

        {pagination.totalPages > 1 ? (
          <nav className="pagination" aria-label="Document pages">
            <button disabled={page <= 1} onClick={() => setPage((value) => value - 1)} type="button">← Previous</button>
            <span>Page {page} of {pagination.totalPages}</span>
            <button disabled={page >= pagination.totalPages} onClick={() => setPage((value) => value + 1)} type="button">Next →</button>
          </nav>
        ) : null}
      </section>

      {showUpload ? (
        <UploadDialog
          categories={categories}
          onClose={() => setShowUpload(false)}
          onCreated={(document, message) => {
            setShowUpload(false);
            setCategories((current) => current.map((category) =>
              category.id === document.category?.id
                ? { ...category, activeDocumentCount: category.activeDocumentCount + 1 }
                : category,
            ));
            show("success", message);
            void loadDocuments();
          }}
        />
      ) : null}
      {showCategories ? (
        <CategoryDialog
          categories={categories}
          onClose={() => setShowCategories(false)}
          onChanged={() => { void loadCategories(); void loadDocuments(); }}
          show={show}
        />
      ) : null}
      {selected ? (
        <DocumentDialog
          categories={categories}
          document={selected}
          onClose={() => setSelected(null)}
          onChanged={(updated, message) => {
            setSelected(updated);
            setDocuments((current) => current.map((document) =>
              document.id === updated.id ? updated : document,
            ));
            show("success", message);
            void loadDocuments();
          }}
          onRemoved={(message) => { setSelected(null); show("success", message); refresh(); }}
          show={show}
        />
      ) : null}
    </>
  );
}

function dateBoundary(value: string, endOfDay: boolean) {
  if (!value) return undefined;
  return new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00"}`).toISOString();
}

function DialogFrame({ title, subtitle, onClose, children, wide = false }: {
  title: string;
  subtitle: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} role="presentation">
      <section aria-label={title} aria-modal="true" className={`dialog${wide ? " dialog--wide" : ""}`} role="dialog">
        <header className="dialog__header"><div><p className="card-kicker">{subtitle}</p><h2>{title}</h2></div><button aria-label="Close dialog" className="dialog__close" onClick={onClose} type="button">×</button></header>
        {children}
      </section>
    </div>
  );
}

function UploadDialog({ categories, onClose, onCreated }: {
  categories: Category[];
  onClose: () => void;
  onCreated: (document: VaultDocument, message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) return setError("Choose a PDF, PNG, or JPEG file.");
    setBusy(true);
    setError("");
    let documentId: string | null = null;
    try {
      const created = await apiJson<{ data: { document: VaultDocument } }>("/api/documents", {
        method: "POST",
        body: JSON.stringify({
          name: String(form.get("name") ?? ""),
          description: String(form.get("description") ?? "").trim() || null,
          categoryId: String(form.get("categoryId") ?? "") || null,
        }),
      });
      documentId = created.data.document.id;
      const upload = new FormData();
      upload.set("file", file);
      await apiJson(`/api/documents/${documentId}/versions`, { method: "POST", body: upload });
      onCreated(
        created.data.document,
        "Document and its first immutable version were uploaded.",
      );
    } catch (caught) {
      setError(documentId ? `The document record was created, but the file upload failed. Open it and retry. ${readableError(caught)}` : readableError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogFrame onClose={onClose} subtitle="Private storage" title="Upload a document">
      <form className="dialog-form" onSubmit={submit}>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <label>Document name<input maxLength={255} name="name" placeholder="e.g. Employment agreement" required /></label>
        <label>Description<textarea maxLength={1000} name="description" placeholder="Optional context for authorized viewers" rows={3} /></label>
        <label>Category<select name="categoryId"><option value="">Uncategorized</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
        <label className="file-drop">File<input accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" name="file" required type="file" /><small>PDF, PNG or JPEG · maximum 10 MB · verified by content signature</small></label>
        <div className="dialog-actions"><button className="button button--ghost" onClick={onClose} type="button">Cancel</button><button className="button button--primary" disabled={busy} type="submit">{busy ? "Securing upload…" : "Create and upload"}</button></div>
      </form>
    </DialogFrame>
  );
}

function CategoryDialog({ categories, onClose, onChanged, show }: {
  categories: Category[];
  onClose: () => void;
  onChanged: () => void;
  show: (kind: "success" | "error", text: string) => void;
}) {
  const [name, setName] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    try {
      await apiJson("/api/categories", { method: "POST", body: JSON.stringify({ name }) });
      setName(""); onChanged(); show("success", "Category created.");
    } catch (error) { show("error", readableError(error)); }
  }

  async function rename(category: Category) {
    const next = window.prompt("Rename category", category.name)?.trim();
    if (!next || next === category.name) return;
    setBusyId(category.id);
    try {
      await apiJson(`/api/categories/${category.id}`, { method: "PATCH", body: JSON.stringify({ name: next }) });
      onChanged(); show("success", "Category renamed.");
    } catch (error) { show("error", readableError(error)); } finally { setBusyId(null); }
  }

  async function remove(category: Category) {
    if (!window.confirm(`Delete “${category.name}”? Its documents will become uncategorized.`)) return;
    setBusyId(category.id);
    try {
      await apiJson(`/api/categories/${category.id}`, { method: "DELETE" });
      onChanged(); show("success", "Category deleted; documents were kept safely.");
    } catch (error) { show("error", readableError(error)); } finally { setBusyId(null); }
  }

  return (
    <DialogFrame onClose={onClose} subtitle="Personal organization" title="Manage categories">
      <form className="category-create" onSubmit={create}><input maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="New category name" required value={name} /><button className="button button--primary" type="submit">Add</button></form>
      <div className="category-list">
        {categories.length ? categories.map((category) => (
          <div key={category.id}><span><strong>{category.name}</strong><small>{category.activeDocumentCount} active document{category.activeDocumentCount === 1 ? "" : "s"}</small></span><span><button disabled={busyId === category.id} onClick={() => void rename(category)} type="button">Rename</button><button className="danger-link" disabled={busyId === category.id} onClick={() => void remove(category)} type="button">Delete</button></span></div>
        )) : <p className="inline-empty">No categories yet.</p>}
      </div>
    </DialogFrame>
  );
}

function DocumentDialog({ document: initial, categories, onClose, onChanged, onRemoved, show }: {
  document: VaultDocument;
  categories: Category[];
  onClose: () => void;
  onChanged: (document: VaultDocument, message: string) => void;
  onRemoved: (message: string) => void;
  show: (kind: "success" | "error", text: string) => void;
}) {
  const [document, setDocument] = useState(initial);
  const [section, setSection] = useState<DetailSection>("overview");
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [grants, setGrants] = useState<DocumentGrant[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loadedSections, setLoadedSections] = useState<Set<DetailSection>>(
    () => new Set(["overview"]),
  );
  const [loadingSection, setLoadingSection] = useState<DetailSection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const markSectionLoaded = useCallback((loadedSection: DetailSection) => {
    setLoadedSections((current) => new Set(current).add(loadedSection));
  }, []);

  const loadVersions = useCallback(async () => {
    setLoadingSection("versions"); setError("");
    try {
      const versionResult = await apiJson<{ data: { versions: DocumentVersion[] } }>(
        `/api/documents/${document.id}/versions`,
      );
      setVersions(versionResult.data.versions);
      markSectionLoaded("versions");
    } catch (caught) { setError(readableError(caught)); } finally {
      setLoadingSection((current) => current === "versions" ? null : current);
    }
  }, [document.id, markSectionLoaded]);

  const loadGrants = useCallback(async () => {
    setLoadingSection("sharing"); setError("");
    try {
      const grantResult = await apiJson<{ data: { grants: DocumentGrant[] } }>(
        `/api/documents/${document.id}/grants`,
      );
      setGrants(grantResult.data.grants);
      markSectionLoaded("sharing");
    } catch (caught) { setError(readableError(caught)); } finally {
      setLoadingSection((current) => current === "sharing" ? null : current);
    }
  }, [document.id, markSectionLoaded]);

  const loadActivity = useCallback(async () => {
    setLoadingSection("activity"); setError("");
    try {
      const activityResult = await apiJson<{ data: { events: AuditEvent[] } }>(
        `/api/documents/${document.id}/activity?limit=30`,
      );
      setEvents(activityResult.data.events);
      markSectionLoaded("activity");
    } catch (caught) { setError(readableError(caught)); } finally {
      setLoadingSection((current) => current === "activity" ? null : current);
    }
  }, [document.id, markSectionLoaded]);

  useEffect(() => {
    if (loadedSections.has(section)) return;
    if (section === "versions") void loadVersions();
    if (section === "sharing") void loadGrants();
    if (section === "activity") void loadActivity();
  }, [loadActivity, loadGrants, loadedSections, loadVersions, section]);

  function invalidateActivity() {
    setLoadedSections((current) => {
      const next = new Set(current);
      next.delete("activity");
      return next;
    });
  }

  function applyGrantChange(nextGrant: DocumentGrant) {
    setGrants((current) => {
      if (nextGrant.status === "REVOKED") {
        return current.map((grant) => grant.id === nextGrant.id ? nextGrant : grant);
      }
      return [
        nextGrant,
        ...current.filter((grant) =>
          grant.id !== nextGrant.id &&
          !(grant.status === "ACTIVE" && grant.recipient.id === nextGrant.recipient.id),
        ),
      ];
    });
    invalidateActivity();
  }

  async function update(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await apiJson<{ data: { document: VaultDocument } }>(`/api/documents/${document.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: String(form.get("name")), description: String(form.get("description") ?? "").trim() || null, ...(document.access === "OWNER" ? { categoryId: String(form.get("categoryId") ?? "") || null } : {}) }),
      });
      setDocument(result.data.document); onChanged(result.data.document, "Document details updated.");
    } catch (caught) { setError(readableError(caught)); } finally { setBusy(false); }
  }

  async function uploadVersion(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const result = await apiJson<{ data: { version: DocumentVersion } }>(
        `/api/documents/${document.id}/versions`,
        { method: "POST", body: form },
      );
      setVersions((current) => [
        result.data.version,
        ...current.filter((version) => version.id !== result.data.version.id),
      ]);
      formElement.reset(); invalidateActivity();
      show("success", "A new immutable version was uploaded.");
    } catch (caught) { setError(readableError(caught)); } finally { setBusy(false); }
  }

  async function openContent(version: DocumentVersion, download: boolean) {
    setBusy(true); setError("");
    try {
      const path = `/api/documents/${document.id}/versions/${version.id}/content${download ? "?disposition=attachment" : ""}`;
      const content = await fetchPrivateContent(path);
      const url = URL.createObjectURL(content.blob);
      const link = window.document.createElement("a");
      link.href = url;
      if (download) link.download = content.filename ?? version.originalFilename;
      else { link.target = "_blank"; link.rel = "noopener"; }
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (caught) { setError(readableError(caught)); } finally { setBusy(false); }
  }

  async function removeOrRestore() {
    const restoring = document.state === "DELETED";
    if (!restoring && !window.confirm(`Move “${document.name}” to trash? Existing shares stop immediately.`)) return;
    setBusy(true);
    try {
      const result = await apiJson<{ data: { document: VaultDocument } }>(`/api/documents/${document.id}${restoring ? "/restore" : ""}`, { method: restoring ? "POST" : "DELETE" });
      onRemoved(restoring ? "Document restored." : "Document moved to trash and shared access was suspended.");
      setDocument(result.data.document);
    } catch (caught) { setError(readableError(caught)); } finally { setBusy(false); }
  }

  return (
    <DialogFrame onClose={onClose} subtitle={`${document.access.replace("_", " ")} access`} title={document.name} wide>
      <div className="detail-tabs" role="tablist">
        {(["overview", "versions", ...(document.access === "OWNER" ? ["sharing", "activity"] : [])] as DetailSection[]).map((tab) => <button className={section === tab ? "is-active" : ""} key={tab} onClick={() => setSection(tab)} role="tab" type="button">{tab}</button>)}
      </div>
      {error ? <p className="form-error detail-error" role="alert">{error}</p> : null}
      {loadingSection === section ? <div className="detail-loading">Loading authorized document details…</div> : null}
      {section === "overview" ? (
        <form className="dialog-form detail-overview" onSubmit={update}>
          <div className="detail-facts"><div><span>Owner</span><strong>{document.owner.name}</strong><small>{document.owner.email}</small></div><div><span>Created</span><strong>{formatDate(document.createdAt)}</strong></div><div><span>Status</span><strong>{document.state}</strong></div></div>
          {document.access === "OWNER" || document.access === "EDIT" ? <><label>Document name<input defaultValue={document.name} maxLength={255} name="name" required /></label><label>Description<textarea defaultValue={document.description ?? ""} maxLength={1000} name="description" rows={3} /></label>{document.access === "OWNER" ? <label>Category<select defaultValue={document.category?.id ?? ""} name="categoryId"><option value="">Uncategorized</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label> : null}<div className="dialog-actions"><button className="button button--primary" disabled={busy || document.state === "DELETED"} type="submit">Save changes</button>{document.access === "OWNER" ? <button className={`button ${document.state === "DELETED" ? "button--primary" : "button--danger"}`} disabled={busy} onClick={() => void removeOrRestore()} type="button">{document.state === "DELETED" ? "Restore document" : "Move to trash"}</button> : null}</div></> : <p className="read-only-note">You have read-only access. Metadata changes and sharing controls are intentionally unavailable.</p>}
        </form>
      ) : null}
      {loadedSections.has("versions") && section === "versions" ? <VersionsPanel busy={busy} canUpload={(document.access === "OWNER" || document.access === "EDIT") && document.state === "ACTIVE"} onOpen={openContent} onUpload={uploadVersion} versions={versions} /> : null}
      {loadedSections.has("sharing") && section === "sharing" ? <SharingPanel documentId={document.id} grants={grants} onChanged={applyGrantChange} show={show} /> : null}
      {loadedSections.has("activity") && section === "activity" ? <ActivityList events={events} /> : null}
    </DialogFrame>
  );
}

function VersionsPanel({ versions, canUpload, busy, onUpload, onOpen }: { versions: DocumentVersion[]; canUpload: boolean; busy: boolean; onUpload: (event: React.FormEvent<HTMLFormElement>) => void; onOpen: (version: DocumentVersion, download: boolean) => void }) {
  return <div className="detail-section">{canUpload ? <form className="version-upload" onSubmit={onUpload}><label>Upload new version<input accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" name="file" required type="file" /></label><button className="button button--primary" disabled={busy} type="submit">Upload version</button></form> : null}<div className="version-list">{versions.length ? versions.map((version) => <article key={version.id}><span className="version-number">v{version.versionNumber}</span><div><strong>{version.originalFilename}</strong><small>{formatBytes(version.sizeBytes)} · {formatDate(version.createdAt)} · by {version.createdBy.name}</small></div><span className="row-actions"><button disabled={busy} onClick={() => void onOpen(version, false)} type="button">Preview</button><button disabled={busy} onClick={() => void onOpen(version, true)} type="button">Download</button></span></article>) : <p className="inline-empty">No ready versions yet.</p>}</div></div>;
}

function SharingPanel({ documentId, grants, onChanged, show }: { documentId: string; grants: DocumentGrant[]; onChanged: (grant: DocumentGrant) => void; show: (kind: "success" | "error", text: string) => void }) {
  const [busy, setBusy] = useState(false);
  async function grant(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(true); const formElement = event.currentTarget; const form = new FormData(formElement); try { const result = await apiJson<{ data: { grant: DocumentGrant } }>(`/api/documents/${documentId}/grants`, { method: "POST", body: JSON.stringify({ recipientEmail: String(form.get("email")), accessLevel: String(form.get("accessLevel")) }) }); formElement.reset(); onChanged(result.data.grant); show("success", "Access granted."); } catch (error) { show("error", readableError(error)); } finally { setBusy(false); } }
  async function change(item: DocumentGrant, method: "PATCH" | "DELETE", accessLevel?: "READ" | "EDIT") { setBusy(true); try { const result = await apiJson<{ data: { grant: DocumentGrant } }>(`/api/documents/${documentId}/grants/${item.id}`, { method, ...(accessLevel ? { body: JSON.stringify({ accessLevel }) } : {}) }); onChanged(result.data.grant); show("success", method === "DELETE" ? "Access revoked immediately." : "Access level updated."); } catch (error) { show("error", readableError(error)); } finally { setBusy(false); } }
  const active = grants.filter((grant) => grant.status === "ACTIVE");
  return <div className="detail-section"><form className="share-form" onSubmit={grant}><label>Recipient email<input name="email" placeholder="colleague@company.com" required type="email" /></label><label>Access<select defaultValue="READ" name="accessLevel"><option value="READ">Can view</option><option value="EDIT">Can edit</option></select></label><button className="button button--primary" disabled={busy} type="submit">Grant access</button></form><p className="security-inline">Recipients must already have an active TrustVault account. Revocation applies to their next request.</p><div className="grant-list">{active.length ? active.map((item) => <article key={item.id}><span className="avatar" aria-hidden="true">{item.recipient.name.slice(0, 2).toUpperCase()}</span><div><strong>{item.recipient.name}</strong><small>{item.recipient.email}</small></div><select aria-label={`Access for ${item.recipient.name}`} disabled={busy} onChange={(event) => void change(item, "PATCH", event.target.value as "READ" | "EDIT")} value={item.accessLevel}><option value="READ">View</option><option value="EDIT">Edit</option></select><button className="danger-link" disabled={busy} onClick={() => void change(item, "DELETE")} type="button">Revoke</button></article>) : <p className="inline-empty">This document is not shared with anyone.</p>}</div></div>;
}

export function ActivityList({ events }: { events: AuditEvent[] }) {
  return <div className="activity-list">{events.length ? events.map((event) => <article key={event.eventId}><span className={`outcome-dot outcome-dot--${event.outcome.toLowerCase()}`} /><div><strong>{event.action.replaceAll("_", " ").toLowerCase()}</strong><small>{event.actor?.name ?? "System"} · {event.reason.replaceAll("_", " ").toLowerCase()}</small></div><time>{formatDate(event.occurredAt)}</time></article>) : <p className="inline-empty">No activity matches this view.</p>}</div>;
}
