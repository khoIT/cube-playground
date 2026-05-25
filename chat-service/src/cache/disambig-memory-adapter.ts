/**
 * Session-scoped disambiguation memory.
 *
 * Wraps kv-cache-store with kind='disambig_resolution', one row per session.
 * The row's value_json holds whichever slot resolutions the user has accepted
 * during this session (metric, dimension, filters, timeRange). When the
 * disambig tool runs and a slot is already memorised, it skips clarify for
 * that slot and routes auto with the prior value.
 *
 * Scope: per-session, 24h TTL. Cross-session preference learning is out of
 * scope (would belong in a user-preferences table, not the cache).
 */

import type Database from 'better-sqlite3';
import { config } from '../config.js';
import { kvGet, kvPut } from './kv-cache-store.js';

const KIND = 'disambig_resolution';
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h

/** Mutable bag of resolved slots a user has accepted in this session. */
export interface DisambigResolutions {
  /** Cube member ref (e.g. 'recharge.revenue_vnd'). */
  metric?: string;
  /** Cube dimension ref (e.g. 'players.country'). */
  dimension?: string;
  /** Filter slot — keyed by member name; rare but supported. */
  filters?: Record<string, unknown>;
  /** Time-range slot — store as the same shape disambig produces. */
  timeRange?: unknown;
  /** Last update epoch ms — used for staleness checks if needed. */
  updatedAt?: number;
}

function sessionKey(sessionId: string): string {
  return `session:${sessionId}`;
}

/**
 * Read the resolution bag for a session, or empty object on miss / when
 * the cache service is disabled. Never throws.
 */
export function getResolutions(
  db: Database.Database,
  sessionId: string,
): DisambigResolutions {
  if (!config.cacheServiceEnabled) return {};
  const row = kvGet(db, KIND, sessionKey(sessionId));
  if (!row) return {};
  try {
    return JSON.parse(row.valueJson) as DisambigResolutions;
  } catch {
    return {};
  }
}

/**
 * Merge a partial resolution into the session's bag. Subsequent calls for
 * other slots accumulate (read-modify-write under SQLite's single-writer
 * semantics; no race risk in single-process mode). No-op when cache disabled.
 */
export function mergeResolution(
  db: Database.Database,
  sessionId: string,
  ownerId: string,
  partial: DisambigResolutions,
): void {
  if (!config.cacheServiceEnabled) return;
  const current = getResolutions(db, sessionId);
  const next: DisambigResolutions = {
    ...current,
    ...partial,
    // Deep-merge filters if both sides supply them; partial wins on conflict.
    filters: { ...(current.filters ?? {}), ...(partial.filters ?? {}) },
    updatedAt: Date.now(),
  };
  // If neither side had filters, drop the empty object to keep payloads clean.
  if (next.filters && Object.keys(next.filters).length === 0) delete next.filters;

  kvPut(db, {
    kind: KIND,
    key: sessionKey(sessionId),
    valueJson: JSON.stringify(next),
    ownerId,
    expiresAt: Date.now() + DEFAULT_TTL_MS,
  });
}
