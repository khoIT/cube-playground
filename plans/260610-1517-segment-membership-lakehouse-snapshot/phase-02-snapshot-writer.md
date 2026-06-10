# Phase 02 — Snapshot writer (compile → cross-catalog INSERT)

**Priority:** P0 · **Status:** pending · **Depends on:** Phase 01

## Overview
Per segment, compile its membership query to Trino SQL via Cube `/sql`, then run a
cross-catalog `INSERT … SELECT` so Trino lands the **full** cohort into
`segment_membership_daily` — no app-side row shipping, no `MAX_UID_LIST` cap.

## Key insight / architecture
- The app currently reaches Trino **only through Cube** — there is **no direct Trino
  client** (no `trino`/`presto` dep in `server/package.json`). Cube `/sql` only *returns*
  SQL; it will not execute an INSERT. → **Phase 02 must add a direct Trino client +
  write connection** to `stag_iceberg` (a Trino coordinator session that can see both
  `game_integration` and `stag_iceberg`).
- Cube `/sql` returns **parameterized** SQL: `{ sql: [sqlText, params[]] }`. Params must be
  safely inlined (typed quoting: numbers raw, strings single-quoted+escaped, dates as
  `DATE '…'`) before wrapping. Source is our own segment defs (internal), but quote correctly.
- The compiled SELECT references `game_integration` tables unqualified, relying on the
  session's default catalog. Run with **session catalog = the game_integration catalog**
  so the SELECT resolves, and **fully-qualify the INSERT target** as
  `stag_iceberg.khoitn.segment_membership_daily`.

## Write sequence (per segment S, game G, date D)
```
-- idempotent re-run: clear the partition slice first
DELETE FROM stag_iceberg.khoitn.segment_membership_daily
 WHERE snapshot_date = DATE 'D' AND game_id = 'G' AND segment_id = 'S';
-- land full membership
INSERT INTO stag_iceberg.khoitn.segment_membership_daily
SELECT DATE 'D' AS snapshot_date, 'G' AS game_id, 'S' AS segment_id, m.uid
FROM ( <inlined compiled membership SELECT, identity column aliased AS uid> ) m;
```
If the Iceberg connector lacks row-level `DELETE`, use `INSERT OVERWRITE` scoped to the
partition instead (decided in Phase 01 smoke test).

## Implementation steps
1. Add Trino client dep (e.g. `trino-client`) + a `server/src/lakehouse/trino-write-client.ts`
   wrapper (coordinator URL, catalog/schema, auth from env; AbortController timeout like cube-client).
2. `server/src/lakehouse/segment-snapshot-writer.ts`:
   - Build identity-only query: `{ ...JSON.parse(cube_query_json), dimensions: [identity], limit: undefined }`.
   - `cubeClient.sqlWithCtx(query, ctx)` → extract `[sqlText, params]`.
   - `inlineParams(sqlText, params)` helper (typed, escaped) → standalone SELECT.
   - Compose DELETE + INSERT; run on the Trino write client in one logical unit.
3. Skip segments without `game_id` or `cube_query_json` (log + continue).
4. Return `{ segment_id, game_id, snapshot_date, status, error? }` for the job log (Phase 04).

## Related code files
- Create: `server/src/lakehouse/trino-write-client.ts`, `server/src/lakehouse/segment-snapshot-writer.ts`,
  `server/src/lakehouse/inline-sql-params.ts`
- Read: `server/src/services/cube-client.ts` (`sqlWithCtx`), `server/src/jobs/refresh-segment.ts` (identity-only query shape)
- Modify: `server/package.json` (Trino client dep)

## Success criteria
- Running the writer for one real segment lands its **full** uid set (matches Cube `total:true` count)
  in `segment_membership_daily`, idempotent on re-run (no dupes).
- Param inlining verified against a segment whose predicate carries string/number/date filters.

## Security / correctness
- `inlineParams` must escape single quotes + type-cast; add a unit test with adversarial values.
- Trino write creds in env/Vault only — never in code or SQLite. Reuse the prod Vault path pattern.

## Open questions
- Exact Trino coordinator endpoint + catalog name for `stag_iceberg` and for `game_integration`
  (session default). → needs the connection details from Phase 01.

## Next
Phase 03 diffs consecutive snapshots into the delta table.
