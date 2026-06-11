/**
 * Live per-rollup pre-aggregation build progress.
 *
 * While a triggered build (preagg-trigger.ts) is running, the refresh worker's
 * info-level logs carry `preAggregationId` on the queue/build lifecycle lines:
 *   "Added to queue"              → rollup queued
 *   "Performing query"            → a partition build started
 *   "Performing query completed"  → a partition build finished
 *   failure lines (shared with preagg-run-parser) → build error
 *
 * This module re-reads the worker logs since the trigger window opened and
 * folds those events into one phase per rollup — a stateless aggregation, so a
 * poll is always consistent with the logs and a server restart loses nothing.
 *
 * Honesty note: partition SEALS are trace-only (never logged at info), so the
 * terminal per-rollup phase is 'finished' = "all observed partition builds
 * completed without error", not "sealed". Seal truth arrives via the
 * serveability probe after the window closes.
 */

import { readWorkerLogsSince, DockerLogError } from './docker-log-reader.js';
import {
  splitDockerTimestamp,
  isFailureLine,
  classifyError,
} from './preagg-run-parser.js';
import { getTriggerState } from './preagg-trigger.js';

// ---------------------------------------------------------------------------
// Types (mirrored in src/types/preagg-run.ts — keep in sync)
// ---------------------------------------------------------------------------

export type BuildRollupPhase = 'queued' | 'building' | 'finished' | 'failed';

export interface BuildRollupProgress {
  /** "<cube>.<rollup>" — Cube's preAggregationId. */
  id: string;
  cube: string;
  rollup: string;
  phase: BuildRollupPhase;
  /** Partition builds observed started / completed (a rollup = many partitions). */
  partitionsStarted: number;
  partitionsCompleted: number;
  errorSig: string | null;
  errorMessage: string | null;
  lastEventAt: string | null;
}

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
// Pure aggregation (exported for tests)
// ---------------------------------------------------------------------------

interface RollupAcc {
  queuedSeen: boolean;
  started: number;
  completed: number;
  errorSig: string | null;
  errorMessage: string | null;
  lastEventAt: string | null;
  firstSeenIdx: number;
}

const MAX_ERROR_LEN = 500;

/** Fold raw worker log lines into per-rollup build progress entries. */
export function aggregateBuildEvents(lines: string[]): BuildRollupProgress[] {
  const acc = new Map<string, RollupAcc>();

  const touch = (id: string, ts: string | null, idx: number): RollupAcc => {
    let r = acc.get(id);
    if (!r) {
      r = {
        queuedSeen: false, started: 0, completed: 0,
        errorSig: null, errorMessage: null, lastEventAt: null, firstSeenIdx: idx,
      };
      acc.set(id, r);
    }
    if (ts) r.lastEventAt = ts;
    return r;
  };

  for (let i = 0; i < lines.length; i++) {
    const { ts, body } = splitDockerTimestamp(lines[i].trim());
    if (!body.startsWith('{')) continue;

    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(body) as Record<string, unknown>; } catch { continue; }

    const id = parsed['preAggregationId'];
    if (typeof id !== 'string' || !id) continue;
    const message = String(parsed['message'] ?? '');

    // Order matters: 'Performing query completed' contains 'Performing query'.
    if (message.includes('Performing query completed')) {
      touch(id, ts, i).completed++;
    } else if (message.includes('Performing query')) {
      touch(id, ts, i).started++;
    } else if (message.includes('Added to queue')) {
      touch(id, ts, i).queuedSeen = true;
    } else if (isFailureLine(message)) {
      const r = touch(id, ts, i);
      const raw = String(parsed['error'] ?? message).slice(0, MAX_ERROR_LEN);
      r.errorSig = classifyError(raw);
      r.errorMessage = raw;
    }
  }

  return [...acc.entries()]
    // Stable order: first log appearance — matches the worker's actual plan.
    .sort((a, b) => a[1].firstSeenIdx - b[1].firstSeenIdx)
    .map(([id, r]) => {
      const dot = id.indexOf('.');
      const phase: BuildRollupPhase =
        r.errorMessage !== null ? 'failed'
        : r.started > r.completed ? 'building'
        : r.completed > 0 ? 'finished'
        : 'queued';
      return {
        id,
        cube: dot > 0 ? id.slice(0, dot) : id,
        rollup: dot > 0 ? id.slice(dot + 1) : '',
        phase,
        partitionsStarted: r.started,
        partitionsCompleted: r.completed,
        errorSig: r.errorSig,
        errorMessage: r.errorMessage,
        lastEventAt: r.lastEventAt,
      };
    });
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

  return {
    game: trigger.game,
    startedAt: trigger.startedAt,
    finishedAt: trigger.finishedAt,
    degraded,
    rollups,
    totals,
  };
}
