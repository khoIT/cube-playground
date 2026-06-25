/**
 * Feature Atlas — TypeScript shape of the data the page renders.
 * Mirrors src/feature-atlas/atlas.yaml (validated by validate-atlas.mjs).
 */

export type FeatureStatus = 'idea' | 'planned' | 'in-flight' | 'shipped' | 'deprecated';
export type FeatureHealth = 'healthy' | 'partial' | 'at-risk' | 'stale';
export type Effort = 'S' | 'M' | 'L' | 'XL';

export interface AtlasDirection {
  label: string;
  effort: Effort | null;
}

export interface AtlasLinks {
  plans: string[];
  code: string[];
  memory: string[];
}

export interface AtlasFeature {
  id: string;
  label: string;
  surfaceId: string;
  surfaceLabel: string;
  status: FeatureStatus;
  health: FeatureHealth;
  summary: string;
  drawbacks: string[];
  directions: AtlasDirection[];
  deps: string[];
  links: AtlasLinks;
  lastTouched: string | null;
}

export interface AtlasSurface {
  id: string;
  label: string;
  features: AtlasFeature[];
}

export interface AtlasModel {
  version: number;
  reconciledAt: string;
  surfaces: AtlasSurface[];
  /** Flat id→feature index for dep resolution. */
  featById: Map<string, AtlasFeature>;
  /** featureId → ids of features that depend on it (reverse deps / impact radius). */
  dependedOnBy: Map<string, string[]>;
}

/** Result of loading: either a parsed model or a human-readable error. */
export type AtlasLoadResult =
  | { ok: true; model: AtlasModel }
  | { ok: false; error: string };
