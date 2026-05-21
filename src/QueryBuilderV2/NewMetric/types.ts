import { BinaryFilter, UnaryFilter } from '@cubejs-client/core';
import type { FilterGroup, FilterLeaf } from './filter-tree';

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
  | 'percentile'
  | 'weightedAvg'
  | 'formula';

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

// ---------------------------------------------------------------------------
// V3 — adds artifactKind discriminator + kind-specific sub-state.
// ---------------------------------------------------------------------------
//
// The wizard authors three kinds of YAML entry: a Cube `measure`, a `dimension`,
// or a `segment`. Dimensions further split into four sub-kinds. Segment authoring
// reuses the existing `filterTree` from V2 (segment SQL = flattened filter tree).
//
// V2 callers stay typed-correctly: `artifactKind` defaults to `'measure'` in the
// reducer + migration so existing code paths don't need updates.

export type ArtifactKind = 'measure' | 'dimension' | 'segment';

export type DimKind = 'banding' | 'time-since' | 'passthrough' | 'boolean';

// One band row in a banding dimension. Used by `case.when[]` in the emitted YAML.
export type BandingRow = {
  /** Condition SQL; uses `{CUBE}.<column>` template form. */
  sql: string;
  /** Label this band resolves to (e.g. `whale`, `dolphin`). */
  label: string;
};

export type DimBuilder =
  | {
      kind: 'banding';
      /** Underlying column referenced by the band conditions. */
      column: string | null;
      /** Ordered band list — first match wins. */
      bands: BandingRow[];
      /** Fall-through label when no band matches. */
      elseLabel: string;
    }
  | {
      kind: 'time-since';
      /** Time-typed column (e.g. `install_date`). */
      timeColumn: string | null;
      /** Diff unit in Cube's `DATE_DIFF`. */
      unit: 'day' | 'hour' | 'month';
    }
  | {
      kind: 'passthrough';
      column: string | null;
      /** Cube type emitted (`string` | `number` | `boolean` | `time`). */
      outputType: 'string' | 'number' | 'boolean' | 'time';
    }
  | {
      kind: 'boolean';
      /** Single-leaf predicate; same shape as a filter-tree leaf. The generator
       *  rejects raw SQL — only `FilterLeaf`-shaped values reach YAML. */
      predicate: FilterLeaf | null;
    };

export type NewMetricDraftV3 = NewMetricDraftV2 & {
  artifactKind: ArtifactKind;
  /** Selected dim sub-kind. Only set when `artifactKind === 'dimension'`. */
  dimKind?: DimKind;
  /** Active dim builder state. Only set when `artifactKind === 'dimension'`. */
  dimBuilder?: DimBuilder;
  /**
   * Active game scope at draft creation time. Stamped into the emitted
   * `meta.game_id` so liveops surfaces can filter by game. Null/undefined =
   * unscoped (legacy drafts that pre-date the field, or contexts where the
   * game-picker hasn't resolved yet).
   */
  gameId?: string | null;
};

// Per-field validation errors; isValid is false when any field has an error.
export type ValidationResult = {
  isValid: boolean;
  errors: Partial<Record<keyof NewMetricDraft | 'filterTree' | 'grain' | 'visibility' | `inputs.${string}`, string>>;
};
