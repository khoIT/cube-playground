/**
 * Server-side preset types + the mf_users-hub preset, loaded from the shared
 * YAML bundle (./bundles/mf-users-hub.yml) — the single source of truth the FE
 * inlines at build time. Card-runner uses these specs to compose Cube queries
 * on refresh and write rendered rows to segment_card_cache; the FE hydrates by
 * the same `kpi:<id>` / `kpi:<tabId>:<id>` / `card:<tabId>:<cardId>` keys, so
 * sharing one file makes key/measure drift structurally impossible.
 */

import { loadPresetBundle } from './preset-bundles-loader.js';

export type FormatId = 'number' | 'percent' | 'currency' | 'duration' | 'compact';

export interface KpiSpec {
  id: string;
  label: string;
  measure: string;
  timeDimension?: string;
  dateRange?: string;
  format?: FormatId;
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

export interface CompositionCardSpec {
  kind: 'composition';
  id: string;
  label: string;
  measure: string;
  groupBy: string;
  limit?: number;
}

/** FE-rendered as a donut; query shape identical to bar/composition. */
export interface DonutCardSpec {
  kind: 'donut';
  id: string;
  label: string;
  measure: string;
  groupBy: string;
  limit?: number;
}

/** FE-rendered as a single stacked strip; query shape identical to bar/composition. */
export interface SegmentedBarCardSpec {
  kind: 'segmented-bar';
  id: string;
  label: string;
  measure: string;
  groupBy: string;
  limit?: number;
  footer?: string;
}

export type CardSpec =
  | LineCardSpec
  | BarListCardSpec
  | CompositionCardSpec
  | DonutCardSpec
  | SegmentedBarCardSpec;

/** Card kinds whose rows are a categorical count distribution (measure ×
 *  groupBy) — the set brief-context mines for top-N distributions. */
export const DISTRIBUTION_CARD_KINDS: ReadonlyArray<CardSpec['kind']> = [
  'composition',
  'segmented-bar',
  'donut',
];

export interface TabDef {
  id: string;
  label: string;
  kpis: KpiSpec[];
  cards: CardSpec[];
  /** FE layout hint; server ignores. */
  gridCols?: number;
}

export interface PresetSpec {
  id: string;
  hubCube: string;
  identityDim: string;
  /** Per-user LTV measure (logical name) used to rank members into
   *  top/middle/bottom tiers at refresh time. Absent → no tiered sampling for
   *  segments on this preset; the FE falls back to the random sample. */
  ltvMeasure?: string;
  /** Exact distinct-count measure used to size a cohort at refresh time — a
   *  single COUNT(DISTINCT) pushed to Trino, far cheaper than `total: true`
   *  over the identity projection. Logical name; absent → exact `total: true`. */
  sizeMeasure?: string;
  headlineKpis: KpiSpec[];
  tabs: TabDef[];
  // FE-only bundle fields, carried through untyped-loosely so one YAML shape
  // serves both sides; the server never reads them.
  label?: string;
  reachableCubes?: string[];
  memberColumns?: Array<Record<string, unknown>>;
}

export const mfUsersHubPreset: PresetSpec = loadPresetBundle('mf-users-hub');
