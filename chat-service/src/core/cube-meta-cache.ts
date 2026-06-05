/**
 * LRU TTL cache for Cube /meta responses, keyed by (workspace, gameId).
 * Fetches go through the Fastify gateway (`${serverBaseUrl}/cube-api/v1/meta`)
 * so the workspace registry resolves the upstream URL + auth. Authorization
 * comes from the gateway — chat-service does NOT forward the legacy
 * X-Cube-Token to the proxy.
 *
 * TTL: 60 seconds.
 *
 * Phase-06: also caches a derived `version` hash (sha256 of stable schema subset)
 * used as the cubeMetaHash component in the response-cache key.
 */

import { LRUCache } from 'lru-cache';
import { createHash } from 'node:crypto';
import { config } from '../config.js';

interface MetaCacheEntry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meta: any;
  fetchedAt: number;
  /** sha256 of stable schema subset — computed lazily on first call, memoized per TTL cycle. */
  version?: string;
}

const TTL_MS = 60_000;

const cache = new LRUCache<string, MetaCacheEntry>({ max: 50 });

function cacheKey(workspace: string, gameId: string): string {
  return `${workspace}#${gameId}`;
}

/**
 * Return the /meta JSON for the given workspace+game.
 * Results are cached for TTL_MS. A stale-or-missing entry triggers a fresh fetch
 * through the workspace-aware Fastify proxy.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getMeta(gameId: string, workspace: string): Promise<any> {
  const key = cacheKey(workspace, gameId);
  const entry = cache.get(key);
  if (entry && Date.now() - entry.fetchedAt < TTL_MS) {
    return entry.meta;
  }

  const url = `${config.serverBaseUrl}/cube-api/v1/meta`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'X-Cube-Workspace': workspace,
      'X-Cube-Game': gameId,
    },
  });

  if (!res.ok) {
    throw new Error(
      `Failed to fetch /meta for workspace=${workspace} game=${gameId}: ${res.status} ${res.statusText}`,
    );
  }

  const meta = stripAgentInvisibleCubes(await res.json());
  cache.set(key, { meta, fetchedAt: Date.now() });
  return meta;
}

/**
 * True when a cube is a raw `std_*` table passthrough the agent must not see.
 *
 * `std_`-prefixed tables are upstream pipeline surfaces, not analyst-facing
 * semantics — the curated cubes built on top of them (`user_recharge_daily`,
 * `active_daily`, …) are the supported entry points. Matches the prefix both
 * bare (`std_ingame_…`, game_id workspaces) and behind a game prefix
 * (`cfm_std_ingame_…`, prefix workspaces).
 */
export function isRawStdTableCube(name: unknown): boolean {
  if (typeof name !== 'string') return false;
  return name.startsWith('std_') || name.includes('_std_');
}

/**
 * Drop views and raw `std_*` table cubes from a /meta response.
 *
 * Views: chatbot artifacts must be authored against cubes — cubes expose the
 * full join graph, so a query opened in the builder stays explorable (the user
 * can add cross-cube dimensions). Views collapse a query to a single
 * self-contained namespace that can't join to anything, which strands the user
 * in the builder. Views are reserved for a later use case. Cube tags views as
 * `type: 'view'`; cubes are `type: 'cube'` or untyped.
 *
 * Raw std_ tables: see {@link isRawStdTableCube}.
 *
 * Stripping here — the single fetch boundary — keeps every downstream consumer
 * (get_cube_meta, extractMemberNames validation, capability detection) scoped
 * to agent-visible cubes by default.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function stripAgentInvisibleCubes(meta: any): any {
  if (!meta || !Array.isArray(meta.cubes)) return meta;
  return {
    ...meta,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cubes: meta.cubes.filter((c: any) => c?.type !== 'view' && !isRawStdTableCube(c?.name)),
  };
}

/** Extract all known member names (measures + dimensions) from a /meta response. */
export function extractMemberNames(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meta: any,
): Set<string> {
  const names = new Set<string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cubes: any[] = meta?.cubes ?? [];
  for (const cube of cubes) {
    for (const m of cube.measures ?? []) names.add(m.name);
    for (const d of cube.dimensions ?? []) names.add(d.name);
  }
  return names;
}

/**
 * Return a deterministic sha256 hash of the stable schema subset for
 * `(workspace, gameId)`. Stable subset: sorted cube names + sorted
 * measure/dimension names + types. Recomputed whenever the TTL-gated meta
 * fetch fires; memoized otherwise.
 *
 * Falls back to sha256('unknown') if meta cannot be fetched (caller handles
 * cache misses transparently — a stale hash simply produces a cache miss).
 */
export async function getMetaVersion(gameId: string, workspace: string): Promise<string> {
  // Reuse the already-fetched meta if still fresh; fetch otherwise.
  const meta = await getMeta(gameId, workspace);
  const entry = cache.get(cacheKey(workspace, gameId));
  if (entry?.version) return entry.version;

  const version = computeMetaVersion(meta);
  if (entry) entry.version = version;
  return version;
}

/** Compute the stable schema hash from a raw /meta response. Exported for tests. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function computeMetaVersion(meta: any): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cubes: any[] = meta?.cubes ?? [];
  const stable = cubes
    .map((c) => ({
      name: c.name as string,
      measures: ((c.measures ?? []) as Array<{ name: string; type: string }>)
        .map((m) => ({ name: m.name, type: m.type }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      dimensions: ((c.dimensions ?? []) as Array<{ name: string; type: string }>)
        .map((d) => ({ name: d.name, type: d.type }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      segments: ((c.segments ?? []) as Array<{ name: string }>)
        .map((s) => s.name)
        .sort(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return createHash('sha256').update(JSON.stringify(stable), 'utf8').digest('hex');
}

/** Invalidate the cache entry for a (workspace, game) pair (useful for tests). */
export function invalidate(gameId: string, workspace = 'local'): void {
  cache.delete(cacheKey(workspace, gameId));
}

/** Test-only: drop every entry across all workspaces. */
export function __resetMetaCache(): void {
  cache.clear();
}
