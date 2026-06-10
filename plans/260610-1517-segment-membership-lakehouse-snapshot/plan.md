# Segment Membership → Lakehouse Daily Snapshot + Delta

Write each segment's **full daily membership** down to Trino (`stag_iceberg.khoitn`)
as a partitioned fact, derive a **change-delta** feed, and model it in Cube so our
own app and downstream consumers read deterministic, pre-aggregated cohorts —
instead of recomputing capped uid lists per request against cold Trino.

## Why
- Today: `refresh-segment` materializes a **capped** uid list (`MAX_UID_LIST`) into
  SQLite + a `uid_count` heartbeat in `segment_refresh_log`. Full cohort is discarded;
  size-history + member reads round-trip Cube/Trino live (cold-scan latency variance).
- Target: compute the cohort **once/day** in Trino, land the **whole** membership in
  Iceberg, serve many times via a Cube rollup. Decouples compute from serve.

## Locked decisions (user, 2026-06-10)
- Target store: **`stag_iceberg.khoitn`** on Trino (writable, parallel to `game_integration`).
- Grain: **snapshot_date × game_id × segment_id**, **full uid list** (no cap).
- Downstream wants **change deltas** (entered/exited) → store full snapshot AND derive delta.
- PII governance: not required now.
- Keep SQLite `MAX_UID_LIST` cap **as-is for now**; swap the UI read to the lakehouse later.

## Write path (verified feasible)
`segments.cube_query_json` + `dimensions:[identity]` → `cubeClient.sql()` (`/sql`,
cube-client.ts:146) → compiled Trino SELECT over `game_integration` → wrap as
`INSERT INTO stag_iceberg.khoitn.segment_membership_daily SELECT … FROM (<compiled>)`.
Cross-catalog INSERT runs entirely in Trino. Cube stays the only semantic source.

## Phases
| # | Phase | Status |
|---|-------|--------|
| 01 | [Iceberg DDL — daily + delta tables](phase-01-iceberg-ddl.md) | pending |
| 02 | [Snapshot writer service (compile → cross-catalog INSERT)](phase-02-snapshot-writer.md) | pending |
| 03 | [Delta computation (D vs D-1 diff)](phase-03-delta-compute.md) | pending |
| 04 | [Cube model + rollup + nightly job wiring](phase-04-cube-model-and-schedule.md) | pending |

## Key dependencies
- Trino client able to run DDL/INSERT against `stag_iceberg` (Phase 02 needs a write-capable
  Trino connection distinct from Cube's read path — confirm in Phase 01).
- Cube `/sql` returns parameterized SQL (`[sql, params]`); params must be safely inlined
  before wrapping (Phase 02 core wrinkle).

## Open questions
1. **Partition spec**: partition by `(snapshot_date, game_id)` + sort `segment_id`, or include
   `segment_id` in the partition? Depends on segment count (small-file risk). → Phase 01.
2. **Trino write connection**: does the app already hold Trino creds for `stag_iceberg`, or do we
   add a connection (separate from the Cube proxy)? → Phase 01/02.
3. Backfill: seed history from existing SQLite uid samples, or start fresh at first run? → Phase 03.
