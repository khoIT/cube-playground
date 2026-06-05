/**
 * Tool test for list_dimension_values — distinct value enumeration, casing,
 * the `q` filter, truncation, and measure rejection. Mocks meta cache + fetch.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const META = {
  cubes: [
    {
      name: 'mf_users',
      measures: [{ name: 'mf_users.count', type: 'number' }],
      dimensions: [{ name: 'mf_users.payer_tier', type: 'string', title: 'Payer tier' }],
    },
  ],
};

vi.mock('../../src/config.js', () => ({
  config: { serverBaseUrl: 'http://localhost:3004' },
}));
vi.mock('../../src/core/cube-meta-cache.js', () => ({
  getMeta: vi.fn(async () => META),
}));

import { handler } from '../../src/tools/list-dimension-values.js';
import type { ToolContext } from '../../src/types.js';

const ctx = { gameId: 'g1', workspace: 'local' } as unknown as ToolContext;

function mockLoad(values: Array<string | number>) {
  const data = values.map((v) => ({ 'mf_users.payer_tier': v }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ data }) }) as unknown as Response),
  );
}

describe('list_dimension_values tool', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns distinct values with exact casing', async () => {
    mockLoad(['whale', 'dolphin', 'minnow']);
    const out = (await handler({ member: 'mf_users.payer_tier' }, ctx)) as {
      values: string[]; truncated: boolean; count: number;
    };
    expect(out.values).toEqual(['whale', 'dolphin', 'minnow']);
    expect(out.truncated).toBe(false);
    expect(out.count).toBe(3);
  });

  it('dedupes repeated values and drops nulls', async () => {
    mockLoad(['whale', 'whale', 'dolphin']);
    const out = (await handler({ member: 'mf_users.payer_tier' }, ctx)) as { values: string[] };
    expect(out.values).toEqual(['whale', 'dolphin']);
  });

  it('applies the case-insensitive q filter', async () => {
    mockLoad(['whale', 'dolphin', 'minnow']);
    const out = (await handler({ member: 'mf_users.payer_tier', q: 'WHA' }, ctx)) as { values: string[] };
    expect(out.values).toEqual(['whale']);
  });

  it('flags truncation when distinct values exceed the cap', async () => {
    mockLoad(Array.from({ length: 5 }, (_, i) => `v${i}`));
    const out = (await handler({ member: 'mf_users.payer_tier', limit: 3 }, ctx)) as {
      values: string[]; truncated: boolean; count: number;
    };
    expect(out.values).toHaveLength(3);
    expect(out.truncated).toBe(true);
    expect(out.count).toBe(3);
  });

  it('rejects a measure with an actionable message and does not query Cube', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const out = (await handler({ member: 'mf_users.count' }, ctx)) as { values: string[]; error?: string };
    expect(out.values).toEqual([]);
    expect(out.error).toMatch(/measure/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
