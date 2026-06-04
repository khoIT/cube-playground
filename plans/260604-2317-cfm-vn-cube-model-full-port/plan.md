---
title: Multi-Game Cube Model Port (cfm + cros + tf + vga) — kraken → local cube-dev
description: >-
  Port the upstream kraken/cube semantic layer for cfm_vn, cros, tf (per-game
  360 sets) and vga (account/payment platform) into local
  cube-playground/cube-dev, Trino-verified, so local can serve the cfm-user360
  dashboard plus cros/tf 360 + vga domain dashboards.
status: pending
priority: P2
branch: main
tags:
  - cube
  - cfm
  - cros
  - tf
  - vga
  - semantic-layer
  - port
  - trino
  - multi-tenant
blockedBy: []
blocks: []
created: '2026-06-04T16:18:48.638Z'
createdBy: 'ck:plan'
source: skill
---

# Multi-Game Cube Model Port (cfm + cros + tf + vga) — kraken → local cube-dev

## Overview

Port the upstream `kraken/cube` semantic layer into local `cube-dev`. **Active scope: cfm + cros + tf** (vga deferred — Validation S1). The four tenants:
- **cfm** (CrossFire Mobile) — richest 360 set incl. FPS event-stream cubes. Primary driver: the live `cfm-user360` dashboard (6 views via GDS Connector `cube_query_view`).
- **cros** (CrossFire: Legend) + **tf** (Total Football) — clean per-game 360 clones (12 cubes + `user_360.yml` each; login/logout/register events).
- **vga** (VNG Game Account platform) — 16 account/payment/CS cubes + 5 domain dashboards (user overview, acquisition, payment delivery/history, game activity). Different catalog + naming domain.

Goal: local cube-dev compiles the active tenants (cfm/cros/tf); their 360 views resolve to real data; cfm members physicalize to `cfm_*` against prod via `src/lib/cube-member-resolver.ts`. vga (account/payment platform) is specced in Phase 12 but deferred.

## Locked decisions

- **Per-game-tenant cubes (cfm/cros/tf) = BARE names.** Strip the `<game>_` cube prefix + schema qualifier from `sql_table`. Local is multi-tenant compile-per-game (one folder per JWT `game`) so bare can't collide; the resolver physicalizes at the prod edge. Consistent with ballistar/jus/muaw/pubg/ptg.
- **vga = DEFERRED (Validation S1).** Not in active scope. When resumed: keep `vga_` canonical names + `.yaml` verbatim, route to the `iceberg` catalog. Phase 12 retained as the spec.
- **Active scope.** cfm: all ~17 cubes + full `user_360.yml`. cros/tf: all 12 cubes + `user_360.yml`.
- **Replace** hand-built cfm cubes with kraken `etl_*`; **field-merge** overlapping cfm core cubes.
- **Trino-verify** every cube: cfm/cros/tf under catalog `game_integration` (schemas `cfm_vn`/`cros`/`tf`). (vga/`iceberg` deferred.)
- **cube.js**: extend `GAME_SCHEMA` (+cros/tf); port the 31-day behavior-log `queryRewrite` guardrail, generalized to bare `etl_*`. (Per-tenant `iceberg` catalog override deferred with vga.)

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Trino Verify Harness](./phase-01-trino-verify-harness.md) | Completed |
| 2 | [Naming & Transform Rules](./phase-02-bare-rename-rules.md) | Completed |
| 3 | [cfm: Add Mapping Cubes](./phase-03-add-mapping-cubes.md) | Completed |
| 4 | [cfm: Reconcile Core Cubes](./phase-04-reconcile-core-cubes.md) | Completed |
| 5 | [cfm: Replace With Etl](./phase-05-replace-with-etl.md) | Completed |
| 6 | [cfm: Port Event Stream](./phase-06-port-event-stream.md) | Completed |
| 7 | [cfm: Views user_360](./phase-07-views-user360.md) | Completed |
| 8 | [cube.js Multi-Tenant + Guardrail](./phase-08-cubejs-guardrail.md) | Completed |
| 9 | [E2E Verify (all tenants)](./phase-09-e2e-verify.md) | Completed |
| 10 | [cros: Full Port](./phase-10-cros-port.md) | Completed |
| 11 | [tf: Full Port](./phase-11-tf-port.md) | Completed |
| 12 | [vga: Full Port](./phase-12-vga-port.md) | **Deferred** (Validation S1) |

## Dependency chain

Sequencing decision (Validation S1): **all active tenants in parallel** after infra.
- Infra: `1 → 2 → 8` (harness → rules → cube.js GAME_SCHEMA + guardrail). 8 must precede any `etl_*` import.
- Then **in parallel**: cfm `3 → 4 → 5 → 6 → 7`, cros `10`, tf `11` (each depends only on 1,2,8).
- `9` (E2E) last — verifies cfm 360 dashboard + cros/tf 360.
- **vga `12` DEFERRED** to a follow-up (iceberg catalog + per-tenant catalog routing not built now). Its phase file is kept as the spec for resumption.

## Key context / sources

- Upstream: GitLab `kraken/cube` (token in `cube-dev-old` remote) → `cube/model/cubes/{cfm_vn,cros,tf,vga}/*` + `cube/model/views/{cfm_vn,cros,tf,vga}/*`.
- Local target: `cube-dev/cube/model/cubes/{cfm,cros,tf,vga}/`, `views/{cfm,cros,tf,vga}/`, `cube-dev/cube/cube.js`.
- Naming abstraction: `src/lib/cube-member-resolver.ts`. FE game-header test exists for `cros`: `src/api/__tests__/api-client-cube-game-header.test.ts`.
- Trino: `game_integration` (cfm_vn/cros/tf) + `iceberg.vga`; creds `~/.trino-creds` + `cube-dev/.env`; driver `trino`, no CLI.
- Schemas: cfm→`cfm_vn`, cros→`cros`, tf→`tf`, vga→`iceberg.vga`.

## Open questions

All resolved in Validation S1 (see Validation Log):
- ~~vga tenancy~~ → **DEFERRED** to follow-up plan.
- ~~cfm physical parity~~ → **bare-only locally**; resolver handles prod.
- ~~stale/empty upstream data~~ → **keep + comment** (matches kraken).
- ~~sequencing~~ → **cfm/cros/tf in parallel** after infra.

Remaining (factual, verified during implementation, not user decisions):
- Per-tenant column drift cfm vs cros vs tf — Phase 1 inventory is per-schema; don't assume parity.

## Validation Log

### Session 1 — 2026-06-04 (critical-questions interview)

**Verification pass (Full tier, 12 phases):** load-bearing codebase claims verified live this session — `src/lib/cube-member-resolver.ts` (logical↔physical, switches on `workspace.gameModel`), `cube-dev/cube/cube.js` (`GAME_SCHEMA` + single `catalog: process.env.CUBEJS_DB_PRESTO_CATALOG`, compile-per-game), local bare-named `cubes/cfm/*`, kraken `cfm_vn/cros/tf/vga` files + `iceberg.vga` catalog, FE `cros` header test. **Failed: 0.** External (kraken) + live-Trino claims are verified at implementation time via Phase 1 harness (can't grep a remote repo / live warehouse).

**Decisions:**
1. **vga → DEFERRED.** Not in active scope; Phase 12 + the cube.js `iceberg` catalog-override design retained as the resumption spec. Active = cfm + cros + tf.
2. **cfm naming → bare-only locally.** Resolver physicalizes to `cfm_user_*` against prod; local serves bare. No duplicate physical view names.
3. **Stale/empty data → keep + comment.** Model cfm `etl_money_flow`/`etl_game_detail` (stale ~2026-05-01) + unpopulated per-role recharge measures with freshness notes (matches kraken).
4. **Sequencing → all active tenants in parallel.** After infra (1,2,8): cfm (3–7), cros (10), tf (11) concurrently; E2E (9) last.

**Propagated to:** phase-01 (iceberg → deferred), phase-02 (vga passthrough → deferred), phase-08 (GAME_CATALOG/iceberg → deferred; keep GAME_SCHEMA cros/tf + guardrail), phase-09 (drop vga e2e, deps now [3-8,10,11]), phase-12 (status: deferred).

### Whole-Plan Consistency Sweep
Re-read plan.md + all 12 phase files. Reconciled stale "four tenants / all four" active-scope claims (overview, phase-01, phase-08) → now "active = cfm/cros/tf, vga deferred". No `dependencies:` list still references phase 12 except phase-12 itself. phase-08 line referencing "vga has no etl_* cubes → unaffected" kept (accurate, not contradictory). `ck plan status` counts 12 phases incl. the deferred one (CLI has no "deferred" state — table + frontmatter mark it clearly). **Zero unresolved contradictions.**
