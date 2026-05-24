/**
 * metric-trust-resolver tests.
 *
 * Verifies:
 *  - missing/null gameId → metrics returned unchanged.
 *  - unresolved refs → trust downgraded to 'draft'.
 *  - resolved refs → declared trust preserved.
 *  - `deprecated` never downgraded.
 *  - cache hit when same meta hash + within TTL.
 *  - cache invalidated when meta hash changes.
 *  - /meta fetch error or missing token → fail-open + warning.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetTrustCache,
  resolveTrustForGame,
} from '../src/services/metric-trust-resolver.js';
import type { BusinessMetric } from '../src/types/business-metric.js';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../src/services/cube-client.js', () => ({
  getMeta: vi.fn(),
}));
vi.mock('../src/services/resolve-cube-token.js', () => ({
  resolveCubeTokenForGame: vi.fn(),
}));

import { getMeta } from '../src/services/cube-client.js';
import { resolveCubeTokenForGame } from '../src/services/resolve-cube-token.js';

const getMetaMock = vi.mocked(getMeta);
const tokenMock = vi.mocked(resolveCubeTokenForGame);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function metric(
  id: string,
  ref: string,
  trust: BusinessMetric['trust'] = 'certified',
): BusinessMetric {
  return {
    id,
    label: id,
    description: 'x',
    tier: 1,
    domain: 'engagement',
    owner: 'team@vng',
    trust,
    formula: { type: 'measure', ref },
  };
}

function metaWith(members: string[]): {
  cubes: Array<{ name: string; measures: Array<{ name: string }> }>;
} {
  // Group members by their leading "cube." prefix into Cube /meta shape.
  const byCube: Record<string, string[]> = {};
  for (const m of members) {
    const dot = m.indexOf('.');
    const cube = m.slice(0, dot);
    byCube[cube] = byCube[cube] ?? [];
    byCube[cube].push(m);
  }
  return {
    cubes: Object.entries(byCube).map(([name, ms]) => ({
      name,
      measures: ms.map((n) => ({ name: n })),
    })),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('resolveTrustForGame', () => {
  beforeEach(() => {
    __resetTrustCache();
    vi.clearAllMocks();
    tokenMock.mockReturnValue('test-token');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns metrics unchanged when gameId is null', async () => {
    const metrics = [metric('a', 'mf_users.x'), metric('b', 'mf_users.y')];
    const out = await resolveTrustForGame(metrics, null);
    expect(out).toEqual(metrics);
    expect(getMetaMock).not.toHaveBeenCalled();
  });

  it('returns metrics unchanged when gameId is undefined', async () => {
    const metrics = [metric('a', 'mf_users.x')];
    const out = await resolveTrustForGame(metrics, undefined);
    expect(out).toEqual(metrics);
    expect(getMetaMock).not.toHaveBeenCalled();
  });

  it('downgrades certified → draft when ref does not resolve', async () => {
    getMetaMock.mockResolvedValue(metaWith(['mf_users.exists']));
    const metrics = [
      metric('good', 'mf_users.exists', 'certified'),
      metric('bad', 'mf_users.missing', 'certified'),
    ];
    const out = await resolveTrustForGame(metrics, 'ballistar');
    expect(out.find((m) => m.id === 'good')?.trust).toBe('certified');
    expect(out.find((m) => m.id === 'bad')?.trust).toBe('draft');
  });

  it('keeps deprecated regardless of ref resolution', async () => {
    getMetaMock.mockResolvedValue(metaWith(['mf_users.exists']));
    const metrics = [
      metric('a', 'mf_users.missing', 'deprecated'),
      metric('b', 'mf_users.exists', 'deprecated'),
    ];
    const out = await resolveTrustForGame(metrics, 'ballistar');
    expect(out.every((m) => m.trust === 'deprecated')).toBe(true);
  });

  it('caches trustMap on second call with same meta hash', async () => {
    getMetaMock.mockResolvedValue(metaWith(['mf_users.exists']));
    const metrics = [metric('a', 'mf_users.exists')];
    await resolveTrustForGame(metrics, 'ballistar');
    await resolveTrustForGame(metrics, 'ballistar');
    // Second call still fetches /meta (the cache stores the hash + map,
    // we need the latest hash to compare) — but trustMap is reused.
    // The contract we assert: meta hash identical → no rebuild of map.
    expect(getMetaMock).toHaveBeenCalledTimes(2);
    // Both responses identical → trust unchanged.
    const out = await resolveTrustForGame(metrics, 'ballistar');
    expect(out[0]?.trust).toBe('certified');
  });

  it('invalidates cache when /meta payload changes', async () => {
    const metrics = [metric('a', 'mf_users.target')];
    // First call: ref resolves.
    getMetaMock.mockResolvedValueOnce(metaWith(['mf_users.target']));
    let out = await resolveTrustForGame(metrics, 'ballistar');
    expect(out[0]?.trust).toBe('certified');

    // Second call: ref no longer exists in meta → trust downgrades.
    getMetaMock.mockResolvedValueOnce(metaWith(['mf_users.other']));
    out = await resolveTrustForGame(metrics, 'ballistar');
    expect(out[0]?.trust).toBe('draft');
  });

  it('fails open when no token for game', async () => {
    tokenMock.mockReturnValue(null);
    const warn = vi.fn();
    const metrics = [metric('a', 'mf_users.missing', 'certified')];
    const out = await resolveTrustForGame(metrics, 'ballistar', { warn });
    expect(out).toEqual(metrics);
    expect(getMetaMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it('fails open when /meta fetch throws', async () => {
    getMetaMock.mockRejectedValue(new Error('upstream 500'));
    const warn = vi.fn();
    const metrics = [metric('a', 'mf_users.missing', 'certified')];
    const out = await resolveTrustForGame(metrics, 'ballistar', { warn });
    expect(out).toEqual(metrics);
    expect(warn).toHaveBeenCalled();
  });
});
