/**
 * Persisted VIP-profile snapshots for the care action queue (migration 040).
 *
 * Written by the sweep (which already queries Cube) and read by the ledger
 * routes, so the queue enriches each VIP row from SQLite instead of a live
 * Cube → Trino query per page load.
 *
 * Stored fields are raw (last_recharge_date, days_since_last_active); the
 * read DTO derives churn-pay days at request time so the figure doesn't age
 * between sweeps.
 */

import { getDb } from '../db/sqlite.js';

/** Write shape — one snapshot row per VIP, as fetched from Cube during a sweep. */
export interface VipProfileSnapshot {
  uid: string;
  name: string | null;
  ltvVnd: number | null;
  tier: string | null;
  daysSinceLastActive: number | null;
  lastRechargeDate: string | null;
}

/** Read shape returned to the client — churn days are derived, not stored. */
export interface CareVipProfileDto {
  name: string | null;
  ltvVnd: number | null;
  tier: string | null;
  churnPlayDays: number | null;
  churnPayDays: number | null;
}

interface ProfileRow {
  uid: string;
  name: string | null;
  ltv_vnd: number | null;
  tier: string | null;
  days_since_last_active: number | null;
  last_recharge_date: string | null;
}

/** Whole days between an ISO date and `now`; null when missing / unparseable. */
export function daysSince(iso: string | null, now: number = Date.now()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now - t) / 86_400_000));
}

/** Map a stored row to the read DTO, deriving churn-pay days against `now`. */
export function toDto(row: ProfileRow, now: number = Date.now()): CareVipProfileDto {
  return {
    name: row.name,
    ltvVnd: row.ltv_vnd,
    tier: row.tier,
    churnPlayDays: row.days_since_last_active,
    churnPayDays: daysSince(row.last_recharge_date, now),
  };
}

/**
 * Upsert a batch of VIP profile snapshots for a (workspace, game). Idempotent —
 * re-running a sweep overwrites the prior snapshot. Runs in one transaction.
 */
export function upsertVipProfiles(
  gameId: string,
  workspace: string,
  rows: VipProfileSnapshot[],
  now: string = new Date().toISOString(),
): void {
  if (rows.length === 0) return;
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO care_vip_profiles
       (workspace_id, game_id, uid, name, ltv_vnd, tier, days_since_last_active, last_recharge_date, refreshed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(workspace_id, game_id, uid) DO UPDATE SET
       name = excluded.name,
       ltv_vnd = excluded.ltv_vnd,
       tier = excluded.tier,
       days_since_last_active = excluded.days_since_last_active,
       last_recharge_date = excluded.last_recharge_date,
       refreshed_at = excluded.refreshed_at`,
  );
  const tx = db.transaction((batch: VipProfileSnapshot[]) => {
    for (const r of batch) {
      stmt.run(
        workspace, gameId, r.uid,
        r.name, r.ltvVnd, r.tier, r.daysSinceLastActive, r.lastRechargeDate, now,
      );
    }
  });
  tx(rows);
}

/**
 * Read persisted profiles for a uid set as a uid → DTO map. Missing uids are
 * simply absent (the caller renders an em-dash). Empty input → empty map.
 */
export function getVipProfiles(
  gameId: string,
  workspace: string,
  uids: string[],
  now: number = Date.now(),
): Map<string, CareVipProfileDto> {
  const out = new Map<string, CareVipProfileDto>();
  const unique = [...new Set(uids)];
  if (unique.length === 0) return out;

  const db = getDb();
  // Chunk the IN-list so a large queue stays well under SQLite's bind limit.
  const CHUNK = 400;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const slice = unique.slice(i, i + CHUNK);
    const placeholders = slice.map(() => '?').join(',');
    const rows = db
      .prepare(
        `SELECT uid, name, ltv_vnd, tier, days_since_last_active, last_recharge_date
           FROM care_vip_profiles
          WHERE workspace_id = ? AND game_id = ? AND uid IN (${placeholders})`,
      )
      .all(workspace, gameId, ...slice) as ProfileRow[];
    for (const r of rows) out.set(r.uid, toDto(r, now));
  }
  return out;
}
