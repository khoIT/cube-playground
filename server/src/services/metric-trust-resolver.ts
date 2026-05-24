/**
 * metric-trust-resolver — downgrade `trust` to `'draft'` at API-response time
 * when a metric's formula refs don't resolve against a game's `/meta`.
 *
 * The loader (`business-metrics-loader`) stays a pure file → memory registry.
 * This resolver wraps the loader output at the HTTP layer with per-game
 * trust adjustments. YAML files are never mutated; the team's declared
 * intent stays preserved on disk while users see honest badges.
 *
 * Cache: keyed by `gameId`, stores the SHA-256 hash of the game's last
 * /meta payload plus a precomputed `Map<metricId, trust>`. Reused while
 * within TTL_MS and the hash is unchanged.
 *
 * Fail-open: if /meta fetch or token resolution fails, return metrics
 * unchanged plus a warning. Better to show a possibly-stale green than
 * to draft everything when Cube is down.
 */

import { createHash } from 'node:crypto';

import { getMeta } from './cube-client.js';
import { resolveCubeTokenForGame } from './resolve-cube-token.js';
import {
  snapshotFromMeta,
  validateRefs,
  type MetaResponse,
} from './metric-ref-validator.js';
import type { BusinessMetric } from '../types/business-metric.js';

const TTL_MS = 60_000;

interface GameCacheEntry {
  metaHash: string;
  trustMap: Map<string, BusinessMetric['trust']>;
  fetchedAt: number;
}

const cache: Map<string, GameCacheEntry> = new Map();

function hashMeta(meta: unknown): string {
  return createHash('sha256').update(JSON.stringify(meta)).digest('hex');
}

/**
 * Build a trust map for the given metrics against a meta snapshot.
 * A metric whose `validateRefs` flags any unresolved ref is downgraded
 * to `'draft'`. A `'deprecated'` metric is never downgraded — explicit
 * retirement outranks formula-resolvability.
 */
function buildTrustMap(
  metrics: BusinessMetric[],
  meta: MetaResponse,
): Map<string, BusinessMetric['trust']> {
  const snapshot = snapshotFromMeta(meta);
  const unresolved = validateRefs(metrics, snapshot);
  const brokenIds = new Set(unresolved.map((u) => u.metricId));
  const map = new Map<string, BusinessMetric['trust']>();
  for (const m of metrics) {
    if (m.trust === 'deprecated') {
      map.set(m.id, 'deprecated');
      continue;
    }
    map.set(m.id, brokenIds.has(m.id) ? 'draft' : m.trust);
  }
  return map;
}

/**
 * Returns metrics with `trust` possibly downgraded to `'draft'` for the
 * given game. When `gameId` is null/undefined, returns the input untouched.
 *
 * @param metrics  Output of `business-metrics-loader.getAll()`.
 * @param gameId   Game id whose `/meta` defines "resolvable refs".
 */
export async function resolveTrustForGame(
  metrics: BusinessMetric[],
  gameId: string | null | undefined,
  logger: { warn: (...args: unknown[]) => void } = console,
): Promise<BusinessMetric[]> {
  if (!gameId) return metrics;

  const token = resolveCubeTokenForGame(gameId);
  if (!token) {
    logger.warn(
      `[metric-trust-resolver] no Cube token for game="${gameId}"; returning declared trust`,
    );
    return metrics;
  }

  let meta: MetaResponse;
  try {
    meta = (await getMeta(token)) as MetaResponse;
  } catch (err) {
    logger.warn(
      `[metric-trust-resolver] /meta fetch failed for game="${gameId}": ${
        (err as Error).message
      }`,
    );
    return metrics;
  }

  const metaHash = hashMeta(meta);
  const now = Date.now();
  let entry = cache.get(gameId);

  if (!entry || entry.metaHash !== metaHash || now - entry.fetchedAt > TTL_MS) {
    entry = {
      metaHash,
      trustMap: buildTrustMap(metrics, meta),
      fetchedAt: now,
    };
    cache.set(gameId, entry);
  }

  const { trustMap } = entry;
  return metrics.map((m) => {
    const resolved = trustMap.get(m.id);
    if (resolved && resolved !== m.trust) {
      return { ...m, trust: resolved };
    }
    return m;
  });
}

/** Test-only: reset module cache. */
export function __resetTrustCache(): void {
  cache.clear();
}
