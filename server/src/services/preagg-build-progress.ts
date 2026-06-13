/**
 * Live per-rollup pre-aggregation build progress (HTTP-facing read).
 *
 * Re-reads the worker logs since the trigger window opened and folds them into
 * one phase per rollup via aggregateBuildEvents (preagg-build-events.ts) — a
 * stateless aggregation, so a poll is always consistent with the logs and a
 * server restart loses nothing. The fold itself lives in preagg-build-events to
 * avoid an import cycle and is shared with the triggered-build recorder.
 *
 * Honesty note: partition SEALS are trace-only (never logged at info), so the
 * terminal per-rollup phase is 'finished' = "all observed partition builds
 * completed without error", not "sealed". Seal truth arrives via the
 * serveability probe after the window closes.
 */

import { readWorkerLogsSince, DockerLogError } from './docker-log-reader.js';
import {
  aggregateBuildEvents,
  type BuildRollupPhase,
  type BuildRollupProgress,
} from './preagg-build-events.js';
import { getTriggerState } from './preagg-trigger.js';

// Re-export so existing importers (panel wire types, tests) keep their path.
export { aggregateBuildEvents };
export type { BuildRollupPhase, BuildRollupProgress };

// ---------------------------------------------------------------------------
// Types (mirrored in src/types/preagg-run.ts — keep in sync)
// ---------------------------------------------------------------------------

export interface BuildProgress {
  game: string | null;
  startedAt: string;
  /** Trigger script finish time; null while the build window is open. */
  finishedAt: string | null;
  /** True when docker logs were unreadable — rollup list may be empty/stale. */
  degraded: boolean;
  rollups: BuildRollupProgress[];
  totals: { queued: number; building: number; finished: number; failed: number };
}

// ---------------------------------------------------------------------------
// Last-window snapshot fallback
// ---------------------------------------------------------------------------

/**
 * The --restore step of the trigger script recreates the worker container,
 * which DESTROYS its log history — so a poll right after the window closes
 * reads zero build lines and the final checklist would blank out. Keep the
 * last non-empty aggregation per window in memory and serve it whenever a
 * later read of the SAME window comes back empty. Lost on server restart,
 * which is acceptable: the linger window is 10 minutes.
 */
let lastWindowSnapshot: BuildProgress | null = null;

/** Test-only reset. */
export function __resetBuildProgressSnapshot(): void {
  lastWindowSnapshot = null;
}

/** Cache non-empty progress; recover the cached window when logs vanished. */
export function applySnapshotFallback(progress: BuildProgress): BuildProgress {
  if (progress.rollups.length > 0) {
    lastWindowSnapshot = progress;
    return progress;
  }
  if (lastWindowSnapshot && lastWindowSnapshot.startedAt === progress.startedAt) {
    // Same trigger window, logs gone — serve the snapshot but keep the live
    // window metadata (finishedAt lands after the snapshot was taken).
    return { ...lastWindowSnapshot, finishedAt: progress.finishedAt, degraded: progress.degraded };
  }
  return progress;
}

// ---------------------------------------------------------------------------
// Live read keyed off the trigger window
// ---------------------------------------------------------------------------

const DEFAULT_CONTAINER = 'cube-playground-cube-refresh-worker-dev';
/** Keep serving the finished window for a while so the UI can show the final
 *  state without racing the last poll; afterwards report null (idle). */
const LINGER_AFTER_FINISH_MS = 10 * 60 * 1000;

/**
 * Snapshot the current (or just-finished) triggered build's per-rollup
 * progress. Returns null when no trigger window is active or recent.
 */
export async function getBuildProgress(): Promise<BuildProgress | null> {
  const trigger = getTriggerState();
  if (!trigger.startedAt) return null;
  if (trigger.phase === 'idle') return null;
  if (
    trigger.phase !== 'running' &&
    (!trigger.finishedAt ||
      Date.now() - new Date(trigger.finishedAt).getTime() > LINGER_AFTER_FINISH_MS)
  ) {
    return null;
  }

  const container = process.env.PREAGG_WORKER_CONTAINER ?? DEFAULT_CONTAINER;
  const sinceUnix = Math.floor(new Date(trigger.startedAt).getTime() / 1000);

  let rollups: BuildRollupProgress[] = [];
  let degraded = false;
  try {
    const lines = await readWorkerLogsSince(container, sinceUnix);
    rollups = aggregateBuildEvents(lines);
  } catch (err) {
    if (!(err instanceof DockerLogError)) throw err;
    degraded = true;
  }

  const totals = { queued: 0, building: 0, finished: 0, failed: 0 };
  for (const r of rollups) totals[r.phase]++;

  return applySnapshotFallback({
    game: trigger.game,
    startedAt: trigger.startedAt,
    finishedAt: trigger.finishedAt,
    degraded,
    rollups,
    totals,
  });
}
