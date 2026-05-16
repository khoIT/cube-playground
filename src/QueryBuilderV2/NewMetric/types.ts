import { BinaryFilter, UnaryFilter } from '@cubejs-client/core';
import type { FilterGroup } from './filter-tree';

// Operation types supported by the wizard.
// `median` + `percentile` are added in P3 (advanced segment).
// Custom SQL operation is intentionally NOT included — see plan red-team #24.
export type Operation =
  | 'sum'
  | 'count'
  | 'countDistinct'
  | 'avg'
  | 'min'
  | 'max'
  | 'ratio'
  | 'median'
  | 'percentile';

// Display format for the new metric.
// Extended in P6 to match the 5-option select (currency-vnd / currency-usd / duration).
export type Format =
  | 'number'
  | 'currency'         // v1 alias kept for back-compat
  | 'currency-vnd'
  | 'currency-usd'
  | 'percent'
  | 'duration';

export type Grain = 'hourly' | 'daily' | 'weekly' | 'monthly';
export type Visibility = 'team' | 'org' | 'private';

// Draft shape. The canonical multi-source / N-slot shape is `sourceCubes` +
// `inputs`. The legacy single-source fields `sourceCube`/`ofMember`/`ofMemberB`
// are kept in lock-step via the `useNewMetricDraft` reducer so the legacy
// NewMetricDialog flow keeps compiling without being rewritten end-to-end.
//
// New (full-page) code should prefer `sourceCubes` and `inputs`. Dialog code
// keeps reading the legacy fields as before.
export type NewMetricDraft = {
  /** Canonical multi-source field. `sourceCubes[0]` is the primary cube. */
  sourceCubes: string[];
  /** @deprecated synced from `sourceCubes[0]`. Read for dialog compat only. */
  sourceCube: string | null;

  operation: Operation;

  /**
   * Canonical N-slot inputs. Keys are slot ids (e.g. `value`, `numerator`,
   * `denominator`). Values are reachable-member names like `cube_a.measure_a`.
   */
  inputs: Record<string, string | null>;
  /** @deprecated synced from `inputs[primarySlotIdFor(operation)]`. */
  ofMember: string | null;
  /** @deprecated synced from `inputs.denominator`. */
  ofMemberB: string | null;

  filter: BinaryFilter | UnaryFilter | null;
  name: string;
  title: string;
  description: string;
  format: Format;
  tags: string[];
  previewTimeDimension: string | null;
  previewRange: '7d' | '30d';
};

// v2 — full-page wizard draft. Adds filterTree, grain, visibility.
export type NewMetricDraftV2 = NewMetricDraft & {
  filterTree: FilterGroup;
  grain: Grain;
  visibility: Visibility;
};

// Per-field validation errors; isValid is false when any field has an error.
export type ValidationResult = {
  isValid: boolean;
  errors: Partial<Record<keyof NewMetricDraft | 'filterTree' | 'grain' | 'visibility' | `inputs.${string}`, string>>;
};
