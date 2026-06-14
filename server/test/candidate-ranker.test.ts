/**
 * Tests for candidate-ranker.ts — deterministic ranking, win-back rank-1,
 * underpowered flagged (not hidden), ₫ TBD fallback ordering.
 *
 * Uses an in-memory SQLite DB so the Treatment-Effect Library seeds are
 * available without touching the dev database.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setDb, closeDb } from '../src/db/sqlite.js';
import { rankCandidates } from '../src/advisor/candidate-ranker.js';
import type { RankerInput } from '../src/advisor/candidate-types.js';
import type { Opportunity } from '../src/advisor/diagnosis-types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function migrationPath(name: string) {
  return join(__dirname, '..', 'src', 'db', 'migrations', name);
}

let db: Database.Database;

beforeAll(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  // Apply only the migration needed for this test
  const sql = readFileSync(migrationPath('053-treatment-effect-library.sql'), 'utf8');
  db.exec(sql);
  setDb(db);
});

afterAll(() => {
  closeDb();
});

function makeOpp(factor: string, gapPct = 25): Opportunity {
  return { factor, gapPct, gapValue: 600, confidence: 2, agreeingLenses: [1, 2] };
}

// Worked-example input: segment 5ee78131… cfm_vn, N=2400, reachable=78%
const WIN_BACK_INPUT: RankerInput = {
  opportunity: makeOpp('lifespan', 30),
  addressableN: 2400,
  reachablePct: 0.78,
  windowDays: 14,
  baselineRate: 0.40,
  gameId: 'cfm_vn',
};

describe('rankCandidates', () => {
  it('win-back ranks #1 on the worked-example lifespan opportunity', () => {
    const candidates = rankCandidates([WIN_BACK_INPUT]);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].opportunityFactor).toBe('lifespan');
    // win-back should be the top candidate for lifespan
    expect(candidates[0].lever.family).toBe('win-back');
  });

  it('win-back candidate has powered verdict on N=2400', () => {
    const candidates = rankCandidates([WIN_BACK_INPUT]);
    const winBack = candidates.find((c) => c.lever.family === 'win-back');
    expect(winBack).toBeDefined();
    expect(winBack!.power.status).toBe('powered');
  });

  it('win-back expected effect is +6pp from library seed', () => {
    const candidates = rankCandidates([WIN_BACK_INPUT]);
    const winBack = candidates.find((c) => c.lever.family === 'win-back');
    expect(winBack).toBeDefined();
    expect(winBack!.expectedEffect.value).toBeCloseTo(0.06, 5);
    expect(winBack!.expectedEffect.confidence).toBe('assumption');
    expect(winBack!.expectedEffect.source).toMatch(/win-back/);
  });

  it('underpowered candidate is present in output with flag, not silently dropped', () => {
    const tinySegment: RankerInput = {
      opportunity: makeOpp('lifespan'),
      addressableN: 50,
      reachablePct: 0.78,
      windowDays: 14,
      baselineRate: 0.40,
      gameId: 'cfm_vn',
    };
    const candidates = rankCandidates([tinySegment]);
    // At least one candidate should exist (win-back)
    expect(candidates.length).toBeGreaterThan(0);
    // All should be underpowered for N=50
    const winBack = candidates.find((c) => c.lever.family === 'win-back');
    expect(winBack).toBeDefined();
    expect(winBack!.power.status).toBe('underpowered');
    // It must still appear in the output — not silently removed
    expect(candidates.some((c) => c.power.status === 'underpowered')).toBe(true);
  });

  it('ranking is deterministic — same inputs produce same order', () => {
    const inputs = [WIN_BACK_INPUT, { ...WIN_BACK_INPUT, opportunity: makeOpp('payers', 20) }];
    const first = rankCandidates(inputs).map((c) => c.id);
    const second = rankCandidates(inputs).map((c) => c.id);
    expect(first).toEqual(second);
  });

  it('₫ TBD: no valuePerUnitVnd → money fields null, ranking still produces order', () => {
    const input: RankerInput = {
      ...WIN_BACK_INPUT,
      valuePerUnitVnd: undefined,
    };
    const candidates = rankCandidates([input]);
    expect(candidates.length).toBeGreaterThan(0);
    // Money should be TBD
    const winBack = candidates.find((c) => c.lever.family === 'win-back');
    expect(winBack!.money.incrementalVnd).toBeNull();
    expect(winBack!.money.note).toMatch(/TBD/);
    // Score should still be non-zero (fallback uses effect×N)
    expect(winBack!.score).toBeGreaterThan(0);
  });

  it('known ₫/unit: score reflects money magnitude', () => {
    const withMoney: RankerInput = { ...WIN_BACK_INPUT, valuePerUnitVnd: 850_000 };
    const withoutMoney: RankerInput = { ...WIN_BACK_INPUT, valuePerUnitVnd: undefined };
    const scored = rankCandidates([withMoney]);
    const unscored = rankCandidates([withoutMoney]);
    const s1 = scored.find((c) => c.lever.family === 'win-back')!.score;
    const s2 = unscored.find((c) => c.lever.family === 'win-back')!.score;
    // Score with money should be different (larger due to VND magnitude)
    expect(s1).not.toBeCloseTo(s2, 0);
  });

  it('infeasible candidates have score=0', () => {
    const candidates = rankCandidates([WIN_BACK_INPUT]);
    const infeasible = candidates.filter((c) => c.feasibility.status === 'infeasible');
    for (const c of infeasible) {
      expect(c.score).toBe(0);
    }
  });

  it('rankReason includes prior confidence label', () => {
    const candidates = rankCandidates([WIN_BACK_INPUT]);
    const winBack = candidates.find((c) => c.lever.family === 'win-back');
    expect(winBack!.rankReason).toContain('assumption');
  });

  it('multiple opportunities produce candidates for all factors', () => {
    const inputs: RankerInput[] = [
      WIN_BACK_INPUT,
      { ...WIN_BACK_INPUT, opportunity: makeOpp('payers', 15) },
      { ...WIN_BACK_INPUT, opportunity: makeOpp('session_freq', 10) },
    ];
    const candidates = rankCandidates(inputs);
    const factors = new Set(candidates.map((c) => c.opportunityFactor));
    expect(factors.has('lifespan')).toBe(true);
    expect(factors.has('payers')).toBe(true);
    expect(factors.has('session_freq')).toBe(true);
  });

  it('output is sorted by score descending', () => {
    const inputs: RankerInput[] = [
      WIN_BACK_INPUT,
      { ...WIN_BACK_INPUT, opportunity: makeOpp('payers') },
    ];
    const candidates = rankCandidates(inputs);
    for (let i = 1; i < candidates.length; i++) {
      expect(candidates[i - 1].score).toBeGreaterThanOrEqual(candidates[i].score);
    }
  });
});
