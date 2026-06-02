# Phase 11 — Multi-source introspection / profiler

**Context:** [plan.md](./plan.md) · v2 Decision 1. Generalizes the v1 Trino profiler to dispatch
by `sourceType`. Depends on Phase 09 (connector) + Phase 10 (registry caps/driverType).

## Overview
- **Priority:** P1.
- **Status:** Planned.
- Extract a `Profiler` interface from `trino-profiler.ts`; keep Trino as the reference impl; add a
  shared `information_schema` profiler covering the ANSI-SQL family (Postgres/MySQL/Redshift/
  Snowflake) + BigQuery's metadata path. `/api/onboarding/introspect` + `/generate` dispatch by type.

## Key Insights
- v1 `trino-profiler.ts` already exposes `listTables` + `profileTable` returning `TableProfile`
  (the inference input). The interface = exactly those two methods; cost caps (`PROFILER_CAPS`)
  are reusable across SQL sources.
- Postgres/MySQL/Redshift/Snowflake share ANSI `information_schema.tables/columns` → ONE profiler
  covers them with per-dialect quoting + a sample/approx-distinct query template. BigQuery uses
  `INFORMATION_SCHEMA` + `region.` qualifier — its own thin client.
- `trino-rest-client.ts` is fetch-based + dependency-free; match that style. Adding warehouse npm
  drivers is acceptable ONLY where no HTTP/ANSI path exists (e.g. `pg` for Postgres) — justify per type.

## Requirements
**Functional**
- `profiler-interface.ts`: `interface Profiler { listTables(schema): Promise<TableMeta[]>;
  profileTable(schema, table): Promise<TableProfile> }` + `getProfiler(connector): Profiler`
  dispatch keyed by `sourceType`.
- `information-schema-profiler.ts`: ANSI impl, per-dialect quote/sample templates, honoring
  `PROFILER_CAPS` (maxColumnsPerTable, sampleDistinctLimit, statementTimeoutMs, uniqueRatio).
- Keep `trino-profiler.ts` as the Trino impl behind the interface (minimal refactor).
- Route refactor: `onboarding.ts` `getProfiler(connector)` instead of direct Trino calls.

**Non-functional**
- Every profiling query bounded by `PROFILER_CAPS`; credentials redacted from all errors
  (reuse the per-client redaction helper).

## Architecture
`onboarding.ts` → `getProfiler(connector)` → {`trino-profiler` | `information-schema-profiler` |
`bigquery-profiler`}. All return the same `TableProfile` → unchanged `inferSchema` (Phase 02 v1).

## Related Code Files
- **Create:** `server/src/services/profiler-interface.ts`,
  `server/src/services/information-schema-profiler.ts`, (optional) `bigquery-profiler.ts`.
- **Modify:** `server/src/services/trino-profiler.ts` (implement interface),
  `server/src/routes/onboarding.ts` (dispatch via `getProfiler`).
- **Read for context:** `trino-rest-client.ts`, `trino-profiler-config.ts`, `types/raw-schema.ts`.

## Implementation Steps
1. Define `profiler-interface.ts` + `getProfiler` dispatch (registry caps gate non-introspectable types → 501).
2. Refactor `trino-profiler.ts` to implement the interface (no behavior change for Trino).
3. Implement `information-schema-profiler.ts` for the ANSI family; per-dialect quoting + sampling.
4. (If in scope) `bigquery-profiler.ts` via `INFORMATION_SCHEMA`.
5. Repoint `onboarding.ts` introspect/generate to `getProfiler`; non-introspectable type → clear 501.

## Todo
- [ ] Profiler interface + getProfiler dispatch
- [ ] Trino profiler implements interface (regression-safe)
- [ ] information_schema profiler (ANSI family) + caps
- [ ] (optional) BigQuery profiler
- [ ] Route dispatch + 501 for non-introspectable types

## Success Criteria
- Trino introspect/profile output byte-identical to v1 (regression test).
- A Postgres connector lists tables + produces `TableProfile`s feeding `inferSchema` unchanged.
- Non-introspectable source type → honest 501, surfaced in UI (no fake data).

## Risks & Mitigation
- **Driver sprawl:** prefer ANSI/HTTP; add an npm driver only with justification. Cap initial set to
  Trino + ANSI family + (maybe) BigQuery; others "connect, modeling coming" via registry caps.
- **Dialect quoting bugs:** unit-test the SQL templates per dialect with fixture schemas.

## Security
- Bounded-cost queries (`PROFILER_CAPS`); read-only by construction (introspection statements only);
  redacted errors. SSRF host check inherited from Phase 12 provisioning.

## Next
Phase 14 (builder consumes profiles); Phase 12 (form triggers introspect post-provision).
