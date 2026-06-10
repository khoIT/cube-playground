/**
 * Sweep in-flight status — verifies getSweepInFlight reports a live sweep's
 * source + startedAt while executeSweep is mid-run, and clears to null once it
 * settles (and on failure). Backs the queue page's reconnect banner, which polls
 * /api/care/cases/sweep/status to re-attach to a sweep after navigating away.
 *
 * The executor's heavy collaborators (scope, members, cohort sweep, profile
 * enrich, run record) are mocked so the test can hold a sweep open on a gate and
 * inspect the in-process mutex deterministically.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Gate the inner sweep so we can observe the in-flight state mid-run.
let release: () => void;
let gate: Promise<void>;

vi.mock('../src/care/game-scope.js', () => ({
  resolveGameScope: () => ({ ok: true, gamePrefix: '', gameId: 'jus_vn' }),
}));
vi.mock('../src/care/availability.js', () => ({
  getGameMembers: vi.fn(async () => new Set<string>()),
}));
vi.mock('../src/care/calibrate.js', () => ({
  loadCalibration: () => ({}),
}));
vi.mock('../src/care/care-case-sweep.js', () => ({
  makeCubeCohortFetcher: () => async () => [],
  // Drive the progress sink the way the real driver does (init → start → settle),
  // then block on the gate so the sweep — and its mid-flight progress — stays
  // observable until the test releases it.
  runCaseSweep: vi.fn(async (_g, _w, _m, _d, _c, _only, progress?: { init: (p: unknown[]) => void; start: (id: string) => void; settle: (s: unknown) => void }) => {
    progress?.init([{ playbookId: '02', label: 'VIP tier change' }]);
    progress?.start('02');
    await gate;
    progress?.settle({ playbookId: '02', cohortSize: 2, opened: 2, lapsed: 0, alreadyOpen: 0 });
    return [];
  }),
}));
vi.mock('../src/care/care-case-store.js', () => ({ listCases: () => [] }));
vi.mock('../src/care/care-vip-profile-fetch.js', () => ({ makeCubeProfileFetcher: () => async () => [] }));
vi.mock('../src/care/care-vip-profile-store.js', () => ({ upsertVipProfiles: vi.fn() }));
vi.mock('../src/care/care-sweep-run-store.js', () => ({
  recordSweep: vi.fn(() => 'run-1'),
  recordFailedSweep: vi.fn(() => 'run-err'),
  deriveRunStatus: () => 'ok',
}));

import { executeSweep, getSweepInFlight, isSweepInFlight } from '../src/care/care-sweep-execute.js';
import { runCaseSweep } from '../src/care/care-case-sweep.js';

const WORKSPACE = { id: 'local' } as never;
const CTX = {} as never;

beforeEach(() => {
  gate = new Promise<void>((res) => {
    release = res;
  });
});

describe('sweep in-flight status', () => {
  it('reports source + startedAt while running, then clears on completion', async () => {
    expect(getSweepInFlight('local', 'jus_vn')).toBeNull();

    const done = executeSweep(WORKSPACE, 'jus_vn', CTX, 'manual');

    // Let the executor advance to the gated runCaseSweep call.
    await vi.waitFor(() => expect(runCaseSweep).toHaveBeenCalled());

    const active = getSweepInFlight('local', 'jus_vn');
    expect(active).not.toBeNull();
    expect(active?.source).toBe('manual');
    expect(typeof active?.startedAt).toBe('string');
    expect(Number.isNaN(Date.parse(active!.startedAt))).toBe(false);
    expect(isSweepInFlight('local', 'jus_vn')).toBe(true);

    // Mid-flight progress: the running playbook is seeded + flipped to 'running'.
    expect(active?.progress).toEqual([
      { playbookId: '02', label: 'VIP tier change', state: 'running' },
    ]);

    // A different game is unaffected.
    expect(getSweepInFlight('local', 'other')).toBeNull();

    release();
    await done;
    expect(getSweepInFlight('local', 'jus_vn')).toBeNull();
    expect(isSweepInFlight('local', 'jus_vn')).toBe(false);
  });

  it('clears in-flight state when the sweep throws', async () => {
    (runCaseSweep as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      throw new Error('cube unreachable');
    });

    await expect(executeSweep(WORKSPACE, 'jus_vn', CTX, 'cron')).rejects.toThrow('cube unreachable');
    expect(getSweepInFlight('local', 'jus_vn')).toBeNull();
  });
});
