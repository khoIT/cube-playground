/**
 * Per-workspace game enumeration.
 *
 * A `prefix`-model workspace (the external multi-tenant cube-dev at
 * cube.gds.vng.vn) serves EVERY game's cubes in one flat schema, name-spaced by
 * a per-game prefix. The authoritative list of those games is the cube's own
 * open registry endpoint `GET <cubeApiUrl>/cubes` → `{ "cube_ids": [...] }`,
 * where each id is BOTH the tenant key and the cube-name prefix verbatim
 * (`ptg` → `ptg__recharge`, `cfm_vn` → `cfm_vn__active_daily`). We fetch + cache
 * it instead of hardcoding a list, so the playground tracks whatever the prod
 * cube serves (~65 games) with zero config churn.
 *
 * A `game_id`-model workspace (local) has one cube per concept and is enumerated
 * from the in-repo games config — no remote registry needed.
 *
 * Fail-soft: a fetch failure serves the last good list (if any) or an empty
 * array, never throws. The URL comes from the workspace def (SSRF guard) — the
 * client never supplies it.
 */

import { loadGamesConfig } from './games-config-loader.js';
import type { WorkspaceDef } from './workspaces-config-loader.js';

type WorkspaceShape = Pick<WorkspaceDef, 'id' | 'cubeApiUrl' | 'gameModel'>;

interface CacheEntry {
  at: number;
  ids: string[];
}

const cache = new Map<string, CacheEntry>();
const TTL_MS = 10 * 60 * 1000; // 10 min — the prod game roster changes rarely.
const FETCH_TIMEOUT_MS = 10_000;

/**
 * Fetch (cached) the cube_ids a prefix workspace serves via its `/cubes`
 * registry. Returns `[]` for non-prefix workspaces and on any fetch error
 * (serving the last good list when one is cached).
 */
export async function fetchProdCubeIds(ws: WorkspaceShape): Promise<string[]> {
  if (ws.gameModel !== 'prefix') return [];

  const hit = cache.get(ws.id);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.ids;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const url = new URL('/cubes', ws.cubeApiUrl).toString();
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`/cubes responded ${res.status}`);
    const body = (await res.json()) as { cube_ids?: unknown };
    const ids = Array.isArray(body.cube_ids)
      ? body.cube_ids.filter((x): x is string => typeof x === 'string' && x.length > 0)
      : [];
    if (ids.length > 0) cache.set(ws.id, { at: Date.now(), ids });
    return ids.length > 0 ? ids : hit?.ids ?? [];
  } catch {
    // Fail-soft: stale list if we have one, else empty. Surfaces an empty
    // picker / matrix rather than a 500.
    return hit?.ids ?? [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The game ids a workspace exposes:
 *   - `prefix`  → its `/cubes` registry (remote, cached).
 *   - `game_id` → the in-repo games config.
 * The single enumeration source for the admin grant matrix, workspace
 * readiness, the end-user game picker, and identity-map introspection.
 */
export async function listWorkspaceGameIds(ws: WorkspaceShape): Promise<string[]> {
  if (ws.gameModel === 'prefix') return fetchProdCubeIds(ws);
  return loadGamesConfig().games.map((g) => g.id);
}

/** Test-only cache reset. */
export function __resetProdGameRegistryCache(): void {
  cache.clear();
}
