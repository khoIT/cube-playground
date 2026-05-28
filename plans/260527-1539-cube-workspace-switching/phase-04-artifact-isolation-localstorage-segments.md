---
phase: 4
title: "Server-side per-workspace artifact storage"
status: partial
priority: P2
effort: "1.5d"
dependencies: [2]
---

# Phase 4: Server-side per-workspace artifact storage

## Overview
Move **data artifacts** off localStorage into the server (SQLite), scoped by `(owner,
workspace)`, so switching workspaces shows only that workspace's clean artifacts AND the
app is multi-user-ready for production. Pure device-local *view ephemera* (panel pixel
widths, expand/collapse) may remain in localStorage; everything that is user data does not.

> **Decision (user):** never localStorage for production multi-user data. Identity for now =
> the existing `X-Owner` header seam (`server/src/middleware/owner-header.ts`); it gets
> replaced by validated Keycloak identity in Phase 6 ("workspace first, RBAC follows").

## Requirements
- Functional: cube aliases/icons, dashboards, and segments are server-persisted, scoped by
  owner + workspace; created in one workspace, invisible in another, intact on return.
- Non-functional: reuse segments' SQLite + owner-header pattern; no new auth in this phase.

## Architecture
- **Inventory of localStorage artifacts** (`src/hooks/local-storage.ts` consumers):
  - `gds-cube:cube-aliases` (aliases + icons) → **server-side** (data).
  - draft metric writes (`NewMetric/.../pending-writes.ts`) → **server-side** (data).
  - active workspace selection → **server-side user pref** (not localStorage; survives device).
  - `VIEW_MODE_STORAGE_KEY`, panel widths → **stay localStorage** (device-ephemeral view state).
  - cube token (`gds-cube:token`/`cubejsToken`) → out of scope here (auth token; Phase 6).
- **SQLite tables** (new migration `017-workspace-artifacts.sql` — migrations exist through 016):
  - `cube_aliases (id, owner, workspace, cube_name, alias, icon, updated_at)`, unique
    `(owner, workspace, cube_name)`.
  - `user_prefs (owner, key, value)` — holds active workspace (`key='workspace'`).
  - Drafts: extend existing draft store (or add `metric_drafts` table) with `owner, workspace`.
- **Segments**: table already has `game_id` (migration 004, default `'ptg'`). Add `workspace
  TEXT NOT NULL DEFAULT 'local'` + index `(workspace, game_id, owner)`. Routes read
  `req.workspace.id` (Phase 1 hook) → filter list + stamp on create. Backfill rows to `local`.
- **Dashboards**: already server-side (migration `010-dashboards.sql`). Add `workspace
  TEXT NOT NULL DEFAULT 'local'` + filter/stamp by active workspace — same treatment as segments.
- **Server routes** (new, mirror segments REST shape, owner-header scoped):
  - `GET/PUT/DELETE /api/aliases` (workspace from header).
  - `GET/PUT /api/user-prefs/workspace`.
- **Frontend**: replace `use-cube-alias.ts` localStorage with API calls (React Query or the
  existing fetch pattern); WorkspaceContext reads/writes active workspace via `/api/user-prefs`
  (falls back to **`prod`** — the validated default — if pref missing).

## Related Code Files
- Create: `server/src/db/migrations/017-workspace-artifacts.sql`,
  `server/src/routes/aliases.ts`, `server/src/routes/user-prefs.ts`, their service/query files
- Modify: `server/src/routes/segments.ts` + segment query layer (workspace filter/stamp),
  dashboards route + query layer (workspace filter/stamp)
- Modify: `src/hooks/use-cube-alias.ts:10` (localStorage `STORAGE_KEY` → API),
  `src/components/workspace-context.tsx` (server pref), `NewMetric/.../pending-writes.ts` (server-backed drafts)

## Implementation Steps
1. Migration 017: cube_aliases + user_prefs + segments.workspace + dashboards.workspace;
   backfill workspace=`local`.
2. Build aliases + user-prefs routes (owner-header + workspace scoped), reuse segments patterns.
3. Migrate `use-cube-alias.ts` and workspace selection to the API; remove their localStorage.
4. Move draft metric writes server-side, scoped by owner+workspace.
5. Verify: alias on `local` absent on `prod`, intact on return; segments + dashboards filtered
   + stamped; pre-existing local rows still listed.

## Success Criteria
- [ ] No data artifact persists in localStorage (only view-ephemera remains; grep confirms).
- [ ] Aliases, drafts, segments, active-workspace are server-side, scoped `(owner, workspace)`.
- [ ] Switching workspaces isolates artifacts; pre-existing segments backfilled to `local`.
- [ ] Two different `X-Owner` values see disjoint artifact sets (multi-user smoke test).

## Risk Assessment
- **One-time migration of existing localStorage aliases** — provide a best-effort import on
  first load (read old key → POST → clear), then drop the key. Don't silently lose user aliases.
- **Interim auth posture** — owner-header still unvalidated until Phase 6. **Validated decision:
  prod workspace is reachable in the interim** (no gate) — accepted risk; document clearly in
  release notes and tighten on Phase 6 landing.
- **Dashboards unknown store** — confirm before assuming; may add scope to this phase.
