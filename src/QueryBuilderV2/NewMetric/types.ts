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

// v1 — kept for back-compat with the legacy NewMetricDialog until P8 deletion.
export type NewMetricDraft = {
  sourceCube: string | null;
  operation: Operation;
  ofMember: string | null;
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

// v2 — full-page wizard draft. Adds filterTree, grain, visibility, column field.
// `ofMember` is renamed conceptually to `column` for the new flow but the field
// name `ofMember` is retained for emitter compatibility.
export type NewMetricDraftV2 = NewMetricDraft & {
  filterTree: FilterGroup;
  grain: Grain;
  visibility: Visibility;
  // P7 test-run state lives in its own ephemeral slot, not in the persisted draft.
};

// Per-field validation errors; isValid is false when any field has an error.
export type ValidationResult = {
  isValid: boolean;
  errors: Partial<Record<keyof NewMetricDraft | 'filterTree' | 'grain' | 'visibility', string>>;
};
