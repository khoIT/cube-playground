/**
 * resolveMemberNamesLive — maps uid→name from a targeted identity-IN profile
 * query, and is fail-soft: no name column / null compute / throw all yield an
 * empty map, and a per-segment cooldown blocks retries after a failure. The Cube
 * primitives are mocked; only the service's mapping + guard logic is under test.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { MemberProfiles } from '../src/types/segment.js';

const computeMock = vi.fn();
vi.mock('../src/services/member-profile-runner.js', () => ({
  MEMBER_PROFILE_LIMIT: 1000,
  computeMemberProfiles: (...a: unknown[]) => computeMock(...a),
}));
vi.mock('../src/services/resolve-identity-field.js', () => ({
  resolveIdentityField: vi.fn(async () => 'mf_users.uid'),
}));
vi.mock('../src/services/resolve-game-prefix.js', () => ({
  resolveGamePrefixForWorkspace: () => null,
}));
vi.mock('../src/services/resolve-cube-token.js', () => ({
  resolveCubeTokenForGame: () => 'tok',
}));
vi.mock('../src/services/cube-meta-members.js', () => ({
  getMetaMemberSets: vi.fn(async () => null),
}));
vi.mock('../src/services/cube-member-resolver.js', () => ({
  logicalCube: (c: string) => c,
}));

const presetMock = vi.fn();
vi.mock('../src/presets/registry.js', () => ({
  pickPresetForSegment: (...a: unknown[]) => presetMock(...a),
}));

import { resolveMemberNamesLive, __resetLiveNameState, MAX_LIVE_NAME_UIDS } from '../src/services/resolve-member-names-live.js';

const ROW = { id: 's1', cube: 'mf_users', game_id: 'jus_vn', workspace: 'default' };
const NAME_PRESET = { memberColumns: [{ id: 'name', label: 'In-game name', dimension: 'mf_users.ingame_name' }] };

function profiles(rows: Array<Record<string, unknown> & { uid: string }>): MemberProfiles {
  return {
    computed_at: '2026-06-14T00:00:00.000Z',
    rank_measure: null,
    columns: [{ key: 'name', label: 'In-game name', field: 'mf_users.ingame_name' }],
    rows,
  };
}

beforeEach(() => {
  __resetLiveNameState();
  computeMock.mockReset();
  presetMock.mockReset();
  presetMock.mockReturnValue(NAME_PRESET);
});

describe('resolveMemberNamesLive', () => {
  it('maps uid → name for rows the query returned', async () => {
    computeMock.mockResolvedValue(profiles([
      { uid: '111', name: 'Tô Phi' },
      { uid: '222', name: 'OmManiPadMeHum' },
    ]));
    const out = await resolveMemberNamesLive(ROW, ['111', '222', '333']);
    expect(out.get('111')).toBe('Tô Phi');
    expect(out.get('222')).toBe('OmManiPadMeHum');
    expect(out.has('333')).toBe(false); // not returned → absent (caller keeps uid)
  });

  it('drops null/empty names', async () => {
    computeMock.mockResolvedValue(profiles([
      { uid: '111', name: null },
      { uid: '222', name: '   ' },
      { uid: '333', name: 'Real' },
    ]));
    const out = await resolveMemberNamesLive(ROW, ['111', '222', '333']);
    expect(out.size).toBe(1);
    expect(out.get('333')).toBe('Real');
  });

  it('returns empty (no Cube call) when the preset exposes no name column', async () => {
    presetMock.mockReturnValue({ memberColumns: [{ id: 'ltv', measure: 'mf_users.ltv_total_vnd' }] });
    const out = await resolveMemberNamesLive(ROW, ['111']);
    expect(out.size).toBe(0);
    expect(computeMock).not.toHaveBeenCalled();
  });

  it('returns empty with no uids or no cube', async () => {
    expect((await resolveMemberNamesLive(ROW, [])).size).toBe(0);
    expect((await resolveMemberNamesLive({ ...ROW, cube: null }, ['111'])).size).toBe(0);
    expect(computeMock).not.toHaveBeenCalled();
  });

  it('returns empty on compute null and then cools down (no second Cube call)', async () => {
    computeMock.mockResolvedValue(null);
    expect((await resolveMemberNamesLive(ROW, ['111'])).size).toBe(0);
    expect(computeMock).toHaveBeenCalledTimes(1);
    // Within the cooldown the second call short-circuits before hitting Cube.
    expect((await resolveMemberNamesLive(ROW, ['111'])).size).toBe(0);
    expect(computeMock).toHaveBeenCalledTimes(1);
  });

  it('returns empty on throw (never rejects)', async () => {
    computeMock.mockRejectedValue(new Error('cube down'));
    const out = await resolveMemberNamesLive(ROW, ['111']);
    expect(out.size).toBe(0);
  });

  it('caps the resolved uid set to MAX_LIVE_NAME_UIDS', async () => {
    computeMock.mockResolvedValue(profiles([]));
    const many = Array.from({ length: MAX_LIVE_NAME_UIDS + 10 }, (_, i) => String(i));
    await resolveMemberNamesLive(ROW, many);
    const filter = (computeMock.mock.calls[0][0] as { segmentFilters: Array<{ values: string[] }> }).segmentFilters[0];
    expect(filter.values.length).toBe(MAX_LIVE_NAME_UIDS);
  });
});
