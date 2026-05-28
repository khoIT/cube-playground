# Brainstorm: Cube Workspaces (local meta ↔ prod cube-dev)

**Date:** 2026-05-27 · **Status:** Approved, proceeding to `/ck:plan`

## Problem

Need cube-playground to operate against **two Cube data sources**: local dev meta
(`http://localhost:4000`) and DA-controlled production cube-dev semantic layer
(`https://cube.gds.vng.vn/cubejs-api/v1/meta?extended=true`). Want (a) to understand the
gap + code changes required, and (b) an in-app switch. Reframed during session: the real
job is **workspaces** — a named context = (data source + its fresh meta) where all
artifacts are clean/valid against that meta. "Blast radius" is a migration/readiness
concern, not a standalone diff product.

## Verified findings (probed live + scouted code)

- **Prod meta shape == app's expected shape.** `{cubes:[…]}` with extended fields
  (`joins`, `preAggregations`, `connectedComponent`). SDK `new Meta(json)` + catalog hook
  parse prod **without code change**. Verified by probe (884KB, 79 entries: 35 cube / 44 view).
- **Prod is open.** `GET /meta` → HTTP 200, **no token**, `Access-Control-Allow-Origin: *`.
  Browser GET from localhost works today. (POST `/load` openness NOT verified.)
- **Game model differs.** Prod returns flat, **prefix-namespaced** cubes (`ballistar_*`,
  `cfm_*`, `cros_*`), ignores `game_id`. Local scopes via `game_id` param + per-game minted
  HS256 JWT claim. Decision: **prefix-map the game selector** per workspace.
- **Prod measures lack `.meta`** (`source/author/tags` absent). Catalog CDP enrichment +
  coverage attribution degrade → must tolerate missing `.meta`.
- **Backend is ONE in-repo Fastify server** (`server/`, port 3004), not a sibling repo.
  Cube URL = single runtime fn `cube-client.ts:16` `() => process.env.CUBE_API_URL ?? :4000`.
  Metric registry = local YAMLs `server/src/presets/business-metrics/` (NOT pulled from
  cube-dev). → "workspace-aware services" = one repo, no sibling deploy.
- **3 duplicated frontend meta loaders**: `QueryBuilderV2/hooks/query-builder.ts:361`,
  `pages/Catalog/use-catalog-meta.ts:70`, `QueryBuilderV2/NewMetric/hooks/use-new-metric-meta.ts:60`.

## Decisions (user-confirmed)

| Topic | Decision |
|---|---|
| Switch scope | Both: global active-source switch **+** readiness/migration view |
| Blast radius | Reframed → **workspace** with isolated, meta-valid artifacts |
| Game model | **Prefix-map** the existing game selector per workspace |
| Artifact model | **Isolated per workspace** (localStorage namespaced; segments get workspace dim) |
| Backend coupling | **Make services workspace-aware** (single repo, feasible) |
| MVP | **Full vertical slice** |
| Coverage registry | **Same shared** local YAML registry, reconciled vs each workspace's meta |

## Chosen approach — "Workspace as first-class context" (A)

`workspace = { id, label, cubeApiUrl, authMode, gameModel, gamePrefixMap }` in a
**server-side registry** `workspaces.config.json`. Frontend sends **workspace id only**
(`x-cube-workspace` header); server resolves URL+token from registry. **Client never
supplies raw URL (SSRF guard).** Two workspaces: `local` (minted JWT, game_id), `prod`
(authMode `none`, flat/prefix).

**Rejected:** B env-swap/dual-deploy (no in-app switch, no isolation); C client-only
toggle (backend dead in prod) — fallback only if effort balloons.

## Changes

**Backend (`server/`):** add `workspaces.config.json` + loader (mirror
`games-config-loader`); `cube-client` `getMeta/load/sql` take resolved workspace ctx vs
global `BASE_URL()`; `resolve-cube-token` keyed by `(workspace,game)` (prod `none` skips
minting); coverage resolver + segments routes read workspace from request header.

**Frontend (`src/`):** `WorkspaceContext` (persist `gds-cube:workspace`); header switcher
beside game selector; **consolidate 3 meta loaders** into one workspace-aware client (DRY);
game selector prefix-filter when `gameModel==='prefix'`; **namespace localStorage artifacts**
by workspace (`gds-cube:ws:<id>:…`); segments get workspace dimension.

**Workspace Readiness panel** (Settings tab, reuse coverage-monitor patterns): per-game
cube availability via prefix match; saved-artifact survival (resolve vs broken); coverage
delta (shared registry vs workspace meta = the DA audit).

## Phasing (full slice)

1. Backend workspace registry + per-request Cube ctx.
2. Frontend WorkspaceContext + switcher + consolidated meta client.
3. Prefix-mapped game selector.
4. localStorage + segments artifact isolation.
5. Workspace readiness panel.

## Success criteria

- Switch local↔prod from header; whole app (Playground/Catalog/Segments/Dashboards/coverage)
  operates on active workspace.
- Prod renders 79 entries; game selector filters by prefix.
- Artifacts isolated: switching shows target-workspace artifacts only, none broken.
- Coverage runs shared registry vs prod meta.
- No raw client URLs reach server; only registry-resolved ids.

## Risks

- **Prod auth durability** — open now, DA may lock down → keep `authMode` pluggable
  (`none|minted|env-token`); no per-game prod tokens exist yet.
- **`game→prefix` map gaps** — `gds.config.json` ids (`cfm_vn`,`ballistar`,…) ≠ prod prefixes
  (`cfm_`,`cros_`); some prod prefixes (`cros`) have no configured game; some games no prod data.
- **Missing `.meta` on prod** — enrichment/attribution UIs must degrade gracefully.

## Open questions

1. POST `/load` on prod — open like `/meta`, or auth-gated? (couldn't verify without a query)
2. Segments persistence store (DB vs file) — to confirm in phase 4 before adding workspace dim.
3. Exact `game→prefix` mapping values — needs DA/user input per game.
4. Should prod workspace be hidden from non-dev users, or available to all? (no auth/RBAC today)
