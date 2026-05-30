---
title: "Metric Drift Center"
description: "Dedicated page surfacing root-cause-grouped metric drift, with repoint-ref and mark-N/A-per-game mutations and a detector→product bridge."
priority: P2
effort: ~16h
branch: main
tags: [metrics, drift, coverage, anomaly-detector, frontend, backend]
blocks: [260530-1406-cube-model-onboarding-agent]
status: completed
created: 2026-05-30
---

# Metric Drift Center

Turns the anomaly-detector's noisy "skipping N metric(s) with unresolved refs"
log into a product surface. A new dedicated page reconciles the business-metrics
registry against each game's live Cube `/meta`, groups broken refs by their
underlying missing cube/measure, and lets an editor **repoint** a stale ref or
**mark a metric N/A** for a game — both audited, both gated behind the existing
write-role RBAC.

## Why (verified this session)
- A `game=ptg` token resolves to only 2 cubes (`recharge`, `ordered_event_funnel`);
  registry refs `mf_users.*`, `active_daily.*`, `funnel.*`, `retention.*`,
  `user_recharge_daily.*` are absent → `cube-missing`.
- ballistar/cfm_vn have the cubes but lack specific measures → `member-missing`.
- Metric YAMLs ref cube `funnel.*` but the deployed cube is `ordered_event_funnel`
  → a rename/remodel that **repoint** fixes.
- Many metrics are genuinely N/A per game (e.g. `cpi` needs marketing cubes ptg
  lacks) → **mark-N/A** removes them from drift counts permanently.

## Scope (v1 — active-game only, on a NEW page)
1. Detector → product bridge (persist per-game unresolved set; shrink log line).
2. Root-cause grouping (collapse many refs into the missing cube/measure).
3. Repoint-ref action (remap a broken ref via a live-`/meta` member picker, re-validate, audit).
4. Mark-N/A-per-game (per-game applicability flag, excluded from drift).
5. New `/drift-center` page (**active game only**, like `/coverage?game=`) + nav entry; Settings tab + Catalog strip link in.

**Out of scope (v1.5):**
- **All-games overview** — v1 reconciles + shows drift for the currently-selected game only.
- **`prefix`-model / prod drift support** — needs registry-ref → `<gameprefix>_cube`
  translation + per-game gating for games absent from `gamePrefixMap` (see decision below).
- **Freshness / last-data-date columns.** Store schema is designed so a `last_seen_at`
  / freshness column can be added without migration churn.

## Phases

| # | Phase | Status | Depends on |
|---|-------|--------|------------|
| 01 | [Schema & types](phase-01-schema-and-types.md) | ✅ done | — |
| 02 | [Drift snapshot store + resolver grouping](phase-02-store-and-resolver.md) | ✅ done | 01 |
| 03 | [Backend endpoints (grouped drift, repoint, mark-N/A)](phase-03-backend-endpoints.md) | ✅ done | 02 |
| 04 | [Detector → product bridge](phase-04-detector-bridge.md) | ✅ done | 02 |
| 05 | [Frontend Drift Center page + nav](phase-05-frontend-page-and-nav.md) | ✅ done | 03 |
| 06 | [Tests](phase-06-tests.md) | ✅ done | 03, 04, 05 |

## Implementation notes (260530)
- Backend routes extracted to `server/src/routes/business-metrics-drift.ts` (host file stayed lean).
- **Security hardening beyond plan:** the plan assumed the upstream `workspace-header`
  game-grant check covered these routes, but it keys off the `x-cube-game` *header* while the
  new routes take `game` from query/body — so it never fired. Added an explicit
  `userCanAccessGame` guard (403 `GAME_FORBIDDEN`) to all three routes. Verified by
  `business-metrics-drift-authz.test.ts`.
- Grouping carries `items: {metricId, ref}[]` so the repoint form can target a specific
  metric's slot (the design's single `from` becomes a per-ref selector when a group spans many).
- Tests live in `server/test/` (repo convention), not co-located `__tests__/`.
- Result: server typecheck clean, 391 server tests pass; FE hook test passes; FE typecheck
  unchanged from baseline (pre-existing errors only).

## Key reuse (do NOT rebuild)
- `metric-ref-validator.ts` — `validateRefs`, `snapshotFromMeta`, `parseFqn`, `extractRefs`.
- `metric-coverage-resolver.ts` — per-game coverage + matrix (fail-open).
- `business-metrics-loader.ts` — atomic `writeMetric` (YAML source of truth).
- `business-metric-audit-store.ts` — `insertAuditRow` / `listAudit`.
- `anomaly-state-store.ts` — SQLite upsert pattern to mirror.
- `coverage-ui.tsx` — `Pill`, `Mono`, `Note`, `Collapsible`, `GameFilterChips`.
- Page-header recipe: `src/pages/Dashboards/index.tsx`.
- Migrations: next file is `021-…` (sqlite.ts runs files[currentVersion..], `user_version = files.length`).
- RBAC: mutations on `/api/business-metrics/*` already gate viewer out via the
  global `enforce-write-roles` preHandler — repoint & mark-N/A inherit it for free.

## Cross-cutting design decisions (DECIDED — encoded in phases)

### D1. Cube target — technically-coherent unification (NOT "unify onto prod")
Verified facts that pin this:
- **No ref-prefix translation exists anywhere.** Metric refs (`mf_users.acu`) are matched
  VERBATIM against `/meta` cube names — `metric-ref-validator.ts:99` does
  `snapshot.cubes.has(parsed.cube)` with no rewriting.
- The **`prod` workspace** (`:16000`, `gameModel:'prefix'`) exposes cubes as
  `ballistar_mf_users`, `cfm_mf_users`, … and has **no `ptg`**. So `validateRefs` against
  prod marks EVERY metric `cube-missing` → drift is **not meaningful** for `prefix`
  workspaces today.
- The **detector** already reconciles against **local `:4000` (`game_id` model)** with
  minted per-game tokens, where cube names match the registry verbatim. The local
  `game_id` workspace is the **only** place drift is currently meaningful.

**Decision:** do **NOT** repoint the detector onto prod. Both the detector and the
meaningful coverage path stay on the **local `game_id` model**. The Drift Center page
reconciles live against the **ACTIVE workspace** (exactly how `/coverage` works today via
`req.buildCubeCtxForGame`). But when the active workspace is `gameModel:'prefix'`, the page
shows a one-line note — *"drift not meaningful without ref translation (v1.5)"* — instead
of a wall of false `cube-missing`. Full `prefix`/prod support (registry-ref →
`<gameprefix>_cube` translation + per-game gating for games absent from `gamePrefixMap`) is
a deferred **v1.5 sub-project**.

### D2. Persisted store keyed by `(workspace_id, game, source)` — workspace-independent drift
The store is the mechanism that makes drift workspace-independent: switching workspace shows
*that* workspace's own snapshot and never overwrites another's.
- Detector rows persist under `(workspace='local', game, source='detector')`.
- Live page rows persist under `(activeWorkspaceId, game, source='live')`.
- `GET /drift-center` scopes reads by **active workspace + game**.
Replace-semantics are per-`(workspace, game, source)`. (`source` enum: `detector` | `live`.)

### D3. Detector provenance shown in a SEPARATE "last detector run" panel
The page's live reconciliation is authoritative for the active workspace. Detector-source
rows render in a distinct panel — **no silent merge** into the live groups.

### D4. Repoint UX = dropdown of live `/meta` members (not free text)
The repoint control populates a searchable picker from the **active workspace's live `/meta`
member list** (measures + dimensions, fully-qualified `cube.member`) for the active game, so
users can only pick real members. **Reuse the existing `/cube-api/v1/meta?extended=true`
proxy** (`cube-proxy.ts:78`, already workspace+game scoped via `x-cube-workspace` /
`x-cube-game` headers; pattern in `use-new-metric-meta.ts` / `use-catalog-meta.ts`) — **no
new endpoint**. The `PATCH /:id/repoint` server endpoint **still** re-validates the chosen
`to` ref against `/meta` as a backstop (defense in depth — `/meta` may shift between fetch and
submit); 400s if the target doesn't resolve.

### D5. Applicability (N/A) is a property of the metric, not the workspace
`meta.applicability` lives in the registry YAML. N/A exclusion therefore applies **across all
workspaces and all sources** — it is independent of the `(workspace, game, source)` store
keying. Drift counting filters N/A refs before grouping, for both the live and detector paths.

## Unresolved questions
See end of each phase file; consolidated in phase-06 (all 5 prior opens now DECIDED).
