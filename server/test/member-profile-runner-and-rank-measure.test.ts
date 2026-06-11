/**
 * Unit tests for the ranked member-profile snapshot (member-profile-runner)
 * and the segment rank-measure picker (segment-rank-measure): defining-metric
 * detection from predicate filters, meta-validated column dropping, ranked
 * query shape, and the never-break-a-refresh failure posture.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the Cube loader so the runner is exercised without a live cluster.
vi.mock('../src/services/load-with-continue-wait.js', () => ({
  loadWithContinueWait: vi.fn(),
}));

import { loadWithContinueWait } from '../src/services/load-with-continue-wait.js';
import { computeMemberProfiles, MEMBER_PROFILE_LIMIT } from '../src/services/member-profile-runner.js';
import { pickSegmentRankMeasure } from '../src/services/segment-rank-measure.js';
import type { MetaMemberSets } from '../src/services/cube-meta-members.js';

const mockLoad = vi.mocked(loadWithContinueWait);

const IDENTITY = 'mf_users.user_id';
const LTV = 'mf_users.ltv_total_vnd';

const META: MetaMemberSets = {
  measures: new Set([LTV, 'mf_users.recharge_30d_vnd', 'mf_users.active_days_total']),
  dimensions: new Set([
    IDENTITY,
    'mf_users.ingame_name',
    'mf_users.install_date',
    'mf_users.last_active_date',
  ]),
};

const MEMBER_COLUMNS: Array<Record<string, unknown>> = [
  { id: 'name', label: 'In-game name', dimension: 'mf_users.ingame_name' },
  { id: 'ltv', label: 'LTV', measure: LTV, format: 'currency' },
  { id: 'stage', label: 'Stage', dimension: 'mf_users.lifecycle_stage' }, // not in META
  { id: 'last-active', label: 'Last active', dimension: 'mf_users.last_active_date' },
  { id: 'joined', label: 'Joined', dimension: 'mf_users.install_date' },
];

interface SentQuery {
  dimensions: string[];
  measures: string[];
  order: Record<string, 'asc' | 'desc'>;
  limit: number;
  filters?: unknown[];
  segments?: string[];
}

describe('pickSegmentRankMeasure', () => {
  it('picks the first measure-typed filter leaf (the defining metric)', () => {
    const filters = [
      { member: 'mf_users.country', operator: 'equals', values: ['VN'] },
      { and: [{ member: 'mf_users.recharge_30d_vnd', operator: 'gte', values: ['5000000'] }] },
      { member: LTV, operator: 'gte', values: ['1'] },
    ];
    expect(pickSegmentRankMeasure(filters, META, null, LTV)).toBe('mf_users.recharge_30d_vnd');
  });

  it('falls back to the preset LTV measure when filters are dimension-only', () => {
    const filters = [{ member: 'mf_users.country', operator: 'equals', values: ['VN'] }];
    expect(pickSegmentRankMeasure(filters, META, null, LTV)).toBe(LTV);
  });

  it('falls back when meta is unavailable (cannot tell measures apart)', () => {
    const filters = [{ member: 'mf_users.recharge_30d_vnd', operator: 'gte', values: ['1'] }];
    expect(pickSegmentRankMeasure(filters, null, null, LTV)).toBe(LTV);
    expect(pickSegmentRankMeasure(filters, null, null, null)).toBeNull();
  });

  it('matches physical members on prefix workspaces', () => {
    const meta: MetaMemberSets = {
      measures: new Set(['ballistar_mf_users.ltv_total_vnd']),
      dimensions: new Set(),
    };
    // Stored filters on prefix workspaces are already physical.
    const filters = [{ member: 'ballistar_mf_users.ltv_total_vnd', operator: 'gte', values: ['1'] }];
    expect(pickSegmentRankMeasure(filters, meta, 'ballistar', null)).toBe(
      'ballistar_mf_users.ltv_total_vnd',
    );
  });
});

describe('computeMemberProfiles', () => {
  beforeEach(() => {
    mockLoad.mockReset();
  });

  function baseArgs(totalCount = 500) {
    return {
      identityDim: IDENTITY,
      rankMeasure: LTV,
      memberColumns: MEMBER_COLUMNS,
      metaSets: META,
      segmentFilters: [{ member: 'mf_users.country', operator: 'equals', values: ['VN'] }],
      cubeSegments: ['mf_users.whales'],
      totalCount,
      prefix: null,
    };
  }

  it('loads one ranked query with meta-validated columns and maps rows by snake_cased keys', async () => {
    mockLoad.mockResolvedValue({
      data: [
        {
          [IDENTITY]: 'whale1',
          'mf_users.ingame_name': 'Diaochan',
          [LTV]: 9000,
          'mf_users.last_active_date': '2026-06-01',
          'mf_users.install_date': '2024-01-01',
        },
        { [IDENTITY]: 'whale2', [LTV]: 5000 },
      ],
    });

    const result = await computeMemberProfiles(baseArgs());
    expect(result).not.toBeNull();
    expect(mockLoad).toHaveBeenCalledTimes(1);

    const sent = mockLoad.mock.calls[0][0] as SentQuery;
    // 'stage' is not in META → dropped from the query, no 400 risk.
    expect(sent.dimensions).toEqual([
      IDENTITY,
      'mf_users.ingame_name',
      'mf_users.last_active_date',
      'mf_users.install_date',
    ]);
    expect(sent.measures).toEqual([LTV]); // rank measure deduped with the ltv column
    expect(sent.order).toEqual({ [LTV]: 'desc', [IDENTITY]: 'asc' });
    expect(sent.limit).toBe(500);
    expect(sent.segments).toEqual(['mf_users.whales']); // cohort scope carried

    expect(result!.rank_measure).toBe(LTV);
    expect(result!.columns.map((c) => c.key)).toEqual(['name', 'ltv', 'last_active', 'joined']);
    expect(result!.rows[0]).toEqual({
      uid: 'whale1',
      name: 'Diaochan',
      ltv: 9000,
      last_active: '2026-06-01',
      joined: '2024-01-01',
    });
    // Missing cells become null, never undefined (JSON-stable).
    expect(result!.rows[1]).toEqual({
      uid: 'whale2',
      name: null,
      ltv: 5000,
      last_active: null,
      joined: null,
    });
  });

  it('caps the query at the snapshot limit for huge cohorts', async () => {
    mockLoad.mockResolvedValue({ data: [{ [IDENTITY]: 'u1', [LTV]: 1 }] });
    await computeMemberProfiles(baseArgs(2_000_000));
    expect((mockLoad.mock.calls[0][0] as SentQuery).limit).toBe(MEMBER_PROFILE_LIMIT);
  });

  it('orders by identity when there is no rank measure but columns exist', async () => {
    mockLoad.mockResolvedValue({ data: [{ [IDENTITY]: 'u1' }] });
    const result = await computeMemberProfiles({ ...baseArgs(), rankMeasure: null });
    const sent = mockLoad.mock.calls[0][0] as SentQuery;
    expect(sent.order).toEqual({ [IDENTITY]: 'asc' });
    expect(result!.rank_measure).toBeNull();
  });

  it('skips entirely when there is nothing beyond bare uids to load', async () => {
    const result = await computeMemberProfiles({
      ...baseArgs(),
      rankMeasure: null,
      memberColumns: [],
    });
    expect(result).toBeNull();
    expect(mockLoad).not.toHaveBeenCalled();
  });

  it('returns null on load failure and on transient empty results (never cached)', async () => {
    mockLoad.mockRejectedValueOnce(new Error('cube down'));
    expect(await computeMemberProfiles(baseArgs())).toBeNull();

    mockLoad.mockResolvedValueOnce({ data: [] });
    expect(await computeMemberProfiles(baseArgs())).toBeNull();
  });

  it('keeps all columns when meta is unavailable (legacy posture)', async () => {
    mockLoad.mockResolvedValue({ data: [{ [IDENTITY]: 'u1' }] });
    await computeMemberProfiles({ ...baseArgs(), metaSets: null });
    const sent = mockLoad.mock.calls[0][0] as SentQuery;
    expect(sent.dimensions).toContain('mf_users.lifecycle_stage');
  });
});
