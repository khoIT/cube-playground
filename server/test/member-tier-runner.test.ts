import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the Cube loader so computeMemberTiers is exercised without a live cluster.
vi.mock('../src/services/load-with-continue-wait.js', () => ({
  loadWithContinueWait: vi.fn(),
}));

import { loadWithContinueWait } from '../src/services/load-with-continue-wait.js';
import { computeMemberTiers, TIER_SIZE } from '../src/services/member-tier-runner.js';

const mockLoad = vi.mocked(loadWithContinueWait);

const IDENTITY = 'mf_users.user_id';
const LTV = 'mf_users.ltv_total_vnd';

interface SentQuery {
  dimensions: string[];
  measures: string[];
  filters?: unknown[];
  order: Record<string, 'asc' | 'desc'>;
  limit: number;
  offset?: number;
}

/** Build a Cube /load payload of `n` member rows keyed by the given member names. */
function rows(n: number, opts: { dimKey?: string; measureKey?: string; uidPrefix?: string; ltvStart?: number } = {}) {
  const { dimKey = IDENTITY, measureKey = LTV, uidPrefix = 'u', ltvStart = 1000 } = opts;
  return {
    data: Array.from({ length: n }, (_, i) => ({
      [dimKey]: `${uidPrefix}${i}`,
      [measureKey]: ltvStart - i,
    })),
  };
}

function baseArgs(totalCount: number) {
  return {
    identityDim: IDENTITY,
    ltvMeasure: LTV,
    segmentFilters: [{ member: 'mf_users.os_platform', operator: 'equals', values: ['ios'] }],
    totalCount,
    prefix: null,
  };
}

describe('computeMemberTiers', () => {
  beforeEach(() => {
    mockLoad.mockReset();
  });

  it('runs 3 ordered queries and returns top/middle/bottom for a large cohort', async () => {
    mockLoad.mockImplementation(async (q: unknown) => {
      const query = q as SentQuery;
      // Distinguish the three windows by direction + offset.
      if (query.order[LTV] === 'asc') return rows(TIER_SIZE, { uidPrefix: 'bot', ltvStart: 0 });
      if (query.offset) return rows(TIER_SIZE, { uidPrefix: 'mid', ltvStart: 500 });
      return rows(TIER_SIZE, { uidPrefix: 'top', ltvStart: 99_999 });
    });

    const result = await computeMemberTiers(baseArgs(10_000));
    expect(result).not.toBeNull();
    expect(result!.ltv_measure).toBe(LTV);
    expect(result!.tiers.top).toHaveLength(TIER_SIZE);
    expect(result!.tiers.middle).toHaveLength(TIER_SIZE);
    expect(result!.tiers.bottom).toHaveLength(TIER_SIZE);
    expect(result!.tiers.all).toBeUndefined();
    expect(result!.tiers.top![0]).toEqual({ uid: 'top0', ltv: 99_999 });

    // Query contract: 3 loads, predicate filters carried, deterministic
    // secondary order on the identity dim, middle window centred on the median.
    expect(mockLoad).toHaveBeenCalledTimes(3);
    const sent = mockLoad.mock.calls.map((c) => c[0] as SentQuery);
    for (const q of sent) {
      expect(q.dimensions).toEqual([IDENTITY]);
      expect(q.measures).toEqual([LTV]);
      expect(q.filters).toHaveLength(1);
      expect(q.order[IDENTITY]).toBe('asc');
      expect(q.limit).toBe(TIER_SIZE);
    }
    const middle = sent.find((q) => q.offset);
    expect(middle?.offset).toBe(Math.floor(10_000 / 2) - Math.floor(TIER_SIZE / 2));
    expect(middle?.order[LTV]).toBe('desc');
  });

  it('returns a single "all" tier for degenerate cohorts (≤150)', async () => {
    mockLoad.mockResolvedValue(rows(80) as never);
    const result = await computeMemberTiers(baseArgs(80));
    expect(mockLoad).toHaveBeenCalledTimes(1);
    const sent = mockLoad.mock.calls[0][0] as SentQuery;
    expect(sent.limit).toBe(80);
    expect(sent.offset).toBeUndefined();
    expect(result!.tiers.all).toHaveLength(80);
    expect(result!.tiers.top).toBeUndefined();
  });

  it('dedupes boundary-tie overlaps with priority top > bottom > middle', async () => {
    mockLoad.mockImplementation(async (q: unknown) => {
      const query = q as SentQuery;
      if (query.order[LTV] === 'asc') {
        // bottom shares "dup-tb" with top and "dup-bm" with middle
        return { data: [
          { [IDENTITY]: 'dup-tb', [LTV]: 5 },
          { [IDENTITY]: 'dup-bm', [LTV]: 6 },
          { [IDENTITY]: 'b1', [LTV]: 7 },
        ] };
      }
      if (query.offset) {
        return { data: [
          { [IDENTITY]: 'dup-bm', [LTV]: 6 },
          { [IDENTITY]: 'm1', [LTV]: 50 },
        ] };
      }
      return { data: [
        { [IDENTITY]: 'dup-tb', [LTV]: 5 },
        { [IDENTITY]: 't1', [LTV]: 900 },
      ] };
    });

    const result = await computeMemberTiers(baseArgs(200));
    expect(result!.tiers.top!.map((m) => m.uid)).toEqual(['dup-tb', 't1']);
    expect(result!.tiers.bottom!.map((m) => m.uid)).toEqual(['dup-bm', 'b1']); // dup-tb dropped
    expect(result!.tiers.middle!.map((m) => m.uid)).toEqual(['m1']); // dup-bm dropped
  });

  it('returns null on query failure without throwing (refresh must continue)', async () => {
    mockLoad.mockRejectedValue(new Error('Cube down'));
    await expect(computeMemberTiers(baseArgs(10_000))).resolves.toBeNull();
  });

  it('returns null on an all-empty result (transient blips must not be cached)', async () => {
    mockLoad.mockResolvedValue({ data: [] } as never);
    expect(await computeMemberTiers(baseArgs(80))).toBeNull();
    expect(await computeMemberTiers(baseArgs(10_000))).toBeNull();
  });

  it('returns null for an empty cohort without querying Cube', async () => {
    expect(await computeMemberTiers(baseArgs(0))).toBeNull();
    expect(mockLoad).not.toHaveBeenCalled();
  });

  it('physicalizes members on prefix workspaces and extracts by physical keys', async () => {
    const PHYS_ID = 'ballistar_mf_users.user_id';
    const PHYS_LTV = 'ballistar_mf_users.ltv_total_vnd';
    mockLoad.mockImplementation(async (q: unknown) => {
      const query = q as SentQuery;
      // The wire query must be fully physicalized…
      expect(query.dimensions).toEqual([PHYS_ID]);
      expect(query.measures).toEqual([PHYS_LTV]);
      expect(Object.keys(query.order)).toEqual([PHYS_LTV, PHYS_ID]);
      // …and Cube responds with physical row keys.
      return rows(2, { dimKey: PHYS_ID, measureKey: PHYS_LTV });
    });

    const result = await computeMemberTiers({ ...baseArgs(2), prefix: 'ballistar' });
    expect(result!.tiers.all).toEqual([
      { uid: 'u0', ltv: 1000 },
      { uid: 'u1', ltv: 999 },
    ]);
  });

  it('coerces numeric-string LTV cells and nulls unparseable ones', async () => {
    mockLoad.mockResolvedValue({
      data: [
        { [IDENTITY]: 'a', [LTV]: '123.45' },
        { [IDENTITY]: 'b', [LTV]: null },
        { [IDENTITY]: 'c', [LTV]: 'not-a-number' },
      ],
    } as never);
    const result = await computeMemberTiers(baseArgs(3));
    expect(result!.tiers.all).toEqual([
      { uid: 'a', ltv: 123.45 },
      { uid: 'b', ltv: null },
      { uid: 'c', ltv: null },
    ]);
  });
});
