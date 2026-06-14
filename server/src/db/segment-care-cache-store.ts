/**
 * SQLite store for the segment Care tab payload (segment_care_cache table).
 *
 * Replaces the route's in-memory Map with a durable, last-good-preserving cache.
 * Mirrors card-cache-store's last-good contract: a failed recompute stamps the
 * attempt time + error but NEVER wipes a previously good payload, so the route
 * can serve stale-on-error instead of failing the whole tab on a transient
 * Trino hiccup. computed_at dates the last successful build (the payload's real
 * age); last_attempt_at moves on every attempt.
 */

import { getDb } from './sqlite.js';
import type { CsCarePayload } from '../services/cs-care-builder.js';

export interface CareCacheRead {
  payload: CsCarePayload;
  /** ISO of the last successful build (the payload's real age). */
  computedAt: string;
  /** Age of the payload in ms (now − computed_at). */
  ageMs: number;
  /** Last failure message, if the most recent attempt errored. */
  lastError: string | null;
  status: 'ok' | 'error';
}

interface RawRow {
  game_id: string;
  payload_json: string | null;
  computed_at: string | null;
  last_attempt_at: string | null;
  last_error: string | null;
  status: string;
}

/** Read the last-good payload for a segment, or null if none was ever built. */
export function readCareCache(segmentId: string, nowMs: number = Date.now()): CareCacheRead | null {
  const row = getDb()
    .prepare(
      `SELECT game_id, payload_json, computed_at, last_attempt_at, last_error, status
         FROM segment_care_cache WHERE segment_id = ?`,
    )
    .get(segmentId) as RawRow | undefined;

  if (!row || !row.payload_json || !row.computed_at) return null;

  let payload: CsCarePayload;
  try {
    payload = JSON.parse(row.payload_json) as CsCarePayload;
  } catch {
    return null; // corrupt row — treat as a true miss, never throw on read
  }

  return {
    payload,
    computedAt: row.computed_at,
    ageMs: nowMs - Date.parse(row.computed_at),
    lastError: row.last_error,
    status: row.status === 'error' ? 'error' : 'ok',
  };
}

/** Persist a freshly-built payload: sets computed_at, clears last_error, ok. */
export function writeCareCache(segmentId: string, gameId: string, payload: CsCarePayload): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO segment_care_cache
         (segment_id, game_id, payload_json, computed_at, last_attempt_at, last_error, status)
       VALUES (?, ?, ?, ?, ?, NULL, 'ok')
       ON CONFLICT(segment_id) DO UPDATE SET
         game_id         = excluded.game_id,
         payload_json    = excluded.payload_json,
         computed_at     = excluded.computed_at,
         last_attempt_at = excluded.last_attempt_at,
         last_error      = NULL,
         status          = 'ok'`,
    )
    .run(segmentId, gameId, JSON.stringify(payload), now, now);
}

/**
 * Record a failed attempt: stamps last_attempt_at + last_error + status='error'
 * but LEAVES payload_json / computed_at untouched so the last-good value (if
 * any) survives. Creates a payload-less row when nothing was ever cached, so
 * the board can still show the segment as erroring.
 */
export function markCareAttempt(segmentId: string, gameId: string, error: string): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO segment_care_cache
         (segment_id, game_id, payload_json, computed_at, last_attempt_at, last_error, status)
       VALUES (?, ?, NULL, NULL, ?, ?, 'error')
       ON CONFLICT(segment_id) DO UPDATE SET
         game_id         = excluded.game_id,
         last_attempt_at = excluded.last_attempt_at,
         last_error      = excluded.last_error,
         status          = 'error'`,
    )
    .run(segmentId, gameId, now, error);
}

export interface CareCacheStatus {
  segmentId: string;
  gameId: string;
  computedAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  status: 'ok' | 'error';
  hasPayload: boolean;
}

/** All cache rows (freshness only, no payload) — powers the status board. */
export function listCareCacheStatuses(): CareCacheStatus[] {
  const rows = getDb()
    .prepare(
      `SELECT segment_id, game_id, payload_json, computed_at, last_attempt_at, last_error, status
         FROM segment_care_cache`,
    )
    .all() as Array<RawRow & { segment_id: string }>;
  return rows.map((r) => ({
    segmentId: r.segment_id,
    gameId: r.game_id,
    computedAt: r.computed_at,
    lastAttemptAt: r.last_attempt_at,
    lastError: r.last_error,
    status: r.status === 'error' ? 'error' : 'ok',
    hasPayload: !!r.payload_json,
  }));
}

/** Test hook — clears all care cache rows. */
export function __clearCareCache(): void {
  getDb().prepare('DELETE FROM segment_care_cache').run();
}
