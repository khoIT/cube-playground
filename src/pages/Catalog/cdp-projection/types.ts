/**
 * Types for the CDP projection module.
 *
 * `CdpMetricPayload` mirrors MM-01-CRUD `CreateMetricRequest` minus the
 * `materialize` / `schedule` knobs (deferred). `ProjectionResult` is the
 * discriminated union returned by `projectMeasure(...)`.
 */

export type CdpMetricPayload = {
  game_id: string;
  metric_name: string;
  metric_codename: string;
  source: string;
  expression: string;
  dimensions: string[];
  filter: string;
};

export type NotProjectableReason =
  | 'references-other-measures'
  | 'not-single-source'
  | 'missing-cube-meta'
  | 'unsupported-agg-type';

export type ProjectionResult =
  | { ok: true; payload: CdpMetricPayload }
  | { ok: false; reason: NotProjectableReason; detail?: string };

export type VerifyDiffEntry = {
  field: string;
  expected: unknown;
  actual: unknown;
};

export type VerifyState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available' }
  | { kind: 'missing' }
  | { kind: 'mismatch'; diff: VerifyDiffEntry[] }
  | { kind: 'error'; message: string };

/**
 * Loose Measure shape sourced from Cube `/meta?extended=true`. The Cube
 * client SDK doesn't expose the extended-meta shape in its public types,
 * so we keep our own minimal definition. Fields that aren't relevant to
 * projection are intentionally absent.
 */
export type ProjectableMeasure = {
  name: string;
  title?: string;
  aggType?: string;
  type?: string;
  sql?: string;
  filters?: Array<{ sql: string }>;
  public?: boolean;
  meta?: { source?: string; [k: string]: unknown };
};

export type ProjectableDimension = {
  name: string;
  type?: string;
  primaryKey?: boolean;
  public?: boolean;
};

/**
 * Cube shape consumed by the projection mapper — superset of the
 * `CatalogCube` exported from `use-catalog-meta.ts` (with the optional
 * `meta.{game_id,cdp_source}` block added in P3).
 */
export type ProjectableCube = {
  name: string;
  measures: ProjectableMeasure[];
  dimensions: ProjectableDimension[];
  type?: 'cube' | 'view';
  meta?: { game_id?: string; cdp_source?: string; [k: string]: unknown };
};
