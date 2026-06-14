/**
 * Threshold rules for VIP-care playbooks.
 *
 * A playbook's trigger condition is stored as a *rule*, not a frozen number, so
 * it recomputes against the live population on every refresh instead of rotting.
 * Five rule kinds cover the 21 playbooks:
 *
 *   - abs        — member compared to a fixed value (e.g. ltv ≥ ₫50M). Cohort-queryable.
 *   - tierStep   — member crosses one of N cumulative bands (VIP tiers). Cohort-queryable.
 *   - event      — member fell inside a recent time window (first deposit, anniversary). Cohort-queryable.
 *   - percentile — member ≥ the p-th percentile of a live cohort. Cohort-queryable
 *                  ONLY after calibration resolves the percentile to an absolute cutoff.
 *   - ratio      — member's recent value vs its OWN baseline (spend-drop, session-drop).
 *                  Per-member comparison — NOT a static cohort filter → evaluated by the
 *                  trigger engine (Phase 1), never compiled to a cohort predicate.
 *
 * `compileRule` turns a rule (+ optional calibration result) into a canonical
 * PredicateNode that translator.ts feeds to Cube — or reports that the rule must
 * be evaluated per-member instead.
 */

import { v4 as uuidv4 } from 'uuid';
import type { LeafOperator, LeafValueType, PredicateNode, PopulationRef } from '../types/predicate-tree.js';

export interface AbsRule {
  kind: 'abs';
  member: string;
  op: Extract<LeafOperator, 'gt' | 'lt' | 'gte' | 'lte' | 'equals'>;
  value: number;
  valueType?: LeafValueType; // defaults to 'number'
}

/** One cumulative band, ordered ascending by `min`. `label` names the tier. */
export interface TierBand {
  label: string;
  min: number;
}

export interface TierStepRule {
  kind: 'tierStep';
  member: string;
  bands: TierBand[];
}

export interface EventRule {
  kind: 'event';
  member: string;
  /** Relative window string understood by expand-relative-date-range (e.g. "last 24 hours"). */
  window: string;
  /**
   * Whether the member's event must fall inside the window ('in', default) or
   * outside it ('notIn'). Compiles to inDateRange / notInDateRange respectively.
   */
  op?: 'in' | 'notIn';
}

export interface PercentileRule {
  kind: 'percentile';
  /** Member whose distribution the percentile is taken over (also the gate member). */
  of: string;
  /** Percentile in [0,100], e.g. 90 for P90. */
  p: number;
  /** Optional gate predicate restricting the population the percentile is computed over. */
  gate?: string;
  /**
   * Side of the distribution the cohort sits on: at-or-above the cutoff ('gte',
   * default, top Pn) or at-or-below it ('lte', bottom Pn). Applied to the
   * calibrated cutoff.
   */
  op?: 'gte' | 'lte';
  /**
   * Reference population the cutoff is computed over (physical table/column for
   * the shared two-pass resolver). When set, the calibration runner resolves the
   * absolute cutoff via percentile-cutoff-resolver — the same path the Segments
   * compiler uses. Absent → calibration records cohort size only (legacy).
   */
  over?: PopulationRef;
}

export interface RatioRule {
  kind: 'ratio';
  /** Recent-window member (numerator), e.g. user_recharge_daily.revenue_7d. */
  member: string;
  /** Baseline member (denominator), e.g. user_recharge_daily.revenue_30d_avg. */
  vs: string;
  /** Ratio threshold; `op` decides direction (lt for drops, gte for spikes). */
  value: number;
  op: Extract<LeafOperator, 'gt' | 'lt' | 'gte' | 'lte'>;
}

export type ThresholdRule = AbsRule | TierStepRule | EventRule | PercentileRule | RatioRule;

/** How a playbook's cohort is materialized. */
export type EvalMode = 'membership' | 'trigger';

/** Calibration output for a single playbook, seeded by the calibration runner. */
export interface CalibrationResult {
  /** Resolved absolute cutoff for a percentile rule (the value at the p-th percentile). */
  cutoff?: number;
  /** Resulting cohort size at the chosen cutoff — asserted > 0 before enabling. */
  cohortSize?: number;
  computedAt?: string;
}

export interface CompiledRule {
  /** Cohort predicate, or null when the rule is per-member (trigger) or awaits calibration. */
  predicate: PredicateNode | null;
  evalMode: EvalMode;
  /** Set when predicate is null on a membership rule (e.g. uncalibrated percentile). */
  reason?: string;
}

function leaf(member: string, op: LeafOperator, values: unknown[], type: LeafValueType): PredicateNode {
  return { kind: 'leaf', id: uuidv4(), member, type, op, values };
}

/**
 * Compile a ThresholdRule to a cohort predicate where possible.
 * Pass the playbook's CalibrationResult to resolve percentile rules to a concrete cutoff.
 */
export function compileRule(rule: ThresholdRule, calibration?: CalibrationResult): CompiledRule {
  switch (rule.kind) {
    case 'abs':
      return {
        predicate: leaf(rule.member, rule.op, [rule.value], rule.valueType ?? 'number'),
        evalMode: 'membership',
      };

    case 'tierStep': {
      // "Reached a VIP tier" = at or above the lowest band. Per-band attribution
      // (which tier was crossed) is derived at snapshot time from the live value.
      const lowest = [...rule.bands].sort((a, b) => a.min - b.min)[0];
      if (!lowest) return { predicate: null, evalMode: 'membership', reason: 'tierStep has no bands' };
      return {
        predicate: leaf(rule.member, 'gte', [lowest.min], 'number'),
        evalMode: 'membership',
      };
    }

    case 'event':
      // Relative window string; translator expands it to a 2-tuple date range.
      // op 'notIn' negates membership (event fell OUTSIDE the window).
      return {
        predicate: leaf(
          rule.member,
          rule.op === 'notIn' ? 'notInDateRange' : 'inDateRange',
          [rule.window],
          'time',
        ),
        evalMode: 'membership',
      };

    case 'percentile': {
      const cutoff = calibration?.cutoff;
      if (cutoff == null) {
        return {
          predicate: null,
          evalMode: 'membership',
          reason: `percentile P${rule.p} of ${rule.of} not yet calibrated — fail-closed`,
        };
      }
      // op 'lte' selects the bottom Pn (at-or-below the cutoff); 'gte' (default) the top.
      return { predicate: leaf(rule.of, rule.op === 'lte' ? 'lte' : 'gte', [cutoff], 'number'), evalMode: 'membership' };
    }

    case 'ratio':
      // Self-referential comparison — two per-user measures. Cannot be a static
      // cohort filter; the trigger engine evaluates it per member.
      return {
        predicate: null,
        evalMode: 'trigger',
        reason: `ratio ${rule.member}/${rule.vs} is per-member — evaluated by trigger engine`,
      };
  }
}

/** Members a rule reads — used to derive dataRequirements / availability. */
export function ruleMembers(rule: ThresholdRule): string[] {
  switch (rule.kind) {
    case 'abs':
    case 'event':
      return [rule.member];
    case 'tierStep':
      return [rule.member];
    case 'percentile':
      return rule.gate ? [rule.of, rule.gate] : [rule.of];
    case 'ratio':
      return [rule.member, rule.vs];
  }
}
