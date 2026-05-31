---
phase: C
title: "Cross-source declare + flag (advisory)"
status: planned
priority: P2
effort: "7h"
dependencies: [B]
---

# Phase C: Cross-source declare + flag (advisory)

## Overview
Let users **declare** a relationship between cubes on **different connectors / dataSources**
(e.g. ballistar Trino facts × AppsFlyer attribution × ClickHouse events) and visualize it,
**without pretending Cube can execute it**. The link is advisory metadata + a graph edge, with
an honest capability note and (where caps allow) a `rollupJoin` suggestion.

## Key insight
Cube has **no live SQL join across `dataSource`s**. The product value here is *modeling intent
+ documentation + a path forward*, not execution. Phase 15 already established the declare+flag
stance and a graph view with cross edges — this phase makes it user-authorable and persists it.

## Requirements
**Functional**
- Declare a cross-source link: pick two cubes on different connectors, the conceptual key
  pair, a relationship, and a free-text rationale.
- Persist declared links (workspace-scoped) so they survive reload and render on the graph.
- Render advisory edges (distinct dashed/flagged style) in `view-graph`; clicking shows the
  caps verdict: executable? (no), `rollupJoin`-eligible? (from `source-type-registry` caps),
  and the recommended next step (pre-agg or ETL into a shared store).
- Never emit a non-executable cross-source join into a Cube YAML that would break `/load`.

**Non-functional**
- Declared links are metadata only; they do not alter the compiled, executable model.
- Secret-free; workspace + dual-connector grant checks.

## Architecture
- **Store**: small `cross_source_links` table (migration **025**) — `(id, workspace_id,
  left_cube, left_connector, right_cube, right_connector, key_json, relationship, rationale,
  status, created_by, created_at)`; append-only audit reuse pattern. (Confirm next migration
  number at landing; 024 is latest committed.)
- **Service** `cross-source-link-store.ts`: upsert/list/disable, mirroring `connector-store`.
- **Caps verdict** `cross-source-advisor.ts`: pure fn → given two source types, return
  `{ executable:false, rollupJoinEligible, note }` from `source-type-registry` caps.
- **Routes**: `POST/GET/DELETE /api/onboarding/cross-source-links` (RBAC + dual-connector grant).
- **FE**: graph edge rendering + a "Declare cross-source link" affordance + verdict panel;
  reuse `view-graph.tsx`.

## Related code files
- Create: `server/src/db/migrations/025-cross-source-links.sql`,
  `server/src/services/cross-source-link-store.ts`,
  `server/src/services/cross-source-advisor.ts`.
- Modify: `server/src/routes/onboarding.ts`, `src/pages/Data/triage/view-graph.tsx`,
  `src/api/onboarding-client.ts`.
- Read for context: `server/src/services/source-type-registry.ts` (caps),
  phase-15 cross-source merge notes in `plans/260530-1406-cube-model-onboarding-agent/`.

## Implementation steps
1. Migration 025 + `cross-source-link-store.ts`.
2. `cross-source-advisor.ts` caps verdict (pure, unit-tested).
3. Routes (RBAC + dual-connector grant).
4. Graph advisory edges + declare UI + verdict panel.
5. Tests: advisor verdict matrix; store; route grant.

## Todo
- [ ] Migration 025 + link store
- [ ] caps advisor (pure)
- [ ] CRUD routes (dual-connector grant)
- [ ] graph advisory edges + declare UI
- [ ] tests green

## Success criteria
- [ ] A declared ballistar-Trino × AppsFlyer link persists + renders as a flagged edge.
- [ ] Verdict panel correctly says "not executable; rollupJoin-eligible: <caps>" with a note.
- [ ] No cross-source link is ever written into an executable Cube YAML.
- [ ] Server suite + typecheck clean.

## Risks
- **User expects it to "just join"** → UI must be explicit it's advisory; show the engine
  limit + the rollupJoin/ETL path.
- **AppsFlyer → modeled as a Postgres source** (resolved): it lands in a queryable Postgres, so
  it's introspectable like any SQL source. The cross-source link is Trino × Postgres — still a
  different `dataSource`, so it stays advisory (not executable) in this phase.

## Security
- Secret-free; dual-connector grant; write-role gate; audited.
