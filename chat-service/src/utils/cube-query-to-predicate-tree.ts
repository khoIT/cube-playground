/**
 * Translate a Cube query's filters array into an AND-group PredicateNode.
 *
 * This is NOT a generic translator — it is scoped to filters a segment can
 * legally represent. Several Cube filter shapes are explicitly rejected:
 *
 *  - Measure filters: `member` resolves to a measure (dot-separated suffix is
 *    in a known measures-only position). Segments operate on dimension values
 *    attached to entity rows; a measure filter would require a JOIN that the
 *    segment refresh engine doesn't support.
 *
 *  - `order` + `limit` without a ranked measure: "top-N by arbitrary order" is
 *    not translatable to a declarative predicate — the result set changes as
 *    data ages. The caller should convert this to a percentileGte leaf instead.
 *
 *  - A `time` leaf (inDateRange, beforeDate, afterDate) that appears inside an
 *    OR group: Cube's SQL engine can handle it, but our rolling-window semantics
 *    only work for top-level AND leaves. A time constraint inside OR would
 *    produce a union of two time windows, which round-trips to an incorrect
 *    predicate during future edits.
 *
 * On success, returns `{ ok: true, predicate }`. On any violation, returns
 * `{ ok: false, reason, hint }` so the LLM can surface a clean message.
 */

import { randomUUID } from 'node:crypto';
import type { PredicateNode, LeafNode, GroupNode, LeafOperator, LeafValueType } from '../types/predicate-tree.js';

// ---------------------------------------------------------------------------
// Public contract
// ---------------------------------------------------------------------------

export type TranslateResult =
  | { ok: true; predicate: PredicateNode }
  | { ok: false; reason: string; hint: string };

export interface CubeQueryFilters {
  /** Cube measure/dimension members referenced in the query. */
  measures?: string[];
  dimensions?: string[];
  filters?: CubeInputFilter[];
  order?: Record<string, 'asc' | 'desc'> | [string, 'asc' | 'desc'][];
  limit?: number;
}

export interface CubeInputFilter {
  member?: string;
  dimension?: string;
  operator?: string;
  values?: string[];
  and?: CubeInputFilter[];
  or?: CubeInputFilter[];
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Translate a Cube query's filters to a predicate tree.
 * @param query - The Cube query (only `filters`, `measures`, `order`, `limit` are read).
 * @param measureNames - Set of known measure member names for validation.
 *                       Pass an empty Set to skip measure-filter detection.
 */
export function cubeQueryToPredicateTree(
  query: CubeQueryFilters,
  measureNames: Set<string> = new Set(),
): TranslateResult {
  const filters = query.filters ?? [];

  // Guard: order+limit without a ranked measure leaf means "top-N by raw sort",
  // which cannot be stored as a declarative predicate — the cut drifts as new
  // data arrives without re-resolution. Callers must convert to percentileGte.
  const hasOrderLimit = (query.limit != null && query.limit > 0) ||
    (query.order != null && Object.keys(query.order as object).length > 0);
  if (hasOrderLimit) {
    const hasMeasureDim = (query.measures?.length ?? 0) > 0;
    if (!hasMeasureDim) {
      return {
        ok: false,
        reason: 'order_limit_without_measure',
        hint:
          'The query uses order+limit without a ranked measure. ' +
          'Convert to a percentileGte predicate via propose_segment instead.',
      };
    }
  }

  if (filters.length === 0) {
    // Empty filter list → match-all; represent as an AND group with no children.
    const root: GroupNode = { kind: 'group', id: randomUUID(), op: 'AND', children: [] };
    return { ok: true, predicate: root };
  }

  const children: PredicateNode[] = [];
  for (const f of filters) {
    const result = translateFilter(f, 'root', measureNames);
    if (!result.ok) return result;
    children.push(result.node);
  }

  // Always wrap in an AND group — the root of a segment predicate tree is
  // always a group so callers get a consistent shape regardless of child count.
  const root: GroupNode = { kind: 'group', id: randomUUID(), op: 'AND', children };
  return { ok: true, predicate: root };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type NodeResult =
  | { ok: true; node: PredicateNode }
  | { ok: false; reason: string; hint: string };

function translateFilter(
  f: CubeInputFilter,
  parentOp: 'root' | 'AND' | 'OR',
  measureNames: Set<string>,
): NodeResult {
  // Logical group (and / or)
  if (f.and || f.or) {
    const op = f.and ? 'AND' : 'OR';
    const rawChildren = (f.and ?? f.or) as CubeInputFilter[];
    const children: PredicateNode[] = [];
    for (const child of rawChildren) {
      // A time-dimension filter (inDateRange / beforeDate / afterDate) inside
      // an OR group is illegal for segment semantics — the rolling-window logic
      // only applies at the top-level AND.
      if (op === 'OR' && isTimeDimFilter(child)) {
        return {
          ok: false,
          reason: 'time_leaf_in_or',
          hint:
            'A date-range filter inside an OR group cannot be stored in a segment. ' +
            'Move time constraints to the top-level AND, or restructure the query.',
        };
      }
      const result = translateFilter(child, op as 'AND' | 'OR', measureNames);
      if (!result.ok) return result;
      children.push(result.node);
    }
    const group: GroupNode = { kind: 'group', id: randomUUID(), op, children };
    return { ok: true, node: group };
  }

  // Leaf filter
  const member = f.member ?? f.dimension;
  if (!member) {
    return {
      ok: false,
      reason: 'missing_member',
      hint: 'A filter is missing a `member` or `dimension` field.',
    };
  }

  // Reject measure filters — segments act on dimension values, not aggregates.
  if (measureNames.size > 0 && measureNames.has(member)) {
    return {
      ok: false,
      reason: 'measure_filter',
      hint:
        `${member} is a measure; it cannot be used as a segment filter. ` +
        'Use propose_segment with a threshold or percentile instead.',
    };
  }

  const op = cubeToPredOp(f.operator ?? '');
  if (!op) {
    return {
      ok: false,
      reason: `unsupported_operator:${f.operator ?? ''}`,
      hint: `The filter operator "${f.operator}" has no equivalent predicate form.`,
    };
  }

  const type = inferType(member, f.values ?? []);
  const values = coerceValues(type, f.values ?? []);
  const leaf: LeafNode = { kind: 'leaf', id: randomUUID(), member, type, op, values };
  return { ok: true, node: leaf };
}

/** True when a filter looks like a time-dimension operator. */
function isTimeDimFilter(f: CubeInputFilter): boolean {
  const op = f.operator ?? '';
  return (
    op === 'inDateRange' ||
    op === 'notInDateRange' ||
    op === 'beforeDate' ||
    op === 'afterDate'
  );
}

/** Map a Cube operator string to its LeafOperator counterpart. */
function cubeToPredOp(op: string): LeafOperator | null {
  const MAP: Record<string, LeafOperator> = {
    equals: 'equals',
    notEquals: 'notEquals',
    contains: 'contains',
    notContains: 'notEquals',
    startsWith: 'contains',
    endsWith: 'contains',
    gt: 'gt',
    lt: 'lt',
    gte: 'gte',
    lte: 'lte',
    in: 'in',
    notIn: 'notIn',
    set: 'set',
    notSet: 'notSet',
    inDateRange: 'inDateRange',
    notInDateRange: 'notInDateRange',
    beforeDate: 'beforeDate',
    afterDate: 'afterDate',
  };
  return MAP[op] ?? null;
}

/** Infer the predicate value type from the member name and values. */
function inferType(member: string, values: string[]): LeafValueType {
  // Heuristic: if the member ends with common time-dimension suffixes or has
  // date-like values, treat as time. Otherwise numeric or string.
  const lower = member.toLowerCase();
  if (lower.endsWith('date') || lower.endsWith('time') || lower.endsWith('at')) {
    return 'time';
  }
  if (values.length > 0 && values.every((v) => !isNaN(Number(v)))) {
    return 'number';
  }
  return 'string';
}

/** Coerce string values from Cube into the appropriate JS type for the predicate. */
function coerceValues(type: LeafValueType, values: string[]): unknown[] {
  if (type === 'number') return values.map(Number);
  return values;
}
