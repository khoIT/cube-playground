/**
 * SQLite store for precomputed member-360 panel rows — per (segment, uid,
 * panel) cell written by the nightly runner, read cache-first by the member
 * detail API. Mirrors card-cache-store's skip-if-unchanged contract so re-runs
 * with identical Cube results write nothing (quiet snapshot diffs, no churn).
 *
 * Pruning is uid-driven (NOT entry-set-driven like card-cache's ghost prune):
 * tier membership defines which uids belong; when tiers change at refresh time
 * the caller prunes to the surviving uid set, and departed members' rows go.
 */

import { createHash } from 'node:crypto';
import { getDb } from '../db/sqlite.js';

export interface Member360CacheEntry {
  uid: string;
  panelId: string;
  queryHash: string;
  rows: Array<Record<string, unknown>>;
  /** 'ok' = load succeeded; 'error' = failed or budget-skipped (see error). */
  status: 'ok' | 'error';
  error?: string;
}

export interface Member360CacheView {
  rows: unknown[];
  fetched_at: string;
  status: 'ok' | 'error';
  error?: string;
}

function hashRows(rows: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 16);
}

/** Insert or update entries; skips the write when query_hash + rows + status
 *  + error are all unchanged (so fetched_at only moves on real changes). */
export function upsertMember360Cache(segmentId: string, entries: Member360CacheEntry[]): void {
  const db = getDb();
  const now = new Date().toISOString();

  const select = db.prepare(`
    SELECT query_hash, rows_json, status, error
      FROM segment_member360_cache
     WHERE segment_id = ? AND uid = ? AND panel_id = ?
  `);
  const upsert = db.prepare(`
    INSERT INTO segment_member360_cache
      (segment_id, uid, panel_id, query_hash, rows_json, fetched_at, status, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(segment_id, uid, panel_id) DO UPDATE SET
      query_hash = excluded.query_hash,
      rows_json  = excluded.rows_json,
      fetched_at = excluded.fetched_at,
      status     = excluded.status,
      error      = excluded.error
  `);

  const tx = db.transaction((rows: Member360CacheEntry[]) => {
    for (const entry of rows) {
      const rowsJson = JSON.stringify(entry.rows);
      const rowsHash = hashRows(entry.rows);
      const error = entry.error ?? null;
      const existing = select.get(segmentId, entry.uid, entry.panelId) as
        | { query_hash: string; rows_json: string; status: string; error: string | null }
        | undefined;
      if (
        existing &&
        existing.query_hash === entry.queryHash &&
        hashRows(JSON.parse(existing.rows_json)) === rowsHash &&
        existing.status === entry.status &&
        (existing.error ?? null) === error
      ) {
        continue; // no-op — nothing changed
      }
      upsert.run(segmentId, entry.uid, entry.panelId, entry.queryHash, rowsJson, now, entry.status, error);
    }
  });

  tx(entries);
}

/** All cached panels for one member as a {panelId: view} map (detail page). */
export function getMember360Cache(segmentId: string, uid: string): Record<string, Member360CacheView> {
  const db = getDb();
  const rows = db
    .prepare(`
      SELECT panel_id, rows_json, fetched_at, status, error
        FROM segment_member360_cache
       WHERE segment_id = ? AND uid = ?
    `)
    .all(segmentId, uid) as Array<{
      panel_id: string;
      rows_json: string;
      fetched_at: string;
      status: string;
      error: string | null;
    }>;

  const out: Record<string, Member360CacheView> = {};
  for (const r of rows) {
    const status: 'ok' | 'error' = r.status === 'error' ? 'error' : 'ok';
    out[r.panel_id] = {
      rows: JSON.parse(r.rows_json),
      fetched_at: r.fetched_at,
      status,
      ...(r.error ? { error: r.error } : {}),
    };
  }
  return out;
}

/** Per-uid cache status aggregate for a segment — one cheap GROUP BY powering
 *  the Members-tab "360 ready" chips (never an N+1 over 150 uids). */
export interface Member360UidStatus {
  ok: number;
  error: number;
  latest_fetched_at: string | null;
}

export function getMember360StatusBySegment(
  segmentId: string,
): Record<string, Member360UidStatus> {
  const db = getDb();
  const rows = db
    .prepare(`
      SELECT uid,
             SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) AS ok,
             SUM(CASE WHEN status = 'ok' THEN 0 ELSE 1 END) AS error,
             MAX(fetched_at) AS latest_fetched_at
        FROM segment_member360_cache
       WHERE segment_id = ?
       GROUP BY uid
    `)
    .all(segmentId) as Array<{ uid: string; ok: number; error: number; latest_fetched_at: string | null }>;
  const out: Record<string, Member360UidStatus> = {};
  for (const r of rows) {
    out[r.uid] = { ok: r.ok, error: r.error, latest_fetched_at: r.latest_fetched_at };
  }
  return out;
}

/** Set of `${uid}|${panelId}` keys already cached ok — the runner uses this so
 *  a budget-skipped unit never clobbers a previously good row with an error. */
export function listOkMember360CacheKeys(segmentId: string): Set<string> {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT uid, panel_id FROM segment_member360_cache WHERE segment_id = ? AND status = 'ok'",
    )
    .all(segmentId) as Array<{ uid: string; panel_id: string }>;
  return new Set(rows.map((r) => `${r.uid}|${r.panel_id}`));
}

/** Delete cache rows whose uid is NOT in `keepUids` (tier membership changed).
 *  An empty keep set wipes the segment's cache (segment became ineligible). */
export function pruneMember360CacheToUids(segmentId: string, keepUids: readonly string[]): number {
  const db = getDb();
  if (keepUids.length === 0) {
    return db
      .prepare('DELETE FROM segment_member360_cache WHERE segment_id = ?')
      .run(segmentId).changes;
  }
  const keep = new Set(keepUids);
  const cached = db
    .prepare('SELECT DISTINCT uid FROM segment_member360_cache WHERE segment_id = ?')
    .all(segmentId) as Array<{ uid: string }>;
  const del = db.prepare('DELETE FROM segment_member360_cache WHERE segment_id = ? AND uid = ?');
  let removed = 0;
  const tx = db.transaction(() => {
    for (const { uid } of cached) {
      if (!keep.has(uid)) removed += del.run(segmentId, uid).changes;
    }
  });
  tx();
  return removed;
}
