/**
 * Monetary impact estimator for experiment candidates.
 *
 * Converts an expected effect (fraction) × addressable N × ₫/unit into an
 * incremental VND estimate. When ₫/unit is not yet agreed (pending business sign-off), returns
 * a TBD sentinel so the ranker can fall back to effect × N × confidence.
 *
 * Currency: defaults to VND (cfm_vn is VND-only). jus_vn operates in a mixed
 * currency environment — callers pass currency='USD' and valuePerUnit in USD;
 * no conversion is applied here (the UI labels accordingly).
 *
 * ₫/unit factors are intentionally NOT hard-coded here. They are agreed-upon
 * business inputs that belong in the Treatment-Effect Library or a per-game
 * config, not in this pure computation module.
 */

import type { MoneyEstimate } from './candidate-types.js';

export interface MoneyInput {
  /**
   * Expected effect size as a fraction (e.g. 0.06 = +6 pp churn reduction).
   * Treated as the fraction of addressableN that is incrementally retained /
   * converted by the intervention.
   */
  effectFraction: number;
  /** Total addressable segment members. */
  addressableN: number;
  /**
   * Revenue per user per period in the target currency.
   * Pass null or undefined when not yet agreed — triggers TBD path.
   */
  valuePerUnit?: number | null;
  /** Currency code (default 'VND'). */
  currency?: string;
}

/**
 * Estimate incremental revenue from an intervention.
 *
 * When valuePerUnit is known:
 *   incrementalVnd = addressableN × effectFraction × valuePerUnit
 *
 * When valuePerUnit is unknown (pending business sign-off):
 *   Returns null for monetary fields with a human note. The ranker MUST fall
 *   back to effect × N × confidence weight for ordering in this case.
 */
export function expectedIncremental(input: MoneyInput): MoneyEstimate {
  const { effectFraction, addressableN, currency = 'VND' } = input;
  const valuePerUnit = input.valuePerUnit ?? null;

  if (valuePerUnit == null) {
    return {
      incrementalVnd: null,
      perUnitVnd: null,
      note: 'TBD — ₫/unit pending business sign-off; ranking falls back to effect×N×confidence',
      currency,
    };
  }

  const incremental = Math.round(addressableN * effectFraction * valuePerUnit);
  const note =
    `${currency === 'VND' ? '₫' : currency}${valuePerUnit.toLocaleString()} × ` +
    `${(effectFraction * 100).toFixed(1)}% effect × ${addressableN.toLocaleString()} N` +
    ` = ${currency === 'VND' ? '₫' : currency}${incremental.toLocaleString()}`;

  return {
    incrementalVnd: incremental,
    perUnitVnd: valuePerUnit,
    note,
    currency,
  };
}
