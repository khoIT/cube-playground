---
title: "Connector management + flexible cross-source / cross-game modeling"
description: "Make data connections editable in the DB (not .env), and let users model joins across games (same Trino dataSource, executable) and across sources (Trino/ClickHouse/AppsFlyer, declared+flagged). Start with ballistar."
status: planned
priority: P2
effort: "~30h"
branch: "feat/connector-management-cross-source"
demoTag: "v0.1.0-demo"
tags: [connectors, datasource, cross-source, cross-game, modeling, cube, trino]
blockedBy: []
blocks: []
created: "2026-05-31T10:16:00+07:00"
createdBy: "ck:plan (inline)"
---

# Connector management + flexible cross-source / cross-game modeling

## Overview
Two user goals, one feature arc:
1. **Editable connections** — move connection config out of `.env` into the DB so users
   add/edit/disable connectors (any source type) from the product UI. *Most of the
   substrate already exists* (DB vault, encryption, audit, dynamic form); the gap is the
   **edit surface** + making the existing env-seeded Trino connection an editable row.
2. **Flexible modeling** — let a user join data **across games** (e.g. ballistar ⋈ cfm,
   same Trino catalog → **executable**) and **across sources** (Trino × ClickHouse ×
   AppsFlyer, different `dataSource` → **declared + flagged**, not executed). Start with
   ballistar.

Builds directly on the shipped onboarding agent (v1 phases 1-8) + multi-source connector
backend (v2 phases 9-16). See `plans/260530-1406-cube-model-onboarding-agent/`.

## Locked decisions (interview 2026-05-31)
1. **Edit posture → bootstrap-seed env → DB row.** On boot, if `CONNECTOR_SECRET_KEY` is
   set and no DB row exists for the env-seeded connector, materialize it as an editable DB
   row (env supplies initial values; DB authoritative after). Degrade to read-only env seed
   if no vault key.
2. **Cross-source stance → executable same-source + advisory cross-source.** Real, live
   joins for cubes sharing a `dataSource` (incl. cross-game within Trino via schema
   federation). Cross-`dataSource` links are *declared + flagged* in the builder/graph, not
   executed — matches Cube's engine (no cross-dataSource SQL join; only `rollupJoin` pre-agg).
3. **Model scope → per-game dirs, reference by FQ table.** Keep `cubes/<game>/*.yml`. A
   cross-game join references the other game's table via fully-qualified
   `catalog.schema.table` in the join `sql`. No new shared-model dir.

## The hard engine constraint (why Q2 splits in two)
Cube **cannot execute SQL joins across different `dataSource`s** — only within one. So:
- **Same-source, cross-game** (ballistar_vn ⋈ cfm_vn, both under Trino `game_integration`):
  ✅ executable — Trino federates schemas; cubes share `data_source: trino`.
- **Cross-source** (Trino × ClickHouse × AppsFlyer): ⚠️ not executable as live SQL — only
  `rollupJoin` over pre-aggregations, or declare-and-flag advisory (chosen stance).

## Phases
| Phase | Name | Status |
|-------|------|--------|
| A | [Connector CRUD + bootstrap-seed](./phase-01-connector-crud-bootstrap-seed.md) | Planned |
| B | [Cross-game executable join (same Trino dataSource)](./phase-02-cross-game-executable-join.md) | Planned |
| C | [Cross-source declare + flag (advisory)](./phase-03-cross-source-declare-flag.md) | Planned |
| D | [cube.js dataSource generalization + non-Trino driver (operator)](./phase-04-cubejs-datasource-generalization.md) | Planned |

**Sequencing:** A → B deliver the full ballistar story (editable connection + executable
cross-game join) with **zero cube.js changes**. C is additive (graph/declaration). D is the
operator unlock that turns *saved* non-Trino connectors into *served* ones.

## Key reuse (do NOT rebuild)
- **DB vault:** `connectors` table (`024-connectors.sql`) + `connector-store.ts`
  (`createConnector` is already an upsert; `disableConnector`, audit exist). **No new
  migration needed** for Phase A.
- **`.env` already a fallback:** `trino-profiler-config.ts:171-195` — DB rows already
  override env/file seed in `listConnectors`/`getConnector`. Bootstrap-seed just inserts the
  env values as a row.
- **Dynamic form + validation:** `source-type-registry.ts` (`validateConnectionInput`,
  field schemas + caps for Trino/Postgres/MySQL/Redshift/ClickHouse/Snowflake/BigQuery) +
  `connector-connect-form.tsx`.
- **Provisioning composition:** `connector-provisioning.ts` (validate → SSRF guard → vault
  persist → `datasource-registry-writer.upsertDataSource`).
- **data_source stamping:** the onboarding writer already stamps `data_source: <connectorId>`
  per cube (`onboarding.ts:214`) — the foundation for multi-connector models.
- **Graph view:** `src/pages/Data/triage/view-graph.tsx` (phase-15 cross edges) — extend for
  cross-source advisory edges.
- **Builder:** triage engine state + `metric-composition-wizard` stepper.
- **Validate path:** `POST /cube-api/v1/load` proxy + `load-with-continue-wait`.

## Cross-cutting constraints
- **RBAC:** all new mutations under `/api/*` inherit `enforce-write-roles` (viewer→403);
  connector edit/disable + model writes re-check workspace/game grant.
- **Secret invariants:** secrets never returned to the browser, never logged, never in
  `datasources.config.json` (secret-free, `secretRef` only). Edit with blank secret = keep
  existing (no blank-overwrite).
- **Worked-example connector stays read-only** (`existing-model` id) — not editable.
- **Timestamps:** ISO8601 strings.

## Release & branching strategy (per user ask)
Goal: keep the **working demo** cleanly separable from this big feature.
- **`v0.1.0-demo`** (annotated tag, commit `2dd4b0c`) — immutable checkpoint of the current
  working demo (onboarding agent + read-only worked-example connector). Always
  demo-able via `git checkout v0.1.0-demo`.
- **`main`** — stays at the demo state until this feature is reviewed + merged.
- **`feat/connector-management-cross-source`** — all plan + implementation commits land here.
- **Per-phase tags** (optional): tag `v0.2.0-rc.A`, `…rc.B` as phases land, so each
  milestone is independently demo-able before the full merge.
- **Merge:** squash/merge to `main` only after Phase A+B reviewed; bump `package.json`
  `0.1.0 → 0.2.0`; tag `v0.2.0`.

## Resolved (interview 2026-05-31)
1. **Phase D ownership → we update `cube-dev` directly now.** No external operator hand-off;
   the cube.js `driverFactory` generalization is part of this feature's work (sibling repo we
   control). Deploy path for `datasources.config.json` + secret export handled in Phase D.
2. **AppsFlyer → assume it lands in a queryable Postgres.** So it's a standard SQL-over-host
   **`postgres`** source type (already in the registry) — introspectable/profilable like any
   warehouse. No API-pull/ETL connector in scope; the "AppsFlyer" link in Phase C is
   Trino × Postgres (still a different `dataSource` → advisory, not executable).
3. **Cross-game join RBAC → enforce grant intersection.** The builder requires the user to
   hold grants for **both** the initiating and target game; route 403s otherwise (Phase B).
