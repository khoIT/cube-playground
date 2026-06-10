# Phase 04 — Optional: entered/exited Feed + Full-Cohort Member List

**Priority:** P2. **Status:** deferred (build only if there's demand after Phase 03).
Two net-new surfaces the lakehouse makes possible. Independent of each other — cherry-pick.

## 04A — entered/exited delta feed (from `segment_membership_delta`)
- Leverage: the `_delta` table (per-game after Phase 01) already holds `change ∈ {entered, exited}`
  per uid per day — a surface that did **not** exist before.
- Model: a small per-game `segment_membership_delta` cube; measures `entered`/`exited`
  (`count` filtered by `change`), dims `snapshot_date`, `segment_id`. Optional `changes_daily` rollup.
- UI: a "churn" strip on the segment Monitor/Insights — net change, entered vs exited counts over
  time. Reuses the Phase 03 endpoint pattern.

## 04B — full-cohort member list (from `segment_membership_daily`)
- Leverage: replaces the capped `uid_list_json` (SQLite, `MAX_UID_LIST`) with the **full** cohort,
  browsable + paginated.
- Path: cube query `dimensions:[uid] filters:[segment_id, snapshot_date=latest]` with `limit/offset`.
  NOT a rollup (raw uid rows) — hits Iceberg directly, but partition-pruned (segment_id+date) and
  `sorted_by uid`, so it's a bounded scan, not a full table read. Cap page size.
- UI: the Members tab paginates against this instead of the SQLite uid list; show true cohort size.

## Success criteria (per sub-phase if built)
- 04A: entered/exited counts reconcile against a direct `_delta` count for a sample day.
- 04B: member-list page returns full-cohort rows (count matches `members_exact`), paginated,
  sub-second per page; SQLite uid_list path retired only after parity confirmed.

## Risks
- 04B raw-row reads are the one place that still touches Trino live (no rollup) — keep page size
  bounded and partition filters mandatory, or it degrades to a cold scan.
- Manual segments / pre-snapshot segments: fallback to existing SQLite list.

## Next
None — terminal/optional. If neither is wanted, the plan ends at Phase 03.
