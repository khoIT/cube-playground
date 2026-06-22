/**
 * Translate a Cube query's filters array into an AND-group PredicateNode, with a
 * segmentability gate — the server-side counterpart of chat-service's
 * `utils/cube-query-to-predicate-tree.ts`.
 *
 * WHY a second copy: the two are separately-deployed Node services that already
 * duplicate the canonical contract (`types/predicate-tree.ts`). The chat path
 * runs the translator inside the `propose_segment` tool; the FE "Build segment
 * from this" bridge has no chat turn to ride on, so it calls a server endpoint
 * that needs the SAME gate. The two MUST stay in lockstep — any rule change here
 * must mirror chat-service and vice-versa (covered by round-trip tests).
 *
 * The gate is what makes an explored query *segmentable*. It rejects the shapes a
 * segment cannot legally represent and returns `{ ok: false, reason, hint }` so
 * the caller can hide the bridge (never emit a partial/lossy predicate):
 *
 *  - Measure filters: a segment acts on dimension values attached to entity rows;
 *    a measure filter would need a JOIN the refresh engine doesn't support.
 *  - `order` + `limit` without a ranked measure: "top-N by raw sort" is not a
 *    declarative predicate — the cut drifts as data ages. Use percentileGte.
 *  - A time leaf (inDateRange/beforeDate/afterDate) inside an OR group: our
 *    rolling-window semantics only hold for top-level AND leaves.
 */

import { randomUUID } from 'node:crypto';
import type {
  PredicateNode,
  LeafNode,
  GroupNode,
  LeafOperator,
  LeafValueType,
} from '../types/predicate-tree.js';

// ---------------------------------------------------------------------------
// Public contract
// ---------------------------------------------------------------------------

export type TranslateResult =
  | { ok: true; predicate: PredicateNode }
  | { ok: false; reason: string; hint: string };

export interface CubeQueryFilters {
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
 * @param measureNames - Set of known measure member names for validation. Pass an
 *                       empty Set to skip measure-filter detection.
 */
export function cubeQueryToPredicate(
  query: CubeQueryFilters,
  measureNames: Set<string> = new Set(),
): TranslateResult {
  const filters = query.filters ?? [];

  // order+limit without a ranked measure = "top-N by raw sort" → not declarative.
  const hasOrderLimit =
    (query.limit != null && query.limit > 0) ||
    (query.order != null && Object.keys(query.order as object).length > 0);
  if (hasOrderLimit) {
    const hasMeasureDim = (query.measures?.length ?? 0) > 0;
    if (!hasMeasureDim) {
      return {
        ok: false,
        reason: 'order_limit_without_measure',
        hint:
          'The query uses order+limit without a ranked measure. ' +
          'Convert to a percentileGte predicate instead.',
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

  // The root of a segment predicate tree is always a group, regardless of count.
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
      // A date-range leaf inside an OR group is illegal for segment semantics —
      // rolling-window logic only applies at the top-level AND.
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
        `${member} is a measure; it cannot be a segment filter. ` +
        'Use a threshold / percentile / top-N proposal for measure bounds instead.',
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
  return op === 'inDateRange' || op === 'notInDateRange' || op === 'beforeDate' || op === 'afterDate';
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
