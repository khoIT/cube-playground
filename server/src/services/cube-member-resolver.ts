/**
 * Logical ↔ physical Cube member translation for prefix-model workspaces.
 *
 * Two workspace models exist (see workspaces-config-loader):
 *   - `game_id`  (local): one cube per concept (`mf_users`, `recharge`), scoped
 *     by a gameId dimension. Member names are already canonical.
 *   - `prefix`   (prod):  every game's cubes share one schema, name-spaced by a
 *     per-game prefix (`ballistar_mf_users`, `cfm_recharge`).
 *
 * Server-side config written in LOGICAL names (preset card specs, LiveOps KPI
 * config, anomaly metrics) must be PHYSICALIZED before hitting Cube on a prefix
 * workspace, and Cube responses (physical keys) LOGICALIZED before logical-named
 * consumers read them. This module is that single translation layer — so a new
 * feature never needs to know the workspace's naming model.
 *
 * Everything is a strict no-op when `prefix` is null (game_id workspaces, no
 * game, or unmapped game) — local behavior is unchanged. All operations are
 * idempotent on the `${prefix}_` boundary, so passing an already-physical
 * member (e.g. a segment's stored predicate filters) through is safe — it is
 * never double-prefixed.
 */

type CubeFilter =
  | { member?: string; dimension?: string; operator?: string; values?: unknown[] }
  | { and: CubeFilter[] }
  | { or: CubeFilter[] };

// Structural superset of a Cube query. Intentionally permissive (optional
// fields, loose `order`/`dateRange` value types) so real query objects from
// callers — card-runner's CubeQuery, inline literals in LiveOps/anomaly —
// satisfy it without casts. Only member-bearing fields are rewritten.
interface CubeQueryShape {
  measures?: string[];
  dimensions?: string[];
  timeDimensions?: Array<{ dimension: string; granularity?: string; dateRange?: unknown }>;
  filters?: CubeFilter[];
  order?: Record<string, string> | Array<[string, string]>;
  segments?: string[];
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
  if (!member.startsWith(needle)) return member;
  return member.slice(needle.length);
}

/** `cube` → `prefix_cube` for a bare cube name. Idempotent; no-op when prefix null. */
export function physicalCube(cube: string, prefix: string | null): string {
  if (!prefix) return cube;
  return cube.startsWith(`${prefix}_`) ? cube : `${prefix}_${cube}`;
}

/** `prefix_cube` → `cube` for a bare cube name (preset matching). No-op if unprefixed. */
export function logicalCube(cube: string, prefix: string | null): string {
  if (!prefix) return cube;
  const needle = `${prefix}_`;
  return cube.startsWith(needle) ? cube.slice(needle.length) : cube;
}

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
export function physicalizeQuery<T extends CubeQueryShape>(query: T, prefix: string | null): T {
  if (!prefix) return query;
  const out: CubeQueryShape = { ...query };
  if (Array.isArray(query.measures)) out.measures = query.measures.map((m) => physicalMember(m, prefix));
  if (Array.isArray(query.dimensions)) out.dimensions = query.dimensions.map((d) => physicalMember(d, prefix));
  if (Array.isArray(query.timeDimensions)) {
    out.timeDimensions = query.timeDimensions.map((td) => ({
      ...td,
      dimension: physicalMember(td.dimension, prefix),
    }));
  }
  if (Array.isArray(query.filters)) out.filters = query.filters.map((f) => physicalizeFilter(f, prefix));
  if (query.order) {
    if (Array.isArray(query.order)) {
      out.order = query.order.map(([m, dir]) => [physicalMember(m, prefix), dir] as [string, string]);
    } else {
      const nextOrder: Record<string, string> = {};
      for (const [m, dir] of Object.entries(query.order)) nextOrder[physicalMember(m, prefix)] = dir;
      out.order = nextOrder;
    }
  }
  if (Array.isArray(query.segments)) out.segments = query.segments.map((s) => physicalMember(s, prefix));
  return out as T;
}

/**
 * Rewrite the keys of Cube result rows from physical → logical so logical-named
 * consumers (preset card specs, KPI series extractors) read them correctly.
 * No-op when `prefix` is null.
 */
export function logicalizeRows<T extends Record<string, unknown>>(
  rows: T[],
  prefix: string | null,
): Array<Record<string, unknown>> {
  if (!prefix || rows.length === 0) return rows;
  return rows.map((row) => {
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) next[logicalMember(k, prefix)] = v;
    return next;
  });
}
