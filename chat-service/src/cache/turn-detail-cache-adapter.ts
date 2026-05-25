/**
 * Cache adapter for /debug/turns/:turnId aggregated reads.
 *
 * Wraps kv-cache-store with kind='turn_detail'. Caches the immutable portion
 * of a turn's detail payload: llm_calls + tool_invocations + permission_decisions.
 * Annotations are intentionally NOT cached — they're per-(owner, turn) and
 * mutable (star/flag/note can change at any time).
 *
 * Invalidation:
 *   - Rows are immutable once a turn finalises (ended_at set + stop_reason);
 *     callers MUST verify the turn is finalised before put() to avoid caching
 *     partial in-flight data.
 *   - evictTurnDetail() called when a turn is hard-deleted.
 *   - No TTL — entries live until eviction.
 */

import type Database from 'better-sqlite3';
import { config } from '../config.js';
import { kvGet, kvPut, kvEvict } from './kv-cache-store.js';

const KIND = 'turn_detail';

export interface TurnDetailPayload {
  llmCalls: unknown[];
  toolInvocations: unknown[];
  permissionDecisions: unknown[];
}

/** Returns the cached payload or null on miss / when cache is disabled. */
export function getCachedTurnDetail(
  db: Database.Database,
  turnId: string,
): TurnDetailPayload | null {
  if (!config.cacheServiceEnabled) return null;
  const row = kvGet(db, KIND, turnId);
  if (!row) return null;
  try {
    return JSON.parse(row.valueJson) as TurnDetailPayload;
  } catch {
    return null;
  }
}

/**
 * Persist a payload. Caller must ensure the turn is finalised (ended_at set
 * and stop_reason set) before calling, otherwise partial data could be cached.
 */
export function putCachedTurnDetail(
  db: Database.Database,
  turnId: string,
  payload: TurnDetailPayload,
): void {
  if (!config.cacheServiceEnabled) return;
  kvPut(db, {
    kind: KIND,
    key: turnId,
    valueJson: JSON.stringify(payload),
  });
}

/** Drop a cached entry — call when the underlying turn is hard-deleted. */
export function evictCachedTurnDetail(db: Database.Database, turnId: string): boolean {
  return kvEvict(db, KIND, turnId);
}
