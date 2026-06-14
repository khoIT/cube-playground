/**
 * RunRecorder — the seam the agent runtime calls at turn end to persist an audit
 * trail. Injected into the session so tests can pass a capturing fake or the
 * no-op, and production gets durable SQLite persistence.
 *
 * Retention: on the first flush per process, runs older than
 * ADVISOR_AUDIT_RETENTION_DAYS (default 30) are pruned once. Lazy + guarded so a
 * prune failure never blocks recording.
 */

import { persistTurn, pruneOlderThan, type TurnFlush } from './advisor-run-store.js';

export interface RunRecorder {
  /** Persist one turn's run/turn/tool-call/event rows. Must never throw. */
  flushTurn(flush: TurnFlush): void;
}

/** No-op recorder — the default for tests and for disabling persistence. */
export const noopRunRecorder: RunRecorder = {
  flushTurn() {
    /* intentionally empty */
  },
};

const DEFAULT_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

let prunedThisProcess = false;

function retentionDays(): number {
  const raw = Number(process.env.ADVISOR_AUDIT_RETENTION_DAYS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RETENTION_DAYS;
}

function maybePrune(): void {
  if (prunedThisProcess) return;
  prunedThisProcess = true; // set before the attempt so a failure isn't retried every turn
  try {
    pruneOlderThan(Date.now() - retentionDays() * DAY_MS);
  } catch {
    /* retention is best-effort; never block recording */
  }
}

/**
 * SQLite-backed recorder. Persistence errors are swallowed: the audit trail is
 * an observability aid and must never break a live advisor turn.
 */
export const sqliteRunRecorder: RunRecorder = {
  flushTurn(flush: TurnFlush): void {
    try {
      maybePrune();
      persistTurn(flush);
    } catch {
      /* swallow — recording must never abort a turn */
    }
  },
};

/** Test seam: reset the once-per-process prune latch. */
export function resetRetentionLatchForTests(): void {
  prunedThisProcess = false;
}
