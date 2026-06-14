/**
 * Tests for recommend() — the diagnose → rank orchestration.
 *
 * Uses a STUBBED CubeReaderFn (no live Cube). The ranker + diagnosis engine are
 * tested in depth elsewhere (candidate-ranker.test.ts, diagnosis-lens-engine.test.ts);
 * here we assert the WIRING: short-circuit on an empty cohort yields no
 * candidates, and a populated cohort flows through to ranked candidates with the
 * power/money/confidence fields the UI renders.
 */
import { describe, it, expect } from 'vitest';
import type { CubeReaderFn, CubeRow } from '../src/advisor/cube-read.js';
import type { WorkspaceCtx } from '../src/services/cube-client.js';
import type { DiagnosisInput } from '../src/advisor/diagnosis-types.js';
import { recommend } from '../src/advisor/recommend.js';

const STUB_CTX: WorkspaceCtx = { cubeApiUrl: 'http://stub', token: null };

const SEGMENT_INPUT: DiagnosisInput = {
  scope: { kind: 'segment', segmentId: 'seg-x', gameId: 'cfm_vn' },
  goal: 'revenue',
  asOf: new Date('2026-06-14T00:00:00Z'),
};

// Weak-lifespan whale segment vs a healthier population (lifespan 2× higher).
const SEGMENT_ROWS: CubeRow[] = [
  { 'mf_users.paying_users': 100, 'mf_users.arppu_vnd': 500_000, 'mf_users.avg_total_active_days': 30 },
];
const POPULATION_ROWS: CubeRow[] = [
  { 'mf_users.paying_users': 100, 'mf_users.arppu_vnd': 500_000, 'mf_users.avg_total_active_days': 60 },
];

/** Odd calls → segment rows, even calls → population rows (mirrors lens read order). */
function alternatingReader(): CubeReaderFn {
  let call = 0;
  return async () => {
    call += 1;
    return call % 2 === 1 ? SEGMENT_ROWS : POPULATION_ROWS;
  };
}

/** Empty cohort: zero payers → decomposition short-circuits. */
function emptyReader(): CubeReaderFn {
  return async () => [{ 'mf_users.paying_users': 0, 'mf_users.arppu_vnd': 0, 'mf_users.avg_total_active_days': 0 }];
}

describe('recommend()', () => {
  it('short-circuits to zero candidates on an empty cohort', async () => {
    const result = await recommend(SEGMENT_INPUT, STUB_CTX, { addressableN: 0 || 1 }, emptyReader());
    expect(result.candidates).toEqual([]);
  });

  it('produces a diagnosis + an array of ranked candidates for a populated cohort', async () => {
    const result = await recommend(
      SEGMENT_INPUT,
      STUB_CTX,
      { addressableN: 2400, reachablePct: 0.78, windowDays: 14 },
      alternatingReader(),
    );
    expect(result.diagnosis.goalTrees.length).toBeGreaterThan(0);
    expect(Array.isArray(result.candidates)).toBe(true);
    // Every candidate carries the fields the UI renders.
    for (const c of result.candidates) {
      expect(c).toHaveProperty('feasibility');
      expect(c).toHaveProperty('power');
      expect(c).toHaveProperty('money');
      expect(c).toHaveProperty('expectedEffect.confidence');
      expect(typeof c.score).toBe('number');
    }
  });

  it('ranks candidates by score descending', async () => {
    const result = await recommend(
      SEGMENT_INPUT,
      STUB_CTX,
      { addressableN: 2400, reachablePct: 0.78 },
      alternatingReader(),
    );
    const scores = result.candidates.map((c) => c.score);
    const sorted = [...scores].sort((a, b) => b - a);
    expect(scores).toEqual(sorted);
  });
});
