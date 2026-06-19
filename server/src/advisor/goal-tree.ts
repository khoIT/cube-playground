/**
 * Pure goal-tree decomposition — no I/O.
 *
 * Revenue decomposition (growth accounting):
 *   Revenue ≈ payers × ARPPU × lifespan
 *   Bottleneck = whichever factor has the largest relative gap vs baseline.
 *
 * Engagement decomposition (leading indicator):
 *   Engagement ≈ session_freq × session_length × lifespan
 *   Engagement measures (session_freq / session_length) are NOT available per
 *   cfm_vn mf_users as of v1 — this tree degrades gracefully with a labeled note
 *   rather than crashing. Session measures may be absent; confirm they exist per-segment.
 *
 * asOf is threaded through so callers can derive recency-based factors without
 * calling Date.now() inside this module.
 */

import type { Factor, GoalTree } from './diagnosis-types.js';

/** Weak-factor threshold: factor is "weak" when it falls below this fraction of baseline. */
const WEAK_THRESHOLD_RATIO = 0.8; // below 80% of baseline = weak

// ─── Revenue tree ─────────────────────────────────────────────────────────────

export interface RevenueFactorValues {
  /** Count of paying users in this scope. */
  payers: number | null;
  /**
   * Total user count in this scope. When present alongside `payers`, the payers
   * factor is compared as a conversion RATE (payers ÷ users) rather than a raw
   * count — see buildRevenueGoalTree. Optional so callers without a denominator
   * (or older inputs) fall back to the count comparison.
   */
  users?: number | null;
  /** Average Revenue Per Paying User (lifetime, VND). */
  arppu: number | null;
  /**
   * Average lifespan of payers in this scope (days from first recharge to last
   * active date). Proxy: avg total_active_days for paying users.
   */
  lifespan: number | null;
}

export interface BaselineValues {
  payers: number | null;
  users?: number | null;
  arppu: number | null;
  lifespan: number | null;
}

/**
 * Build the revenue GoalTree from observed values + baseline.
 * Revenue = payers × ARPPU × lifespan; factor is "weak" when below 80% of baseline.
 *
 * The payers factor is intensive-vs-extensive sensitive: a raw payer COUNT
 * always shrinks for a sub-segment (a slice is smaller than the whole), so
 * comparing the segment count to the population count flags every cohort "weak"
 * by construction. When a `users` denominator is supplied, payers is therefore
 * compared as a conversion RATE (payers ÷ users) — an intensive quantity that
 * is genuinely comparable across scopes (and is the real lever: convert more of
 * this cohort). ARPPU and lifespan are already per-capita averages, so they
 * compare directly. The rate path activates only when both observed and
 * baseline denominators are positive; otherwise it degrades to the count.
 */
export function buildRevenueGoalTree(
  observed: RevenueFactorValues,
  baseline: BaselineValues,
): GoalTree {
  const payerFactor = buildPayerFactor(observed, baseline);

  const factors: Factor[] = [
    payerFactor,
    {
      key: 'arppu',
      label: 'ARPPU (lifetime)',
      value: observed.arppu,
      baseline: baseline.arppu,
      weak: isWeak(observed.arppu, baseline.arppu),
      unit: '₫',
    },
    {
      key: 'lifespan',
      label: 'Payer Lifespan',
      value: observed.lifespan,
      baseline: baseline.lifespan,
      weak: isWeak(observed.lifespan, baseline.lifespan),
      unit: 'days',
    },
  ];

  return { goal: 'revenue', factors };
}

// ─── Engagement tree ──────────────────────────────────────────────────────────

export interface EngagementFactorValues {
  /** Average sessions per week (null = not available in current cube model). */
  sessionFreq: number | null;
  /** Average session length in minutes (null = not available). */
  sessionLength: number | null;
  /** Average lifespan (total_active_days). */
  lifespan: number | null;
}

export interface EngagementBaselineValues {
  sessionFreq: number | null;
  sessionLength: number | null;
  lifespan: number | null;
}

/**
 * Build the engagement GoalTree.
 *
 * Session freq / length do not exist in cfm_vn mf_users (session measures may be absent) — when both
 * are null, the tree degrades to lifespan-only with a labeled note. The function
 * never throws on missing data; callers should check `degraded` and surface the
 * note to the user.
 */
export function buildEngagementGoalTree(
  observed: EngagementFactorValues,
  baseline: EngagementBaselineValues,
): GoalTree {
  const factors: Factor[] = [];
  let degraded = false;
  let degradedNote: string | undefined;

  // Lifespan is always available (total_active_days from mf_users).
  factors.push({
    key: 'engagement_lifespan',
    label: 'Active Lifespan',
    value: observed.lifespan,
    baseline: baseline.lifespan,
    weak: isWeak(observed.lifespan, baseline.lifespan),
    unit: 'days',
  });

  if (observed.sessionFreq !== null || observed.sessionLength !== null) {
    factors.push({
      key: 'session_freq',
      label: 'Session Frequency',
      value: observed.sessionFreq,
      baseline: baseline.sessionFreq,
      weak: isWeak(observed.sessionFreq, baseline.sessionFreq),
      unit: 'sessions/wk',
    });
    factors.push({
      key: 'session_length',
      label: 'Session Length',
      value: observed.sessionLength,
      baseline: baseline.sessionLength,
      weak: isWeak(observed.sessionLength, baseline.sessionLength),
      unit: 'min',
    });
  } else {
    // Session measures absent from this game's cube model — degrade gracefully.
    degraded = true;
    degradedNote =
      'Session frequency and length measures are not available for this game. ' +
      'Engagement tree shows lifespan only. Add session measures to the game cube to unlock the full tree.';
  }

  return { goal: 'engagement', factors, ...(degraded ? { degraded, degradedNote } : {}) };
}

// ─── Bottleneck selection ─────────────────────────────────────────────────────

/**
 * Select the bottleneck factor from a goal tree — the one with the largest
 * relative gap vs baseline. Used by the Decomposition lens (#4) to nominate the
 * single most constraining factor for a growth-accounting intervention.
 *
 * Returns null when no factor has a computable gap (all values/baselines null).
 */
export function pickBottleneckFactor(tree: GoalTree): Factor | null {
  let worst: Factor | null = null;
  let worstGap = -Infinity;

  for (const f of tree.factors) {
    if (f.value === null || f.baseline === null || f.baseline === 0) continue;
    const relGap = (f.baseline - f.value) / f.baseline; // positive = below baseline
    if (relGap > worstGap) {
      worstGap = relGap;
      worst = f;
    }
  }

  return worst;
}

/**
 * Compute the gap metrics for a factor (used by lens-synthesis to populate
 * Opportunity fields).
 */
export function factorGap(f: Factor): { gapPct: number; gapValue: number } {
  if (f.value === null || f.baseline === null || f.baseline === 0) {
    return { gapPct: 0, gapValue: 0 };
  }
  const gapValue = f.baseline - f.value;
  const gapPct = (gapValue / f.baseline) * 100;
  return { gapPct, gapValue };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Build the payers factor. When both observed and baseline carry a positive
 * `users` denominator, payers is compared as a conversion RATE (payers ÷ users)
 * — intensive and comparable across scopes — so a sub-segment is no longer
 * flagged weak merely for being a smaller slice. Without a usable denominator
 * it degrades to the raw count comparison (the prior behaviour).
 */
function buildPayerFactor(observed: RevenueFactorValues, baseline: BaselineValues): Factor {
  const obsUsers = observed.users ?? null;
  const basUsers = baseline.users ?? null;
  const canRate =
    observed.payers !== null &&
    baseline.payers !== null &&
    obsUsers !== null &&
    basUsers !== null &&
    obsUsers > 0 &&
    basUsers > 0;

  if (canRate) {
    const obsRate = observed.payers! / obsUsers!;
    const basRate = baseline.payers! / basUsers!;
    return {
      key: 'payers',
      label: 'Payer Conversion',
      value: obsRate,
      baseline: basRate,
      weak: isWeak(obsRate, basRate),
      unit: 'rate',
    };
  }

  return {
    key: 'payers',
    label: 'Payer Count',
    value: observed.payers,
    baseline: baseline.payers,
    weak: isWeak(observed.payers, baseline.payers),
    unit: 'users',
  };
}

/** Returns true when observed is below WEAK_THRESHOLD_RATIO × baseline. */
function isWeak(observed: number | null, baseline: number | null): boolean {
  if (observed === null || baseline === null || baseline === 0) return false;
  return observed / baseline < WEAK_THRESHOLD_RATIO;
}
