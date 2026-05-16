import { BinaryFilter, UnaryFilter } from '@cubejs-client/core';

// Operation types supported by the wizard
export type Operation =
  | 'sum'
  | 'count'
  | 'countDistinct'
  | 'avg'
  | 'min'
  | 'max'
  | 'ratio';

// Display format for the new metric
export type Format = 'number' | 'currency' | 'percent';

// Single source of truth for wizard form state
export type NewMetricDraft = {
  sourceCube: string | null;
  operation: Operation;
  ofMember: string | null;       // e.g. "users.id"
  ofMemberB: string | null;      // only used when operation === 'ratio'
  filter: BinaryFilter | UnaryFilter | null;
  name: string;                  // snake_case identifier
  title: string;
  description: string;
  format: Format;
  tags: string[];                // free-form, case-sensitive; emitted as meta.tags
  previewTimeDimension: string | null; // qualified, e.g. "orders.created_at"
  previewRange: '7d' | '30d';
};

// Per-field validation errors; isValid is false when any field has an error
export type ValidationResult = {
  isValid: boolean;
  errors: Partial<Record<keyof NewMetricDraft, string>>;
};
