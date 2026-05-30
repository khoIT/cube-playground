---
phase: 1
title: "Trino introspection client"
status: complete
priority: P1
effort: "6h"
dependencies: []
---

# Phase 1: Trino introspection client

## Overview
Give cube-playground its first direct line to the warehouse: a Trino client that lists
schemas/tables/columns and profiles them. This is the only new capability that breaks the
credential-free design, so it is isolated in one service behind a guarded config.

## Requirements
- Functional: connect to Trino with its own credentials; list tables in a schema; per column return type, null %, approx distinct count, min/max, and a small sample of distinct values; bounded row/time cost.
- Non-functional: read-only (no DDL/DML); query timeout; SSRF-safe (no client-supplied host); secrets never logged or returned to the client.

## Architecture
- New dep `trino` (or `presto-client`) in `server/package.json`.
- New `server/src/services/trino-profiler.ts`:
  - `listTables(schema): TableMeta[]` via `information_schema.tables` / `.columns`.
  - `profileTable(schema, table): ColumnProfile[]` — one bounded query per table using `approx_distinct(col)`, `count(*)`, `count(col)`, `min/max`, plus a `TABLESAMPLE`/`LIMIT`-bounded distinct-value sample. Prefer `SHOW STATS FOR` where available to avoid full scans.
  - Hard caps: max columns/table, max sample rows, statement timeout.
<!-- Updated: Validation Session 1 — connector = warehouse profile nested under a workspace -->
- Credential config: a **connector** is a warehouse connection profile (creds + catalog) and a NEW entity nested under a workspace (`workspace → connector → dataset → tables`; a workspace holds many connectors). Back it with an env-seeded default connector (`TRINO_PROFILER_HOST/PORT/USER/PASS/CATALOG/SSL`) for `game_integration`, plus a store/config for additional connectors. Do NOT overload `workspaces.config.json` (that defines Cube *endpoints*, a different role). Default catalog `game_integration`. Re-derive/import the per-game `GAME_SCHEMA` map documented in `cube-dev/cube/cube.js:130-139` (copy as a small config constant; do NOT depend on the sibling repo at runtime).
- Feature gate: profiler disabled unless creds present; surfaces a clear "not configured" state.

## Related Code Files
- Create: `server/src/services/trino-profiler.ts`, `server/src/services/trino-profiler-config.ts`, `server/src/types/raw-schema.ts` (TableMeta / ColumnProfile).
- Modify: `server/package.json` (dep), `workspaces.config.json` + `workspaces-config-loader.ts` (optional trino override), `.env.example`.
- Read for context: `server/src/services/cube-client.ts` (fetch/timeout pattern), `workspaces-config-loader.ts:16-50` (SSRF guard), `cube-dev/cube/cube.js:130-139` (driver config + schema map).

## Implementation Steps
1. Add Trino client dep; pin version.
2. Write `trino-profiler-config.ts` — load + validate creds (Zod); export `isProfilerConfigured()`.
3. Implement `listTables` against `information_schema`.
4. Implement `profileTable` with bounded stats + sample queries; prefer `SHOW STATS`.
5. Define `ColumnProfile` type (name, dataType, nullPct, approxDistinct, isUnique, min, max, sampleValues[]).
6. Enforce caps + statement timeout; redact creds from errors.
7. Manual smoke test against a local Trino schema.

## Success Criteria
- [x] `profileTable` returns typed profiles for a real schema within the time cap.
- [x] No warehouse credentials appear in responses or logs.
- [x] Profiler cleanly reports "not configured" when creds absent.
- [x] Read-only verified — no statement can mutate the warehouse.

## Risk Assessment
- **Full-scan cost on huge tables** → prefer `SHOW STATS`, cap with `TABLESAMPLE`/`LIMIT`, statement timeout.
- **Credential leak / SSRF** → server-owned host only, no client input; secrets redacted. Flag for `/ck:security` review before merge.
- **Trino dialect drift (Presto vs Trino)** → isolate SQL in one module; keep queries ANSI-ish.
