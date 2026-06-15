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
import { recommend, pickEvidenceLink } from '../src/advisor/recommend.js';
import type { Diagnosis } from '../src/advisor/diagnosis-types.js';

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

  it('attaches an evidence query to each candidate whose factor a lens reported', async () => {
    const result = await recommend(
      SEGMENT_INPUT,
      STUB_CTX,
      { addressableN: 2400, reachablePct: 0.78 },
      alternatingReader(),
    );
    expect(result.candidates.length).toBeGreaterThan(0);
    // At least one candidate's factor is backed by a lens, so it carries a
    // re-runnable evidence query (measures + a source label) for its Opportunity.
    const factorsWithLens = new Set(result.diagnosis.lenses.map((l) => l.factor));
    for (const c of result.candidates) {
      if (factorsWithLens.has(c.opportunityFactor)) {
        expect(c.evidenceLink).toBeDefined();
        expect(Array.isArray(c.evidenceLink!.measures)).toBe(true);
        expect(typeof c.evidenceLink!.source).toBe('string');
      }
    }
  });
});

describe('pickEvidenceLink()', () => {
  const diagnosis = {
    goalTrees: [],
    opportunities: [{ factor: 'lifespan', gapPct: 50, gapValue: 30, confidence: 2, agreeingLenses: [4] }],
    lenses: [
      { id: 1, name: 'other', verdict: 'ok', factor: 'arppu', inputs: {}, method: 'm', provenance: { measures: ['a'], source: 'A' } },
      { id: 4, name: 'decomp', verdict: 'weak', factor: 'lifespan', inputs: {}, method: 'm', provenance: { measures: ['lifespan_m'], source: 'L' } },
      { id: 7, name: 'fallback', verdict: 'weak', factor: 'lifespan', inputs: {}, method: 'm', provenance: { measures: ['other_m'], source: 'O' } },
    ],
  } as unknown as Diagnosis;

  it('prefers a lens the opportunity corroborates (agreeingLenses)', () => {
    expect(pickEvidenceLink(diagnosis, 'lifespan')?.source).toBe('L');
  });

  it('falls back to any lens reporting the factor when none corroborate', () => {
    expect(pickEvidenceLink(diagnosis, 'arppu')?.source).toBe('A');
  });

  it('returns undefined when no lens carries the factor', () => {
    expect(pickEvidenceLink(diagnosis, 'session_freq')).toBeUndefined();
  });
});
