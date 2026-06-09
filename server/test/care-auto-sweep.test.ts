/**
 * Auto-sweep cron orchestration — verifies (with the live-Cube deps mocked):
 *  - only eligible, not-in-flight games are swept, with source 'cron'
 *  - one game's failure does NOT abort the others (fail-soft per game)
 *  - in-flight games (a manual sweep running) are skipped
 *  - ineligible games (no available membership playbook) are skipped
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/services/workspaces-config-loader.js', () => ({
  getDefaultWorkspace: () => ({ id: 'local', cubeApiUrl: 'http://x', gameModel: 'game_id' }),
}));
vi.mock('../src/services/resolve-cube-token.js', () => ({
  resolveCubeTokenForWorkspace: () => ({ token: 't' }),
}));
vi.mock('../src/services/games-config-loader.js', () => ({
  loadGamesConfig: () => ({
    defaultGameId: 'alpha',
    games: [{ id: 'alpha' }, { id: 'bravo' }, { id: 'charlie' }, { id: 'delta' }],
  }),
}));
vi.mock('../src/care/game-scope.js', () => ({
  resolveGameScope: () => ({ ok: true, gamePrefix: null }),
}));
vi.mock('../src/care/availability.js', () => ({
  getGameMembers: async () => new Set<string>(),
}));
// charlie is ineligible (no available membership playbook); the rest are eligible.
vi.mock('../src/care/playbook-merge.js', () => ({
  mergePlaybooks: (game: string) =>
    game === 'charlie'
      ? []
      : [{ id: '01', enabled: true, availability: 'available', evalMode: 'membership', predicate: { kind: 'group' } }],
}));

const { executeSweep, isSweepInFlight, FakeSweepBusyError } = vi.hoisted(() => {
  class FakeSweepBusyError extends Error {}
  return { executeSweep: vi.fn(), isSweepInFlight: vi.fn(), FakeSweepBusyError };
});
vi.mock('../src/care/care-sweep-execute.js', () => ({
  executeSweep,
  isSweepInFlight,
  SweepBusyError: FakeSweepBusyError,
}));

import { careAutoSweepTick } from '../src/jobs/care-auto-sweep.js';

describe('careAutoSweepTick', () => {
  beforeEach(() => {
    executeSweep.mockReset();
    isSweepInFlight.mockReset();
    // delta is being swept manually → skipped via the in-flight mutex.
    isSweepInFlight.mockImplementation((_ws: string, game: string) => game === 'delta');
    // alpha succeeds; bravo throws (fail-soft); charlie ineligible (never reached).
    executeSweep.mockImplementation(async (_ws: unknown, game: string) => {
      if (game === 'bravo') throw new Error('Trino down');
      return { opened: 2, lapsed: 0, profilesRefreshed: 2, status: 'ok', runId: 'r', summaries: [] };
    });
  });

  it('sweeps eligible+free games as cron, skips in-flight + ineligible, survives one failure', async () => {
    const r = await careAutoSweepTick();

    expect(r.swept).toBe(1); // alpha
    expect(r.failed).toBe(1); // bravo threw, loop continued
    expect(r.skipped).toBe(2); // charlie ineligible + delta in-flight

    // executeSweep called only for the eligible, free games (alpha, bravo), with 'cron'.
    const sweptGames = executeSweep.mock.calls.map((c) => c[1]).sort();
    expect(sweptGames).toEqual(['alpha', 'bravo']);
    for (const call of executeSweep.mock.calls) expect(call[3]).toBe('cron');
    // delta never reaches executeSweep (in-flight short-circuits before it).
    expect(sweptGames).not.toContain('delta');
  });
});
