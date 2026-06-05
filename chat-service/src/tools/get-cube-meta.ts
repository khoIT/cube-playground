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
 *  - scope='full'    -> raw /meta JSON. May exceed the output cap on large
 *                       schemas — prefer cubes=[...] instead.
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
  'scope="full" returns raw /meta and can exceed output limits on large schemas.';

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
      const hits = allCubes.filter((c) => cubeNameMatches(String(c.name ?? ''), requested));
      if (hits.length === 0) notFound.push(requested);
      else matched.push(...hits);
    }
    // De-dupe in case two requested names matched the same cube.
    const seen = new Set<string>();
    const cubes = matched
      .filter((c) => {
        const key = String(c.name ?? '');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map(cubeDetail);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = { cubes };
    if (notFound.length > 0) {
      result.notFound = notFound;
      result.availableCubes = allCubes.map((c: AnyCube) => c.name);
    }
    return result;
  }

  if (args.scope === 'full') {
    return meta;
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

  // Schema too large to inline — return an index instead of letting the SDK
  // dump an oversized result to a file the agent has to dig back out of.
  return {
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
  };
}
