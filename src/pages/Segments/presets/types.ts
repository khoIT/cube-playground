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

export type CardSpec =
  | LineCardSpec
  | BarListCardSpec
  | DonutCardSpec
  | CompositionCardSpec;

export interface TabDef {
  id: string;
  label: string;
  kpis: KpiSpec[];
  cards: CardSpec[];
  /** Grid columns hint for layout. Defaults to 2. */
  gridCols?: 1 | 2 | 3;
}

export interface MemberColumnSpec {
  id: string;
  label: string;
  /** Cube dimension name (e.g. `mf_users.ltv_total_vnd`). */
  dimension: string;
  format?: FormatId;
  /** Optional max char width to truncate string-y values. */
  truncate?: number;
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
}
