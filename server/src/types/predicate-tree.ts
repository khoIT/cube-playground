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
  /**
   * Restricts the reference population the cutoff is computed over (e.g. "top
   * quartile *among payers*" → `{ recharge_col > 0 }`). REQUIRED for spend-like
   * distributions where free users dominate: an unscoped percentile of recharge
   * is 0 (the median row spent nothing), so the cutoff selects everyone. This is
   * a structured sub-predicate compiled through predicateToSql into the cutoff
   * query's WHERE — never a raw fragment, so the user-controlled predicate tree
   * is not an injection surface (the same posture as the rest of this module).
   */
  filter?: PredicateNode;
  /**
   * For sources whose physical table carries MORE THAN ONE row per real user
   * (e.g. jus's dual identity-namespace mart), the percentile must be taken over
   * the merged per-user grain — matching the cube's own `split_part(id,'@',1) …
   * GROUP BY` collapse — or it double-counts and the cutoff drifts off-cohort.
   * The transform is a server-owned enum (NOT raw SQL), so this stays
   * injection-free. Omit for clean one-row-per-user tables (the common case).
   */
  identityMerge?: IdentityMerge;
}

/** Server-owned per-user collapse for multi-row identity marts. */
export interface IdentityMerge {
  /** Raw identity column to normalize + group by (validated identifier). */
  idColumn: string;
  /** Known normalization applied before grouping. `split_part_at` → split_part(id,'@',1). */
  transform: 'split_part_at';
  /** Per-user aggregate for the value/filter columns. Default 'max' (mirrors the cube). */
  agg?: 'max' | 'sum';
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
