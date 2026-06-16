/**
 * Optimization-playbook seed catalog — generic engineering remedies for slow /
 * failed Cube queries, keyed off the P3 classifier verdict.
 *
 * Seed-only by design: unlike the CS care playbooks (business-curated per game,
 * hence seed+override+authoring), optimization remedies are generic, stable, and
 * few — a declarative array + a pure matcher is enough (KISS/YAGNI). A DB
 * override/authoring layer is a known extension point, deferred until a
 * deployment needs custom remedies.
 *
 * Each remedy's `appliesWhen` is a pure predicate over the Verdict. `scaffolds:
 * 'rollup'` flags the remedy whose draft YAML the rollup scaffolder generates.
 */

import type { Verdict } from './query-perf-classifier.js';

export interface OptimizationPlaybook {
  id: string;
  title: string;
  /** Pure predicate over the classifier verdict. */
  appliesWhen: (v: Verdict) => boolean;
  rationale: string;
  steps: string[];
  /** 'rollup' → the scaffolder can emit a draft pre_aggregations block. */
  scaffolds: 'rollup' | null;
}

/**
 * Ordered most-specific structural remedy first, accept-timeout last. The
 * matcher relies on this order for `bestPlaybook`.
 */
export const OPTIMIZATION_PLAYBOOKS: OptimizationPlaybook[] = [
  {
    id: 'materialize-snapshot',
    title: 'Materialize as a membership snapshot',
    appliesWhen: (v) => v.matchability === 'unmatchable',
    rationale:
      'This query lists per-user rows (a high-cardinality identifier dimension), so no aggregate pre-aggregation can ever serve it — it will always read raw from Trino. Serve per-user listings from the nightly segment-membership snapshot instead of a live scan.',
    steps: [
      'Confirm the listing maps to an existing segment, or define one for this cohort.',
      'Read the per-user rows from the membership snapshot (stag_iceberg) the nightly job writes, not a live Cube /load.',
      'If a live cut is genuinely needed, scope it by predicate (not a UID IN-list) and accept the raw read.',
    ],
    scaffolds: null,
  },
  {
    id: 'add-rollup',
    title: 'Add a pre-aggregation (rollup)',
    appliesWhen: (v) =>
      v.matchability === 'matchable' && v.preaggHit === 'miss',
    rationale:
      'The query is an additive aggregate that no rollup currently serves (none defined, or the existing one is keyed on a different time dimension), so it falls through to raw Trino. A matching rollup would serve it from CubeStore.',
    steps: [
      "Define a rollup whose time_dimension MATCHES the query's bound time dimension (a mismatch silently falls through).",
      'Include additive measures only (count/sum/min/max/count_distinct_approx); remodel any avg / exact count_distinct first.',
      'For a timestamp time-dim (dteventtime-like), cap the build with build_range_end: LEAST(MAX(<ts>), current_timestamp) so partitions seal.',
      'Rebuild and VERIFY routing via the compiled SQL FROM clause — not usedPreAggregations (lambda rollups report empty even when serving).',
    ],
    scaffolds: 'rollup',
  },
  {
    id: 'remodel-non-additive',
    title: 'Remodel non-additive measures',
    appliesWhen: (v) => v.matchability === 'partial',
    rationale:
      'The query uses a non-additive measure (avg / exact count_distinct) that cannot be summed across rollup partitions, so it cannot be rolled up as-is. Remodel it into additive components first.',
    steps: [
      'Replace avg with a sum + count pair and divide at query time.',
      'Replace exact count_distinct with count_distinct_approx where approximate cardinality is acceptable.',
      'Once additive, follow the add-rollup remedy.',
    ],
    scaffolds: null,
  },
  {
    id: 'narrow-time-grain',
    title: 'Narrow the time range or grain',
    appliesWhen: (v) => v.matchability === 'matchable',
    rationale:
      'A wide date range scans many partitions. Tightening the range or using a coarser grain prunes partitions and cuts read time even before a rollup exists.',
    steps: [
      'Tighten the dateRange to the window actually needed.',
      'Use the coarsest granularity the analysis tolerates (month over day where possible).',
    ],
    scaffolds: null,
  },
  {
    id: 'accept-or-raise-timeout',
    title: "Accept the cost or raise the timeout",
    appliesWhen: () => true, // universal fallback — matcher orders it last
    rationale:
      'No structural remedy fits (a genuine one-off raw pull). The proxy already allows 30s; raising upstream timeouts is a last resort, not a fix.',
    steps: [
      'If this is a rare ad-hoc pull, accept the raw read.',
      'Only if recurring and unavoidable, consider raising the nginx/proxy read timeout — document why.',
    ],
    scaffolds: null,
  },
];
