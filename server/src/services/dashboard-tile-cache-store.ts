/**
 * SQLite store for the dashboard tile result cache.
 * Mirrors liveops-cache-store: hash-skip writes, status transitions, invalidate.
 */

import { createHash } from 'node:crypto';
import { getDb } from '../db/sqlite.js';

export interface TileCacheRow {
  tile_id: number;
  rows_json: string;
  rows_hash: string;
  cube_meta_version: string;
  fetched_at: string;
  expires_at: string;
  status: 'fresh' | 'refreshing' | 'broken';
  error_msg: string | null;
  resp_json: string | null;
}

export interface TileCacheView {
  rows: unknown[];
  /**
   * Full Cube /load response (annotation + data) when available — lets the
   * client rebuild a real ResultSet for chart-engine parity. Null for legacy
   * rows-only cache entries.
   */
  loadResponse: unknown | null;
  fetched_at: string;
  expires_at: string;
  status: 'fresh' | 'refreshing' | 'broken';
  error_msg: string | null;
  cube_meta_version: string;
}

function hashRows(json: string): string {
  return createHash('sha256').update(json).digest('hex').slice(0, 16);
}

export function readTileCache(tileId: number): TileCacheView | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM dashboard_tile_cache WHERE tile_id = ?`).get(tileId) as
    | TileCacheRow
    | undefined;
  if (!row) return null;
  let loadResponse: unknown | null = null;
  if (row.resp_json) {
    try {
      loadResponse = JSON.parse(row.resp_json);
    } catch {
      loadResponse = null;
    }
  }
  return {
    rows: JSON.parse(row.rows_json) as unknown[],
    loadResponse,
    fetched_at: row.fetched_at,
    expires_at: row.expires_at,
    status: row.status,
    error_msg: row.error_msg,
    cube_meta_version: row.cube_meta_version,
  };
}

export interface UpsertTileCacheInput {
  tileId: number;
  rows: unknown[];
  /** Full Cube /load response — persisted so the client can rebuild a ResultSet. */
  loadResponse?: unknown;
  cubeMetaVersion: string;
  ttlSeconds: number;
}

export function upsertTileCache(input: UpsertTileCacheInput): { wrote: boolean } {
  const db = getDb();
  const rowsJson = JSON.stringify(input.rows);
  const rowsHash = hashRows(rowsJson);
  const respJson = input.loadResponse != null ? JSON.stringify(input.loadResponse) : null;
  const now = new Date();
  const expires = new Date(now.getTime() + input.ttlSeconds * 1000);

  const existing = db
    .prepare(`SELECT rows_hash, cube_meta_version FROM dashboard_tile_cache WHERE tile_id = ?`)
    .get(input.tileId) as { rows_hash: string; cube_meta_version: string } | undefined;

  if (
    existing &&
    existing.rows_hash === rowsHash &&
    existing.cube_meta_version === input.cubeMetaVersion
  ) {
    // Rows unchanged — still refresh resp_json so a tile cached before this
    // column existed picks up the load response on its next refresh. COALESCE
    // so a caller that omits loadResponse can't wipe an already-stored response.
    db.prepare(
      `UPDATE dashboard_tile_cache SET expires_at = ?, status = 'fresh', error_msg = NULL,
              resp_json = COALESCE(?, resp_json)
        WHERE tile_id = ?`,
    ).run(expires.toISOString(), respJson, input.tileId);
    return { wrote: false };
  }

  db.prepare(
    `INSERT INTO dashboard_tile_cache
       (tile_id, rows_json, rows_hash, cube_meta_version, fetched_at, expires_at, status, error_msg, resp_json)
     VALUES (?, ?, ?, ?, ?, ?, 'fresh', NULL, ?)
     ON CONFLICT(tile_id) DO UPDATE SET
       rows_json         = excluded.rows_json,
       rows_hash         = excluded.rows_hash,
       cube_meta_version = excluded.cube_meta_version,
       fetched_at        = excluded.fetched_at,
       expires_at        = excluded.expires_at,
       status            = 'fresh',
       error_msg         = NULL,
       resp_json         = excluded.resp_json`,
  ).run(
    input.tileId,
    rowsJson,
    rowsHash,
    input.cubeMetaVersion,
    now.toISOString(),
    expires.toISOString(),
    respJson,
  );
  return { wrote: true };
}

export function setTileStatus(
  tileId: number,
  status: 'refreshing' | 'broken',
  errorMsg: string | null = null,
): void {
  const db = getDb();
  // status='refreshing' may target a row that doesn't exist yet (cache miss);
  // insert a placeholder so the row materializes.
  const ensured = db
    .prepare(`SELECT 1 FROM dashboard_tile_cache WHERE tile_id = ?`)
    .get(tileId);
  if (!ensured) {
    db.prepare(
      `INSERT INTO dashboard_tile_cache
         (tile_id, rows_json, rows_hash, cube_meta_version, fetched_at, expires_at, status, error_msg)
       VALUES (?, '[]', '', '', ?, ?, ?, ?)`,
    ).run(tileId, new Date().toISOString(), new Date().toISOString(), status, errorMsg);
    return;
  }
  db.prepare(
    `UPDATE dashboard_tile_cache SET status = ?, error_msg = ? WHERE tile_id = ?`,
  ).run(status, errorMsg, tileId);
}

export function expireTile(tileId: number): void {
  const db = getDb();
  db.prepare(`UPDATE dashboard_tile_cache SET expires_at = ? WHERE tile_id = ?`)
    .run(new Date(0).toISOString(), tileId);
}

export function invalidateTile(tileId: number): void {
  const db = getDb();
  db.prepare(`DELETE FROM dashboard_tile_cache WHERE tile_id = ?`).run(tileId);
}

export interface StaleTile {
  tile_id: number;
  dashboard_id: number;
  game: string;
  query_json: string;
  tile_ttl_seconds: number;
}

/** Tiles in recently-viewed dashboards whose cache is stale, missing, or broken. */
export function listStaleTilesInRecentDashboards(
  horizonDays: number,
  limit: number,
): StaleTile[] {
  const db = getDb();
  const horizon = new Date(Date.now() - horizonDays * 86_400_000).toISOString();
  const now = new Date().toISOString();
  return db
    .prepare(
      `SELECT t.id AS tile_id, t.dashboard_id, d.game, t.query_json, d.tile_ttl_seconds
         FROM dashboard_tiles t
         JOIN dashboards d ON d.id = t.dashboard_id
    LEFT JOIN dashboard_tile_cache c ON c.tile_id = t.id
        WHERE (d.last_viewed_at IS NOT NULL AND d.last_viewed_at >= ?)
          AND (c.tile_id IS NULL OR c.expires_at < ? OR c.status = 'broken')
          AND (c.status IS NULL OR c.status != 'refreshing')
     ORDER BY COALESCE(c.expires_at, '0') ASC
        LIMIT ?`,
    )
    .all(horizon, now, limit) as StaleTile[];
}
