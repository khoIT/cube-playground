/**
 * Canonical AND/OR predicate tree — the authoritative form stored in segments.
 * Translated to/from Cube Query.filters by services/translator.ts.
 */

export type LeafOperator =
  | 'equals'
  | 'notEquals'
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte'
  | 'in'
  | 'notIn'
  | 'contains'
  | 'set'
  | 'notSet'
  | 'inDateRange'
  | 'notInDateRange'
  | 'beforeDate'
  | 'afterDate'
  // Derived relative-date — resolved to an absolute date at compile time against
  // an as-of anchor (so a sweep over lagging data stays reproducible). These
  // express tenure / recency on a date column without a stored "days old" field:
  // `dateWithinLast {n,unit}` = col is within the last n units (>= anchor−n);
  // `dateBeforeLast {n,unit}` = col is older than n units ago (<= anchor−n).
  | 'dateWithinLast'
  | 'dateBeforeLast'
  // Statistical / percentile — two-pass: a cutoff-resolution query computes the
  // value at the p-th percentile of the reference population, then the leaf
  // compiles to a scalar `gte`/`lte` against that cutoff. Cube REST can't
  // subquery, so the Cube path needs the cutoff pre-resolved; the raw-SQL path
  // can inline the `approx_percentile(...)` subquery directly.
  | 'percentileGte'
  | 'percentileLte';

export type LeafValueType = 'string' | 'number' | 'time' | 'boolean';

/** Value carried by `dateWithinLast` / `dateBeforeLast` — a relative offset. */
export interface RelativeDateValue {
  n: number;
  unit: 'day' | 'week' | 'month';
}

/**
 * Reference population a percentile cutoff is computed over — NOT the target
 * cohort (else "top quartile" is circular). Defaults to the full population of
 * the leaf member's source. For the raw-SQL path `table` + `column` are required
 * so the inline subquery has an explicit FROM.
 */
export interface PopulationRef {
  /** Fully-qualified source table the distribution is drawn from (SQL path). */
  table?: string;
  /** Column the percentile is taken over; defaults to the leaf member. */
  column?: string;
  // NOTE: no free-text SQL gate here on purpose. A restricted population (e.g.
  // "top quartile *among payers*") must be expressed as a structured sub-predicate
  // compiled through predicateToSql, never a raw fragment — otherwise the cutoff
  // query is an injection surface for the user-controlled predicate tree.
}

/** Value carried by `percentileGte` / `percentileLte`. */
export interface PercentileValue {
  /** Percentile in (0,100), e.g. 75 to select at/above the top-quartile cutoff. */
  p: number;
  /** Population the cutoff is computed over; default = member's full population. */
  over?: PopulationRef;
}

export interface LeafNode {
  kind: 'leaf';
  id: string;
  member: string;
  type: LeafValueType;
  op: LeafOperator;
  values: unknown[];
}

export interface GroupNode {
  kind: 'group';
  id: string;
  op: 'AND' | 'OR';
  children: PredicateNode[];
}

export type PredicateNode = GroupNode | LeafNode;

// Cube filter shapes used in translation
export interface CubeLeafFilter {
  member: string;
  operator: string;
  values?: string[];
}

export interface CubeLogicalFilter {
  and?: CubeFilter[];
  or?: CubeFilter[];
}

export type CubeFilter = CubeLeafFilter | CubeLogicalFilter;
