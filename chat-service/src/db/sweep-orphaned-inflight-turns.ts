/**
 * Boot-time sweep for turns orphaned by a service restart.
 *
 * The /agent/turn pipeline persists the user turn at submit and the assistant
 * turn at completion (every normal end, abort, and timeout path appends one).
 * So a session whose LATEST turn is a bare user row means the process died
 * mid-turn — a dev tsx-watch reload or a container restart killed the agent
 * before any completion path ran. Without a marker the FE spinner hangs
 * forever and the turn hides from the leaderboard as if it never ran.
 *
 * The sweep appends an assistant row with stop_reason='service_restart' so
 * the UI shows an honest "interrupted" state and the leaderboard counts it.
 * These rows are excluded from agent context (listTurnsRecent) the same way
 * 'error' rows are, so a retry doesn't see the apology and parrot it.
 */

import type Database from 'better-sqlite3';
import { appendTurn } from './chat-store.js';

export const SERVICE_RESTART_STOP_REASON = 'service_restart';

export const SERVICE_RESTART_ASSISTANT_TEXT =
  'This turn was interrupted by a service restart before a response was ' +
  'generated. Please re-send your message.';

/**
 * Ignore very fresh user rows: a request that landed while this process was
 * booting may legitimately still be waiting for its agent loop to start.
 * Anything older than this at boot belongs to a previous process and is dead.
 */
const MIN_ORPHAN_AGE_MS = 30_000;

interface OrphanRow {
  session_id: string;
  turn_index: number;
  started_at: number;
}

/**
 * Append an interruption marker to every session whose latest turn is a
 * user row older than MIN_ORPHAN_AGE_MS. Returns the number of sessions swept.
 */
export function sweepOrphanedInFlightTurns(
  db: Database.Database,
  nowMs: number = Date.now(),
): number {
  // IMMEDIATE transaction: select + insert are atomic against any concurrent
  // process (orphaned dev watchers share this sqlite file), so two sweeps
  // racing cannot both see the same user-tail and double-insert the marker.
  const sweep = db.transaction((cutoffMs: number): number => {
    const orphans = db
      .prepare(
        `SELECT t.session_id, t.turn_index, t.started_at
         FROM chat_turns t
         JOIN (
           SELECT session_id, MAX(turn_index) AS max_idx
           FROM chat_turns
           GROUP BY session_id
         ) latest
           ON latest.session_id = t.session_id AND latest.max_idx = t.turn_index
         WHERE t.role = 'user'
           AND t.started_at < ?`,
      )
      .all(cutoffMs) as OrphanRow[];

    for (const orphan of orphans) {
      appendTurn(db, {
        sessionId: orphan.session_id,
        turnIndex: orphan.turn_index + 1,
        role: 'assistant',
        assistantText: SERVICE_RESTART_ASSISTANT_TEXT,
        stopReason: SERVICE_RESTART_STOP_REASON,
        startedAt: orphan.started_at,
        endedAt: nowMs,
      });
    }
    return orphans.length;
  });

  return sweep.immediate(nowMs - MIN_ORPHAN_AGE_MS);
}
