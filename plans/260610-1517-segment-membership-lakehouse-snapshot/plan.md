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
| 01 | [Iceberg DDL — daily + delta tables](phase-01-iceberg-ddl.md) | ✅ done — both tables live in stag_iceberg.khoitn; row-level DELETE confirmed |
| 02 | [Snapshot writer service (compile → cross-catalog INSERT)](phase-02-snapshot-writer.md) | ✅ done — full cohort verified (Cube total == Trino count, idempotent, 8.3M-row segment landed) |
| 03 | [Delta computation (D vs D-1 diff)](phase-03-delta-compute.md) | ✅ done — both directions validated; scoped to segments snapshotted on D |
| 04B | Nightly job + heartbeat + index.ts wiring | ✅ done — full run: 13/13 segments written, delta written; gated by SEGMENT_SNAPSHOT_ENABLED |
| 04A | [Cube model + rollup](phase-04-cube-model-and-schedule.md) | ⏸️ artifact-only — YAML written, NOT wired/restarted (see deviations) |

## Implementation outcome (2026-06-10)
- **tsc clean · 1138 tests pass (150 files) · 18→19 new unit tests · live writes correct at 8.3M-row scale.**
- code-reviewer: no critical/blocking; H1/H2/M1–M5/L1 applied or documented.

### Deviations from plan (decided during build, none reverse a locked decision)
1. **Dropped the `trino-client` npm dep** — reused the existing dependency-free `trino-rest-client.ts` (codebase convention). Added one optional `timeoutMs` arg to `runQuery`.
2. **Strip Cube's trailing `LIMIT`/`FETCH FIRST`** from compiled SQL — without it the snapshot caps at 10k, not the full cohort. The key correctness fix.
3. **Delta scoped to segments snapshotted on D** (tighter than the plan's whole-table FULL OUTER JOIN) — avoids false 'exited' for a segment that failed to snapshot that day.
4. **Job gated behind `SEGMENT_SNAPSHOT_ENABLED` (default off)** — safety so shared-Trino writes can't fire from an unintended instance. Enable on exactly one instance.
5. **Phase 04A NOT activated** — the cross-game cube has no home in cube.js's per-game `repositoryFactory`; wiring it needs a shared-models path + a multi-tenant Cube restart. Per locked decision #5 (keep SQLite read path, swap later), deferred as a ready-to-deploy artifact at `cube-dev/cube/model/_shared/segment_membership.yml`.

## Key dependencies
- Trino client able to run DDL/INSERT against `stag_iceberg` (Phase 02 needs a write-capable
  Trino connection distinct from Cube's read path — confirm in Phase 01).
- Cube `/sql` returns parameterized SQL (`[sql, params]`); params must be safely inlined
  before wrapping (Phase 02 core wrinkle).

## Resolved decisions (user, 2026-06-10)
1. **Partition spec**: partition by **`(snapshot_date, game_id, segment_id)`** — supports
   100s of segments per game; point-by-segment reads dominate. Sort by `uid`.
2. **Trino write connection**: creds live in **`cube-dev/.env`** — reuse them for the
   write client (Phase 02). No new credential provisioning.
3. **Backfill**: **start fresh** — first run = all `entered`, deltas accrue forward.
