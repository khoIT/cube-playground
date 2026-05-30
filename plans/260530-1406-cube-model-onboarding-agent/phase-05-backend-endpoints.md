---
phase: 5
title: "Backend endpoints"
status: complete
priority: P1
effort: "6h"
dependencies: [4]
---

# Phase 5: Backend endpoints

## Overview
Wire the pipeline into HTTP: introspect → generate draft → list/accept/reject (RBAC-gated)
→ validate against live Cube → approve-and-write into cube-dev. The write step extends the
proven schema-write pipeline to handle a whole cube-model file.

## Requirements
- Functional: introspect a schema; generate a draft from accepted inference; CRUD the staging buffer; validate a draft query via Cube `/load`; on approval, write YAML to cube-dev and poll `/meta` to confirm.
- Non-functional: all mutations under `/api/onboarding/*` (inherit `enforce-write-roles`); workspace header required for validate; write step atomic with `.bak` + rollback.

## Architecture
- New route module `server/src/routes/onboarding.ts` (registered like other `/api/*` routers in `server/src/index.ts`):
  - `GET  /api/onboarding/introspect?schema=…` → `trino-profiler.listTables` + `profileTable` (Phase 01). Read-only; behind auth.
  - `POST /api/onboarding/generate` → run inference (Phase 02) + scaffolder (Phase 03), `upsertDraft` (Phase 04), return draft + confidences.
  - `GET  /api/onboarding/drafts?game=&status=` / `GET /api/onboarding/drafts/:id`.
  - `POST /api/onboarding/drafts/:id/accept|reject` → `setDraftStatus` (mutation → write-role gated).
  - `POST /api/onboarding/drafts/:id/validate` → build a probe query from the draft, `POST /cube-api/v1/load` via proxy with continue-wait retry (`load-with-continue-wait.ts`); return row count / error. **Requires the cube to already exist in /meta** — so validate runs *after* write, or against a dry-run; see step 4.
  - `POST /api/onboarding/drafts/:id/approve` → write YAML into `cube-dev/cube/model/cubes/{game}/{cube}.yml` via the extended schema-write pipeline; set status `written`; record `approved_by`. <!-- Updated: Validation Session 1 --> **Approval gate: generator ≠ approver in prod** — reject (`403 SELF_APPROVE_FORBIDDEN`) if `approved_by` equals the draft's `created_by` unless `NODE_ENV=dev`; require editor/admin role (inherited from `enforce-write-roles`, but add the self-approve check explicitly since the role gate alone won't catch it).
- Extend `vite-plugins/schema-write-handler.ts` (or lift its core into a shared `server/src/services/cube-model-writer.ts`) to write a **full file** (not just splice a measure): atomic `.tmp`→rename, `.bak` backup, audit append, `/meta`-poll confirm, rollback on timeout. Gate behind `NODE_ENV` + write-roles.

## Related Code Files
- Create: `server/src/routes/onboarding.ts`, `server/src/services/cube-model-writer.ts`.
- Modify: `server/src/index.ts` (register router).
- Read for context: `server/src/routes/cube-proxy.ts:76-138` (load proxy + workspace ctx), `server/src/services/load-with-continue-wait.ts:18-41`, `vite-plugins/schema-write-handler.ts` (write pipeline to lift), `server/src/middleware/enforce-write-roles.ts:25-56` (prefix gating — add `/api/onboarding`).

## Implementation Steps
1. Scaffold router; register in `index.ts`; add `/api/onboarding` to write-role protected prefixes.
2. Implement introspect + generate endpoints.
3. Implement drafts CRUD + accept/reject (gated).
4. Decide validate strategy: (a) Cube `/dry-run` for static validation pre-write, or (b) real `/load` post-write. Recommend dry-run pre-write + real `/load` post-write smoke. Implement with continue-wait retry + workspace header.
5. Lift schema-write core into `cube-model-writer.ts`; support full-file write + rollback.
6. Implement approve → write → `/meta` poll → status `written`.

## Success Criteria
- [x] Full happy path works end-to-end via curl: introspect → generate → accept → validate → approve → cube appears in `/meta`.
- [x] Viewer role gets 403 on accept/reject/approve.
- [x] Approve is atomic: a failed `/meta` poll rolls back the file from `.bak`.
- [x] Validate routes carry `X-Cube-Workspace` and survive continue-wait.

## Risk Assessment
- **Validate before cube exists** → `/meta` lacks the new cube; use `/dry-run` for pre-write validation, real `/load` only after write.
- **Write to wrong repo path** → derive cube-dev model dir from `VITE_CUBE_MODEL_DIR`; refuse if unset (no silent default).
- **Prod write exposure** → write endpoint gated by `NODE_ENV` + write-roles; document in `/ck:security` review.
