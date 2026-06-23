/**
 * Scope a Cube `/meta` response to a single game on `prefix`-model workspaces.
 *
 * On a `prefix` workspace (e.g. prod cube-dev) every game's cubes live in one
 * schema, name-spaced by a per-game prefix (`ballistar_recharge`,
 * `cfm_recharge`, …). Cube's `/meta` returns ALL games' cubes regardless of the
 * requested game, so a consumer scoped to one game (chat agent, Playground)
 * sees the same measure name (`revenue_vnd`) across several cubes and cannot
 * resolve which one is meant.
 *
 * `game_id`-model workspaces (local) need no filtering — they expose one cube
 * per concept and scope by a `gameId` dimension at query time.
 *
 * The prefix rule mirrors the per-game cube count in
 * `workspace-readiness.ts` (`name.startsWith(`${prefix}_`)`).
 */

import type { WorkspaceDef } from './workspaces-config-loader.js';

/**
 * Resolve the cube-name prefix for a game on a prefix workspace, or null when
 * filtering does not apply (non-prefix workspace, or no game).
 *
 * On the prod cube the game id IS the cube-name prefix verbatim (`ptg` →
 * `ptg__…`, `cfm_vn` → `cfm_vn__…`), so the prefix defaults to the game id.
 * `gamePrefixMap` remains an optional override for the rare game whose id ≠
 * prefix — but the identity default is what lets every game the cube serves
 * resolve without an explicit map entry.
 */
export function gamePrefixFor(
  workspace: Pick<WorkspaceDef, 'gameModel' | 'gamePrefixMap'>,
  gameId: string | null,
): string | null {
  if (workspace.gameModel !== 'prefix' || !gameId) return null;
  return workspace.gamePrefixMap?.[gameId] ?? gameId;
}

/**
 * Return a copy of a `/meta` response with `cubes` narrowed to those whose name
 * starts with `${prefix}__`. No-op (returns the input unchanged) when `prefix`
 * is null or the body is not a meta-shaped object with a `cubes` array.
 *
 * The `__` boundary matches the real cube naming (`<gameId>__<concept>`) and is
 * load-bearing: a single `_` would let prefix `ballistar` also capture the
 * separate tenants `ballistar_twid` / `ballistar_vn` (cross-tenant leak).
 */
export function filterMetaToGamePrefix(metaBody: unknown, prefix: string | null): unknown {
  if (!prefix || metaBody == null || typeof metaBody !== 'object') return metaBody;
  const body = metaBody as { cubes?: unknown };
  if (!Array.isArray(body.cubes)) return metaBody;
  const needle = `${prefix}__`;
  const cubes = (body.cubes as Array<{ name?: unknown }>).filter(
    (c) => c && typeof c.name === 'string' && c.name.startsWith(needle),
  );
  return { ...body, cubes };
}
