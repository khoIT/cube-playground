/**
 * Cross-session disambiguation preferences — read/write CRUD over the
 * `user_disambig_prefs` table.
 *
 * Layer 3 of the disambig memory stack: when session memory (kv_cache) has
 * no entry for a slot, the disambig tool falls back here. Writes piggyback
 * on session-memory writes so any confident slot resolution lands in both
 * layers at once. The Settings UI reads this table to surface what the
 * assistant has learned and lets users clear individual or all defaults.
 *
 * Value column shape: JSON `{ value, phrase? }` mirroring SlotMemory<T>.
 */

import type Database from 'better-sqlite3';
import type { SlotMemory } from './disambig-memory-adapter.js';

/** Slot keys understood by the adapter. */
export type PrefSlot = 'metric' | 'dimension' | 'timeRange' | `filter:${string}`;

export interface UserPrefRow<T = unknown> {
  slot: PrefSlot;
  value: T;
  phrase?: string;
  lastUsedAt: number;
  hitCount: number;
}

interface RawRow {
  slot: string;
  value_json: string;
  hit_count: number;
  last_used_at: number;
}

function parseValue<T>(json: string): SlotMemory<T> | null {
  try {
    const v = JSON.parse(json) as unknown;
    if (typeof v !== 'object' || v === null || !('value' in (v as Record<string, unknown>))) return null;
    return v as SlotMemory<T>;
  } catch {
    return null;
  }
}

/** Return every preference row for (ownerId, gameId), newest-used first. */
export function getUserPrefs(
  db: Database.Database,
  ownerId: string,
  gameId: string,
): UserPrefRow[] {
  const rows = db.prepare(
    `SELECT slot, value_json, hit_count, last_used_at
       FROM user_disambig_prefs
      WHERE owner_id = ? AND game_id = ?
      ORDER BY last_used_at DESC`,
  ).all(ownerId, gameId) as RawRow[];

  const out: UserPrefRow[] = [];
  for (const r of rows) {
    const wrapped = parseValue<unknown>(r.value_json);
    if (!wrapped) continue;
    out.push({
      slot: r.slot as PrefSlot,
      value: wrapped.value,
      phrase: wrapped.phrase,
      lastUsedAt: r.last_used_at,
      hitCount: r.hit_count,
    });
  }
  return out;
}

/**
 * Insert or update a preference. Always bumps last_used_at; hit_count is
 * left at 0 on first write and incremented on subsequent UPSERTs.
 */
export function upsertUserPref<T>(
  db: Database.Database,
  params: {
    ownerId: string;
    gameId: string;
    slot: PrefSlot;
    value: T;
    phrase?: string;
    now?: number;
  },
): void {
  const now = params.now ?? Date.now();
  const valueJson = JSON.stringify({ value: params.value, phrase: params.phrase });
  db.prepare(
    `INSERT INTO user_disambig_prefs
       (owner_id, game_id, slot, value_json, hit_count, last_used_at, created_at)
     VALUES (?, ?, ?, ?, 0, ?, ?)
     ON CONFLICT(owner_id, game_id, slot) DO UPDATE SET
       value_json   = excluded.value_json,
       last_used_at = excluded.last_used_at,
       hit_count    = user_disambig_prefs.hit_count + 1`,
  ).run(params.ownerId, params.gameId, params.slot, valueJson, now, now);
}

/** Bump last_used_at + hit_count on a Layer-3 read hit. No-op if row missing. */
export function touchUserPref(
  db: Database.Database,
  ownerId: string,
  gameId: string,
  slot: PrefSlot,
  now: number = Date.now(),
): void {
  db.prepare(
    `UPDATE user_disambig_prefs
        SET last_used_at = ?, hit_count = hit_count + 1
      WHERE owner_id = ? AND game_id = ? AND slot = ?`,
  ).run(now, ownerId, gameId, slot);
}

export function deleteUserPref(
  db: Database.Database,
  ownerId: string,
  gameId: string,
  slot: PrefSlot,
): boolean {
  const info = db.prepare(
    `DELETE FROM user_disambig_prefs WHERE owner_id = ? AND game_id = ? AND slot = ?`,
  ).run(ownerId, gameId, slot);
  return info.changes > 0;
}

export function deleteAllUserPrefs(
  db: Database.Database,
  ownerId: string,
  gameId: string,
): number {
  const info = db.prepare(
    `DELETE FROM user_disambig_prefs WHERE owner_id = ? AND game_id = ?`,
  ).run(ownerId, gameId);
  return info.changes;
}
