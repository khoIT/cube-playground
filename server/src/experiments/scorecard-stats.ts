/**
 * Scorecard statistics. Pure, no I/O — takes the per-arm outcome aggregates and
 * returns the lift readout. Unit-testable without Trino.
 *
 * Two comparisons:
 *  - Re-pay RATE (binary: did the member pay in the window?) → two-proportion
 *    z-test. Reports lift in percentage points, a 95% CI on the difference, and
 *    a two-sided p-value.
 *  - Mean gross PER MEMBER (continuous) → difference of means (absolute +
 *    relative lift). No CI is computed here: per-uid values aren't carried from
 *    the aggregate, so a variance-based interval would be fabricated. The
 *    re-pay-rate z-test carries the significance signal; the mean lift is a
 *    point estimate.
 *
 * ITT (intent-to-treat, measured on everyone assigned) is the headline — it's
 * unbiased regardless of delivery. Treated-on-treated is deferred (exposure
 * tracking is not wired this round).
 */

import type { ArmOutcome } from './experiment-types.js';

export interface ProportionTest {
  treatmentRate: number; // 0–1
  controlRate: number; // 0–1
  liftPp: number; // percentage points (treatment - control) * 100
  ci95: [number, number]; // CI on the pp difference
  pValue: number; // two-sided
  significant: boolean; // p < 0.05
}

export interface MeanTest {
  treatmentMean: number;
  controlMean: number;
  liftAbs: number; // treatment - control
  liftPct: number | null; // relative, null when control mean is 0
}

export interface Scorecard {
  repayRate: ProportionTest;
  grossPerMember: MeanTest;
  /** Headline verdict for the readout strip. */
  verdict: 'win' | 'inconclusive' | 'flat';
}

/** Standard normal CDF via the Abramowitz–Stegun erf approximation. */
function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const p =
    d *
    t *
    (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

/**
 * Two-proportion z-test on the re-pay rate. Uses the pooled proportion for the
 * test statistic and the unpooled SE for the CI on the difference (standard).
 */
export function twoProportionTest(
  treatPayers: number,
  treatN: number,
  ctrlPayers: number,
  ctrlN: number,
): ProportionTest {
  const pT = treatN > 0 ? treatPayers / treatN : 0;
  const pC = ctrlN > 0 ? ctrlPayers / ctrlN : 0;
  const diff = pT - pC;

  let pValue = 1;
  if (treatN > 0 && ctrlN > 0) {
    const pPool = (treatPayers + ctrlPayers) / (treatN + ctrlN);
    const sePool = Math.sqrt(pPool * (1 - pPool) * (1 / treatN + 1 / ctrlN));
    const z = sePool > 0 ? diff / sePool : 0;
    pValue = 2 * (1 - normalCdf(Math.abs(z)));
  }

  // Unpooled SE for the difference CI.
  const seDiff =
    treatN > 0 && ctrlN > 0
      ? Math.sqrt((pT * (1 - pT)) / treatN + (pC * (1 - pC)) / ctrlN)
      : 0;
  const margin = 1.96 * seDiff;

  return {
    treatmentRate: pT,
    controlRate: pC,
    liftPp: diff * 100,
    ci95: [(diff - margin) * 100, (diff + margin) * 100],
    pValue,
    significant: pValue < 0.05,
  };
}

/** Difference of mean gross per member (relative lift when control > 0). */
export function meanDifference(
  treatGross: number,
  treatN: number,
  ctrlGross: number,
  ctrlN: number,
): MeanTest {
  const mT = treatN > 0 ? treatGross / treatN : 0;
  const mC = ctrlN > 0 ? ctrlGross / ctrlN : 0;
  return {
    treatmentMean: mT,
    controlMean: mC,
    liftAbs: mT - mC,
    liftPct: mC > 0 ? (mT - mC) / mC : null,
  };
}

/** Assemble the full scorecard from per-arm aggregates. */
export function computeScorecard(arms: ArmOutcome[]): Scorecard {
  const t = arms.find((a) => a.arm === 'treatment');
  const c = arms.find((a) => a.arm === 'control');
  const treat = t ?? { assigned: 0, payers: 0, grossVnd: 0, txns: 0, arm: 'treatment' as const };
  const ctrl = c ?? { assigned: 0, payers: 0, grossVnd: 0, txns: 0, arm: 'control' as const };

  const repayRate = twoProportionTest(treat.payers, treat.assigned, ctrl.payers, ctrl.assigned);
  const grossPerMember = meanDifference(treat.grossVnd, treat.assigned, ctrl.grossVnd, ctrl.assigned);

  // Verdict: a clear win needs a positive, significant rate lift; a positive but
  // not-yet-significant lift is inconclusive; otherwise flat/negative.
  let verdict: Scorecard['verdict'] = 'flat';
  if (repayRate.liftPp > 0 && repayRate.significant) verdict = 'win';
  else if (repayRate.liftPp > 0) verdict = 'inconclusive';

  return { repayRate, grossPerMember, verdict };
}
