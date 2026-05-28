---
phase: 1
title: "Backend workspace registry + per-request Cube ctx"
status: completed
priority: P1
effort: "1.5d"
dependencies: []
---

# Phase 1: Backend workspace registry + per-request Cube ctx

## Overview
Introduce a server-side workspace registry and make every Cube call resolve its base URL
+ auth from the active workspace per-request, instead of the global `CUBE_API_URL`. Client
sends only a workspace id; server never trusts a client-supplied URL.

## Requirements
- Functional: `local` + `prod` workspaces defined server-side; `getMeta/load/sql` route to
  the workspace's `cubeApiUrl` with the right auth (`minted` for local, `none` for prod).
- Non-functional: SSRF-safe (id→config lookup only); **default workspace = `prod`** (validated).

## Architecture
- New `workspaces.config.json` (repo root, beside `gds.config.json`):
  ```json
  {
    "default": "prod",
    "workspaces": [
      { "id": "local", "label": "Local dev", "cubeApiUrl": "http://localhost:4000",
        "authMode": "minted", "gameModel": "game_id" },
      { "id": "prod", "label": "Prod cube-dev", "cubeApiUrl": "https://cube.gds.vng.vn",
        "authMode": "none", "gameModel": "prefix",
        "gamePrefixMap": { "cfm_vn": "cfm", "ballistar": "ballistar", "cros": "cros" } }
        // verified live: cfm(41), cros(27), ballistar(11)=79. cros added per validation.
        // ptg/jus_vn/muaw/pubg absent from prod → game selector shows them disabled.
    ]
  }
  ```
- New loader `server/src/services/workspaces-config-loader.ts` — mirror
  `games-config-loader.ts` (env `WORKSPACES_CONFIG_PATH` override, cwd walk, dev watch).
- `resolveWorkspace(id?)` → workspace object (fallback to `default`); unknown id → 400.
- `cube-client.ts`: replace global `BASE_URL()` usage. `getMeta/load/sql` accept a
  `WorkspaceCtx { cubeApiUrl, token }`. Keep a thin back-compat wrapper that builds ctx
  from `local` so untouched callers don't break mid-migration.
- `resolve-cube-token.ts`: key resolution by `(workspace, game)`. `authMode==='none'` →
  return `{ token: null, source: 'none' }` and skip minting. `minted` → current path
  (`CUBEJS_API_SECRET`). `env-token` → `CUBE_TOKEN_<WS>_<GAME>` / `CUBE_TOKEN_<WS>`.
- Request plumbing: a Fastify hook reads `x-cube-workspace` header (default `local`),
  attaches `req.workspace` (resolved object). Routes pass it into cube-client.

## Related Code Files
- Create: `server/src/services/workspaces-config-loader.ts`, `workspaces.config.json`
- Create: `server/src/services/resolve-workspace.ts` (or fold into loader)
- Modify: `server/src/services/cube-client.ts` (ctx-based getMeta/load/sql; drop bare `BASE_URL()`)
- Modify: `server/src/services/resolve-cube-token.ts` (workspace-keyed authMode)
- Modify: `server/src/index.ts` (register `x-cube-workspace` preHandler hook)
- Modify: `server/src/routes/business-metrics.ts`, `server/src/routes/segments.ts`,
  `server/src/routes/cube-token.ts` (consume `req.workspace`)
- Add: `GET /api/workspaces` route returning the registry (id, label, gameModel, no secrets)

## Implementation Steps
1. Add `workspaces.config.json` + loader + `resolveWorkspace()`; unit test fallback/unknown-id.
2. Refactor `cube-client.ts` to ctx-based calls; back-compat wrapper for `local`.
3. Rework `resolve-cube-token.ts` for `authMode` (none|minted|env-token), workspace-keyed env.
4. Add Fastify preHandler that resolves `x-cube-workspace` → `req.workspace`.
5. Thread `req.workspace` through coverage, segments, cube-token routes.
6. Expose `GET /api/workspaces` (secret-free projection).
7. Verify: `curl -H 'x-cube-workspace: prod' /api/business-metrics/coverage` hits prod meta.
   (Prod `/meta` AND `/load` already verified open server-side — 200, real data, no token.)

## Success Criteria
- [ ] `GET /api/workspaces` lists `local` + `prod` without secrets.
- [ ] Coverage with `x-cube-workspace: prod` fetches prod `/meta` (no token) and resolves refs.
- [ ] Local workspace path unchanged (minted JWT still works); default with no header = `local`.
- [ ] Unknown workspace id → 400, never an outbound request.
- [ ] No global `BASE_URL()` call remains in request paths (grep clean).

## Risk Assessment
- **Prod fully open today** (`/meta` + `/load`, no token, CORS `*`) — verified. No query-path
  degradation for `authMode: none`. If DA later locks prod down, `authMode` flips to
  `env-token`/`minted` with no structural change (that's the point of the pluggable mode).
- **Token-minting regressions** — keep `minted` path byte-for-byte; cover with existing tests.
- **Mid-migration breakage** — back-compat `local` wrapper prevents callers breaking before all are migrated.
