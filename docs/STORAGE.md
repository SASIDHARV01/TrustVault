# TrustVault Secure Document Storage

Last verified: 2026-10-22

## Phase 6 scope

Phase 6 implements the complete private-byte lifecycle: validated uploads,
immutable versions, server-authorized preview/download, reason-bearing admin
override, failure compensation, and independent audit-chain checkpoints.
Cloudflare credentials are not required for local tests because the same
contract has an in-memory implementation. A live R2 connection and bucket
policy remain deployment checks.

## Private storage boundary

Document bytes live in a private Cloudflare R2 bucket. PostgreSQL stores only
the server-generated object key, digest, size, media type, immutable version
number, and workflow state. No API response exposes an R2 credential, bucket
URL, object key, or reusable presigned URL.

`ObjectStorage` has only `put`, `get`, `head`, and `delete`. It deliberately has
no public-URL or browser-signing operation. Document objects use random keys:

```text
documents/12/123e4567-e89b-42d3-a456-426614174000
```

Checkpoint evidence uses a separate lockable prefix:

```text
audit-checkpoints/12/123e4567-e89b-42d3-a456-426614174000
```

Neither key contains a document ID, owner, email, or original filename.

## Runtime configuration

```dotenv
R2_ACCOUNT_ID=replace-with-cloudflare-account-id
R2_ACCESS_KEY_ID=replace-with-bucket-scoped-access-key
R2_SECRET_ACCESS_KEY=replace-with-bucket-scoped-secret
R2_BUCKET_NAME=trustvault-documents
R2_JURISDICTION=default
```

`R2_JURISDICTION` accepts `default`, `eu`, `fedramp`, or `us`. The application
derives the HTTPS endpoint instead of accepting an arbitrary host. Use an R2
Object Read & Write token restricted to this bucket. Do not enable `r2.dev` or a
public custom domain.

In Cloudflare, add an indefinite bucket-lock rule for the
`audit-checkpoints/` prefix. Cloudflare documents that bucket locks prevent
matching objects from being overwritten or deleted. The application token must
not have permission to change bucket-lock configuration. This operational lock
is what makes the checkpoint independent evidence; the prefix alone is only
organization.

## Upload contract

`POST /api/documents/:documentId/versions` accepts one multipart field named
`file`. The owner and a current EDIT recipient may upload. READ recipients,
unrelated users, ordinary administrator access, deleted documents, malformed
IDs, and revoked grants fail closed.

Version one supports:

- PDF (`.pdf`, `application/pdf`);
- PNG (`.png`, `image/png`); and
- JPEG (`.jpg` or `.jpeg`, `image/jpeg`).

Files must be 1 byte–10 MiB. The server compares the normalized single
extension, declared MIME type, and magic bytes; rejects control characters,
paths, traversal, and double extensions; and computes SHA-256 itself. Broad
Office/ZIP formats are intentionally deferred because reliable type and malware
inspection is more complex.

The staged workflow is:

1. lock the document row, re-read authorization, and allocate the next version;
2. create immutable metadata in `PENDING` state;
3. write bytes to a random private object key;
4. mark the row `READY` and append upload/version audit events; or
5. mark it `FAILED` and compensate by deleting an object when finalization fails.

Serializable transactions plus the document lock prevent concurrent uploads
from receiving the same version number. PostgreSQL triggers reject metadata
changes, physical deletion, and invalid state transitions.

## Version history and content delivery

- `GET /api/documents/:documentId/versions` returns READY version metadata in
  descending version order. It never returns `storageKey`.
- `GET /api/documents/:documentId/versions/:versionId/content` previews content.
- Add `?disposition=attachment` to request a download.

Every content request re-reads the current document and active grant before
loading R2. Therefore revocation blocks the next request. The server compares
R2 metadata with PostgreSQL, reads at most the expected bounded size, recomputes
SHA-256 over the actual bytes, then returns the verified content through the
application. Responses use `private, no-store`, `Vary: Cookie`, `nosniff`, a
sandbox Content Security Policy, and a safe RFC 5987 content disposition.

Administrators receive metadata visibility only. Exceptional content viewing
uses the same content endpoint with `X-TrustVault-Override-Reason`. The reason
must contain 10–500 non-whitespace characters. A successful or refused attempt
creates `ADMIN_OVERRIDE_READ`; it grants no edit, delete, or sharing power.

## Audit checkpoints

`POST /api/admin/audit/checkpoints` is administrator-only, requires a trusted
origin, verifies the entire database chain, writes a JSON snapshot of its head
to the locked R2 prefix, and then stores the database reference and an
`AUDIT_CHECKPOINT_CREATE` event. `GET` returns the latest 50 public checkpoint
records without object keys.

The external JSON contains the public event ID, database sequence ID, event
timestamp, event count, chain head, checkpoint timestamp, and schema version.
It contains no HMAC key, credentials, request headers, or document content. The
database checkpoint row is append-only. A database-finalization failure attempts
object cleanup; a lock may deliberately prevent deletion, leaving an unreferenced
forensic object rather than mutable evidence.

## Verification evidence

Unit and boundary tests cover file signatures, filename attacks, size limits,
MIME mismatches, key namespaces, strict multipart shape, safe errors, protected
response headers, and secret/key non-disclosure.

The isolated PostgreSQL 15 suite applies all migrations and proves the full
owner/READ/EDIT/unrelated/admin matrix, concurrent version numbering,
next-request revocation, admin override evidence, storage failure states,
content-integrity rejection, external checkpoint creation, and database
immutability. The production build and dependency audit are separate final
quality gates. A live R2 privacy/token/lock check remains required during
deployment because no cloud credentials are committed or used in tests.

Every R2 put, get, head, and delete operation has a 15-second abort deadline so
a stalled provider cannot hold an application request indefinitely. The upload
limit remains 10 MiB, and document-content routes also use the shared Phase 9
request limiter. The live deployment check must still confirm realistic R2
latency, bucket privacy, token scope, and checkpoint retention.
