/**
 * Tool: get_cube_meta
 * Returns the Cube /meta schema for the active game.
 * scope='compact' is the default — returns cubes with name + measures + dimensions only.
 * scope='full' returns the complete /meta JSON.
 */

import { z } from 'zod';
import * as cubeMetaCache from '../core/cube-meta-cache.js';
import type { ToolContext } from '../types.js';

export const name = 'get_cube_meta';
export const description =
  'Return the Cube schema (cubes, dimensions, measures) for the active game. ' +
  'Use scope="compact" (default) to save tokens, or scope="full" for the raw response.';

export const inputSchema = {
  scope: z.enum(['full', 'compact']).default('compact'),
};

export async function handler(
  args: { scope?: 'full' | 'compact' },
  ctx: ToolContext,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const meta = await cubeMetaCache.getMeta(ctx.gameId, ctx.workspace);

  if (args.scope === 'full') {
    return meta;
  }

  // Compact: cubes with name, title, and just measure/dimension names + titles
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cubes = (meta?.cubes ?? []).map((cube: any) => ({
    name: cube.name,
    title: cube.title,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    measures: (cube.measures ?? []).map((m: any) => ({ name: m.name, title: m.title, type: m.type })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dimensions: (cube.dimensions ?? []).map((d: any) => ({ name: d.name, title: d.title, type: d.type })),
  }));

  return { cubes };
}
