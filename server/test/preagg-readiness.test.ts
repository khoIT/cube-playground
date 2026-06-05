/**
 * Unit tests for the pre-aggregation readiness probe service.
 *
 * Tests:
 *   - classifyProbe: correct status for each message shape
 *   - non-game_id workspace short-circuit (no /load calls issued)
 *   - bounded concurrency (≤2 in-flight probes)
 *   - cache hit on second call within TTL (zero new /load calls)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock cube-client BEFORE importing the service under test so the module
// resolver picks up the mock on first import.
vi.mock('../src/services/cube-client.js', () => ({
  loadWithCtx: vi.fn(),
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

import { loadWithCtx } from '../src/services/cube-client.js';
import {
  isPartitionNotBuiltError,
  PARTITION_NOT_BUILT_SUBSTRING,
  computePreaggReadiness,
  PREAGG_REGISTRY,
  __resetPreaggCache,
} from '../src/services/preagg-readiness.js';
import type { WorkspaceDef } from '../src/services/workspaces-config-loader.js';

const mockLoad = loadWithCtx as ReturnType<typeof vi.fn>;

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

// ---------------------------------------------------------------------------
// partition-error predicate
// ---------------------------------------------------------------------------

describe('isPartitionNotBuiltError', () => {
  it('returns true for the exact Cube partition message', () => {
    expect(
      isPartitionNotBuiltError(
        `Error: ${PARTITION_NOT_BUILT_SUBSTRING} for active_daily`,
      ),
    ).toBe(true);
  });

  it('returns true when the substring appears anywhere in the message', () => {
    expect(
      isPartitionNotBuiltError(
        `Cube /load → 200: {"error":"${PARTITION_NOT_BUILT_SUBSTRING}"}`,
      ),
    ).toBe(true);
  });

  it('returns false for a generic Cube error (auth, timeout, etc.)', () => {
    expect(isPartitionNotBuiltError('Cube /load → 401: Authorization header missing')).toBe(false);
    expect(isPartitionNotBuiltError('Cube request timed out after 15s')).toBe(false);
    expect(isPartitionNotBuiltError('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// non-game_id short-circuit
// ---------------------------------------------------------------------------

describe('computePreaggReadiness — prefix workspace short-circuit', () => {
  beforeEach(() => {
    __resetPreaggCache();
    mockLoad.mockReset();
  });

  it('returns empty games + note without calling loadWithCtx', async () => {
    const result = await computePreaggReadiness(prefixWorkspace);
    expect(result.games).toHaveLength(0);
    expect(result.note).toMatch(/n\/a/i);
    expect(mockLoad).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// happy path — game_id workspace
// ---------------------------------------------------------------------------

describe('computePreaggReadiness — game_id workspace', () => {
  beforeEach(() => {
    __resetPreaggCache();
    mockLoad.mockReset();
  });

  it('returns one entry per (game × registry cube)', async () => {
    mockLoad.mockResolvedValue({ data: [] });
    const result = await computePreaggReadiness(gameIdWorkspace);
    // 2 games × 5 cubes = 10 entries total.
    const total = result.games.reduce((s, g) => s + g.cubes.length, 0);
    expect(total).toBe(2 * PREAGG_REGISTRY.length);
  });

  it('classifies a successful /load response as built', async () => {
    mockLoad.mockResolvedValue({ data: [] });
    const result = await computePreaggReadiness(gameIdWorkspace);
    for (const g of result.games) {
      expect(g.built).toBe(PREAGG_REGISTRY.length);
      expect(g.unbuilt).toBe(0);
      expect(g.errored).toBe(0);
    }
  });

  it('classifies the partition-not-built error as unbuilt', async () => {
    mockLoad.mockRejectedValue(
      new Error(`Cube /load → 200: ${PARTITION_NOT_BUILT_SUBSTRING}`),
    );
    const result = await computePreaggReadiness(gameIdWorkspace);
    for (const g of result.games) {
      expect(g.unbuilt).toBe(PREAGG_REGISTRY.length);
      expect(g.built).toBe(0);
      expect(g.errored).toBe(0);
    }
  });

  it('classifies an auth / timeout error as error (not unbuilt)', async () => {
    mockLoad.mockRejectedValue(new Error('Cube /load → 401: Authorization header missing'));
    const result = await computePreaggReadiness(gameIdWorkspace);
    for (const g of result.games) {
      expect(g.errored).toBe(PREAGG_REGISTRY.length);
      expect(g.built).toBe(0);
      expect(g.unbuilt).toBe(0);
    }
  });

  it('never throws when every probe rejects (fail-open)', async () => {
    mockLoad.mockRejectedValue(new Error('total failure'));
    await expect(computePreaggReadiness(gameIdWorkspace)).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// bounded concurrency (≤2 in-flight)
// ---------------------------------------------------------------------------

describe('computePreaggReadiness — concurrency bound', () => {
  beforeEach(() => {
    __resetPreaggCache();
    mockLoad.mockReset();
  });

  it('never exceeds 2 simultaneous in-flight probes', async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    mockLoad.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      // Yield to event loop so other tasks can start before this one resolves.
      await new Promise<void>((resolve) => setImmediate(resolve));
      inFlight -= 1;
      return { data: [] };
    });

    await computePreaggReadiness(gameIdWorkspace);
    // With 2 games × 5 cubes = 10 tasks and concurrency cap 2, max in-flight
    // must never exceed 2.
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// TTL cache — second call within 60s must issue zero new /load calls
// ---------------------------------------------------------------------------

describe('computePreaggReadiness — TTL cache', () => {
  beforeEach(() => {
    __resetPreaggCache();
    mockLoad.mockReset();
  });

  it('returns cached result and issues no new /load calls on second call within TTL', async () => {
    mockLoad.mockResolvedValue({ data: [] });

    const first = await computePreaggReadiness(gameIdWorkspace);
    const callsAfterFirst = mockLoad.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    // Second call — cache should be warm, no new probes.
    const second = await computePreaggReadiness(gameIdWorkspace);
    expect(mockLoad.mock.calls.length).toBe(callsAfterFirst);

    // Both calls return the same generatedAt timestamp (same object from cache).
    expect(second.generatedAt).toBe(first.generatedAt);
  });
});
