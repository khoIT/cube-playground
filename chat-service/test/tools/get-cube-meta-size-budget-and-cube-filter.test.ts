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

  it('scope=full on a small schema returns the raw meta unchanged', async () => {
    const raw = { cubes: [makeCube('recharge', 1, 1)], extraField: 'kept' };
    metaHolder.meta = raw;
    const res = await handler({ scope: 'full' }, ctx);
    expect(res).toBe(raw);
  });

  it('scope=full on an oversized schema degrades to the index, not a raw dump', async () => {
    metaHolder.meta = {
      cubes: Array.from({ length: 30 }, (_, i) => makeCube(`etl_cube_${i}`, 40, 40, 5)),
    };
    const res = await handler({ scope: 'full' }, ctx);
    expect(res.note).toMatch(/cubes=\[/);
    expect(res.cubes[0].measures).toBe(40); // count, not member list
    expect(JSON.stringify(res).length).toBeLessThan(60_000);
  });

  it('cubes filter: exact match wins over suffix fan-out', async () => {
    // "recharge" must hit the exactly-named cube only, not suffix cousins.
    metaHolder.meta = {
      cubes: [makeCube('recharge', 2, 2), makeCube('user_recharge', 2, 2)],
    };
    const res = await handler({ cubes: ['recharge'] }, ctx);
    expect(res.cubes.map((c: { name: string }) => c.name)).toEqual(['recharge']);
  });

  it('cubes filter: oversized multi-cube detail drops member descriptions to fit', async () => {
    // Two big cubes whose detail (with descriptions) exceeds the budget but
    // fits once member descriptions are stripped.
    metaHolder.meta = { cubes: [makeCube('big_a', 120, 120), makeCube('big_b', 120, 120)] };
    // Inflate descriptions so the described form is guaranteed over budget.
    for (const c of (metaHolder.meta as { cubes: Array<Record<string, unknown>> }).cubes) {
      for (const m of c.measures as Array<{ description: string }>) m.description = 'x'.repeat(300);
      for (const d of c.dimensions as Array<{ description: string }>) d.description = 'x'.repeat(300);
    }
    const res = await handler({ cubes: ['big_a', 'big_b'] }, ctx);
    expect(res.cubes).toHaveLength(2);
    expect(res.cubes[0].measures[0].description).toBeUndefined();
    expect(JSON.stringify(res).length).toBeLessThan(60_000);
  });

  it('cubes filter: still-oversized detail trims tail cubes and says so', async () => {
    // Many big cubes — even description-stripped they cannot all fit.
    metaHolder.meta = {
      cubes: Array.from({ length: 12 }, (_, i) => makeCube(`huge_${i}`, 200, 200)),
    };
    const res = await handler({ cubes: Array.from({ length: 12 }, (_, i) => `huge_${i}`) }, ctx);
    expect(res.cubes.length).toBeGreaterThanOrEqual(1);
    expect(res.cubes.length).toBeLessThan(12);
    expect(res.truncated.length).toBeGreaterThan(0);
    expect(res.note).toMatch(/omitted/);
    expect(JSON.stringify(res).length).toBeLessThan(70_000);
  });

  it('prod shape: suffix request across 5 prefixed games stays under budget', async () => {
    // Mirrors the measured prod gateway-unfiltered worst case: 5 games each
    // carrying an mf_users-sized cube (~46 dims with long descriptions).
    const games = ['ballistar', 'cfm', 'cros', 'jus', 'tf'];
    metaHolder.meta = { cubes: games.map((g) => makeCube(`${g}_mf_users`, 13, 46)) };
    for (const c of (metaHolder.meta as { cubes: Array<Record<string, unknown>> }).cubes) {
      for (const d of c.dimensions as Array<{ description: string }>) d.description = 'y'.repeat(200);
    }
    const res = await handler({ cubes: ['mf_users'] }, ctx);
    expect(res.cubes.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(res).length).toBeLessThan(60_000);
  });
});
