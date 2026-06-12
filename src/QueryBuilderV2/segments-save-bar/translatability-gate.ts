/**
 * Translatability gate for segment save-back.
 *
 * buildPredicateFromRows maps a subset of Cube operators to predicate-tree
 * operators (see CUBE_TO_TREE_OP). Any operator it does NOT recognise is
 * silently dropped — a zero-edit round-trip could widen the cohort without
 * any visible feedback.
 *
 * This module counts every "construct" in the executed query and verifies
 * that each one is expressible by the predicate tree. If any construct is
 * unconsumed, Update must be disabled and the caller surfaces a tooltip
 * listing exactly what cannot be expressed.
 *
 * "Consumable" constructs:
 *   - Filter leaf: operator must be in TRANSLATABLE_FILTER_OPS
 *   - Filter logical group (and/or): always consumable (we recurse into them)
 *   - timeDimension with a dateRange: consumable (maps to inDateRange leaf)
 *   - timeDimension without a dateRange: no predicate node produced — only
 *     consumable if the query uses granularity for row bucketing (expansion
 *     mode). In uid-mode the bucket rows are not passed to buildPredicateFromRows,
 *     so a granularity-only timeDimension produces nothing and is unconsumed.
 *   - Query-level segments[]: always consumable (stored as cube_segments sidecar)
 *
 * IMPORTANT: This gate must be kept in sync with CUBE_TO_TREE_OP in
 * build-predicate-from-rows.ts. Add a new entry here whenever a new operator
 * is added there.
 */

import type { Query } from '@cubejs-client/core';

// Operators that cubeFilterToNode in build-predicate-from-rows.ts can
// translate. Derived directly from its CUBE_TO_TREE_OP table plus the
// multi-value promotion for equals/notEquals.
const TRANSLATABLE_FILTER_OPS = new Set([
  'equals',
  'notEquals',
  'gt',
  'lt',
  'gte',
  'lte',
  'contains',
  'set',
  'notSet',
  'inDateRange',
  'beforeDate',
  'afterDate',
  // Multi-value equals/notEquals from the QBs arrive as 'equals'/'notEquals'
  // with multiple values; cubeFilterToNode promotes them to in/notIn leaves.
  // The source operator presented to this gate is always 'equals'/'notEquals'.
  // Direct 'in'/'notIn' Cube operators are NOT handled by cubeFilterToNode
  // (not in its CUBE_TO_TREE_OP table), so they must be flagged here.
]);

interface CubeLeafFilter {
  member?: string;
  dimension?: string;
  operator: string;
  values?: unknown[];
}

interface CubeLogicalFilter {
  and?: CubeAnyFilter[];
  or?: CubeAnyFilter[];
}

type CubeAnyFilter = CubeLeafFilter | CubeLogicalFilter;

function isLogicalFilter(f: CubeAnyFilter): f is CubeLogicalFilter {
  return 'and' in f || 'or' in f;
}

/** Collect every (member, operator) pair that cannot be translated. */
function collectUntranslatableFilters(
  filters: CubeAnyFilter[],
): string[] {
  const blocked: string[] = [];
  for (const f of filters) {
    if (isLogicalFilter(f)) {
      const nested = [...(f.and ?? []), ...(f.or ?? [])];
      blocked.push(...collectUntranslatableFilters(nested));
    } else {
      const leaf = f as CubeLeafFilter;
      if (!TRANSLATABLE_FILTER_OPS.has(leaf.operator)) {
        const memberLabel = leaf.member ?? leaf.dimension ?? '(unknown member)';
        blocked.push(`"${leaf.operator}" on ${memberLabel}`);
      }
    }
  }
  return blocked;
}

export interface TranslatabilityResult {
  /** True when every construct in the query can be expressed in a predicate tree. */
  ok: boolean;
  /** Human-readable list of constructs that cannot be expressed. Empty when ok=true. */
  blockedReasons: string[];
}

/**
 * Check whether the full executed query can be round-tripped through
 * buildPredicateFromRows without silent construct loss.
 *
 * Also blocks an empty query (no filters and no dated timeDimensions):
 * building a predicate from an empty query yields AND([]) which, when saved,
 * produces a match-everyone segment — a high-blast-radius action that requires
 * explicit confirmation, not an accidental one-click.
 *
 * @param query     The executed Cube query (post echo-filter stripping).
 */
export function checkTranslatability(query: Query): TranslatabilityResult {
  const blockedReasons: string[] = [];

  // 0) Guard against saving an empty definition (match-everyone).
  //    An empty query has no filters and no timeDimensions with a dateRange.
  const hasFilters = (query.filters ?? []).length > 0;
  const hasDatedTimeDim = (query.timeDimensions ?? []).some((td) => !!td.dateRange);
  if (!hasFilters && !hasDatedTimeDim) {
    blockedReasons.push(
      'no filters defined — an empty definition matches everyone',
    );
    // Return immediately: other checks on an empty query are not meaningful.
    return { ok: false, blockedReasons };
  }

  // 1) Check filter operators
  const filters = (query.filters ?? []) as CubeAnyFilter[];
  blockedReasons.push(...collectUntranslatableFilters(filters));

  // 2) timeDimensions without dateRange are unconsumed in uid-mode.
  //    We flag them so the user is aware the window constraint won't be saved.
  //    (A timeDimension with dateRange is always consumable.)
  for (const td of query.timeDimensions ?? []) {
    if (!td.dateRange) {
      blockedReasons.push(
        `time dimension "${td.dimension}" has no date range — only granularity is not expressible`,
      );
    }
  }

  return {
    ok: blockedReasons.length === 0,
    blockedReasons,
  };
}
