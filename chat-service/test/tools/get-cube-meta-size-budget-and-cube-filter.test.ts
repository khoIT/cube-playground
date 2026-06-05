/**
 * Tool test for get_cube_meta — size budget degradation and the cubes=[...]
 * targeted-fetch filter. Regression for the cfm_vn chat timeout: an unfiltered
 * compact response on member-rich games exceeded the SDK MCP output cap, got
 * dumped to a file, and the agent burned the turn timeout digging it back out.
 * Mocks the meta cache.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mutable holder so each test can swap the meta the cache returns.
const metaHolder: { meta: unknown } = { meta: { cubes: [] } };

vi.mock('../../src/core/cube-meta-cache.js', () => ({
  getMeta: vi.fn(async () => metaHolder.meta),
}));

import { handler } from '../../src/tools/get-cube-meta.js';
import type { ToolContext } from '../../src/types.js';

const ctx = { gameId: 'cfm_vn', workspace: 'local' } as unknown as ToolContext;

function makeCube(name: string, nMeasures: number, nDims: number, nSegs = 1) {
  return {
    name,
    title: `Title of ${name}`,
    description: `Description of ${name}`,
    measures: Array.from({ length: nMeasures }, (_, i) => ({
      name: `${name}.m${i}`,
      title: `Measure ${i}`,
      type: 'number',
      description: `measure ${i} of ${name}`,
    })),
    dimensions: Array.from({ length: nDims }, (_, i) => ({
      name: `${name}.d${i}`,
      title: `Dimension ${i}`,
      type: 'string',
      description: `dimension ${i} of ${name}`,
    })),
    segments: Array.from({ length: nSegs }, (_, i) => ({
      name: `${name}.s${i}`,
      title: `Segment ${i}`,
      description: `segment ${i} of ${name}`,
    })),
  };
}

describe('get_cube_meta tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    metaHolder.meta = { cubes: [] };
  });

  it('small schema: compact returns full member lists including segments', async () => {
    metaHolder.meta = { cubes: [makeCube('recharge', 3, 4, 2)] };
    const res = await handler({ scope: 'compact' }, ctx);
    expect(res.note).toBeUndefined();
    expect(res.cubes).toHaveLength(1);
    expect(res.cubes[0].measures).toHaveLength(3);
    expect(res.cubes[0].dimensions).toHaveLength(4);
    // Segments were previously omitted from compact — the agent couldn't see
    // e.g. real_users_only. They must be present now.
    expect(res.cubes[0].segments).toEqual([
      { name: 'recharge.s0', title: 'Segment 0' },
      { name: 'recharge.s1', title: 'Segment 1' },
    ]);
  });

  it('oversized schema: compact degrades to a name+count index with guidance', async () => {
    // ~30 member-rich cubes pushes serialized compact well past the budget.
    metaHolder.meta = {
      cubes: Array.from({ length: 30 }, (_, i) => makeCube(`etl_cube_${i}`, 40, 40, 5)),
    };
    const res = await handler({ scope: 'compact' }, ctx);
    expect(res.note).toMatch(/cubes=\[/);
    expect(res.cubes).toHaveLength(30);
    expect(res.cubes[0]).toEqual({
      name: 'etl_cube_0',
      title: 'Title of etl_cube_0',
      measures: 40,
      dimensions: 40,
      segments: 5,
    });
    // The index itself must be small enough to inline.
    expect(JSON.stringify(res).length).toBeLessThan(60_000);
  });

  it('cubes filter: returns full detail with descriptions and segments', async () => {
    metaHolder.meta = {
      cubes: [makeCube('user_recharge_daily', 5, 6, 3), makeCube('mf_users', 10, 20, 4)],
    };
    const res = await handler({ cubes: ['user_recharge_daily'] }, ctx);
    expect(res.cubes).toHaveLength(1);
    expect(res.cubes[0].name).toBe('user_recharge_daily');
    expect(res.cubes[0].description).toBe('Description of user_recharge_daily');
    expect(res.cubes[0].measures[0].description).toBe('measure 0 of user_recharge_daily');
    expect(res.cubes[0].segments).toHaveLength(3);
    expect(res.notFound).toBeUndefined();
  });

  it('cubes filter: bare name matches workspace-prefixed prod cube', async () => {
    metaHolder.meta = { cubes: [makeCube('cfm_vn_user_recharge_daily', 5, 6)] };
    const res = await handler({ cubes: ['user_recharge_daily'] }, ctx);
    expect(res.cubes).toHaveLength(1);
    expect(res.cubes[0].name).toBe('cfm_vn_user_recharge_daily');
  });

  it('cubes filter: prefixed request matches bare local cube', async () => {
    metaHolder.meta = { cubes: [makeCube('user_recharge_daily', 5, 6)] };
    const res = await handler({ cubes: ['cfm_vn_user_recharge_daily'] }, ctx);
    expect(res.cubes).toHaveLength(1);
    expect(res.cubes[0].name).toBe('user_recharge_daily');
  });

  it('cubes filter: unknown name reports notFound with available cube names', async () => {
    metaHolder.meta = { cubes: [makeCube('recharge', 2, 2)] };
    const res = await handler({ cubes: ['nope_cube'] }, ctx);
    expect(res.cubes).toHaveLength(0);
    expect(res.notFound).toEqual(['nope_cube']);
    expect(res.availableCubes).toEqual(['recharge']);
  });

  it('cubes filter: duplicate matches are de-duped', async () => {
    metaHolder.meta = { cubes: [makeCube('user_recharge_daily', 2, 2)] };
    const res = await handler(
      { cubes: ['user_recharge_daily', 'cfm_vn_user_recharge_daily'] },
      ctx,
    );
    expect(res.cubes).toHaveLength(1);
  });

  it('scope=full without filter returns the raw meta unchanged', async () => {
    const raw = { cubes: [makeCube('recharge', 1, 1)], extraField: 'kept' };
    metaHolder.meta = raw;
    const res = await handler({ scope: 'full' }, ctx);
    expect(res).toBe(raw);
  });
});
