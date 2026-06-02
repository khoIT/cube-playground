# Phase 10 — Source-type registry + dataSource abstraction

**Context:** [plan.md](./plan.md) · v2 Decision 1 · addresses the **#1 RISK** (Cube dataSource =
code, not YAML). Depends on Phase 09 (`sourceType` on the connector).

## Overview
- **Priority:** P1.
- **Status:** Planned.
- One registry declaring, per source type: the **connection field schema** (what the form
  renders + validates), the **Cube driver kind**, and **capability flags** (introspectable,
  joinable, supportsRollupJoin). Plus the contract that maps a connector → a Cube `dataSource`
  the warehouse can actually serve queries from.

## Key Insights
- `cube-dev/cube/cube.js` `driverFactory: ({ securityContext }) => ({ type:'trino', … })` is a
  single hard-coded driver. Real multi-source needs `({ securityContext, dataSource }) =>` +
  `data_source:` per cube. cube.js is **code** the YAML write-back can't touch.
- **Resolution:** playground writes a **`datasources.config.json` registry** (config, not code);
  a generalized `cube.js` reads it at request time and builds the driver per `dataSource`. cube.js
  is edited **once** (manual/PR, documented here) to consume the registry — then adding a source =
  appending a registry entry. No further code changes.
- The existing `add-connector.tsx` already lists the source catalog (BigQuery/Snowflake/Postgres/
  Trino/…); this phase gives those tiles real field schemas + driver mappings.

## Requirements
**Functional**
- `source-type-registry.ts`: `SourceType` = `{ id, label, driverType, category, fields: Field[],
  caps: { introspect, sameSourceJoins, crossSourceRollupJoin } }`. Cover Trino (reference) +
  the SQL/`information_schema` family (Postgres, MySQL, Redshift, Snowflake) + BigQuery; mark
  the rest `caps.introspect=false` ("connect, modeling coming").
- `Field` = `{ key, label, type: text|password|number|select|file, required, placeholder, default }`
  — drives the dynamic form (Phase 12) AND server-side validation (single source of truth).
- `datasource-registry-writer.ts`: given a provisioned connector, write/merge its descriptor into
  `datasources.config.json` (non-secret coordinates only; secrets resolved by cube.js from env or
  a sidecar the operator controls — secrets do NOT go into this JSON). Atomic write (reuse
  `schema-write-file-ops` tmp+bak pattern).
- Connection-test endpoint contract `POST /api/onboarding/connectors/test` (impl in Phase 12)
  dispatches by `driverType`.

**Non-functional**
- Registry is the ONLY place a source type is declared (form, validation, driver, caps all read it).

## Architecture
`source-type-registry` (pure data) ← consumed by FE form (Phase 12) + BE validation + profiler
dispatch (Phase 11). `datasource-registry-writer` ← provisioning (Phase 12). cube.js reads
`datasources.config.json` (one-time generalization, documented).

## Related Code Files
- **Create:** `server/src/services/source-type-registry.ts`,
  `server/src/services/datasource-registry-writer.ts`.
- **Modify (documented one-time, sibling repo):** `cube-dev/cube/cube.js` `driverFactory` →
  read `datasources.config.json`; cubes gain `data_source:` (default keeps Trino behavior).
- **Read for context:** `vite-plugins/schema-write-file-ops.ts`, `add-connector.tsx`,
  `trino-profiler-config.ts`.

## Implementation Steps
1. Author `source-type-registry.ts` with field schemas + caps for the introspectable set.
2. `datasource-registry-writer.ts`: atomic merge into `datasources.config.json`; secret-free.
3. Document + (if window allows) implement the `cube.js` generalization: registry-driven
   `driverFactory({ securityContext, dataSource })`; Trino path unchanged when `dataSource` unset.
4. Define the test-connection contract (shared types) consumed by Phase 12.

## Todo
- [ ] source-type-registry (fields + caps) for introspectable types
- [ ] datasource-registry-writer (atomic, secret-free)
- [ ] cube.js generalization (documented; implement if feasible) + default-Trino safety
- [ ] test-connection contract types

## Success Criteria
- FE renders correct fields for each source type purely from the registry.
- Provisioning a Postgres connector writes a valid `datasources.config.json` entry; Trino default
  path still serves existing games with no `data_source:` on legacy cubes.

## Risks & Mitigation
- **cube.js edit can't land in window:** provisioning still writes the registry entry + surfaces a
  "manual cube.js step required" banner; connector marked `degraded` until wired. No silent break.
- **Secret placement:** registry JSON is secret-free; secrets stay in the vault (Phase 09) +
  operator env. Document the resolution path so cube.js never reads ciphertext.

## Security
- Registry JSON is config (no secrets). Write path under `enforce-write-roles`. Host validation
  (SSRF) enforced in Phase 12 using `Field` metadata.

## Next
Phase 11 (profiler dispatch by `driverType`), Phase 12 (form + provisioning consume registry).
