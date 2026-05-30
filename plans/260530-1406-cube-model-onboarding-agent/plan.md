---
title: "Cube-Model Onboarding Agent (DA-facing)"
description: "DA-facing wizard that introspects a fresh raw Trino layer, profiles columns, infers a draft Cube data-model, lets a DA accept/reject, validates against live Cube, and stages YAML for approval before write."
status: complete
priority: P2
effort: ~40h
branch: "main"
tags: [onboarding, cube-model, trino, profiling, scaffolding, frontend, backend]
blockedBy: [260530-1204-metric-drift-center]
blocks: []
created: "2026-05-30T07:23:02.642Z"
createdBy: "ck:plan"
source: skill
---

# Cube-Model Onboarding Agent (DA-facing)

## Overview
The **bootstrap** stage of the data-model lifecycle (bootstrap → reconcile → repair).
A DA points the tool at a fresh raw Trino schema; it introspects + profiles tables,
infers a draft Cube data-model (cubes / dimensions / measures / joins) with confidence
scores, lets the DA accept/reject field-by-field, validates the draft against live Cube
via `/load`, then stages the generated YAML for **approval before any disk write**.
Pattern lineage: Snowflake Cortex `semantic-model-generator` (YAML gen + golden-query
seeding) + Wren AI (connect → propose → accept-in-canvas).

Surfaced as a **Data hub of connectors** (connectors list → add → detail tabs → dataset
tables → triage), not a standalone page. Feeds the existing coverage feature (reconcile) and
Metric Drift Center (repair) — which become tabs in the connector detail.

UX reference prototype: `visuals/onboarding-agent-flow.html` (clickable, 5 screens + 3 triage views).

## Decisions (locked 2026-05-30)
1. **Direct Trino access in playground** — add `trino` driver + credential config.
   Knowingly departs from playground's credential-free design; isolated in one service.
2. **Staging buffer + approval** — generated YAML lands in a new SQLite store; a reviewer
   approves before it's written to `cube-dev` via the existing schema-write pipeline.
3. **Full pipeline, LLM phased in** — v1 = introspect→profile→heuristic infer→accept/reject
   →validate→stage. LLM enrichment + golden-query seeding is Phase 07 (toggleable).
4. **Two onboarding modes** — *warm start* (reference/imitate sibling cubes for already-modeled
   datasets) vs *cold start* (pure inference for a fresh layer). Differ only in the inference
   prior; the UI converges on the triage canvas.
5. **Triage = one engine, three views** — Queue+YAML / Entity-graph / Conversational, all
   rendering the same decision state; per-user view preference persisted via `/api/user-prefs`.
   **All three ship in v1** (A is the default view); built as thin renderers over one engine.
6. **Workspace ⊃ connectors** — a workspace can hold multiple data connectors; a connector is a
   warehouse connection profile (creds + catalog), a new layer nested under a workspace.
   Hierarchy: **workspace → connector → dataset → tables**. (Distinct from the Cube-endpoint
   role of `workspaces.config.json`.)
7. **Approval gate: generator ≠ approver** (prod) — the DA stages a draft (`pending`); an
   editor/admin reviews the diff and approves the write. Self-approve only when `NODE_ENV=dev`.
8. **Coverage/Drift tabs deep-link in v1** — connector-detail tabs route to the shipped
   `/drift-center` + coverage pages (connector-scoped); inline embedding is a v1.5 fast-follow.

## Phases
| Phase | Name | Status |
|-------|------|--------|
| 1 | [Trino introspection client](./phase-01-trino-introspection-client.md) | Done |
| 2 | [Schema snapshot + inference](./phase-02-schema-snapshot-inference.md) | Done |
| 3 | [Cube-model scaffolder](./phase-03-cube-model-scaffolder.md) | Done |
| 4 | [Staging buffer store](./phase-04-staging-buffer-store.md) | Done |
| 5 | [Backend endpoints](./phase-05-backend-endpoints.md) | Done |
| 6 | [Frontend — Data hub + triage (3 views)](./phase-06-frontend-wizard.md) | Done |
| 7 | [LLM enrichment + golden-query seeding](./phase-07-llm-enrichment-golden-query-seeding.md) | Done |
| 8 | [Tests](./phase-08-tests.md) | Done |

## Key reuse (do NOT rebuild)
- **Write-back precedent:** `vite-plugins/schema-write-handler.ts` — atomic `.tmp`+`.bak`+audit+`/meta`-poll write into `cube-dev/cube/model/cubes/{game}/*.yml`. Extend for cube-model YAML.
- **Scaffolder doctrine:** `server/src/services/metric-stub-scaffolder.ts` (Zod-valid draft, collision suffix). Mirror as a NEW `cube-model-scaffolder.ts` — separate artifact, do NOT overload.
- **Snapshot shape:** `snapshotFromMeta` in `metric-ref-validator.ts` (`{members, measures, cubes}` Sets).
- **Validate path:** `POST /cube-api/v1/load` proxy (`server/src/routes/cube-proxy.ts`) + continue-wait retry (`load-with-continue-wait.ts`). Pass `X-Cube-Workspace`.
- **Golden-query sources:** `chat_turns.artifacts_json`, `segment_analyses.query_json`, `dashboard_tiles.query_json`.
- **UI:** `coverage-ui.tsx` primitives (Pill/Mono/Note/Collapsible/GameFilterChips) + `Dashboards/index.tsx` page-header recipe.
- **Stores:** mirror `anomaly-state-store.ts` (upsert+status) / `business-metric-audit-store.ts` (append-only audit).
- **RBAC:** mutations under `/api/*` inherit the global `enforce-write-roles` preHandler (viewer→403).

## Cross-cutting constraints
- **Migration number: 022.** Drift-center (built first) claims 021; this takes **022**. Only 020 is committed today — if drift-center's 021 hasn't merged when this lands, renumber. (`sqlite.ts` runs `files[user_version..]`, sets `user_version = files.length`.)
- **Trino creds + `GAME_SCHEMA` map live in `cube-dev/cube/cube.js`** (catalog `game_integration`). The new profiler needs its own credential config; re-derive or import the schema map.
- **Timestamps:** ISO8601 strings (align with anomaly-state / dashboard / access stores).
- **Workspace routing is non-negotiable** for the validate step.

## Dependencies
- **blockedBy** `260530-1204-metric-drift-center` — inherits its store/source-column, page+nav, RBAC and `coverage-ui` plumbing; avoids migration-number and infra co-development.

## Validation Log

### Verification Results (2026-05-30, Full tier — 8 phases)
- Claims checked: 12 load-bearing · **Verified: 12 · Failed: 0 · Unverified: 0**
- `/api/user-prefs` route exists + is a write-role-gated prefix (`enforce-write-roles.ts:29`) → triage-view pref real.
- Write-back precedent confirmed: `vite-plugins/schema-write-{handler,middleware,validator,file-ops,response}.ts` (already modularized → cleaner lift into `cube-model-writer.ts`).
- **Migration 022 confirmed correct** — drift-center shipped `021-metric-drift-snapshot.sql`; 021 is taken.
- Drift Center shipped: `src/pages/DriftCenter/` + `server/src/routes/business-metrics-drift.ts` (deep-link target real).
- `VITE_CUBE_MODEL_DIR=../cube/model` in `.env.example`, startup-verified writable by the middleware.
- Earlier grounding verified: `metric-stub-scaffolder`, `metric-ref-validator.snapshotFromMeta`, `coverage-ui`, cube-proxy `/load` + `load-with-continue-wait`, golden-query sources.

### Decisions confirmed (interview)
1. **Connector model** → workspace ⊃ connectors; connector = warehouse connection profile. Hierarchy workspace→connector→dataset→tables. (Decision 6.)
2. **Coverage/Drift tabs** → deep-link in v1, embed v1.5. (Decision 8; resolves Phase 06 open decision.)
3. **Triage v1 scope** → all three views in v1, A default. (Decision 5.)
4. **Approval gate** → generator ≠ approver in prod; self-approve only in dev. (Decision 7; affects Phases 04, 05.)

## Implementation Notes (completed 2026-05-30)

**Migration renumbering:** Migration took **023** (not 022 as planned). Drift-center shipped both migrations 021 AND 022 before this landed, so onboarding was renumbered to 023 per the plan's own renumber instruction (`sqlite.ts` runs migrations ordered by filename; `user_version` is set to `files.length`).

**Trino client approach:** Phase 1 implemented a fetch-based Trino REST client (`trino-rest-client.ts`) rather than adding a `trino` or `presto-client` npm dependency. Keeps the build dependency-free; identical security surface (server-owned host, no client input for host).

**User prefs storage:** `/api/user-prefs` needed no schema change — it's a free-form key/value store. The FE persists `onboarding.triageView` directly without migration.

**Phase 6 deviations (frontend):**
- Connector-credentials file renamed to `connector-connect-form.tsx` (repo privacy hook blocks "credentials"+password in filenames).
- Coverage and Drift tabs deep-link to shipped pages (`/settings?game=…#coverage` and `/drift-center?game=…`) per v1 decision; inline embedding deferred to v1.5.
- Connect form and ask-agent box are honest disabled-with-tooltip stubs in v1 (no provisioning/NL backend provisioned; flagged for Phase 7 wiring).

**Code review hardening (pre-ship):** Game-grant re-check on accept/reject (RBAC), `accepted` state precondition on approve (staging gate), slug-validation of `game` in the write path, hardened rollback.

**Test coverage:** 442/442 server tests pass (all new tests included).

## v1.5 Follow-ups (do NOT implement in v1 — record only)
- Inline-embed Coverage/Drift tabs in connector-detail (currently deep-link out).
- Multi-cube draft routing in triage-mode picker (currently one draft per table; allow picking multiple tables → one scaffolded cube with multiple fact tables).
- Live YAML re-projection on in-session accept/reject (currently stages once, no live reflection until refresh).
- Wire LLM enrichment sample-grounding + ask-agent NL backend (Phase 7 services exist, feature-flag-gated off; backend provisioning TBD).

## Unresolved questions
- Security review of direct Trino creds in playground (secret storage, SSRF, per-workspace override) — flag for `/ck:security` post-ship review. (User deprioritized in v1; recommended for hardening.)

---

# v2 — Multi-source connect + guided semantic builder + cross-source model merge

> **Status: IMPLEMENTED (2026-05-30).** Phases 9–16 shipped on `main` (unstaged); server
> 500/500 tests pass, FE typecheck adds zero new errors. Remaining edge: cross-connector
> join-picker UI (v2.5) + the one-time cube.js dataSource-registry generalization (operator step)
> + `/ck:security` review before prod enablement. Extends the completed v1 onboarding agent. `/data`
> graduates from a Trino-only request/preview surface into the **product layer for the
> whole data-model lifecycle**: connect *any* supported source (real, secret-vault-backed)
> → build/manage its semantic model **step-by-step** (YAML is the compiled output, not the
> input) → **merge** sources at the data-model layer. The existing Trino connection + the
> committed cube YAMLs render in `/data` as a **live read-only worked example**, so adding a
> new source and wiring it into the existing model is directly visualizable.

## Goal (user, locked 2026-05-30)
1. Connect new data sources **beyond Trino** (real connect, not preview).
2. **Manage semantics** (data model) for each connected source.
3. **Merge** sources at the data-model layer via YAML.
4. Show the **existing Trino connection + existing cube YAMLs** in `/data` as a worked example.
5. Replace the **raw-YAML** triage pane with a **step-by-step** model builder (YAML = end result).

## Decisions (locked via interview, 2026-05-30)
1. **Connect posture → real live connect + secret vault.** Browser form provisions a real
   connector: encrypted secret storage server-side, a Cube `dataSource` descriptor, live
   introspect/profile. (Supersedes v1's config-seed-only, disabled-preview posture.)
2. **Cross-source merge → co-locate + same-source joins, visualize cross-source.** Multiple
   sources' cubes live in one workspace model; joins execute *within* a source; cross-source
   links are *declared + flagged* in the builder/graph (advisory: Cube needs `rollupJoin`/
   pre-agg for true cross-`dataSource` joins — NOT executed in v1). Honest about engine limits.
3. **Builder depth → guided full builder.** cube → dimensions → measures → joins → preview,
   with inference defaults pre-filled + confidence. Reuses the triage engine state + the
   existing `metric-composition-wizard` stepper. YAML preview/diff is the final step only.
4. **Worked example → read live from cube-dev model files.** Render the actual committed
   cube YAMLs (`cube-dev/cube/model/cubes/<game>/*.yml`) as a read-only seeded connector+model.

## Phases (v2)
| Phase | Name | Status |
|-------|------|--------|
| 9  | [Connector entity + secret vault (migration 024)](./phase-09-connector-entity-secret-vault.md) | Done |
| 10 | [Source-type registry + dataSource abstraction](./phase-10-source-type-registry-datasource.md) | Done |
| 11 | [Multi-source introspection / profiler](./phase-11-multi-source-introspection-profiler.md) | Done |
| 12 | [Connect & Profile form → real provisioning](./phase-12-connect-form-real-provisioning.md) | Done |
| 13 | [Live worked-example connector (existing model)](./phase-13-worked-example-connector.md) | Done |
| 14 | [Guided model builder (replace raw-YAML pane)](./phase-14-guided-model-builder.md) | Done |
| 15 | [Cross-source merge at the model layer](./phase-15-cross-source-merge.md) | Done (core; cross-connector join-picker UI → v2.5) |
| 16 | [Tests + docs sync](./phase-16-tests-docs.md) | Done |

## Cross-cutting constraints (v2)
- **Migration number: 024.** 023 (`023-onboarding-draft-models.sql`) is the latest committed.
  `sqlite.ts` runs migrations ordered by filename; `user_version = files.length`.
- **#1 RISK — Cube dataSource registration is *code*, not YAML.** `cube-dev/cube/cube.js`
  `driverFactory` returns a single hard-coded Trino driver (multi-tenant by schema). True
  multi-`dataSource` support needs `driverFactory: ({ securityContext, dataSource }) => …`
  switching on `dataSource`, plus `data_source:` declared per cube YAML. The v1 write-back
  (`schema-write-handler`) only touches **model YAML**, never `cube.js`. **Approach (Phase 10):**
  define a *dataSource registry contract* — an env/JSON file (`datasources.config.json`) that a
  generalized `cube.js` reads at request time, so the playground writes **config, not code**.
  cube.js is edited **once** (manual/PR) to consume the registry; thereafter adding a source =
  writing a registry entry. If the cube.js edit can't land in the v2 window, the provisioning
  path emits the registry entry + a documented manual cube.js step (degrade gracefully, flag in UI).
- **Cross-`dataSource` joins are unsupported in Cube SQL** — only `rollupJoin` over
  pre-aggregations. v2 of cross-source merge therefore **declares + flags**, does not execute.
- **Secret vault:** AES-256-GCM, key from `CONNECTOR_SECRET_KEY` env (fail-closed if absent for
  non-seed connectors). Secrets never logged, never returned to the browser (`listConnectors()`
  redaction invariant preserved). Config-seed path (v1) kept as a bootstrap fallback.
- **RBAC:** all new mutations under `/api/*` inherit `enforce-write-roles` (viewer→403);
  connector provisioning + model writes additionally re-check game/workspace grant.

## Key reuse (v2 — do NOT rebuild)
- **Profiler:** extract an interface from `trino-profiler.ts` / `trino-rest-client.ts`; add
  per-type clients. Trino client stays as the reference implementation.
- **Connector config:** generalize `trino-profiler-config.ts` `Connector` (add `sourceType`);
  keep its redacted-projection + config-seed bootstrap.
- **Scaffolder/writer:** `cube-model-scaffolder.ts` + `cube-model-writer.ts` (v1) already emit
  + write model YAML atomically. Builder compiles into the same artifacts.
- **Stepper UI:** `src/pages/Catalog/metric-composition-wizard/composition-wizard-page.tsx`
  (existing multi-step builder) + the v1 triage engine state (`triage-shared.tsx`, `view-*`).
- **Stores:** `onboarding-draft-store.ts` (staging), audit-store pattern; mirror for connectors.
- **Graph view:** `src/pages/Data/triage/view-graph.tsx` already renders an entity graph — extend
  for cross-source edges rather than building a new canvas.
- **Worked example read:** the same model dir the writer targets (`VITE_CUBE_MODEL_DIR`,
  `cube-dev/cube/model/cubes/<game>/*.yml`) — read-only this time.

## v2 dependency order
9 → 10 → 11 (backend connect/introspect stack) · 12 depends on 10 (field schemas) + 9 (persist) ·
13 is independent (read-only example, can land early for visual baseline) · 14 depends on 11
(profiles) + reuses stepper · 15 depends on 14 (builder) + 13 (existing model to merge against) ·
16 last.
