/**
 * Frontend logical ↔ physical Cube member translation for prefix-model
 * workspaces. Mirror of the server-side `cube-member-resolver.ts` — same
 * contract, kept separate because the FE bundle can't import server modules.
 *
 * Two workspace models exist (see workspace-context):
 *   - `game_id`  (local): one cube per concept (`mf_users`), scoped by a gameId
 *     dimension. Member names are already canonical → translation is a no-op.
 *   - `prefix`   (prod):  every game's cubes share one schema, name-spaced by a
 *     per-game prefix (`ballistar_mf_users`).
 *
 * Logical-named FE config (segment-monitor preset card specs) must be
 * PHYSICALIZED before hitting Cube on a prefix workspace, and Cube responses
 * (physical keys) LOGICALIZED before logical-named consumers read them.
 *
 * Everything is a strict no-op when `prefix` is null (game_id workspaces, no
 * game, or unmapped game). All operations are idempotent on the `${prefix}_`
 * boundary — passing an already-physical member (e.g. a segment's stored
 * predicate slice filters, which originate from the physical query builder)
 * through is safe; it is never double-prefixed.
 */

import type { Query, QueryOrder } from '@cubejs-client/core';

interface PrefixWorkspaceShape {
  gameModel: 'game_id' | 'prefix';
  gamePrefixMap?: Record<string, string>;
}

/**
 * Resolve the cube-name prefix for a game, or null when translation does not
 * apply (non-prefix workspace, or no game). Mirrors the server's `gamePrefixFor`:
 * the prod game id IS the cube-name prefix verbatim, so it defaults to the game
 * id; `gamePrefixMap` is an optional override for any game whose id ≠ prefix.
 */
export function resolveGamePrefix(
  workspace: PrefixWorkspaceShape | null,
  gameId: string | null,
): string | null {
  if (!workspace || workspace.gameModel !== 'prefix' || !gameId) return null;
  return workspace.gamePrefixMap?.[gameId] ?? gameId;
}

/** `cube.field` → `prefix_cube.field`. Idempotent on the `${prefix}_` boundary. */
export function physicalMember(member: string, prefix: string | null): string {
  if (!prefix) return member;
  const dot = member.indexOf('.');
  if (dot < 0) return member; // not a qualified member — leave alone
  const cube = member.slice(0, dot);
  if (cube.startsWith(`${prefix}_`)) return member; // already physical
  return `${prefix}_${member}`;
}

/** `prefix_cube.field` → `cube.field`. Idempotent (no-op if not prefixed). */
export function logicalMember(member: string, prefix: string | null): string {
  if (!prefix) return member;
  const needle = `${prefix}_`;
  return member.startsWith(needle) ? member.slice(needle.length) : member;
}

type CubeFilter =
  | { member?: string; dimension?: string; operator?: string; values?: unknown[] }
  | { and: CubeFilter[] }
  | { or: CubeFilter[] };

function physicalizeFilter(f: CubeFilter, prefix: string): CubeFilter {
  if ('and' in f && Array.isArray(f.and)) return { and: f.and.map((c) => physicalizeFilter(c, prefix)) };
  if ('or' in f && Array.isArray(f.or)) return { or: f.or.map((c) => physicalizeFilter(c, prefix)) };
  const leaf = f as { member?: string; dimension?: string };
  const next = { ...f } as { member?: string; dimension?: string };
  if (leaf.member) next.member = physicalMember(leaf.member, prefix);
  if (leaf.dimension) next.dimension = physicalMember(leaf.dimension, prefix);
  return next as CubeFilter;
}

/**
 * Rewrite every member reference in a Cube query to its physical (prefixed)
 * name. No-op when `prefix` is null. Idempotent — already-physical members
 * (e.g. a segment's stored slice filters) pass through unchanged.
 */
export function physicalizeQuery(query: Query, prefix: string | null): Query {
  if (!prefix) return query;
  const out: Query = { ...query };
  if (Array.isArray(query.measures)) out.measures = query.measures.map((m) => physicalMember(m, prefix));
  if (Array.isArray(query.dimensions)) out.dimensions = query.dimensions.map((d) => physicalMember(d, prefix));
  if (Array.isArray(query.timeDimensions)) {
    out.timeDimensions = query.timeDimensions.map((td) => ({
      ...td,
      dimension: physicalMember(td.dimension, prefix),
    }));
  }
  if (Array.isArray(query.filters)) {
    out.filters = query.filters.map((f) => physicalizeFilter(f as CubeFilter, prefix)) as Query['filters'];
  }
  if (query.order) {
    if (Array.isArray(query.order)) {
      out.order = query.order.map(([m, dir]) => [physicalMember(m, prefix), dir] as [string, QueryOrder]);
    } else {
      const nextOrder: Record<string, QueryOrder> = {};
      for (const [m, dir] of Object.entries(query.order as Record<string, QueryOrder>)) {
        nextOrder[physicalMember(m, prefix)] = dir;
      }
      out.order = nextOrder;
    }
  }
  if (Array.isArray(query.segments)) out.segments = query.segments.map((s) => physicalMember(s, prefix));
  return out;
}

/**
 * Rewrite the keys of Cube result rows from physical → logical so logical-named
 * consumers (segment-monitor preset card specs) read them correctly. No-op when
 * `prefix` is null.
 */
export function logicalizeRows(rows: unknown[], prefix: string | null): unknown[] {
  if (!prefix || rows.length === 0) return rows;
  return rows.map((row) => {
    if (row == null || typeof row !== 'object') return row;
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
      next[logicalMember(k, prefix)] = v;
    }
    return next;
  });
}
