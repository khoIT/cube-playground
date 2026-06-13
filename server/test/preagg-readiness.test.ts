/**
 * Unit tests for the pre-aggregation readiness probe service.
 *
 * The probe classifies each (game, cube) by where a /sql DRY-RUN routes the
 * query, cross-checked against CubeStore materialisation. It does NOT read
 * `usedPreAggregations` — that field is masked to empty by the lambda unions in
 * this model, so it can never signal "built" here (see service header).
 *
 * Tests:
 *   - isPartitionNotBuiltError predicate
 *   - non-game_id workspace short-circuit (no /sql calls issued)
 *   - classification: built (routed + materialised), built (routed, introspect
 *     off), from-source (routed to raw source), unbuilt (routed but not active),
 *     error (auth/timeout)
 *   - bounded concurrency (≤2 in-flight)
 *   - TTL cache (second call issues zero new /sql calls)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock cube-client BEFORE importing the service so the resolver picks the mock.
vi.mock('../src/services/cube-client.js', () => ({
  sqlWithCtx: vi.fn(),
}));

// Mock CubeStore introspection — the probe verifies materialisation through it.
vi.mock('../src/services/cubestore-introspect.js', () => ({
  isCubestoreIntrospectEnabled: vi.fn(() => true),
  findPreaggByTableName: vi.fn(),
}));

// Mock resolve-cube-token so tests never need a real JWT secret.
vi.mock('../src/services/resolve-cube-token.js', () => ({
  resolveCubeTokenForWorkspace: vi.fn(() => ({ token: 'test-token' })),
}));

// Mock games config to a deterministic small set.
vi.mock('../src/services/games-config-loader.js', () => ({
  loadGamesConfig: vi.fn(() => ({
    defaultGameId: 'ballistar',
    games: [
      { id: 'ballistar', name: 'Ballistar' },
      { id: 'muaw', name: 'Muaw' },
    ],
  })),
}));

// Force the static PREAGG_REGISTRY fallback so per-game cube counts are
// deterministic. Without this the probe reads each game's REAL model from
// cube-dev (ballistar=8 cubes, muaw=7), which makes count assertions depend on
// the vendored model rather than the classification logic under test.
vi.mock('../src/services/preagg-model-registry.js', () => ({
  getModelPreaggRegistry: vi.fn(() => undefined),
}));

import { sqlWithCtx } from '../src/services/cube-client.js';
import {
  isCubestoreIntrospectEnabled,
  findPreaggByTableName,
} from '../src/services/cubestore-introspect.js';
import {
  isPartitionNotBuiltError,
  PARTITION_NOT_BUILT_SUBSTRING,
  computePreaggReadiness,
  PREAGG_REGISTRY,
  __resetPreaggCache,
} from '../src/services/preagg-readiness.js';
import type { WorkspaceDef } from '../src/services/workspaces-config-loader.js';

const mockSql = sqlWithCtx as ReturnType<typeof vi.fn>;
const mockEnabled = isCubestoreIntrospectEnabled as ReturnType<typeof vi.fn>;
const mockFind = findPreaggByTableName as ReturnType<typeof vi.fn>;

// A /sql dry-run body that routes to a rollup (the shape extractPlannedPreaggs
// parses). The tableName carries a schema so findPreaggByTableName is exercised.
const ROUTED = {
  sql: {
    preAggregations: [
      {
        preAggregationId: 'active_daily.dau_by_country_payer_daily_batch',
        tableName: 'preagg_x.active_daily_dau_by_country_payer_daily_batch',
      },
    ],
  },
};
// A /sql dry-run body that reads the raw source — no rollup matched.
const SOURCE_ONLY = { sql: { preAggregations: [] } };

// Representative workspace definitions for branching tests.
const gameIdWorkspace: WorkspaceDef = {
  id: 'local',
  label: 'Local dev',
  cubeApiUrl: 'http://localhost:4000',
  authMode: 'minted',
  gameModel: 'game_id',
};

const prefixWorkspace: WorkspaceDef = {
  id: 'prod',
  label: 'Production',
  cubeApiUrl: 'http://cube-prod:4000',
  authMode: 'env-token',
  gameModel: 'prefix',
  gamePrefixMap: { ballistar: 'bs' },
};

beforeEach(() => {
  __resetPreaggCache();
  mockSql.mockReset();
  mockFind.mockReset();
  mockEnabled.mockReset();
  mockEnabled.mockReturnValue(true);
});

// ---------------------------------------------------------------------------
// partition-error predicate
// ---------------------------------------------------------------------------

describe('isPartitionNotBuiltError', () => {
  it('returns true for the exact Cube partition message', () => {
    expect(
      isPartitionNotBuiltError(`Error: ${PARTITION_NOT_BUILT_SUBSTRING} for active_daily`),
    ).toBe(true);
  });

  it('returns true when the substring appears anywhere in the message', () => {
    expect(
      isPartitionNotBuiltError(`Cube /load → 200: {"error":"${PARTITION_NOT_BUILT_SUBSTRING}"}`),
    ).toBe(true);
  });

  it('returns false for a generic Cube error (auth, timeout, etc.)', () => {
    expect(isPartitionNotBuiltError('Cube /sql → 401: Authorization header missing')).toBe(false);
    expect(isPartitionNotBuiltError('Cube request timed out after 15s')).toBe(false);
    expect(isPartitionNotBuiltError('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// non-game_id short-circuit
// ---------------------------------------------------------------------------

describe('computePreaggReadiness — prefix workspace short-circuit', () => {
  it('returns empty games + note without calling sqlWithCtx', async () => {
    const result = await computePreaggReadiness(prefixWorkspace);
    expect(result.games).toHaveLength(0);
    expect(result.note).toMatch(/n\/a/i);
    expect(mockSql).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// classification — game_id workspace
// ---------------------------------------------------------------------------

describe('computePreaggReadiness — game_id workspace', () => {
  it('returns one entry per (game × registry cube)', async () => {
    mockSql.mockResolvedValue(SOURCE_ONLY);
    const result = await computePreaggReadiness(gameIdWorkspace);
    const total = result.games.reduce((s, g) => s + g.cubes.length, 0);
    expect(total).toBe(2 * PREAGG_REGISTRY.length);
  });

  it('classifies a routed query with active CubeStore partitions as built', async () => {
    mockSql.mockResolvedValue(ROUTED);
    mockFind.mockResolvedValue({ activePartitions: 3, readyCount: 3 });
    const result = await computePreaggReadiness(gameIdWorkspace);
    for (const g of result.games) {
      expect(g.built).toBe(PREAGG_REGISTRY.length);
      expect(g.fromSource).toBe(0);
      expect(g.unbuilt).toBe(0);
      expect(g.errored).toBe(0);
    }
  });

  it('trusts the routing plan as built when introspection is disabled', async () => {
    mockEnabled.mockReturnValue(false);
    mockSql.mockResolvedValue(ROUTED);
    const result = await computePreaggReadiness(gameIdWorkspace);
    for (const g of result.games) {
      expect(g.built).toBe(PREAGG_REGISTRY.length);
      expect(g.unbuilt).toBe(0);
    }
    // No materialisation check is made in the disabled path.
    expect(mockFind).not.toHaveBeenCalled();
  });

  it('classifies a query that routes to raw source as from-source', async () => {
    mockSql.mockResolvedValue(SOURCE_ONLY);
    const result = await computePreaggReadiness(gameIdWorkspace);
    for (const g of result.games) {
      expect(g.fromSource).toBe(PREAGG_REGISTRY.length);
      expect(g.built).toBe(0);
      expect(g.unbuilt).toBe(0);
      expect(g.errored).toBe(0);
    }
  });

  it('classifies a routed query with no active partitions as unbuilt', async () => {
    // Rollup is planned but CubeStore holds it inactive (or absent) → unbuilt,
    // NOT green. This is the registered-but-dormant trap made legible.
    mockSql.mockResolvedValue(ROUTED);
    mockFind.mockResolvedValue({ activePartitions: 0, readyCount: 0 });
    const result = await computePreaggReadiness(gameIdWorkspace);
    for (const g of result.games) {
      expect(g.unbuilt).toBe(PREAGG_REGISTRY.length);
      expect(g.built).toBe(0);
      expect(g.fromSource).toBe(0);
    }
  });

  it('classifies a routed query whose table is absent from CubeStore as unbuilt', async () => {
    mockSql.mockResolvedValue(ROUTED);
    mockFind.mockResolvedValue(null);
    const result = await computePreaggReadiness(gameIdWorkspace);
    for (const g of result.games) {
      expect(g.unbuilt).toBe(PREAGG_REGISTRY.length);
      expect(g.built).toBe(0);
    }
  });

  it('classifies an auth / timeout error as error (not unbuilt)', async () => {
    mockSql.mockRejectedValue(new Error('Cube /sql → 401: Authorization header missing'));
    const result = await computePreaggReadiness(gameIdWorkspace);
    for (const g of result.games) {
      expect(g.errored).toBe(PREAGG_REGISTRY.length);
      expect(g.built).toBe(0);
      expect(g.fromSource).toBe(0);
      expect(g.unbuilt).toBe(0);
    }
  });

  it('maps the partition-not-built error to unbuilt', async () => {
    mockSql.mockRejectedValue(new Error(`Cube /sql → 200: ${PARTITION_NOT_BUILT_SUBSTRING}`));
    const result = await computePreaggReadiness(gameIdWorkspace);
    for (const g of result.games) {
      expect(g.unbuilt).toBe(PREAGG_REGISTRY.length);
      expect(g.errored).toBe(0);
    }
  });

  it('never throws when every probe rejects (fail-open)', async () => {
    mockSql.mockRejectedValue(new Error('total failure'));
    await expect(computePreaggReadiness(gameIdWorkspace)).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// bounded concurrency (≤2 in-flight)
// ---------------------------------------------------------------------------

describe('computePreaggReadiness — concurrency bound', () => {
  it('never exceeds 2 simultaneous in-flight probes', async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    mockSql.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>((resolve) => setImmediate(resolve));
      inFlight -= 1;
      return SOURCE_ONLY;
    });

    await computePreaggReadiness(gameIdWorkspace);
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// TTL cache — second call within 60s must issue zero new /sql calls
// ---------------------------------------------------------------------------

describe('computePreaggReadiness — TTL cache', () => {
  it('returns cached result and issues no new /sql calls on second call within TTL', async () => {
    mockSql.mockResolvedValue(SOURCE_ONLY);

    const first = await computePreaggReadiness(gameIdWorkspace);
    const callsAfterFirst = mockSql.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    const second = await computePreaggReadiness(gameIdWorkspace);
    expect(mockSql.mock.calls.length).toBe(callsAfterFirst);
    expect(second.generatedAt).toBe(first.generatedAt);
  });
});
