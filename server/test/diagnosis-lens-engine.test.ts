/**
 * Unit tests for the diagnosis lens engine.
 *
 * All tests use STUBBED CubeReaderFn — no live Cube or Trino required.
 * Fixtures model a cfm_vn whale segment where lifespan is below baseline,
 * asserting that decomposition picks lifespan as the bottleneck.
 *
 * Live smoke test (segment 5ee78131… → payer-lifespan weak) is deferred to a
 * host with Cube connectivity. This is documented in diagnosis-engine.ts.
 */

import { describe, it, expect } from 'vitest';
import type { CubeReaderFn, CubeRow } from '../src/advisor/cube-read.js';
import type { WorkspaceCtx } from '../src/services/cube-client.js';
import {
  buildRevenueGoalTree,
  buildEngagementGoalTree,
  pickBottleneckFactor,
  factorGap,
} from '../src/advisor/goal-tree.js';
import { synthesizeConfidence, buildOpportunities } from '../src/advisor/lens-synthesis.js';
import { runLens04Decomposition } from '../src/advisor/lenses/lens-04-decomposition.js';
import { runLens01Level } from '../src/advisor/lenses/lens-01-level.js';
import type { LensResult, GoalTree } from '../src/advisor/diagnosis-types.js';

// ─── Shared stub ctx (not used by stubbed reader) ─────────────────────────────

const STUB_CTX: WorkspaceCtx = { cubeApiUrl: 'http://stub', token: null };

// ─── Fixture: whale segment where lifespan is below baseline ─────────────────
//
// Segment:   payers=100  arppu=500_000  total_active_days=30   (lifespan weak)
// Baseline:  payers=100  arppu=500_000  total_active_days=60   (lifespan 2×)
//
// Expected bottleneck: lifespan (gap = 50% of baseline)

const SEGMENT_ROWS: CubeRow[] = [
  {
    'mf_users.paying_users': 100,
    'mf_users.arppu_vnd': 500_000,
    'mf_users.total_active_days': 30,
  },
];

const POPULATION_ROWS: CubeRow[] = [
  {
    'mf_users.paying_users': 100,
    'mf_users.arppu_vnd': 500_000,
    'mf_users.total_active_days': 60,
  },
];

/** Stub reader: first call → segment rows, second call → population rows. */
function makeDecompReader(): CubeReaderFn {
  let callCount = 0;
  return async (_query, _ctx) => {
    callCount += 1;
    return callCount === 1 ? SEGMENT_ROWS : POPULATION_ROWS;
  };
}

/** Stub reader that always returns a fixed row set. */
function fixedReader(rows: CubeRow[]): CubeReaderFn {
  return async () => rows;
}

/** Stub reader alternating: odd calls → segRows, even calls → popRows. */
function alternatingReader(segRows: CubeRow[], popRows: CubeRow[]): CubeReaderFn {
  let call = 0;
  return async () => {
    call += 1;
    return call % 2 === 1 ? segRows : popRows;
  };
}

// ─── goal-tree.ts (pure — no I/O) ────────────────────────────────────────────

describe('buildRevenueGoalTree', () => {
  it('marks lifespan weak when below 80% of baseline', () => {
    const tree = buildRevenueGoalTree(
      { payers: 100, arppu: 500_000, lifespan: 30 },
      { payers: 100, arppu: 500_000, lifespan: 60 },
    );
    const lifespan = tree.factors.find((f) => f.key === 'lifespan')!;
    expect(lifespan.weak).toBe(true);
    expect(lifespan.value).toBe(30);
    expect(lifespan.baseline).toBe(60);
  });

  it('does NOT mark payers weak when equal to baseline', () => {
    const tree = buildRevenueGoalTree(
      { payers: 100, arppu: 500_000, lifespan: 30 },
      { payers: 100, arppu: 500_000, lifespan: 60 },
    );
    const payers = tree.factors.find((f) => f.key === 'payers')!;
    expect(payers.weak).toBe(false);
  });

  it('goal is revenue', () => {
    const tree = buildRevenueGoalTree(
      { payers: 100, arppu: 500_000, lifespan: 30 },
      { payers: 100, arppu: 500_000, lifespan: 60 },
    );
    expect(tree.goal).toBe('revenue');
  });

  it('returns 3 factors', () => {
    const tree = buildRevenueGoalTree(
      { payers: 100, arppu: 500_000, lifespan: 30 },
      { payers: 100, arppu: 500_000, lifespan: 60 },
    );
    expect(tree.factors).toHaveLength(3);
  });
});

describe('buildEngagementGoalTree', () => {
  it('degrades gracefully when session measures absent', () => {
    const tree = buildEngagementGoalTree(
      { sessionFreq: null, sessionLength: null, lifespan: 20 },
      { sessionFreq: null, sessionLength: null, lifespan: 40 },
    );
    expect(tree.degraded).toBe(true);
    expect(tree.degradedNote).toMatch(/session/i);
    expect(tree.factors).toHaveLength(1); // only lifespan
  });

  it('includes all 3 factors when session data present', () => {
    const tree = buildEngagementGoalTree(
      { sessionFreq: 3, sessionLength: 20, lifespan: 20 },
      { sessionFreq: 5, sessionLength: 30, lifespan: 40 },
    );
    expect(tree.degraded).toBeUndefined();
    expect(tree.factors).toHaveLength(3);
  });
});

describe('pickBottleneckFactor', () => {
  it('picks lifespan when it has the largest relative gap', () => {
    const tree = buildRevenueGoalTree(
      { payers: 100, arppu: 500_000, lifespan: 30 },
      { payers: 100, arppu: 500_000, lifespan: 60 },
    );
    const bottleneck = pickBottleneckFactor(tree);
    expect(bottleneck?.key).toBe('lifespan');
  });

  it('returns null when all values are null', () => {
    const tree = buildRevenueGoalTree(
      { payers: null, arppu: null, lifespan: null },
      { payers: null, arppu: null, lifespan: null },
    );
    expect(pickBottleneckFactor(tree)).toBeNull();
  });

  it('picks payers when payers gap is largest', () => {
    const tree = buildRevenueGoalTree(
      { payers: 10, arppu: 500_000, lifespan: 55 },  // payers 10 vs baseline 100 = 90% gap
      { payers: 100, arppu: 500_000, lifespan: 60 }, // lifespan gap 8%
    );
    const bottleneck = pickBottleneckFactor(tree);
    expect(bottleneck?.key).toBe('payers');
  });
});

describe('factorGap', () => {
  it('computes gap correctly for lifespan', () => {
    const tree = buildRevenueGoalTree(
      { payers: 100, arppu: 500_000, lifespan: 30 },
      { payers: 100, arppu: 500_000, lifespan: 60 },
    );
    const lifespan = tree.factors.find((f) => f.key === 'lifespan')!;
    const { gapPct, gapValue } = factorGap(lifespan);
    expect(gapValue).toBe(30); // 60 - 30
    expect(gapPct).toBeCloseTo(50, 1); // 50%
  });
});

// ─── lens-04-decomposition.ts (with stubbed reader) ──────────────────────────

describe('runLens04Decomposition', () => {
  const scope = { kind: 'segment' as const, segmentId: '5ee78131', gameId: 'cfm_vn' };
  const asOf = new Date('2026-06-14T00:00:00Z');

  it('picks lifespan as bottleneck when lifespan is below baseline', async () => {
    const result = await runLens04Decomposition(
      { scope, asOf },
      STUB_CTX,
      makeDecompReader(),
    );
    expect(result.bottleneckFactor).toBe('lifespan');
    expect(result.verdict).toBe('weak');
  });

  it('emits provenance with mf_users measures', async () => {
    const result = await runLens04Decomposition(
      { scope, asOf },
      STUB_CTX,
      makeDecompReader(),
    );
    expect(result.provenance.measures).toContain('mf_users.paying_users');
    expect(result.provenance.source).toMatch(/cfm_vn/);
  });

  it('returns inconclusive on empty cohort (payers = 0)', async () => {
    const emptyReader = fixedReader([
      { 'mf_users.paying_users': 0, 'mf_users.arppu_vnd': 0, 'mf_users.total_active_days': 0 },
    ]);
    const result = await runLens04Decomposition({ scope, asOf }, STUB_CTX, emptyReader);
    expect(result.verdict).toBe('inconclusive');
    expect(result.bottleneckFactor).toBeNull();
  });

  it('allFactorGaps lists all three revenue factors', async () => {
    const result = await runLens04Decomposition(
      { scope, asOf },
      STUB_CTX,
      makeDecompReader(),
    );
    expect(Object.keys(result.allFactorGaps)).toContain('payers');
    expect(Object.keys(result.allFactorGaps)).toContain('arppu');
    expect(Object.keys(result.allFactorGaps)).toContain('lifespan');
  });
});

// ─── runLens01Level (with stubbed reader) ────────────────────────────────────

describe('runLens01Level', () => {
  const scope = { kind: 'segment' as const, segmentId: '5ee78131', gameId: 'cfm_vn' };
  const asOf = new Date('2026-06-14T00:00:00Z');

  it('returns weak when segment value is well below population', async () => {
    // Segment lifespan = 10, population lifespan = 60 → ratio ~16% → P16 → weak
    const reader = alternatingReader(
      [{ 'mf_users.total_active_days': 10 }],
      [{ 'mf_users.total_active_days': 60 }],
    );
    const result = await runLens01Level({ scope, factor: 'lifespan', asOf }, STUB_CTX, reader);
    expect(result.verdict).toBe('weak');
    expect(result.factor).toBe('lifespan');
  });

  it('returns non-weak verdict when segment value is near population', async () => {
    // 55/60 ≈ 91% of population → above weak threshold → ok or strong
    const reader = alternatingReader(
      [{ 'mf_users.total_active_days': 55 }],
      [{ 'mf_users.total_active_days': 60 }],
    );
    const result = await runLens01Level({ scope, factor: 'lifespan', asOf }, STUB_CTX, reader);
    expect(result.verdict).not.toBe('weak');
    expect(result.verdict).not.toBe('inconclusive');
  });

  it('returns inconclusive for unknown factor', async () => {
    const result = await runLens01Level(
      { scope, factor: 'unknown_factor', asOf },
      STUB_CTX,
      fixedReader([]),
    );
    expect(result.verdict).toBe('inconclusive');
  });

  it('provenance carries source label', async () => {
    const reader = alternatingReader(
      [{ 'mf_users.total_active_days': 10 }],
      [{ 'mf_users.total_active_days': 60 }],
    );
    const result = await runLens01Level({ scope, factor: 'lifespan', asOf }, STUB_CTX, reader);
    expect(result.provenance.source).toMatch(/cfm_vn/);
  });
});

// ─── lens-synthesis.ts ───────────────────────────────────────────────────────

describe('synthesizeConfidence', () => {
  const makeLens = (id: number, verdict: LensResult['verdict'], factor: string): LensResult => ({
    id,
    name: `Lens ${id}`,
    verdict,
    factor,
    inputs: {},
    method: 'stub',
    provenance: { measures: [], source: 'stub' },
  });

  it('confidence = # of independent groups that agree weak', () => {
    const lenses: LensResult[] = [
      makeLens(1, 'weak', 'lifespan'),   // Group A
      makeLens(2, 'weak', 'lifespan'),   // Group C
      makeLens(4, 'weak', 'lifespan'),   // Group D
    ];
    const map = synthesizeConfidence(lenses);
    expect(map.get('lifespan')?.confidence).toBe(3);
  });

  it('correlated lenses in same group count as ONE vote', () => {
    const lenses: LensResult[] = [
      makeLens(2, 'weak', 'payers'),  // Group C
      makeLens(9, 'weak', 'payers'),  // Group C (same group as 2)
    ];
    const map = synthesizeConfidence(lenses);
    expect(map.get('payers')?.confidence).toBe(1);
    // Only the first lens in group is recorded
    expect(map.get('payers')?.agreeingLenses).toHaveLength(1);
  });

  it('ok verdicts are not counted', () => {
    const lenses: LensResult[] = [
      makeLens(1, 'ok', 'lifespan'),
      makeLens(2, 'weak', 'lifespan'),
    ];
    const map = synthesizeConfidence(lenses);
    expect(map.get('lifespan')?.confidence).toBe(1);
  });

  it('different factors tracked independently', () => {
    const lenses: LensResult[] = [
      makeLens(1, 'weak', 'lifespan'),
      makeLens(1, 'weak', 'payers'),
    ];
    const map = synthesizeConfidence(lenses);
    expect(map.get('lifespan')?.confidence).toBe(1);
    expect(map.get('payers')?.confidence).toBe(1);
  });
});

describe('buildOpportunities', () => {
  const makeTree = (factors: GoalTree['factors']): GoalTree => ({
    goal: 'revenue',
    factors,
  });

  it('ranks by gapPct × confidence descending', () => {
    const tree = makeTree([
      { key: 'lifespan', label: 'Lifespan', value: 30, baseline: 60, weak: true, unit: 'days' },
      { key: 'payers', label: 'Payers', value: 80, baseline: 100, weak: true, unit: 'users' },
    ]);
    const confMap = new Map([
      ['lifespan', { confidence: 3, agreeingLenses: [1, 2, 4] }],
      ['payers', { confidence: 1, agreeingLenses: [1] }],
    ]);
    const opps = buildOpportunities([tree], confMap);
    // lifespan: gap=50%, conf=3 → score=150; payers: gap=20%, conf=1 → score=20
    expect(opps[0]?.factor).toBe('lifespan');
    expect(opps[0]?.confidence).toBe(3);
    expect(opps[0]?.agreeingLenses).toHaveLength(3);
  });

  it('only includes weak factors', () => {
    const tree = makeTree([
      { key: 'lifespan', label: 'L', value: 30, baseline: 60, weak: true },
      { key: 'arppu', label: 'A', value: 500_000, baseline: 500_000, weak: false },
    ]);
    const opps = buildOpportunities([tree], new Map());
    expect(opps).toHaveLength(1);
    expect(opps[0]?.factor).toBe('lifespan');
  });

  it('levers field is present (empty in v1)', () => {
    const tree = makeTree([
      { key: 'lifespan', label: 'L', value: 30, baseline: 60, weak: true },
    ]);
    const opps = buildOpportunities([tree], new Map());
    expect(opps[0]?.levers).toEqual([]);
  });
});
