/**
 * Cron tick for the dashboard tile cache.
 *
 * Each tick:
 *   1. Find stale tiles attached to dashboards viewed within the refresh horizon.
 *   2. Up to a per-tick budget, refresh each: status → 'refreshing', Cube /load,
 *      hash-skip upsert. Failures mark status='broken' with the error message.
 *
 * Game scoping via per-game JWT (same pattern as liveops + segments).
 */

import { getDb } from '../db/sqlite.js';
import { loadWithContinueWait } from '../services/load-with-continue-wait.js';
import { resolveCubeTokenForGame } from '../services/resolve-cube-token.js';
import { getCubeMetaVersion } from '../services/cube-meta-version.js';
import {
  listStaleTilesInRecentDashboards,
  upsertTileCache,
  setTileStatus,
  readTileCache,
  type StaleTile,
} from '../services/dashboard-tile-cache-store.js';
import { getSetting } from '../services/app-settings-store.js';

interface DashboardTileCacheConfig {
  refreshHorizonDays: number;
  perTickBudget: number;
  perTileTimeoutMs: number;
  tickIntervalMs: number;
}

const DEFAULTS: DashboardTileCacheConfig = {
  refreshHorizonDays: 7,
  perTickBudget: 30,
  perTileTimeoutMs: 30_000,
  tickIntervalMs: 90_000,
};

let activeConfig: DashboardTileCacheConfig = DEFAULTS;

export function getDashboardTileCacheConfig(): DashboardTileCacheConfig {
  return activeConfig;
}

export function setDashboardTileCacheConfig(patch: Partial<DashboardTileCacheConfig>): void {
  activeConfig = { ...activeConfig, ...patch };
}

export function __resetDashboardTileCacheConfig(): void {
  activeConfig = DEFAULTS;
}

function rowsFrom(res: unknown): unknown[] {
  const r = res as { data?: unknown[]; results?: Array<{ data?: unknown[] }> };
  return r.data ?? r.results?.[0]?.data ?? [];
}

const INTERNAL_TILE_QUERY_FIELDS = ['compare'] as const;

function stripInternalQueryFields(query: Record<string, unknown>): Record<string, unknown> {
  const out = { ...query };
  for (const field of INTERNAL_TILE_QUERY_FIELDS) {
    delete out[field];
  }
  return out;
}

export async function refreshTile(tile: StaleTile): Promise<void> {
  setTileStatus(tile.tile_id, 'refreshing');
  try {
    const token = resolveCubeTokenForGame(tile.game) ?? undefined;
    const metaVersion = await getCubeMetaVersion(tile.game);
    const rawQuery = JSON.parse(tile.query_json) as Record<string, unknown>;
    const query = stripInternalQueryFields(rawQuery);
    const res = await loadWithContinueWait(query, token, activeConfig.perTileTimeoutMs);
    const rows = rowsFrom(res);
    // Per-dashboard override beats the global default. Settings UI tweaks the
    // default; per-dashboard PATCH tweaks individual dashboards.
    const defaultTtl = getSetting<number>('dashboards.tile_ttl_seconds', 300);
    upsertTileCache({
      tileId: tile.tile_id,
      rows,
      // Persist the full load response so the dashboard tile can rebuild a real
      // ResultSet and render through the same chart engine as the playground.
      loadResponse: res,
      cubeMetaVersion: metaVersion,
      ttlSeconds: tile.tile_ttl_seconds || defaultTtl,
    });
  } catch (err) {
    setTileStatus(tile.tile_id, 'broken', (err as Error).message);
  }
}

function resolveEffectiveConfig(): DashboardTileCacheConfig {
  // Live overrides from app_settings — Phase 6 wired the UI for these.
  return {
    ...activeConfig,
    refreshHorizonDays: getSetting<number>('dashboards.refresh_horizon_days', activeConfig.refreshHorizonDays),
    perTickBudget: getSetting<number>('dashboards.refresh_concurrency', activeConfig.perTickBudget),
  };
}

export async function dashboardTileCacheTick(): Promise<void> {
  const cfg = resolveEffectiveConfig();
  const stale = listStaleTilesInRecentDashboards(cfg.refreshHorizonDays, cfg.perTickBudget);
  for (const tile of stale) {
    await refreshTile(tile);
  }
}

/** Inline refresh — used after tile create/update so analysts see data immediately. */
export async function refreshTileById(tileId: number): Promise<void> {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT t.id AS tile_id, t.dashboard_id, d.game, t.query_json, d.tile_ttl_seconds
         FROM dashboard_tiles t
         JOIN dashboards d ON d.id = t.dashboard_id
        WHERE t.id = ?`,
    )
    .get(tileId) as StaleTile | undefined;
  if (!row) return;
  await refreshTile(row);
}

let interval: ReturnType<typeof setInterval> | null = null;

export function startDashboardTileCacheCron(): void {
  if (interval) return;
  void dashboardTileCacheTick().catch(() => {});
  interval = setInterval(() => {
    void dashboardTileCacheTick().catch(() => {});
  }, activeConfig.tickIntervalMs);
}

export function stopDashboardTileCacheCron(): void {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}

/** Test helper. */
export function _readTileCache(tileId: number) {
  return readTileCache(tileId);
}
