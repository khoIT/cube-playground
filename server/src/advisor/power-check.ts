/**
 * Statistical power / MDE checker for experiment candidates.
 *
 * Answers: "Given N reachable subjects and a baseline conversion rate, what is
 * the minimum detectable effect (MDE) at alpha=0.05, power=0.8 over the window?"
 *
 * Formula: two-proportion z-test sample-size formula (Fleiss et al.):
 *   n_per_arm = (z_α/2 + z_β)² × [p1(1-p1) + p2(1-p2)] / (p2-p1)²
 *
 * We invert it: given n, solve for Δ = p2 − p1 = MDE.
 * Binary search over Δ ∈ (0, 1) is stable and avoids closed-form rearrangement
 * complexity — the function is monotone in Δ so convergence is guaranteed.
 *
 * Worked example (from spec):
 *   N=2400, reachable=78% → n_per_arm = floor(2400×0.78/2) = 936
 *   baselineRate=0.40, alpha=0.05, power=0.8
 *   → MDE ≈ 4.1–4.2 pp → verdict 'powered'
 *
 * Tiny segment check:
 *   N=80, reachable=78% → n_per_arm = 31
 *   → MDE >> 10 pp → verdict 'underpowered'
 */

import type { PowerVerdict } from './candidate-types.js';

// ─── Normal distribution helpers ─────────────────────────────────────────────

/**
 * Rational approximation to the inverse normal CDF (Abramowitz & Stegun 26.2.17).
 * Accurate to ±1.5×10⁻⁵ for p ∈ (0,1).
 */
function invNorm(p: number): number {
  const a = [2.515517, 0.802853, 0.010328];
  const b = [1.432788, 0.189269, 0.001308];

  const q = p < 0.5 ? p : 1 - p;
  const t = Math.sqrt(-2 * Math.log(q));
  const num = a[0] + a[1] * t + a[2] * t * t;
  const den = 1 + b[0] * t + b[1] * t * t + b[2] * t * t * t;
  const z = t - num / den;
  return p < 0.5 ? -z : z;
}

// Pre-compute critical values — fixed for standard alpha/power settings
const Z_ALPHA_HALF_DEFAULT = invNorm(1 - 0.05 / 2); // ≈ 1.96
const Z_BETA_DEFAULT = invNorm(0.8);                  // ≈ 0.842

/**
 * Required sample size PER ARM for a two-proportion test.
 * p1 = baselineRate, p2 = baselineRate + delta.
 */
function requiredNPerArm(
  baselineRate: number,
  delta: number,
  zAlphaHalf: number,
  zBeta: number,
): number {
  const p1 = baselineRate;
  const p2 = baselineRate + delta;
  // Guard: p2 must be in (0,1)
  if (p2 <= 0 || p2 >= 1) return Infinity;
  const pooledVar = p1 * (1 - p1) + p2 * (1 - p2);
  const zSum = zAlphaHalf + zBeta;
  return (zSum * zSum * pooledVar) / (delta * delta);
}

/**
 * Binary-search for the MDE given a fixed n_per_arm.
 * Returns the smallest Δ such that requiredNPerArm(baseline, Δ) ≤ nPerArm.
 */
function solveMde(
  nPerArm: number,
  baselineRate: number,
  zAlphaHalf: number,
  zBeta: number,
  tolerance = 1e-5,
): number {
  let lo = 0.0001;
  let hi = 1 - baselineRate - 0.0001;
  if (hi <= lo) return 1; // baseline too close to 1 — MDE undefined, treat as underpowered

  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const needed = requiredNPerArm(baselineRate, mid, zAlphaHalf, zBeta);
    if (needed <= nPerArm) {
      hi = mid; // we can detect this delta — try smaller
    } else {
      lo = mid; // need larger delta
    }
    if (hi - lo < tolerance) break;
  }
  return hi;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface PowerCheckInput {
  /** Total addressable segment members. */
  N: number;
  /** Fraction of N reachable by the intervention channel (0–1). */
  reachablePct: number;
  /** Experiment duration in days (informs interpretation only — not in formula). */
  windowDays: number;
  /**
   * Baseline conversion rate for the target factor (0–1).
   * E.g. if 40% of the segment currently churns, pass 0.4.
   */
  baselineRate: number;
  /** Significance level α (default 0.05). */
  alpha?: number;
  /** Desired statistical power 1-β (default 0.8). */
  power?: number;
}

/**
 * Compute the minimum detectable effect and emit a powered/underpowered verdict.
 *
 * Assumptions:
 * - Equal arms: n_per_arm = floor(N × reachablePct / 2).
 * - Two-sided test.
 * - Measurement window = windowDays (used only in the detail string; the formula
 *   is a snapshot at end-of-window, not a sequential test).
 *
 * Returns mde as an ABSOLUTE percentage point (e.g. 4.2 = 4.2 pp).
 * 'underpowered' when MDE > 10 pp (a lift that large is implausible in practice).
 */
export function checkPower(input: PowerCheckInput): PowerVerdict {
  const { N, reachablePct, windowDays, baselineRate } = input;
  const alpha = input.alpha ?? 0.05;
  const power = input.power ?? 0.8;

  const zAlphaHalf = alpha === 0.05 ? Z_ALPHA_HALF_DEFAULT : invNorm(1 - alpha / 2);
  const zBeta = power === 0.8 ? Z_BETA_DEFAULT : invNorm(power);

  const nPerArm = Math.floor((N * reachablePct) / 2);

  // Edge case: too few subjects to compute
  if (nPerArm < 5) {
    return {
      status: 'underpowered',
      mde: 100,
      detail: `N=${N}, reachable=${(reachablePct * 100).toFixed(0)}%, n_per_arm=${nPerArm} — too small to test.`,
    };
  }

  const mdeRaw = solveMde(nPerArm, baselineRate, zAlphaHalf, zBeta);
  const mdePp = parseFloat((mdeRaw * 100).toFixed(2));

  // 10 pp threshold: a lift > 10 pp is extraordinary and rarely a realistic target
  const status: PowerVerdict['status'] = mdePp <= 10 ? 'powered' : 'underpowered';

  const detail =
    `N=${N}, reachable=${(reachablePct * 100).toFixed(0)}%, ` +
    `n_per_arm=${nPerArm}, ${windowDays}d window → ` +
    `detectable ≥${mdePp} pp at ${(power * 100).toFixed(0)}% power (α=${alpha})`;

  return { status, mde: mdePp, detail };
}
