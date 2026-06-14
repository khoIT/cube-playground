/**
 * Pure bidirectional translator between the canonical AND/OR predicate tree
 * and Cube Query.filters array format.
 *
 * No I/O — safe to call from routes, cron, or tests without side effects.
 */

import { v4 as uuidv4 } from 'uuid';
import { expandRelativeDateRange, expandAnniversaryWindows } from './expand-relative-date-range.js';
import { normalizeInDateRangeValues } from './normalize-in-date-range-values.js';
import type {
  PredicateNode,
  GroupNode,
  LeafNode,
  LeafOperator,
  RelativeDateValue,
  PercentileValue,
  CubeFilter,
  CubeLeafFilter,
  CubeLogicalFilter,
} from '../types/predicate-tree.js';

export class UnsupportedOperatorError extends Error {
  constructor(op: string, context = '') {
    super(`Unsupported operator: "${op}"${context ? ` (${context})` : ''}`);
    this.name = 'UnsupportedOperatorError';
  }
}

/**
 * Thrown when a percentile leaf reaches the Cube path without a pre-resolved
 * cutoff. Cube REST can't subquery, so callers must resolve cutoffs first (via
 * percentile-cutoff-resolver) and pass them in `TranslateOptions.resolvedPercentiles`.
 */
export class PercentileNotResolvedError extends Error {
  constructor(leafId: string, member: string) {
    super(`Percentile leaf ${leafId} (${member}) needs a resolved cutoff before Cube translation`);
    this.name = 'PercentileNotResolvedError';
  }
}

// Mapping from our canonical LeafOperator → Cube operator string.
// The derived-date and percentile ops are absent here — they transform their
// values (relative→absolute date; percentile→resolved scalar) and are handled
// explicitly in leafToCubeFilter before this lookup.
const TREE_TO_CUBE: Partial<Record<LeafOperator, string>> = {
  equals: 'equals',
  notEquals: 'notEquals',
  gt: 'gt',
  lt: 'lt',
  gte: 'gte',
  lte: 'lte',
  in: 'equals',        // Cube uses 'equals' for multi-value (IN)
  notIn: 'notEquals',  // Cube uses 'notEquals' for NOT IN
  contains: 'contains',
  set: 'set',
  notSet: 'notSet',
  inDateRange: 'inDateRange',
  notInDateRange: 'notInDateRange',
  beforeDate: 'beforeDate',
  afterDate: 'afterDate',
};

/** Days in a relative unit, for resolving derived-date offsets against an anchor. */
function offsetDate(anchor: Date, n: number, unit: RelativeDateValue['unit']): Date {
  const d = new Date(anchor);
  d.setHours(0, 0, 0, 0);
  if (unit === 'day') d.setDate(d.getDate() - n);
  else if (unit === 'week') d.setDate(d.getDate() - n * 7);
  else d.setMonth(d.getMonth() - n);
  return d;
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

// Reverse map: Cube operator → our canonical operator
// Some Cube operators map to multiple tree ops; context (single vs multi value) disambiguates
const CUBE_TO_TREE_BASE: Record<string, LeafOperator> = {
  equals: 'equals',
  notEquals: 'notEquals',
  gt: 'gt',
  lt: 'lt',
  gte: 'gte',
  lte: 'lte',
  contains: 'contains',
  set: 'set',
  notSet: 'notSet',
  inDateRange: 'inDateRange',
  notInDateRange: 'notInDateRange',
  beforeDate: 'beforeDate',
  afterDate: 'afterDate',
};

/**
 * Optional knobs for predicate→Cube translation.
 *   - anchorDate: the "as-of" date relative-window expansion resolves against,
 *     instead of real today. Lets a sweep over data that lags real time still
 *     bind `last N days` / `last N hours` windows to where the data actually
 *     ends. Undefined = today (the default for segments, drift, preview).
 */
export interface TranslateOptions {
  anchorDate?: Date;
  /**
   * Pre-resolved percentile cutoffs keyed by leaf id. A `percentileGte`/`percentileLte`
   * leaf compiles to a scalar `gte`/`lte` against its entry. Missing → PercentileNotResolvedError
   * (resolve via percentile-cutoff-resolver first; Cube REST can't subquery).
   */
  resolvedPercentiles?: Map<string, number>;
}

function leafToCubeFilter(
  node: LeafNode,
  anchorDate?: Date,
  resolvedPercentiles?: Map<string, number>,
): CubeFilter | null {
  // Derived relative-date: resolve to an absolute date against the anchor (today
  // when none supplied) and emit a plain after/before scalar so it composes with
  // the rest of the query exactly like a literal date bound.
  if (node.op === 'dateWithinLast' || node.op === 'dateBeforeLast') {
    const rel = node.values[0] as RelativeDateValue | undefined;
    if (!rel || typeof rel.n !== 'number') {
      console.warn(`[translator] Dropping ${node.op} for ${node.member}: missing {n,unit} value`);
      return null;
    }
    const boundary = isoDate(offsetDate(anchorDate ?? new Date(), rel.n, rel.unit));
    // "within last n" → col is on/after (anchor − n); "before last n" → on/before it.
    return {
      member: node.member,
      operator: node.op === 'dateWithinLast' ? 'afterDate' : 'beforeDate',
      values: [boundary],
    };
  }

  // Percentile: Cube REST can't subquery, so the cutoff must be resolved upstream
  // and passed in. Emit a scalar gte/lte against the resolved value.
  if (node.op === 'percentileGte' || node.op === 'percentileLte') {
    const cutoff = resolvedPercentiles?.get(node.id);
    if (cutoff == null) throw new PercentileNotResolvedError(node.id, node.member);
    return {
      member: node.member,
      operator: node.op === 'percentileGte' ? 'gte' : 'lte',
      values: [String(cutoff)],
    };
  }

  const cubeOp = TREE_TO_CUBE[node.op];
  if (!cubeOp) throw new UnsupportedOperatorError(node.op, `member=${node.member}`);

  // "anniversary" is not a contiguous range but a set of milestone days before
  // the as-of date, so it can't be one inDateRange — emit an OR of single-day
  // ranges (member's date ∈ any milestone day). Anchored on anchorDate when the
  // caller supplies one (a lagging data feed's last day), else today.
  if (node.op === 'inDateRange' && node.values.length === 1 && String(node.values[0]).trim().toLowerCase() === 'anniversary') {
    const days = expandAnniversaryWindows(anchorDate);
    return {
      or: days.map(([start, end]) => ({ member: node.member, operator: 'inDateRange', values: [start, end] })),
    };
  }

  // notInDateRange is the negation of inDateRange — same value shape (a 2-tuple
  // or a relative-window string), so both share the normalization/expansion below.
  const isDateRange = node.op === 'inDateRange' || node.op === 'notInDateRange';

  const filter: CubeLeafFilter = {
    member: node.member,
    operator: cubeOp,
  };

  // set/notSet carry no values
  if (node.op !== 'set' && node.op !== 'notSet') {
    // Authoring tools may wrap a date-range 2-tuple as `[[start, end]]`
    // (each element treated as one logical value). Flatten before
    // stringifying so the length-2 branch below accepts it.
    const rawValues = isDateRange ? normalizeInDateRangeValues(node.values) : node.values;
    filter.values = rawValues.map(String);
  }

  // (not)inDateRange requires exactly 2 ISO date strings. Authoring tools sometimes
  // stash a relative-range string ("this month", "last 7 days") as the only
  // value — Cube rejects those with "Invalid format: Invalid date". Expand the
  // recognized ones here; drop the filter (return null) when unrecoverable so
  // the rest of the query still runs.
  if (isDateRange) {
    const vals = filter.values ?? [];
    if (vals.length !== 2) {
      if (vals.length === 1) {
        const expanded = expandRelativeDateRange(vals[0], anchorDate);
        if (expanded) {
          filter.values = expanded;
          return filter;
        }
      }
      // Unrecognized → drop the filter so Cube doesn't 400.
      // eslint-disable-next-line no-console
      console.warn(
        `[translator] Dropping malformed ${node.op} filter for ${node.member}: ${JSON.stringify(vals)}`,
      );
      return null;
    }
  }

  return filter;
}

function nodeToCubeFilter(
  node: PredicateNode,
  anchorDate?: Date,
  resolvedPercentiles?: Map<string, number>,
): CubeFilter | null {
  if (node.kind === 'leaf') return leafToCubeFilter(node, anchorDate, resolvedPercentiles);

  const childFilters = node.children
    .map((child) => nodeToCubeFilter(child, anchorDate, resolvedPercentiles))
    .filter((f): f is CubeFilter => f != null);
  // If all children dropped (e.g. malformed date filters), drop this group too.
  if (childFilters.length === 0) return null;
  if (node.op === 'AND') return { and: childFilters };
  return { or: childFilters };
}

/**
 * Translate predicate tree → flat Cube Query.filters array.
 *
 * Root AND group is flattened to a top-level array (Cube implicit AND).
 * Nested OR/AND groups become { or: [...] } / { and: [...] } objects.
 * Malformed leaf filters (e.g. inDateRange with an unparseable single value)
 * are dropped with a warning so the rest of the query still runs.
 */
export function treeToCubeFilters(tree: PredicateNode, opts: TranslateOptions = {}): CubeFilter[] {
  const { anchorDate, resolvedPercentiles } = opts;
  if (tree.kind === 'leaf') {
    const f = leafToCubeFilter(tree, anchorDate, resolvedPercentiles);
    return f ? [f] : [];
  }

  if (tree.op === 'AND') {
    // Root AND: each child becomes a top-level filter entry
    return tree.children
      .map((child) => nodeToCubeFilter(child, anchorDate, resolvedPercentiles))
      .filter((f): f is CubeFilter => f != null);
  }

  // Root OR: wrap everything in { or: [...] }
  const orChildren = tree.children
    .map((child) => nodeToCubeFilter(child, anchorDate, resolvedPercentiles))
    .filter((f): f is CubeFilter => f != null);
  if (orChildren.length === 0) return [];
  return [{ or: orChildren }];
}

// ---------------------------------------------------------------------------
// Inverse: Cube filters → predicate tree
// ---------------------------------------------------------------------------

function isLogical(f: CubeFilter): f is CubeLogicalFilter {
  return 'and' in f || 'or' in f;
}

function cubeFilterToNode(f: CubeFilter): PredicateNode {
  if (!isLogical(f)) {
    const leaf = f as CubeLeafFilter;
    const op = CUBE_TO_TREE_BASE[leaf.operator];
    if (!op) throw new UnsupportedOperatorError(leaf.operator, `member=${leaf.member}`);

    // Disambiguate equals/notEquals: multi-value → in/notIn
    let resolvedOp: LeafOperator = op;
    if (op === 'equals' && leaf.values && leaf.values.length > 1) resolvedOp = 'in';
    if (op === 'notEquals' && leaf.values && leaf.values.length > 1) resolvedOp = 'notIn';

    return {
      kind: 'leaf',
      id: uuidv4(),
      member: leaf.member,
      type: 'string', // type is unknown from Cube filters alone; default string
      op: resolvedOp,
      values: leaf.values ?? [],
    };
  }

  const logical = f as CubeLogicalFilter;
  if (logical.and) {
    return {
      kind: 'group',
      id: uuidv4(),
      op: 'AND',
      children: logical.and.map(cubeFilterToNode),
    };
  }
  if (logical.or) {
    return {
      kind: 'group',
      id: uuidv4(),
      op: 'OR',
      children: logical.or.map(cubeFilterToNode),
    };
  }

  throw new UnsupportedOperatorError('unknown', 'empty logical filter');
}

/**
 * Translate flat Cube Query.filters → predicate tree.
 *
 * Multiple top-level filters are wrapped in a root AND group (Cube implicit AND).
 * A single logical filter at root is used directly as root.
 */
export function cubeFiltersToTree(filters: CubeFilter[]): PredicateNode {
  if (filters.length === 0) {
    return { kind: 'group', id: uuidv4(), op: 'AND', children: [] };
  }

  if (filters.length === 1) {
    return cubeFilterToNode(filters[0]);
  }

  return {
    kind: 'group',
    id: uuidv4(),
    op: 'AND',
    children: filters.map(cubeFilterToNode),
  };
}
