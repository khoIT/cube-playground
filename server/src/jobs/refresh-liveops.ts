/**
 * Cron tick for the liveops result cache.
 *
 * Each tick:
 *   1. List stale rows (expires_at < now AND status != 'refreshing').
 *   2. For each — up to budget — mark refreshing, run the per-resource handler,
 *      upsert payload via hash-skip writes, log duration.
 *   3. KPI strip + cohort grid: ensure a default key exists per known game so
 *      cache starts warming before the first FE request.
 *
 * Funnel rows are NOT prepopulated — analysts create them via the FE; the
 * route POST seeds a row that becomes the cron's responsibility from then on.
 */

import { listStale, upsertCache, setStatus, logRefresh, ensurePlaceholder, pruneFunnelOlderThan } from '../services/liveops-cache-store.js';
import { getLiveopsCacheConfig, type LiveopsCacheResource as ResourceName } from '../services/liveops-cache-config.js';
import { getSetting } from '../services/app-settings-store.js';
import { getCubeMetaVersion } from '../services/cube-meta-version.js';
import { refreshKpiStrip, refreshCohortGrid, refreshFunnel, type FunnelDef } from '../services/liveops-refresh-handlers.js';
import { getDb } from '../db/sqlite.js';
import { loadGamesConfig } from '../services/games-config-loader.js';

const DEFAULT_COHORT_WINDOW_DAYS = 14;

function readFunnelDef(cacheKey: string): { defHash: string; def: FunnelDef } | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT payload_json FROM liveops_result_cache WHERE resource = 'funnel_result' AND cache_key = ?`,
    )
    .get(cacheKey) as { payload_json: string } | undefined;
  if (!row) return null;
  try {
    const stored = JSON.parse(row.payload_json) as { funnelDef?: FunnelDef; funnelDefHash?: string };
    if (!stored.funnelDef || !stored.funnelDefHash) return null;
    return { defHash: stored.funnelDefHash, def: stored.funnelDef };
  } catch {
    return null;
  }
}

function resolveTtl(resource: ResourceName, fallback: number): number {
  const map = getSetting<Record<string, number>>('liveops.cache_ttl_seconds', {});
  const v = map?.[resource];
  return typeof v === 'number' ? v : fallback;
}

async function refreshOne(
  resource: 'kpi_strip' | 'cohort_grid' | 'funnel_result',
  cacheKey: string,
  game: string,
): Promise<void> {
  const config = getLiveopsCacheConfig();
  const ttl = resolveTtl(resource, config.ttlSeconds[resource]);
  const started = Date.now();
  setStatus(resource, cacheKey, 'refreshing');

  try {
    const metaVersion = await getCubeMetaVersion(game);
    let payload: unknown;
    if (resource === 'kpi_strip') {
      payload = await refreshKpiStrip(game, config.perRefreshTimeoutMs);
    } else if (resource === 'cohort_grid') {
      const colonIdx = cacheKey.indexOf(':');
      const windowDays = colonIdx > 0
        ? parseInt(cacheKey.slice(colonIdx + 1), 10) || DEFAULT_COHORT_WINDOW_DAYS
        : DEFAULT_COHORT_WINDOW_DAYS;
      payload = await refreshCohortGrid(game, windowDays, config.perRefreshTimeoutMs);
    } else {
      const fn = readFunnelDef(cacheKey);
      if (!fn) {
        setStatus(resource, cacheKey, 'broken', 'funnel def missing — cache row orphaned');
        logRefresh({ resource, cacheKey, game, durationMs: Date.now() - started, status: 'broken' });
        return;
      }
      const result = await refreshFunnel(game, fn.def, fn.defHash, config.perRefreshTimeoutMs);
      // Preserve the funnel def alongside the result so future cron ticks can
      // re-run it without the FE needing to re-POST.
      payload = { ...result, funnelDef: fn.def, funnelDefHash: fn.defHash };
    }
    const { wrote } = upsertCache({
      resource,
      cacheKey,
      game,
      payload,
      cubeMetaVersion: metaVersion,
      ttlSeconds: ttl,
    });
    logRefresh({
      resource, cacheKey, game,
      durationMs: Date.now() - started,
      status: wrote ? 'ok' : 'skipped',
    });
  } catch (err) {
    setStatus(resource, cacheKey, 'broken', (err as Error).message);
    logRefresh({
      resource, cacheKey, game,
      durationMs: Date.now() - started,
      status: 'broken',
    });
  }
}

/** Ensure default cache keys exist for known games so cron can warm them. */
async function ensureBootstrapKeys(): Promise<void> {
  const cfg = loadGamesConfig();
  for (const game of cfg.games) {
    const metaVersion = await getCubeMetaVersion(game.id).catch(() => '');
    if (!metaVersion) continue;
    ensurePlaceholder('kpi_strip', game.id, game.id, metaVersion);
    ensurePlaceholder('cohort_grid', `${game.id}:${DEFAULT_COHORT_WINDOW_DAYS}`, game.id, metaVersion);
  }
}

let lastFunnelPruneAt = 0;
const FUNNEL_PRUNE_INTERVAL_MS = 6 * 60 * 60_000; // every 6h

export async function liveopsCacheTick(): Promise<void> {
  const config = getLiveopsCacheConfig();
  await ensureBootstrapKeys().catch(() => {});
  const stale = listStale().slice(0, config.perTickBudget);
  for (const row of stale) {
    await refreshOne(row.resource, row.cacheKey, row.game);
  }
  const now = Date.now();
  if (now - lastFunnelPruneAt >= FUNNEL_PRUNE_INTERVAL_MS) {
    lastFunnelPruneAt = now;
    try {
      const removed = pruneFunnelOlderThan(config.funnelRetentionDays);
      if (removed > 0) {
        // eslint-disable-next-line no-console
        console.log(`[refresh-liveops] pruned ${removed} stale funnel cache rows`);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[refresh-liveops] funnel prune failed: ${(err as Error).message}`);
    }
  }
}

let interval: ReturnType<typeof setInterval> | null = null;

export function startLiveopsCacheCron(): void {
  if (interval) return;
  void liveopsCacheTick().catch(() => {});
  interval = setInterval(() => {
    void liveopsCacheTick().catch(() => {});
  }, getLiveopsCacheConfig().tickIntervalMs);
}

export function stopLiveopsCacheCron(): void {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}

/** Test helper — refresh a single key synchronously. */
export async function refreshOneForTest(
  resource: 'kpi_strip' | 'cohort_grid' | 'funnel_result',
  cacheKey: string,
  game: string,
): Promise<void> {
  await refreshOne(resource, cacheKey, game);
}
