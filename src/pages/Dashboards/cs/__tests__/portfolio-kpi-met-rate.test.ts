/**
 * Portfolio stat tests for attainmentRate (locked — must not change) and the
 * additive kpiMetRate field.
 *
 * attainmentRate = (treated + resolved) / (open + treated + resolved)
 *   — unchanged from before; computed from open/treated counts only.
 *
 * kpiMetRate = kpi_met / (kpi_met + kpi_missed)
 *   — cases that were closed with a definitive outcome; 'na' and null are excluded
 *     from the denominator so in-progress treatment cycles don't dilute the rate.
 *   — renders "—" (null) when the denominator is 0 (no outcome data yet).
 */

import { describe, it, expect } from 'vitest';
import { buildPortfolioStats } from '../use-care-playbooks';
import type { RegistryCounts, CaseAggregateResponse } from '../use-care-playbooks';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeCounts(overrides: Partial<RegistryCounts> = {}): RegistryCounts {
  return {
    total: 10,
    available: 8,
    partial: 1,
    unavailable: 1,
    ...overrides,
  };
}

function makeAgg(overrides: Partial<CaseAggregateResponse> = {}): CaseAggregateResponse {
  return {
    byPlaybook: [],
    openCases: 5,
    treatedCases: 3,
    vipsTriggered: 6,
    kpiMet: 0,
    kpiClosed: 0,
    ...overrides,
  };
}

// ── attainmentRate is LOCKED — formula must not regress ───────────────────────

describe('attainmentRate — formula locked unchanged', () => {
  it('is treated / (open + treated) — exact formula lock', () => {
    const stats = buildPortfolioStats(
      makeCounts(),
      makeAgg({ openCases: 5, treatedCases: 3 }),
    );
    // 3 / (5 + 3) = 0.375
    expect(stats.attainmentRate).toBeCloseTo(0.375);
  });

  it('is null when both open and treated are 0 (no data)', () => {
    const stats = buildPortfolioStats(
      makeCounts(),
      makeAgg({ openCases: 0, treatedCases: 0 }),
    );
    expect(stats.attainmentRate).toBeNull();
  });

  it('is 1.0 when all cases are treated (0 open)', () => {
    const stats = buildPortfolioStats(
      makeCounts(),
      makeAgg({ openCases: 0, treatedCases: 5 }),
    );
    expect(stats.attainmentRate).toBe(1);
  });

  it('is 0.0 when all cases are open (0 treated)', () => {
    const stats = buildPortfolioStats(
      makeCounts(),
      makeAgg({ openCases: 5, treatedCases: 0 }),
    );
    expect(stats.attainmentRate).toBe(0);
  });
});

// ── kpiMetRate — new additive field ──────────────────────────────────────────

describe('kpiMetRate — new portfolio field', () => {
  it('is kpi_met / (kpi_met + kpi_missed) when both present', () => {
    const stats = buildPortfolioStats(
      makeCounts(),
      makeAgg({ kpiMet: 6, kpiClosed: 8 }),
    );
    // 6 / 8 = 0.75
    expect(stats.kpiMetRate).toBeCloseTo(0.75);
  });

  it('is null (render "—") when kpiClosed is 0 — divide-by-zero guard', () => {
    const stats = buildPortfolioStats(
      makeCounts(),
      makeAgg({ kpiMet: 0, kpiClosed: 0 }),
    );
    expect(stats.kpiMetRate).toBeNull();
  });

  it('is null when kpiClosed and kpiMet are both absent from the response', () => {
    // Aggregate endpoint pre-existing responses without the new fields.
    const agg: CaseAggregateResponse = {
      byPlaybook: [],
      openCases: 5,
      treatedCases: 3,
      vipsTriggered: 6,
    };
    const stats = buildPortfolioStats(makeCounts(), agg);
    expect(stats.kpiMetRate).toBeNull();
  });

  it('is 1.0 when all closed outcomes are kpi_met', () => {
    const stats = buildPortfolioStats(
      makeCounts(),
      makeAgg({ kpiMet: 4, kpiClosed: 4 }),
    );
    expect(stats.kpiMetRate).toBe(1);
  });

  it('is 0 when kpi_met is 0 but kpiClosed > 0 (all missed)', () => {
    const stats = buildPortfolioStats(
      makeCounts(),
      makeAgg({ kpiMet: 0, kpiClosed: 3 }),
    );
    expect(stats.kpiMetRate).toBe(0);
  });

  it('does not affect attainmentRate — independence check', () => {
    // Adding kpiMet/kpiClosed must not alter the locked attainmentRate computation.
    const statsWithOutcome = buildPortfolioStats(
      makeCounts(),
      makeAgg({ openCases: 4, treatedCases: 4, kpiMet: 3, kpiClosed: 4 }),
    );
    const statsWithout = buildPortfolioStats(
      makeCounts(),
      makeAgg({ openCases: 4, treatedCases: 4, kpiMet: 0, kpiClosed: 0 }),
    );
    // attainmentRate is independent of kpiMet/kpiClosed.
    expect(statsWithOutcome.attainmentRate).toEqual(statsWithout.attainmentRate);
    // kpiMetRate differs as expected.
    expect(statsWithOutcome.kpiMetRate).toBeCloseTo(0.75);
    expect(statsWithout.kpiMetRate).toBeNull();
  });
});
