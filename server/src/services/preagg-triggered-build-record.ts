/**
 * Durable history record for one on-demand (Build button) pre-aggregation build.
 *
 * The scheduled-sweep path infers builds from worker logs bracketed by "Refresh
 * Scheduler Interval" markers, then attributes them to a game by the
 * `CREATE TABLE preagg_<game>.` table name. A triggered build sidesteps both
 * fragilities: we already KNOW the game (trigger scope) and the live build panel
 * already folds the same logs reliably via aggregateBuildEvents. So at window
 * close we capture that fold directly into ONE durable sweep row — immediately,
 * without waiting on the collector's 5-min cadence.
 *
 * Mapping into the existing sweep taxonomy (so the row renders in the normal
 * history list): per cube — any failed rollup → 'failed'; else partitions built
 * → 'sealed' (lands in the "Built this sweep" group); else 'unbuilt'.
 */

import type Database from 'better-sqlite3';
import { aggregateBuildEvents, type BuildRollupProgress } from './preagg-build-events.js';
import { upsertSweep } from '../db/preagg-run-store.js';
import type {
  Outcome,
  PreaggSweepInput,
  PreaggSweepItemInput,
  RollupBuildStat,
} from '../types/preagg-run.js';

export interface TriggeredBuildInput {
  game: string;
  startedAt: string; // ISO — also the upsert idempotency key
  finishedAt: string; // ISO
  /** Raw worker log lines for the build window (Docker-timestamped). */
  lines: string[];
}

export interface TriggeredBuildRecord {
  sweep: PreaggSweepInput;
  items: PreaggSweepItemInput[];
}

/** Fold one cube's rollup-progress entries into a single sweep item. */
function cubeItem(game: string, cube: string, rollups: BuildRollupProgress[], observedAt: string): PreaggSweepItemInput {
  const partitionsBuilt = rollups.reduce((s, r) => s + r.partitionsCompleted, 0);
  const failed = rollups.find((r) => r.phase === 'failed');
  const outcome: Outcome = failed ? 'failed' : partitionsBuilt > 0 ? 'sealed' : 'unbuilt';

  const rollupsBuilt: RollupBuildStat[] = rollups
    .filter((r) => r.partitionsCompleted > 0)
    // Durations aren't tracked per partition in the event fold — 0 = unknown.
    .map((r) => ({ rollup: r.rollup, partitions: r.partitionsCompleted, buildMs: 0 }));

  return {
    sweepId: 0, // placeholder — upsertSweep injects the real id
    game,
    cube,
    rollup: failed?.rollup ?? null,
    outcome,
    serveable: outcome === 'sealed',
    lastSealedAt: outcome === 'sealed' ? observedAt : null,
    errorSig: failed?.errorSig ?? null,
    errorMessage: failed?.errorMessage ?? null,
    observedAt,
    buildMs: null, // per-partition durations not captured by the event fold
    partitionsBuilt: partitionsBuilt > 0 ? partitionsBuilt : null,
    rollupsBuilt: rollupsBuilt.length > 0 ? rollupsBuilt : null,
  };
}

/**
 * Pure: turn a triggered build's worker logs into a sweep header + items.
 * Exported for unit testing without a DB.
 */
export function buildTriggeredSweep(input: TriggeredBuildInput): TriggeredBuildRecord {
  const progress = aggregateBuildEvents(input.lines);

  // Group rollup-progress entries by cube — one item per cube, matching the
  // (game × cube) item grain the store and the detail panel already render.
  const byCube = new Map<string, BuildRollupProgress[]>();
  for (const p of progress) {
    const list = byCube.get(p.cube) ?? [];
    list.push(p);
    byCube.set(p.cube, list);
  }

  const items = [...byCube.entries()].map(([cube, rollups]) =>
    cubeItem(input.game, cube, rollups, input.finishedAt),
  );

  let sealedCount = 0;
  let failedCount = 0;
  let unbuiltCount = 0;
  for (const it of items) {
    if (it.outcome === 'sealed') sealedCount++;
    else if (it.outcome === 'failed') failedCount++;
    else unbuiltCount++;
  }

  const durationMs = (() => {
    try {
      return new Date(input.finishedAt).getTime() - new Date(input.startedAt).getTime();
    } catch {
      return null;
    }
  })();

  const sweep: PreaggSweepInput = {
    startedAt: input.startedAt,
    endedAt: input.finishedAt,
    durationMs,
    source: 'triggered-build',
    gamesCount: 1,
    rollupsTotal: progress.length,
    sealedCount,
    staleCount: 0,
    failedCount,
    unbuiltCount,
    collectorStatus: 'online',
  };

  return { sweep, items };
}

/**
 * Persist a triggered build's outcome as a durable history row. Idempotent on
 * startedAt — a re-trigger of the same window overwrites rather than duplicates.
 * Never throws: a recording failure must not break the build/restore flow.
 */
export function recordTriggeredBuild(db: Database.Database, input: TriggeredBuildInput): void {
  try {
    const { sweep, items } = buildTriggeredSweep(input);
    upsertSweep(db, sweep, items);
  } catch {
    // Best-effort history — losing one record never blocks the build.
  }
}
