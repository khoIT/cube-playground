/**
 * Parallel-emit soak log — append-only JSONL sink for per-turn diff records.
 *
 * Kept separate from parallel-emit-shim.ts so the diff logic stays
 * dependency-free (and trivially unit-testable) while the fs side-effect lives
 * here. One line per turn at runtime/parallel-emit/diffs.jsonl; the soak
 * harness reads it back to produce the cutover decision report.
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DiffResult } from './parallel-emit-shim.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_PATH = resolve(__dirname, '../../runtime/parallel-emit/diffs.jsonl');

export interface ParallelEmitDiffRecord {
  ts: number;
  turnId: string;
  sessionId: string;
  message: string;
  match: boolean;
  legacyCount: number;
  shadowCount: number;
  kindCounts: Record<string, number>;
  maxLatencyDeltaMs: number;
  mismatchCount: number;
  /** First few mismatches only — full structural payloads can be large. */
  mismatchSample: DiffResult['mismatches'];
}

/**
 * Append one diff record. Best-effort: any fs error is swallowed (the soak log
 * must never break a live turn). Creates the directory on first write.
 */
export function appendParallelEmitDiff(record: ParallelEmitDiffRecord): void {
  try {
    mkdirSync(dirname(LOG_PATH), { recursive: true });
    appendFileSync(LOG_PATH, `${JSON.stringify(record)}\n`, 'utf8');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[parallel-emit] diff log append failed:', err);
  }
}

export { LOG_PATH as PARALLEL_EMIT_LOG_PATH };
