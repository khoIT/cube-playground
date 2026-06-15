/**
 * Deterministic split — the arm derivation must be stable (reproducible across
 * calls/process restarts), salted by experiment (no cross-experiment
 * correlation), and balanced (within tolerance of the requested split).
 */

import { describe, it, expect } from 'vitest';
import { armFor, bucketFor, splitCohort } from '../src/experiments/deterministic-split.js';

const uids = Array.from({ length: 1000 }, (_, i) => `u${i}`);

describe('deterministic-split', () => {
  it('is stable: same inputs → same arm every call', () => {
    for (const uid of uids.slice(0, 50)) {
      const a = armFor('exp-1', uid, 50);
      expect(armFor('exp-1', uid, 50)).toBe(a);
      expect(bucketFor('exp-1', uid)).toBe(bucketFor('exp-1', uid));
    }
  });

  it('splits within ±3pp of the requested share over 1000 uids', () => {
    const rows = splitCohort('exp-1', uids, 50);
    const treat = rows.filter((r) => r.arm === 'treatment').length;
    expect(Math.abs(treat / uids.length - 0.5)).toBeLessThan(0.03);
  });

  it('honors a non-50 split', () => {
    const rows = splitCohort('exp-1', uids, 20);
    const treat = rows.filter((r) => r.arm === 'treatment').length;
    expect(Math.abs(treat / uids.length - 0.2)).toBeLessThan(0.03);
  });

  it('is salted by experiment id: a uid is not always in the same arm', () => {
    // Across many experiments, the same uid should land in both arms sometimes.
    const arms = new Set(
      Array.from({ length: 40 }, (_, i) => armFor(`exp-${i}`, 'fixed-uid', 50)),
    );
    expect(arms.size).toBe(2);
  });

  it('0% → all control, 100% → all treatment', () => {
    expect(splitCohort('e', uids, 0).every((r) => r.arm === 'control')).toBe(true);
    expect(splitCohort('e', uids, 100).every((r) => r.arm === 'treatment')).toBe(true);
  });
});
