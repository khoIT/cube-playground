---
phase: D
title: "cube.js dataSource generalization + non-Trino driver (operator)"
status: planned
priority: P3
effort: "7h"
dependencies: [A]
---

# Phase D: cube.js dataSource generalization + non-Trino driver (operator)

# Overview
Turn **saved** non-Trino connectors into **served** ones. Today the playground can persist a
ClickHouse/Postgres/etc. connector and write its `datasources.config.json` entry, but
`cube-dev/cube.js` still hard-codes a single Trino `driverFactory`, and the non-Trino profiler
runner returns `501`. This phase does the one-time generalization so adding a source = writing
a registry entry (config), not editing code.

**We own the `cube-dev` change directly** (resolved 2026-05-31) — no external operator
hand-off. It still touches the sibling `cube-dev` repo + deploy, so it's sequenced last and
kept independent of A–C; A/B/C deliver full value for the Trino story without it.

## Key insight
The "Cube dataSource is code, not YAML" gap (plan #1 risk from the v2 work). The
`datasource-registry-writer.ts` already emits a secret-free `datasources.config.json` with a
`secretRef` per entry. cube.js must be edited **once** to consume it.

## Requirements
**Functional**
- `cube-dev/cube/cube.js` `driverFactory: ({ securityContext, dataSource }) => …` switches on
  `dataSource`, building the right driver from the registry entry + a secret resolved from the
  operator env/vault export keyed by `secretRef` (NEVER from the config file).
- Trino path preserved exactly (default `dataSource`, multi-tenant by game schema).
- Playground non-Trino profiler runner wired (replace the `501`) for at least one SQL driver
  (ClickHouse or Postgres) so introspection/profiling works end-to-end.
- Provisioning's `liveTested`/degraded note flips to `true` once the registry is consumed.

**Non-functional**
- Secrets resolved at request time from env/vault export; config file stays secret-free.
- Backward compatible: existing committed cubes (no explicit `data_source`) default to Trino.

## Architecture
- **cube-dev (operator PR):** generalized `driverFactory` reading
  `datasources.config.json` (path via env); secret resolution map keyed by `secretRef`;
  per-cube `data_source:` honored (writer already stamps it).
- **playground:** implement a SQL driver runner behind `profiler-interface.ts` (the ANSI
  profiler exists; wire an actual query executor for the chosen driver). Replace
  `ProfilerUnavailableError` 501 for that source type.
- **Deploy:** document how `datasources.config.json` + the secret export reach the cube-dev
  container (mount/CI), since the playground writes config, the operator supplies secrets.

## Related code files
- Modify (sibling repo, operator): `cube-dev/cube/cube.js`.
- Modify (playground): `server/src/services/profiler-interface.ts` (+ a concrete driver
  runner), `server/src/services/connector-provisioning.ts` (`liveTested` for newly-served
  types).
- Read for context: `server/src/services/datasource-registry-writer.ts` (registry shape +
  `secretRef`), `server/src/services/trino-rest-client.ts` (reference runner),
  `server/src/services/connector-secret-vault.ts` (how secrets are sealed/opened).

## Implementation steps
1. Spec the registry → driver mapping + secret-resolution contract (write it down for the PR).
2. cube.js generalization PR (operator) with Trino regression check.
3. Playground: one concrete non-Trino SQL driver runner; replace 501 for it.
4. Flip provisioning `liveTested` for served types; update UI degraded note.
5. Deploy doc: config file + secret export delivery to cube-dev.
6. Tests: profiler dispatch for the new driver; provisioning note state.

## Todo
- [ ] Registry→driver + secret-resolution contract documented
- [ ] cube.js generalized driverFactory (operator PR) + Trino regression
- [ ] one non-Trino SQL driver runner (replace 501)
- [ ] provisioning liveTested flip + UI note
- [ ] deploy doc (config + secret delivery)
- [ ] tests green

## Success criteria
- [ ] Trino queries unchanged after the cube.js generalization (regression).
- [ ] A provisioned ClickHouse/Postgres connector introspects + profiles live (no 501).
- [ ] `datasources.config.json` remains secret-free; secrets resolved from env/vault only.
- [ ] Adding another SQL source needs only a registry entry, no code.

## Risks
- **Sibling-repo coupling / deploy** → we own the cube-dev edit; the remaining unknown is the
  secret-delivery path (env/vault export → container). Pin it in step 1's contract.
- **Driver dependency footprint** → wiring a real driver may add deps to the dependency-free
  build; isolate per-driver, lazy-load.
- **Cross-`dataSource` joins still unsupported** → this phase serves each source; it does NOT
  make Phase C links executable (engine limit stands).

## Security
- Config-only writes from the product; secrets never in the registry file; secret export is an
  operator-controlled boundary.
