# Schema-per-Game Membership → CubeStore Rollup Serve-Layer

Promote the nightly Trino segment-membership tables from **write-only system-of-record**
to a **fast serve-layer** for membership-shaped reads (size-over-time, point-in-time
count, entered/exited delta, optional full-cohort member list) — by giving each game its
own lakehouse schema and modeling the fact in Cube so a per-game CubeStore rollup answers
those reads sub-second, instead of SQLite refresh-log points / cold `game_integration` scans.

## How this leverages the new `segment_membership_*` tables

The lakehouse tables (`segment_membership_daily` + `_delta`, shipped commit `ac25dfc`) hold
the **full** daily membership of every predicate segment. Today nothing reads them — the UI
still serves size-history from SQLite `segment_refresh_log` (capped, refresh-cadence points)
and recomputes everything else live against cold Trino. This plan turns those tables into the
source the serve-layer is built from:

| Read | Today | After this plan |
|------|-------|-----------------|
| Size sparkline / "vs last week" | SQLite `segment_refresh_log` (sparse, capped) | **rollup over `segment_membership_daily`** — full daily, exact |
| Point-in-time cohort size | `uid_count` heartbeat | **rollup** (`members_exact`) |
| entered/exited feed | — (didn't exist) | **`segment_membership_delta`** cube (new surface) |
| Full member list | capped `uid_list_json` in SQLite | **lakehouse paginated** (optional, Phase 04) |
| Event-metric cards (KPI/line/bar) | card_cache(SQLite) + cold `game_integration` | **unchanged** — membership can't serve event metrics without a join (out of scope) |

**Why schema-per-game is the unlock (not a perf trick):** read-scan perf is already handled by
the table's `game_id` partition pruning. Schema-per-game matters because it fits cube.js's
existing per-game routing — each game's cube reads `stag_iceberg.<game_schema>.segment_membership_daily`,
so the rollup lands in that game's own orchestrator namespace with **no cross-game cube** and
no bespoke `_shared` router hack. It also gives independent write-commit lineage + per-game
governance/retention for free.

## Scope boundary

- IN: per-game write target, per-game Cube model + `members_daily` rollup, swap the size-history
  serve path onto the rollup (SQLite kept as fallback).
- OUT (this round): speeding up event-metric cards (needs membership↔event join — separate effort);
  parallel-per-game writes; deleting the SQLite refresh-log path.

## Phases

| # | Phase | Status |
|---|-------|--------|
| 00 | [Validation spike — perms, cross-catalog cube read, COMPILE_CONTEXT, rollup build](phase-00-validation-spike.md) | ⬜ not started — **gates the rest** |
| 01 | [Schema-per-game write path](phase-01-schema-per-game-write.md) | ⬜ not started |
| 02 | [Per-game Cube model + members_daily rollup](phase-02-cube-model-and-rollup.md) | ⬜ not started |
| 03 | [Swap size-history serve path onto the rollup](phase-03-serve-layer-swap.md) | ⬜ not started |
| 04 | [Optional — entered/exited feed + full-cohort member list](phase-04-optional-delta-and-member-list.md) | ⬜ deferred |

## Key dependencies / sequencing

- Phase 00 MUST pass before 01–03 (perms + cross-catalog FQN + per-game COMPILE_CONTEXT are
  assumptions, not yet verified live).
- 01 → 02 (model points at per-game schemas the writer creates).
- 02 → 03 (serve path needs the rollup registered + sealing).
- Cube serving instance runs `DEV_MODE=false` → **no hot reload**; 02 requires a Cube restart.

## Locked context (from prior work, do not re-litigate)

- Writer/job already correct + live (commit `ac25dfc`); SQLite read path stays as fallback
  per decision #5 of `plans/260610-1517-segment-membership-lakehouse-snapshot/`.
- Rollup additivity: `members` = `count_distinct_approx` (HLL, merges across grains for
  week/month); `members_exact` = exact point-in-time. uid is unique per partition.
