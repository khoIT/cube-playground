/**
 * Experiment-QUALITY eval harness — the product's reason-to-exist gate.
 *
 * Agent text is stochastic, so this suite never asserts wording. It asserts
 * the QUALITY GATES a proposed experiment must clear: powered, feasible,
 * ₫-material, fully provenanced, on-goal. Fixed scenarios act as a regression
 * tripwire — if the scoring logic or thresholds drift, the scorecard moves.
 */
import { describe, it, expect } from 'vitest';
import {
  scoreExperiment,
  runEval,
  factorOf,
  DEFAULT_QUALITY_THRESHOLDS,
  type ScorableExperiment,
  type EvalScenario,
} from '../src/advisor/agent/experiment-quality-score.js';
import { ProvenanceLedger } from '../src/advisor/agent/agent-provenance-gate.js';

/** A strong, fully-formed win-back experiment (targets revenue 'lifespan'). */
function goodExperiment(): ScorableExperiment {
  return {
    draftId: 'seg-1::lifespan::win-back',
    candidateId: 'lifespan::win-back',
    power: { status: 'powered', mde: 4.2 },
    feasibility: { status: 'feasible' },
    money: { incrementalVnd: 240_000_000 },
    delivery: 'cs-queue',
    expectedEffect: { value: 0.06 },
    cohort: { addressableN: 2400 },
  };
}

describe('scoreExperiment', () => {
  it('passes a powered, feasible, ₫-material, on-goal experiment (fixture provenance)', () => {
    const card = scoreExperiment(goodExperiment(), 'revenue', { provenanceResolved: true });
    expect(card.pass).toBe(true);
    expect(card.overall).toBeGreaterThanOrEqual(DEFAULT_QUALITY_THRESHOLDS.minOverall);
    for (const d of card.dimensions) expect(d.pass).toBe(true);
  });

  it('FAILS an underpowered experiment (critical gate)', () => {
    const exp = { ...goodExperiment(), power: { status: 'underpowered' as const, mde: 18 } };
    const card = scoreExperiment(exp, 'revenue', { provenanceResolved: true });
    expect(card.pass).toBe(false);
    expect(card.dimensions.find((d) => d.dimension === 'power')?.pass).toBe(false);
  });

  it('FAILS an infeasible lever (critical gate)', () => {
    const exp: ScorableExperiment = {
      ...goodExperiment(),
      feasibility: { status: 'infeasible' },
      delivery: 'external',
    };
    const card = scoreExperiment(exp, 'revenue', { provenanceResolved: true });
    expect(card.pass).toBe(false);
    expect(card.dimensions.find((d) => d.dimension === 'feasibility')?.pass).toBe(false);
  });

  it('feasibility is monotonic in delivery — external delivery does not gate a feasible lever', () => {
    // Delivery channel is pluggable (cs-queue OR no-PII external export); it must
    // NOT penalize feasibility, and a stronger status must never fail a gate a
    // weaker one passes.
    const feasibleExternal = scoreExperiment(
      { ...goodExperiment(), feasibility: { status: 'feasible' }, delivery: 'external' },
      'revenue',
      { provenanceResolved: true },
    );
    const nearestExternal = scoreExperiment(
      { ...goodExperiment(), feasibility: { status: 'nearest-feasible' }, delivery: 'external' },
      'revenue',
      { provenanceResolved: true },
    );
    const fE = feasibleExternal.dimensions.find((d) => d.dimension === 'feasibility')!;
    const nE = nearestExternal.dimensions.find((d) => d.dimension === 'feasibility')!;
    expect(fE.pass).toBe(true); // feasible + external still passes
    expect(nE.pass).toBe(true); // nearest-feasible + external passes (≥0.5)
    expect(fE.score).toBeGreaterThanOrEqual(nE.score); // monotonic: better status ≥ score
  });

  it('flags ₫-immaterial below the floor but does not hard-fail on materiality alone', () => {
    const exp: ScorableExperiment = { ...goodExperiment(), money: { incrementalVnd: 1_000_000 } };
    const card = scoreExperiment(exp, 'revenue', { provenanceResolved: true });
    const mat = card.dimensions.find((d) => d.dimension === 'materiality');
    expect(mat?.pass).toBe(false);
    expect(mat?.critical).toBe(false);
    // overall may dip below threshold → card can still fail via the mean, but not via a critical gate
    expect(card.dimensions.filter((d) => d.critical).every((d) => d.pass)).toBe(true);
  });

  it('treats ₫ TBD (null incremental) as zero materiality', () => {
    const exp: ScorableExperiment = { ...goodExperiment(), money: { incrementalVnd: null } };
    const card = scoreExperiment(exp, 'revenue', { provenanceResolved: true });
    expect(card.dimensions.find((d) => d.dimension === 'materiality')?.score).toBe(0);
  });

  it('FAILS goal-fit when the lever factor is not in the stated goal tree', () => {
    // win-back targets revenue 'lifespan' — scored against the engagement goal it is off-tree
    const card = scoreExperiment(goodExperiment(), 'engagement', { provenanceResolved: true });
    expect(card.dimensions.find((d) => d.dimension === 'goalFit')?.pass).toBe(false);
  });

  it('matches an engagement lever to the engagement tree', () => {
    const exp: ScorableExperiment = {
      ...goodExperiment(),
      draftId: 'seg-2::session_freq::cosmetic-recognition',
      candidateId: 'session_freq::cosmetic-recognition',
    };
    const card = scoreExperiment(exp, 'engagement', { provenanceResolved: true });
    expect(card.dimensions.find((d) => d.dimension === 'goalFit')?.pass).toBe(true);
  });

  it('validates provenance against a live ledger — genuine numbers pass', () => {
    const ledger = new ProvenanceLedger();
    const exp = goodExperiment();
    // Register exactly the draft's published numbers as tool-produced.
    ledger.register('mcp__advisor__scaffold_draft', {
      addressableN: exp.cohort!.addressableN,
      mde: exp.power.mde,
      value: exp.expectedEffect!.value,
      incrementalVnd: exp.money.incrementalVnd,
    });
    const provenanceId = 'mcp__advisor__scaffold_draft#1';
    const card = scoreExperiment(exp, 'revenue', { ledger, provenanceId });
    expect(card.dimensions.find((d) => d.dimension === 'provenance')?.pass).toBe(true);
  });

  it('FAILS provenance against a live ledger when a number is forged (not tool-produced)', () => {
    const ledger = new ProvenanceLedger();
    const exp = goodExperiment();
    // Register a DIFFERENT incremental — the draft's ₫240M is a forged paraphrase.
    ledger.register('mcp__advisor__scaffold_draft', {
      addressableN: exp.cohort!.addressableN,
      mde: exp.power.mde,
      value: exp.expectedEffect!.value,
      incrementalVnd: 999_000_000,
    });
    const card = scoreExperiment(exp, 'revenue', { ledger, provenanceId: 'mcp__advisor__scaffold_draft#1' });
    expect(card.dimensions.find((d) => d.dimension === 'provenance')?.pass).toBe(false);
    expect(card.pass).toBe(false);
  });
});

describe('factorOf', () => {
  it('extracts the opportunity factor from a candidate id', () => {
    expect(factorOf('lifespan::win-back')).toBe('lifespan');
    expect(factorOf('arppu::spend-spike-acknowledgment')).toBe('arppu');
  });
});

describe('runEval — fixed scenario scorecard (regression tripwire)', () => {
  const scenarios: EvalScenario[] = [
    { name: 'win-back / revenue', goal: 'revenue', experiment: goodExperiment(), provenanceResolved: true },
    {
      name: 'spend-drop-recovery / revenue',
      goal: 'revenue',
      provenanceResolved: true,
      experiment: {
        draftId: 's::payers::spend-drop-recovery',
        candidateId: 'payers::spend-drop-recovery',
        power: { status: 'powered', mde: 3.1 },
        feasibility: { status: 'feasible' },
        money: { incrementalVnd: 88_000_000 },
        delivery: 'cs-queue',
        expectedEffect: { value: 0.05 },
        cohort: { addressableN: 5200 },
      },
    },
    {
      name: 'session-recovery / engagement',
      goal: 'engagement',
      provenanceResolved: true,
      experiment: {
        draftId: 's::session_freq::session-recovery',
        candidateId: 'session_freq::session-recovery',
        power: { status: 'powered', mde: 5.0 },
        feasibility: { status: 'feasible' },
        money: { incrementalVnd: 30_000_000 },
        delivery: 'cs-queue',
        expectedEffect: { value: 0.04 },
        cohort: { addressableN: 9000 },
      },
    },
  ];

  it('all well-formed scenarios clear the quality bar', () => {
    const report = runEval(scenarios);
    expect(report.passRate).toBe(1);
    expect(report.meanOverall).toBeGreaterThanOrEqual(DEFAULT_QUALITY_THRESHOLDS.minOverall);
  });

  it('the scorecard drops when an underpowered scenario is mixed in', () => {
    const withBad: EvalScenario[] = [
      ...scenarios,
      {
        name: 'underpowered tiny cohort',
        goal: 'revenue',
        provenanceResolved: true,
        experiment: { ...goodExperiment(), power: { status: 'underpowered', mde: 22 } },
      },
    ];
    const report = runEval(withBad);
    expect(report.passRate).toBeLessThan(1);
  });
});
