# Persist triggered pre-agg builds + harden the build parser

Status: DONE (implemented + unit-tested; live verify needs a Build click) · Owner: khoitn · Branch: main

## Outcome (260613)

- All changes landed. Server tsc clean; tests: triggered-build-record 4, parser 19 (+targetTableName
  case), build-progress 11, merge 14, routes 16 — all green. build-progress trimmed 225→125 lines via
  preagg-build-events extraction. Lessons-learned entry added.
- Live verify: click Build for a game on `/admin/preagg-runs`; on window close a `build`-badged row
  appears in Sweep history immediately (no 5-min collector wait), summarising the rollups built.

## Problem

A manually triggered build (`/admin/preagg-runs` → Build) materializes partitions, but
afterward shows no durable summary. Two data paths disagree:

- **Live build panel** (`aggregateBuildEvents`): liberal — counts any `Performing query
  completed` with a `preAggregationId`. Provably captured the 16:17 jus_vn build (8/9). But
  ephemeral (10-min linger, lost on restart).
- **Sweep history** (`preagg-run-parser` → store): strict — only completion lines whose table
  matches `CREATE TABLE preagg_<game>.…`, AND only when bracketed inside a `Refresh Scheduler
  Interval` window. The triggered build's work either failed the strict table match or got
  scattered across the scoped worker's 20s scheduler-interval fragments → the operator saw
  "nothing rebuilt — every refresh key matched".

Probe stays (it answers "serving now" for the readiness matrix). This adds a durable BUILD-JOB
record sourced from the data the live panel already proved correct.

## Decisions (user-confirmed 260613)

1. **Persist triggered builds.** On trigger-window close, record one durable history row
   (`source: 'triggered-build'`) from `aggregateBuildEvents` — immediate, no collector-cadence wait.
2. **Fix parser too.** Add `targetTableName` to `parseBuildLine`'s table-source fallback so
   scheduled sweeps stop dropping completion lines that carry the table only there.
3. Stop the scoped-window `'window'` snapshot from also feeding the collector (it produced the
   fragmentary/confusing scheduled rows for the same build) — recordTriggeredBuild now owns that
   window. Keep the `'prescope'` snapshot (preserves the outgoing all-games sweep tail).

## Changes

- `preagg-build-events.ts` (NEW) — extract pure `aggregateBuildEvents` + types out of
  build-progress (breaks the trigger→record→build-progress import cycle; trims build-progress <200).
- `preagg-build-progress.ts` — import from preagg-build-events (re-export types for back-compat).
- `preagg-triggered-build-record.ts` (NEW) — `buildTriggeredSweep(game, started, finished, lines)`
  pure → {sweep, items} grouped by cube; `recordTriggeredBuild(db, …)` → upsertSweep. Never throws.
- `preagg-trigger.ts` — in finally: read window lines once → recordTriggeredBuild (skip on degraded
  read); drop the `'window'` snapshot write.
- `preagg-run-parser.ts` — `parseBuildLine` table source: `newVersionEntry.table_name ?? queryKey
  ?? targetTableName`.
- `types/preagg-run.ts` (server + `src/`) — add `'triggered-build'` to `SweepSource`.
- `preagg-runs-sweep-row.tsx` — `build` source badge (brand tone) next to the timestamp.

## Outcome mapping (triggered build → existing taxonomy)

Per cube: failed rollup → `failed`; else partitions>0 → `sealed` (lands in "Built this sweep");
else `unbuilt`. One item per cube; rollups folded into `rollupsBuilt[]`. Header: gamesCount=1,
rollupsTotal=#rollups, durationMs = finished−started (the real window time).

## Tests

- `preagg-triggered-build-record.test.ts` (NEW) — buildTriggeredSweep: finished/failed/empty,
  cube grouping, counts, idempotency key = startedAt.
- `preagg-build-events.test.ts` (moved assertions) — aggregateBuildEvents still correct post-extract.
- `preagg-run-parser.test.ts` — completion line carrying table only in `targetTableName` is captured.
- FE: triggered-build row renders the `build` badge.

## Open questions

- Part-2 root cause unconfirmed against a live failing sample (logs wiped post-restore). The
  `targetTableName` gap is real and grounded in code; if the true drop cause differs, Part 1 still
  fully delivers the user's summary. Will note in the lessons entry.
