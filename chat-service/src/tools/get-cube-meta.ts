/**
 * Tool: get_cube_meta
 * Returns the Cube /meta schema for the active game.
 *
 * Three shapes, sized to stay under the Agent SDK MCP output cap (~25k tokens):
 *  - cubes=[names]   -> full member detail (descriptions + segments) for just
 *                       those cubes. Tolerant name matching so bare names work
 *                       against workspace-prefixed cubes (cfm_vn_user_recharge_daily).
 *  - scope='compact' -> names/titles/types for all cubes. If the serialized
 *                       payload would blow the cap (member-rich games like
 *                       cfm_vn), degrades to a cube INDEX (name + member
 *                       counts) with instructions to re-call with cubes=[...].
 *  - scope='full'    -> complete /meta JSON (joins, sql hints, drill members)
 *                       when it fits the budget; degrades to the same index
 *                       on large schemas. Prefer cubes=[...] instead.
 *
 * Every shape is workspace+game scoped upstream: the gateway filters /meta to
 * the active game on prefixed workspaces, and the meta cache strips views and
 * raw std_* cubes before this handler ever sees the payload.
 */

import { z } from 'zod';
import * as cubeMetaCache from '../core/cube-meta-cache.js';
import type { ToolContext } from '../types.js';

export const name = 'get_cube_meta';
export const description =
  'Return the Cube schema for the active game. To inspect specific cubes, pass ' +
  'cubes=["name", ...] — returns full member lists with descriptions and segments ' +
  '(bare names also match workspace-prefixed cubes). Without a filter, ' +
  'scope="compact" (default) returns all cubes; on large schemas it degrades to a ' +
  'name+count index — then re-call with cubes=[...] for the ones you need. ' +
  'scope="full" adds joins/sql fields when the schema is small enough.';

export const inputSchema = {
  scope: z.enum(['full', 'compact']).default('compact'),
  cubes: z
    .array(z.string())
    .optional()
    .describe('Cube names to fetch full member detail for (tolerant prefix matching)'),
};

/**
 * Keep the unfiltered compact payload safely below the SDK MCP output cap
 * (25k tokens). Schema JSON tokenizes at roughly 3 chars/token, so 60k chars
 * ≈ 20k tokens with headroom. Above this we return the index shape instead —
 * an oversized inline result gets dumped to a file by the SDK, which costs the
 * agent ~45s of grep/subagent recovery and can blow the turn timeout.
 */
const COMPACT_CHAR_BUDGET = 60_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCube = any;

/**
 * Tolerant cube-name match: exact (case-insensitive), or workspace-prefix
 * tolerant in both directions — a bare "user_recharge_daily" matches the prod
 * "cfm_vn_user_recharge_daily", and a prefixed request matches a bare local cube.
 */
function cubeNameMatches(cubeName: string, requested: string): boolean {
  const a = cubeName.toLowerCase();
  const b = requested.toLowerCase();
  return a === b || a.endsWith(`_${b}`) || b.endsWith(`_${a}`);
}

/**
 * Resolve one requested name against the cube list. Exact (case-insensitive)
 * hits win outright; suffix-tolerant matching is only the fallback. This keeps
 * a request like "recharge" from fanning out to every suffix cousin when an
 * exactly-named cube exists.
 */
function matchCubes(allCubes: AnyCube[], requested: string): AnyCube[] {
  const exact = allCubes.filter(
    (c) => String(c.name ?? '').toLowerCase() === requested.toLowerCase(),
  );
  if (exact.length > 0) return exact;
  return allCubes.filter((c) => cubeNameMatches(String(c.name ?? ''), requested));
}

/** Full member detail for one cube — descriptions and segments included. */
function cubeDetail(cube: AnyCube) {
  return {
    name: cube.name,
    title: cube.title,
    description: cube.description,
    measures: (cube.measures ?? []).map((m: AnyCube) => ({
      name: m.name,
      title: m.title,
      type: m.type,
      description: m.description,
    })),
    dimensions: (cube.dimensions ?? []).map((d: AnyCube) => ({
      name: d.name,
      title: d.title,
      type: d.type,
      description: d.description,
    })),
    segments: (cube.segments ?? []).map((s: AnyCube) => ({
      name: s.name,
      title: s.title,
      description: s.description,
    })),
  };
}

export async function handler(
  args: { scope?: 'full' | 'compact'; cubes?: string[] },
  ctx: ToolContext,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const meta = await cubeMetaCache.getMeta(ctx.gameId, ctx.workspace);
  const allCubes: AnyCube[] = meta?.cubes ?? [];

  // Targeted fetch: full detail for the requested cubes only.
  if (args.cubes && args.cubes.length > 0) {
    const matched: AnyCube[] = [];
    const notFound: string[] = [];
    for (const requested of args.cubes) {
      const hits = matchCubes(allCubes, requested);
      if (hits.length === 0) notFound.push(requested);
      else matched.push(...hits);
    }
    // De-dupe in case two requested names matched the same cube.
    const seen = new Set<string>();
    const deduped = matched.filter((c) => {
      const key = String(c.name ?? '');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // The detail path needs the same size guard as the unfiltered path — a
    // multi-cube request (or a suffix request fanning out across prefixed
    // cubes) can blow the SDK output cap just as easily as the full schema.
    // Degrade in two steps: drop member descriptions first, then trim whole
    // cubes from the tail (always keeping at least one).
    let cubes = deduped.map(cubeDetail);
    const truncated: string[] = [];
    if (JSON.stringify(cubes).length > COMPACT_CHAR_BUDGET) {
      cubes = cubes.map((c) => ({
        ...c,
        description: c.description,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        measures: c.measures.map(({ description: _d, ...m }: any) => m),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        dimensions: c.dimensions.map(({ description: _d, ...d }: any) => d),
      }));
      while (cubes.length > 1 && JSON.stringify(cubes).length > COMPACT_CHAR_BUDGET) {
        const dropped = cubes.pop();
        if (dropped) truncated.unshift(dropped.name);
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = { cubes };
    if (truncated.length > 0) {
      result.truncated = truncated;
      result.note =
        'Response trimmed to fit output limits (member descriptions dropped' +
        (truncated.length ? `; cubes omitted: ${truncated.join(', ')}` : '') +
        '). Re-call get_cube_meta with one cube at a time for the omitted ones.';
    }
    if (notFound.length > 0) {
      result.notFound = notFound;
      result.availableCubes = allCubes.map((c: AnyCube) => c.name);
    }
    return result;
  }

  // Schema-too-large fallback: a name+count index instead of letting the SDK
  // dump an oversized result to a file the agent has to dig back out of.
  const cubeIndex = () => ({
    note:
      'Schema too large to inline. Call get_cube_meta with cubes=["name", ...] ' +
      'to get full member details for the cubes you need.',
    cubes: allCubes.map((c: AnyCube) => ({
      name: c.name,
      title: c.title,
      measures: (c.measures ?? []).length,
      dimensions: (c.dimensions ?? []).length,
      segments: (c.segments ?? []).length,
    })),
  });

  if (args.scope === 'full') {
    // Full is verbose (joins, sql, drill members, …) — same budget applies.
    // Note: like every shape here, it is already workspace+game scoped by the
    // gateway and views/std-stripped by the meta cache; "full" only widens the
    // per-cube fields, never the cube set.
    if (JSON.stringify(meta).length <= COMPACT_CHAR_BUDGET) {
      return meta;
    }
    return cubeIndex();
  }

  // Compact: cubes with name, title, and measure/dimension/segment names + types.
  const cubes = allCubes.map((cube: AnyCube) => ({
    name: cube.name,
    title: cube.title,
    measures: (cube.measures ?? []).map((m: AnyCube) => ({ name: m.name, title: m.title, type: m.type })),
    dimensions: (cube.dimensions ?? []).map((d: AnyCube) => ({ name: d.name, title: d.title, type: d.type })),
    segments: (cube.segments ?? []).map((s: AnyCube) => ({ name: s.name, title: s.title })),
  }));

  const compact = { cubes };
  if (JSON.stringify(compact).length <= COMPACT_CHAR_BUDGET) {
    return compact;
  }

  return cubeIndex();
}
