# Phase 02 — Attachment backend: upload route + disk blob store

**Priority:** High (foundation for 03 + 04). **Effort:** M. **Status:** pending. **Depends on:** none.

## Overview
Add the missing plumbing for chat attachments: a multipart upload route, a local-disk blob store, and a `chat_attachments` SQLite table. This phase stores + serves bytes and extracts text; it does NOT change the LLM turn (that's Phase 03) or create segments (Phase 04).

## Key insights
- No multipart/blob support exists in chat-service today. Fastify app boots in `chat-service/src/index.ts`; routes registered there.
- Reuse the DB-open pattern; chat-service owns its SQLite (`chat-service/src/db/schema.sql`, migrations via `migrate.ts`). Add a new `migrateAttachments()` alongside existing migrators.
- Auth identity = `X-Owner-Id` header (matches body), workspace via `X-Cube-Workspace` (default `local`). Reuse on upload.
- Local disk store: write under server data dir (env `DB_PATH` dir sibling, e.g. `chat-service/data/attachments/<owner>/<id>`).

## Requirements
- `POST /agent/attachments` (multipart): fields `file`, `game`, `session_id?`; headers `X-Owner-Id`, `X-Cube-Token`, `X-Cube-Workspace?`.
- Validate: mime allowlist (`image/png|jpeg|webp`, `application/pdf`, `text/csv|plain`), size cap (e.g. 10 MB image / 15 MB pdf — configurable env). Reject others 415.
- Classify `kind`: `image` | `pdf` | `doc` | `csv` from mime.
- Persist file to disk; insert metadata row; return `{ id, kind, filename, mime, size, preview }`.
- Extraction at upload time (so turn stays fast):
  - image → store as-is; `preview` = data-less (FE renders via GET); record width/height if cheap.
  - pdf/doc → extract text (cap ~20k chars), store in `extracted_text`.
  - csv/plain → store raw text in `extracted_text` (Phase 04 parses it; do NOT auto-import here).
- `GET /agent/attachments/:id` → stream bytes (owner-scoped) for FE thumbnail/preview + vision fetch.
- `DELETE /agent/attachments/:id` → owner-scoped delete (file + row).
- Retention: purge attachments when their session is tombstoned (hook into existing retention sweep) + orphan sweep (no session, >24h).

## Architecture / related files
- Create: `chat-service/src/api/attachments.ts` (routes).
- Create: `chat-service/src/services/blob-store.ts` (disk read/write/delete, path derivation).
- Create: `chat-service/src/services/attachment-extract.ts` (pdf→text, csv passthrough; image no-op).
- Create migrator: `chat-service/src/db/migrate-attachments.ts` → table `chat_attachments(id, owner_id, session_id, game_id, workspace, kind, filename, mime, size_bytes, disk_path, extracted_text, meta_json, created_at, deleted_at)`; call from `migrate.ts`.
- Modify: `chat-service/src/index.ts` (register `@fastify/multipart` + attachments routes).
- Dep: add `@fastify/multipart`; PDF lib (decide pdf-parse vs pdfjs in plan Q2).

## Implementation steps
1. Add `@fastify/multipart`; register in `index.ts` with size limits.
2. Migrator + table; wire into `migrate.ts` boot sequence.
3. `blob-store.ts`: `write(owner,id,buf)`, `readStream(owner,id)`, `remove(owner,id)`; mkdir -p per owner; never trust client filename for path.
4. `attachment-extract.ts`: dispatch by kind; pdf→text (cap); guard failures (store empty `extracted_text`, set `meta_json.extract_error`).
5. `attachments.ts`: POST (validate→store→extract→insert→return), GET (owner-scope stream), DELETE.
6. Retention: extend tombstone sweep + add orphan sweep.

## Todo
- [ ] multipart registered + size caps
- [ ] `chat_attachments` migration wired
- [ ] blob-store (path-traversal-safe)
- [ ] extract service (pdf/csv/image) with failure guards
- [ ] POST/GET/DELETE routes, owner-scoped
- [ ] retention + orphan sweep
- [ ] tests: upload each kind, mime/size rejection, owner isolation on GET/DELETE, pdf extraction, orphan purge

## Success criteria
- Upload png/pdf/csv → row + file on disk + correct `kind`; GET streams bytes owner-scoped; oversized/disallowed rejected; pdf `extracted_text` populated.

## Risks / security
- Path traversal: derive disk path from server-generated id only.
- Owner isolation on GET/DELETE (return 404 not 403 to avoid id enumeration).
- Disk growth: caps + retention; log purges (no silent truncation).
- PII: extracted text + uploaded files may contain PII — keep on-VPN disk only, never log contents.
