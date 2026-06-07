/**
 * use-segment-ids — shared-rows restructure: `selectSharedSegments` semantics
 * (shared WITH me, not BY me) and the single-fetch guarantee when both the
 * id-set hook and the rows hook subscribe (sidebar render path must not add
 * network requests).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { Segment } from '../../../types/segment-api';
import {
  useSegmentIds,
  useSegmentRows,
  selectSharedSegments,
  filterRowsByGame,
  __resetSegmentIdsCache,
} from '../use-segment-ids';
import { segmentsClient } from '../../../api/segments-client';

vi.mock('../../../api/segments-client', () => ({
  segmentsClient: { list: vi.fn() },
}));

function seg(over: Partial<Segment>): Segment {
  return {
    id: 'id',
    name: 'name',
    type: 'manual',
    owner: 'me-sub',
    status: 'fresh',
    cube: null,
    predicate_tree: null,
    cube_query_json: null,
    sql_preview: null,
    uid_count: 0,
    uid_list: [],
    tags: [],
    refresh_cadence_min: null,
    last_refreshed_at: null,
    broken_reason: null,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    game_id: 'ptg',
    activations: [],
    funnel_json: null,
    visibility: 'personal',
    owner_label: null,
    shared_at: null,
    is_owner: true,
    can_administer: true,
    ...over,
  };
}

describe('selectSharedSegments', () => {
  it("keeps teammates' shared/org rows, drops own + personal rows, respects cap", () => {
    const rows = [
      seg({ id: 'mine-personal' }),
      seg({ id: 'mine-shared', visibility: 'shared' }), // shared BY me → excluded
      seg({ id: 'team-shared', visibility: 'shared', is_owner: false, owner: 'alice' }),
      seg({ id: 'team-org', visibility: 'org', is_owner: false, owner: 'bob' }),
      seg({ id: 'team-personal-leak', visibility: 'personal', is_owner: false }),
      seg({ id: 'team-shared-2', visibility: 'shared', is_owner: false }),
    ];
    expect(selectSharedSegments(rows, 4).map((s) => s.id)).toEqual([
      'team-shared',
      'team-org',
      'team-shared-2',
    ]);
    expect(selectSharedSegments(rows, 2).map((s) => s.id)).toEqual(['team-shared', 'team-org']);
    expect(selectSharedSegments(null, 4)).toEqual([]);
  });

  it('admin capability (can_administer) does NOT eject foreign org rows from the rail', () => {
    // Admin viewer: every org segment carries can_administer: true while
    // is_owner stays false — the rail must keep keying off literal ownership.
    const rows = [
      seg({ id: 'org-foreign', visibility: 'org', is_owner: false, can_administer: true, owner: 'alice' }),
    ];
    expect(selectSharedSegments(rows, 4).map((s) => s.id)).toEqual(['org-foreign']);
  });
});

describe('filterRowsByGame', () => {
  it('keeps only the active game and preserves the null loading sentinel', () => {
    const rows = [
      seg({ id: 'b1', game_id: 'ballistar' }),
      seg({ id: 'c1', game_id: 'cfm_vn' }),
      seg({ id: 'b2', game_id: 'ballistar' }),
    ];
    expect(filterRowsByGame(rows, 'ballistar')?.map((s) => s.id)).toEqual(['b1', 'b2']);
    expect(filterRowsByGame(rows, 'cfm_vn')?.map((s) => s.id)).toEqual(['c1']);
    expect(filterRowsByGame(rows, 'unknown')).toEqual([]);
    // null (still loading) must pass through — consumers treat null as
    // "don't prune yet", and an empty array would flash recents out.
    expect(filterRowsByGame(null, 'ballistar')).toBeNull();
  });

  it('composes with selectSharedSegments — other-game shared rows drop off the rail', () => {
    const rows = [
      seg({ id: 'shared-here', visibility: 'shared', is_owner: false, game_id: 'ballistar' }),
      seg({ id: 'shared-other-game', visibility: 'shared', is_owner: false, game_id: 'cfm_vn' }),
    ];
    expect(
      selectSharedSegments(filterRowsByGame(rows, 'ballistar'), 4).map((s) => s.id),
    ).toEqual(['shared-here']);
  });
});

describe('shared fetch cache', () => {
  beforeEach(() => {
    __resetSegmentIdsCache();
    vi.mocked(segmentsClient.list).mockReset();
  });

  it('useSegmentIds and useSegmentRows share ONE list fetch', async () => {
    vi.mocked(segmentsClient.list).mockResolvedValue([
      seg({ id: 'a' }),
      seg({ id: 'b', visibility: 'shared', is_owner: false }),
    ]);

    const idsHook = renderHook(() => useSegmentIds());
    const rowsHook = renderHook(() => useSegmentRows());

    await waitFor(() => expect(idsHook.result.current.loading).toBe(false));
    await waitFor(() => expect(rowsHook.result.current.loading).toBe(false));

    expect(segmentsClient.list).toHaveBeenCalledTimes(1);
    expect(idsHook.result.current.ids).toEqual(new Set(['a', 'b']));
    expect(rowsHook.result.current.rows?.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('falls back to empty list when the fetch fails', async () => {
    vi.mocked(segmentsClient.list).mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useSegmentRows());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows).toEqual([]);
  });
});
