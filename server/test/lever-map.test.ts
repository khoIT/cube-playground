/**
 * Tests for lever-map.ts — factor → lever family → feasibility verdict.
 */
import { describe, expect, it } from 'vitest';
import { mapLevers } from '../src/advisor/lever-map.js';
import type { Opportunity } from '../src/advisor/diagnosis-types.js';

function makeOpp(factor: string): Opportunity {
  return { factor, gapPct: 20, gapValue: 480, confidence: 2, agreeingLenses: [1, 2] };
}

describe('mapLevers', () => {
  it('lifespan → win-back is feasible (CS-actuated)', () => {
    const mapped = mapLevers(makeOpp('lifespan'));

    const winBack = mapped.find((m) => m.family.family === 'win-back');
    expect(winBack).toBeDefined();
    expect(winBack!.verdict.status).toBe('feasible');
    expect(winBack!.verdict.lever.actuator).toBe('cs');
  });

  it('lifespan → maps to playbook 14 (No login ≥ N days)', () => {
    const mapped = mapLevers(makeOpp('lifespan'));
    const winBack = mapped.find((m) => m.family.family === 'win-back');
    expect(winBack!.primaryPlaybookId).toBe('14');
  });

  it('payers → spend-drop-recovery is feasible', () => {
    const mapped = mapLevers(makeOpp('payers'));
    const recovery = mapped.find((m) => m.family.family === 'spend-drop-recovery');
    expect(recovery).toBeDefined();
    expect(recovery!.verdict.status).toBe('feasible');
  });

  it('session_freq → session-recovery is feasible', () => {
    const mapped = mapLevers(makeOpp('session_freq'));
    const rec = mapped.find((m) => m.family.family === 'session-recovery');
    expect(rec).toBeDefined();
    expect(rec!.verdict.status).toBe('feasible');
  });

  it('infeasible: payment-failure-assist (playbook 05 is data-blocked)', () => {
    // payers maps to payment-failure-assist among others; 05 is blocked
    const mapped = mapLevers(makeOpp('payers'));
    const failAssist = mapped.find((m) => m.family.family === 'payment-failure-assist');
    // payment-failure-assist maps only to blocked playbook 05
    expect(failAssist?.verdict.status).toBe('infeasible');
    expect(failAssist?.verdict.why).toMatch(/data-blocked/);
  });

  it('unmapped factor → single infeasible sentinel, not fabricated lever', () => {
    const mapped = mapLevers(makeOpp('unknown_factor_xyz'));
    expect(mapped).toHaveLength(1);
    expect(mapped[0].verdict.status).toBe('infeasible');
    expect(mapped[0].family.family).toBe('no-feasible-lever');
    expect(mapped[0].verdict.why).toMatch(/unknown_factor_xyz/);
  });

  it('all CS-feasible levers have actuator=cs', () => {
    for (const factor of ['lifespan', 'payers', 'arppu', 'session_freq', 'session_length']) {
      const mapped = mapLevers(makeOpp(factor));
      const feasible = mapped.filter((m) => m.verdict.status === 'feasible');
      for (const m of feasible) {
        expect(m.lever ?? m.verdict.lever).toBeDefined();
        expect(m.verdict.lever.actuator).toBe('cs');
      }
    }
  });

  it('nearest-feasible levers carry a substitute description', () => {
    // system levers (push-re-engagement, system-offer) should have substitute
    for (const factor of ['payers', 'session_freq']) {
      const mapped = mapLevers(makeOpp(factor));
      const nearestFeasible = mapped.filter((m) => m.verdict.status === 'nearest-feasible');
      for (const m of nearestFeasible) {
        expect(m.verdict.substitute).toBeDefined();
        expect(m.verdict.substitute!.length).toBeGreaterThan(0);
      }
    }
  });

  it('arppu → tier-advancement and spend-drop-recovery both mapped', () => {
    const mapped = mapLevers(makeOpp('arppu'));
    const families = mapped.map((m) => m.family.family);
    expect(families).toContain('tier-advancement');
    expect(families).toContain('spend-drop-recovery');
  });
});
