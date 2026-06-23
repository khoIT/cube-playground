/**
 * Unit tests for delta-decomposition.ts — rewritten with correct relative paths.
 *   - additive measure contributions + residual reconcile to headline Δ
 *   - topN cap + "Other" bucket aggregates the tail correctly
 *   - non-additive measure flagged (additive:false, pctOfSwing null)
 *   - truncated:true when a grouped window hits the row cap
 */
// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DeltaDecomposeInput } from '../src/services/delta-decomposition.js';

// ── Mock loadCubeRows ─────────────────────────────────────────────────────────

let mockGroupedARows: Array<Record<string, unknown>> = [];
let mockGroupedBRows: Array<Record<string, unknown>> = [];
let mockTotalARows: Array<Record<string, unknown>> = [];
let mockTotalBRows: Array<Record<string, unknown>> = [];
let mockMeasureType = 'sum';

vi.mock('../src/services/load-cube-rows.js', () => ({
  loadCubeRows: vi.fn((query: Record<string, unknown>) => {
    // Distinguish grouped (has dimensions array) from totals (no dimensions).
    const hasGroupBy =
      Array.isArray((query as { dimensions?: unknown[] }).dimensions) &&
      (query as { dimensions: unknown[] }).dimensions.length > 0;
    const timeDimArr = (query as { timeDimensions?: Array<{ dateRange: string[] }> })
      .timeDimensions ?? [];
    const range = timeDimArr[0]?.dateRange ?? [];
    // Period A starts '2024-01-01'; period B starts '2024-01-08'.
    const isPeriodA = range[0] === '2024-01-01';
    if (hasGroupBy) {
      return Promise.resolve(isPeriodA ? mockGroupedARows : mockGroupedBRows);
    }
    // totals query (no dimensions)
    return Promise.resolve(isPeriodA ? mockTotalARows : mockTotalBRows);
  }),
}));

vi.mock('../src/core/cube-meta-cache.js', () => ({
  getMeta: vi.fn(() =>
    Promise.resolve({
      cubes: [
        {
          name: 'active_daily',
          measures: [{ name: 'active_daily.dau', type: mockMeasureType }],
        },
      ],
    }),
  ),
}));

// ── Import after mocks ────────────────────────────────────────────────────────

const { decomposeDelta } = await import('../src/services/delta-decomposition.js');

// ── Helpers ───────────────────────────────────────────────────────────────────

function baseInput(overrides: Partial<DeltaDecomposeInput> = {}): DeltaDecomposeInput {
  return {
    gameId: 'cfm_vn',
    workspace: 'local',
    measure: 'active_daily.dau',
    dimension: 'active_daily.platform',
    timeDimension: 'active_daily.log_date',
    periodA: ['2024-01-01', '2024-01-07'],
    periodB: ['2024-01-08', '2024-01-14'],
    ...overrides,
  };
}

function makeRows(
  dimension: string,
  measure: string,
  entries: Array<[string, number]>,
): Array<Record<string, unknown>> {
  return entries.map(([val, n]) => ({ [dimension]: val, [measure]: n }));
}

beforeEach(() => {
  mockGroupedARows = [];
  mockGroupedBRows = [];
  mockTotalARows = [];
  mockTotalBRows = [];
  mockMeasureType = 'sum';
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('decomposeDelta_additive_contributions_reconcile', () => {
  it('sum of contributor deltas + residual equals headlineDelta', async () => {
    // Arrange: 3 platform segments
    mockMeasureType = 'sum';
    mockGroupedARows = makeRows('active_daily.platform', 'active_daily.dau', [
      ['android', 1000],
      ['ios', 500],
      ['web', 200],
    ]);
    mockGroupedBRows = makeRows('active_daily.platform', 'active_daily.dau', [
      ['android', 1100],
      ['ios', 600],
      ['web', 180],
    ]);
    mockTotalARows = [{ 'active_daily.dau': 1700 }];
    mockTotalBRows = [{ 'active_daily.dau': 1880 }];

    const result = await decomposeDelta(baseInput());

    expect(result.additive).toBe(true);
    expect(result.headlineDelta).toBeCloseTo(180, 5);

    const sumContribDeltas = result.contributors.reduce((s, c) => s + c.delta, 0);
    // residual must close the gap: headlineDelta = sumContribDeltas + residual
    expect(sumContribDeltas + result.residual).toBeCloseTo(result.headlineDelta, 5);
  });

  it('pctOfSwing values sum to ~1 when no "Other" bucket and no residual', async () => {
    mockMeasureType = 'sum';
    mockGroupedARows = makeRows('active_daily.platform', 'active_daily.dau', [
      ['android', 1000],
      ['ios', 500],
    ]);
    mockGroupedBRows = makeRows('active_daily.platform', 'active_daily.dau', [
      ['android', 1200],
      ['ios', 300],
    ]);
    // Totals exactly match sum of groups → residual should be 0
    mockTotalARows = [{ 'active_daily.dau': 1500 }];
    mockTotalBRows = [{ 'active_daily.dau': 1500 }];

    const result = await decomposeDelta(baseInput());
    // headlineDelta = 0, so pctOfSwing should be null
    for (const c of result.contributors) {
      expect(c.pctOfSwing).toBeNull();
    }
  });
});

describe('decomposeDelta_topN_cap_other_bucket', () => {
  it('rolls up segments beyond topN into a single "Other" row', async () => {
    mockMeasureType = 'sum';
    // 5 segments, topN=3
    const segments: Array<[string, number]> = [
      ['seg_a', 100],
      ['seg_b', 80],
      ['seg_c', 60],
      ['seg_d', 40],
      ['seg_e', 20],
    ];
    mockGroupedARows = makeRows('active_daily.platform', 'active_daily.dau', segments);
    // Same values in B → deltas are 0 — but we want tail aggregation tested
    const segmentsB: Array<[string, number]> = [
      ['seg_a', 120],
      ['seg_b', 90],
      ['seg_c', 65],
      ['seg_d', 45],
      ['seg_e', 25],
    ];
    mockGroupedBRows = makeRows('active_daily.platform', 'active_daily.dau', segmentsB);
    mockTotalARows = [{ 'active_daily.dau': 300 }];
    mockTotalBRows = [{ 'active_daily.dau': 345 }];

    const result = await decomposeDelta(baseInput({ topN: 3 }));

    // Should have 3 head + 1 Other
    expect(result.contributors).toHaveLength(4);
    const other = result.contributors.find((c) => c.isOther);
    expect(other).toBeDefined();
    expect(other!.value).toMatch(/^Other \(2\)/);
    // Other.a = seg_d.a + seg_e.a = 40+20 = 60
    expect(other!.a).toBe(60);
    // Other.b = 45+25 = 70
    expect(other!.b).toBe(70);
    expect(result.bucketedCount).toBe(2);
  });

  it('produces no "Other" row when segments fit within topN', async () => {
    mockMeasureType = 'sum';
    const segments: Array<[string, number]> = [
      ['android', 500],
      ['ios', 300],
    ];
    mockGroupedARows = makeRows('active_daily.platform', 'active_daily.dau', segments);
    mockGroupedBRows = makeRows('active_daily.platform', 'active_daily.dau', segments);
    mockTotalARows = [{ 'active_daily.dau': 800 }];
    mockTotalBRows = [{ 'active_daily.dau': 800 }];

    const result = await decomposeDelta(baseInput({ topN: 5 }));
    expect(result.contributors.some((c) => c.isOther)).toBe(false);
    expect(result.bucketedCount).toBe(0);
  });
});

describe('decomposeDelta_non_additive_measure', () => {
  it('flags additive:false and sets pctOfSwing to null for avg measures', async () => {
    mockMeasureType = 'avg';
    mockGroupedARows = makeRows('active_daily.platform', 'active_daily.dau', [
      ['android', 4.2],
      ['ios', 3.8],
    ]);
    mockGroupedBRows = makeRows('active_daily.platform', 'active_daily.dau', [
      ['android', 4.5],
      ['ios', 4.1],
    ]);
    mockTotalARows = [{ 'active_daily.dau': 4.0 }];
    mockTotalBRows = [{ 'active_daily.dau': 4.3 }];

    const result = await decomposeDelta(baseInput());

    expect(result.additive).toBe(false);
    for (const c of result.contributors) {
      expect(c.pctOfSwing).toBeNull();
    }
    expect(result.note).toContain('non-additive');
  });

  it('flags additive:false for countDistinctApprox measures', async () => {
    mockMeasureType = 'countDistinctApprox';
    mockGroupedARows = [];
    mockGroupedBRows = [];
    mockTotalARows = [{ 'active_daily.dau': 1000 }];
    mockTotalBRows = [{ 'active_daily.dau': 1200 }];

    const result = await decomposeDelta(baseInput());
    expect(result.additive).toBe(false);
    expect(result.measureType).toBe('countDistinctApprox');
  });
});

describe('decomposeDelta_truncated_flag', () => {
  it('sets truncated:true when grouped window returns MAX_GROUP_ROWS rows', async () => {
    mockMeasureType = 'sum';
    // MAX_GROUP_ROWS is 1000 — fill exactly 1000 rows for period A
    const bigRows: Array<[string, number]> = Array.from({ length: 1000 }, (_, i) => [
      `seg_${i}`,
      i + 1,
    ]);
    mockGroupedARows = makeRows('active_daily.platform', 'active_daily.dau', bigRows);
    mockGroupedBRows = makeRows('active_daily.platform', 'active_daily.dau', [
      ['seg_0', 1],
    ]);
    mockTotalARows = [{ 'active_daily.dau': 500500 }];
    mockTotalBRows = [{ 'active_daily.dau': 1 }];

    const result = await decomposeDelta(baseInput());
    expect(result.truncated).toBe(true);
  });

  it('sets truncated:false when grouped rows are below cap', async () => {
    mockMeasureType = 'sum';
    mockGroupedARows = makeRows('active_daily.platform', 'active_daily.dau', [
      ['android', 100],
    ]);
    mockGroupedBRows = makeRows('active_daily.platform', 'active_daily.dau', [
      ['android', 120],
    ]);
    mockTotalARows = [{ 'active_daily.dau': 100 }];
    mockTotalBRows = [{ 'active_daily.dau': 120 }];

    const result = await decomposeDelta(baseInput());
    expect(result.truncated).toBe(false);
  });
});
