# /cook status — cube workspace switching (`260527-1539`)

Auto-mode execution. Plan: `plans/260527-1539-cube-workspace-switching/plan.md`.

## Delivered (Phases 1–4 foundation)

### Phase 1 — Backend workspace registry + per-request Cube ctx ✅
- `workspaces.config.json` at repo root (prod default, local + prod registered).
- `server/src/services/workspaces-config-loader.ts` — id → workspace resolver, SSRF-safe (id-only lookup), env-path override.
- `server/src/services/resolve-cube-token.ts` — new `resolveCubeTokenForWorkspace()` switching on `authMode` (none/minted/env-token); legacy resolver kept.
- `server/src/services/cube-client.ts` — `WorkspaceCtx` type + `getMetaWithCtx / loadWithCtx / sqlWithCtx`; legacy `getMeta(token)` preserved for un-migrated callers.
- `server/src/middleware/workspace-header.ts` — Fastify onRequest hook reads `x-cube-workspace`, unknown id → 400, decorates `req.workspace` + `req.cubeCtx` + `req.buildCubeCtxForGame()`.
- `server/src/routes/workspaces.ts` — `GET /api/workspaces` secret-free projection.
- `server/src/routes/cube-token.ts` — workspace-aware (`authMode='none'` returns `{token: null}`).
- `server/src/routes/business-metrics.ts` — coverage + trust PATCH use `req.buildCubeCtxForGame` / `req.cubeCtx`.
- New test: `server/test/workspaces-config-loader.test.ts` (6 tests).
- 3 existing tests updated to register workspace plugin + mock new exports.
- **Server tests: 311/311 pass; typecheck clean.**

### Phase 2 — Frontend WorkspaceContext + switcher ✅ (partial)
- `src/components/workspace-context.tsx` — provider, localStorage persist (`gds-cube:workspace`), `gds-cube:workspace-change` event, `getActiveWorkspaceId()` for non-React fetch wrappers, public-API hydration from `/api/workspaces`.
- `src/shell/topbar/workspace-switcher.tsx` — chip + dropdown matching GamePicker tokens (Database icon, brand-soft active row).
- `src/App.tsx` — `WorkspaceProvider` wrap, switcher renders left of GamePicker in topbar.
- `src/api/api-client.ts` — auto-attaches `x-cube-workspace` to every `/api/*` call.
- **Deferred**: cube-meta-client consolidation of the 3 meta loaders (`query-builder.ts:369`, `use-new-metric-meta.ts:85`, `use-catalog-meta.ts`) — coordination point with the glossary-resolver-consolidation plan (per phase doc risk note).
- **Deferred**: Cube SDK transport customization (would need a `transport` shim or move all Cube traffic through Fastify).
- **Frontend tests: 1441/1441 pass.**

### Phase 3 — Prefix-mapped game selector ✅ (partial)
- `gds.config.json` — `cros` added (label "CrossFire PC", mark `CP`, color `#10b981`).
- `src/pages/Catalog/use-catalog-meta.ts` — branches on `workspace.gameModel`: `prefix` → strip `game_id` query param + post-filter cubes by `${prefix}_`; `game_id` → unchanged. Sends `x-cube-workspace` on the meta fetch.
- **Deferred**: GamePicker "disabled state" for games absent in the active workspace's `gamePrefixMap` (low priority — feeds Phase 5 readiness panel).

### Phase 4 — Server-side per-workspace artifact storage ✅ (foundation only)
- `server/src/db/migrations/017-workspace-artifacts.sql`:
  - `segments.workspace TEXT NOT NULL DEFAULT 'local'` + `idx_segments_workspace_game_owner`.
  - `dashboards.workspace TEXT NOT NULL DEFAULT 'local'` + `idx_dashboards_workspace_game_owner`.
  - New table `user_prefs (owner, key, value, updated_at)`.
  - New table `cube_aliases (id, owner, workspace, cube_name, alias, icon, updated_at)`.
- `server/src/routes/segments.ts` — list filters by `workspace = req.workspace.id`; both INSERT paths stamp `workspace`.
- **Deferred (explicit)**:
  - Dashboards routes still globally listed (column exists, default `'local'` preserves rows). Wider query surface — `dashboard-store.ts` has ~10 query points to migrate.
  - `/api/aliases` + `/api/user-prefs/workspace` routes (frontend migration off localStorage).
  - `use-cube-alias.ts` localStorage → API.
  - Draft-metric server-backing.

## Not started (Phases 5–7)

| Phase | Title | Status | Why not |
|-------|-------|--------|---------|
| 5 | Workspace readiness panel | not started | Depends on Phase 4 alias/prefs API; UI surface ≈ Settings tab + coverage reuse. ½–1 day. |
| 6 | Keycloak SSO + basic RBAC | not started | Major: replaces owner-header seam across all routes + adds token middleware + per-workspace + per-game RBAC. Multi-day. Needs infra inputs (KC realm/client id/redirect URIs still TBD per plan open Q3). |
| 7 | Chat-service workspace awareness | not started | Depends on Phases 1 + 4; chat-service mirrors per-request Cube ctx + `workspace_id` on `chat_sessions`. Significant change in a separate microservice. |

## Verification

- Server: `cd server && npm test` → 311/311. `npx tsc --noEmit` → clean.
- Frontend: `npm test -- --run` → 1441/1441. `npm run typecheck` → pre-existing baseline errors (unrelated to this work).
- Manual: not exercised against live prod cube-dev in this run; the workspace plugin is wired through `buildApp()` and the existing test setup confirms the seam.

## Open questions

1. **cros display label.** Used "CrossFire PC" placeholder — needs DA confirmation per plan Phase 3 Q.
2. **Cube SDK header forwarding.** The 3 direct meta loaders + every `/cubejs-api/v1/*` call from the Cube SDK still hit the proxy/Cube directly (not Fastify). Decision needed: should Cube traffic route through Fastify (so workspace header is honored) or stay direct (workspace-switching becomes meta-only for catalog/coverage/business-metrics)?
3. **Phase 4 completeness threshold.** Migration + segments are isolated; dashboards' wider query surface and the aliases-from-localStorage migration are bigger lifts. Need user input on whether to land Phase 4 incrementally or finish as a single batch.
4. **Phase 6 inputs.** VNG Keycloak realm name / client id / redirect URIs (plan open Q3) — blocker until devops provides.
