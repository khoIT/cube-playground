/**
 * Pure fold of refresh-worker log lines into per-rollup build progress.
 *
 * Extracted from preagg-build-progress.ts so it can be consumed both by the live
 * progress endpoint AND by the triggered-build recorder without an import cycle
 * (the recorder is called from preagg-trigger.ts, which preagg-build-progress.ts
 * imports for trigger state). No I/O here — just the aggregation with edge cases.
 *
 * While a build runs the worker's info-level logs carry `preAggregationId` on the
 * queue/build lifecycle lines:
 *   "Added to queue"             → rollup queued
 *   "Performing query"           → a partition build started
 *   "Performing query completed" → a partition build finished
 *   failure lines (shared with preagg-run-parser) → build error
 *
 * Honesty note: partition SEALS are trace-only (never info), so the terminal
 * per-rollup phase is 'finished' = "all observed partition builds completed
 * without error", not "sealed". Seal truth arrives via the serveability probe.
 */

import { splitDockerTimestamp, isFailureLine, classifyError } from './preagg-run-parser.js';

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
