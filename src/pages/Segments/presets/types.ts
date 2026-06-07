/**
 * Preset definition types — schema-agnostic declarative bundles of
 * KPI specs + card specs per analysis tab. v1 ships a single preset
 * for `mf_users-hub`; the renderer is generic.
 */

export type FormatId = 'number' | 'percent' | 'currency' | 'duration' | 'compact';

export interface KpiSpec {
  id: string;
  label: string;
  /** Cube measure name e.g. `mf_users.dau`. */
  measure: string;
  /** Optional time dimension for the measure (e.g. `mf_users.event_date`). */
  timeDimension?: string;
  /** ISO date range string like `last 30 days`. */
  dateRange?: string;
  format?: FormatId;
  unit?: string;
  /** Compared against the previous equal-length period. */
  delta?: boolean;
}

export interface LineCardSpec {
  kind: 'line';
  id: string;
  label: string;
  measure: string;
  timeDimension: string;
  granularity?: 'day' | 'week' | 'month';
  dateRange?: string;
  format?: FormatId;
  height?: number;
}

export interface BarListCardSpec {
  kind: 'bar';
  id: string;
  label: string;
  measure: string;
  groupBy: string;
  limit?: number;
  format?: FormatId;
}

export interface DonutCardSpec {
  kind: 'donut';
  id: string;
  label: string;
  measure: string;
  groupBy: string;
  limit?: number;
}

export interface CompositionCardSpec {
  kind: 'composition';
  id: string;
  label: string;
  measure: string;
  groupBy: string;
  limit?: number;
}

/** Single horizontal stacked bar with % legend — used for lifecycle / spend
 *  tier composition strips where a donut would waste space. */
export interface SegmentedBarCardSpec {
  kind: 'segmented-bar';
  id: string;
  label: string;
  measure: string;
  groupBy: string;
  limit?: number;
  /** Optional helper line below the legend, e.g. "Avg LTV: $50.44". */
  footer?: string;
}

export type CardSpec =
  | LineCardSpec
  | BarListCardSpec
  | DonutCardSpec
  | CompositionCardSpec
  | SegmentedBarCardSpec;

export interface TabDef {
  id: string;
  label: string;
  kpis: KpiSpec[];
  cards: CardSpec[];
  /** Grid columns hint for layout. Defaults to 2. */
  gridCols?: 1 | 2 | 3;
}

/**
 * One column rendered on the Members tab alongside the user identifier.
 *
 * Exactly one of `dimension` or `measure` must be set:
 *   - `dimension` (e.g. `mf_users.lifecycle_stage`) — flat per-row field,
 *     used when the hub cube is a per-user dimensional table.
 *   - `measure` (e.g. `recharge.revenue_vnd`) — aggregated per user; required
 *     for event cubes where there is no flat per-user denormalization.
 *
 * `use-member-dim-rows` collects dim columns into the query's `dimensions`
 * and measure columns into `measures`, with the identity dim always included
 * in `dimensions` so the aggregate is grouped per user.
 */
export interface MemberColumnSpec {
  id: string;
  label: string;
  /** Cube dimension name. */
  dimension?: string;
  /** Cube measure name; rendered as an aggregate grouped by the identity dim. */
  measure?: string;
  format?: FormatId;
  /** Optional max char width to truncate string-y values. */
  truncate?: number;
  /** Behavior-cube measures whose model REQUIRES a bounded time window
   *  (event cubes reject unbounded queries). Columns carrying this are fetched
   *  in a SEPARATE query bound to this time dimension over `dateRange` —
   *  bundling them unbounded fails the whole enrichment query and blanks
   *  every member column. */
  boundTimeDimension?: string;
  /** Cube relative date range for the bounded query (default 'last 30 days'). */
  dateRange?: string;
}

export interface Preset {
  id: string;
  label: string;
  hubCube: string;
  identityDim: string;
  reachableCubes: string[];
  headlineKpis: KpiSpec[];
  tabs: TabDef[];
  /** Optional per-member info shown alongside uid on the Members tab. */
  memberColumns?: MemberColumnSpec[];
  /** True when this preset was synthesized from Cube /meta (no curated bundle).
   *  Consumers should surface a "best-effort" hint so users know the content
   *  is auto-generated and not hand-tuned. */
  auto?: boolean;
  /** Set when this preset was PIVOTED from another cube: the segment's own
   *  cube has no curated preset, but its identity is join-inherited from this
   *  preset's hub cube (e.g. `etl_money_flow` → `mf_users`), so the anchor's
   *  user-centric preset is reused. Holds the segment's original cube name so
   *  consumers can explain the pivot in a banner. */
  pivotedFromCube?: string;
}
