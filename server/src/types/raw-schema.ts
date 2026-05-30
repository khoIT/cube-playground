/**
 * Shared types for the raw-warehouse onboarding pipeline.
 *
 * Phase 1 (introspection): TableMeta + ColumnProfile — what the Trino profiler
 *   returns for a raw schema.
 * Phase 2 (inference): InferredField + InferredSchema — the model skeleton the
 *   pure inference engine derives from a set of ColumnProfiles. (Added below so
 *   server + frontend share one contract.)
 *
 * No runtime behaviour here — types only. Zod contracts live next to the
 * scaffolder (cube-model.ts) where validation actually happens.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Introspection (Phase 1)
// ─────────────────────────────────────────────────────────────────────────────

/** One column as reported by `information_schema.columns`. */
export interface ColumnMeta {
  name: string;
  /** Raw Trino data type, e.g. `varchar`, `bigint`, `timestamp(3)`. */
  dataType: string;
  /** Ordinal position (1-based) — preserves source column order for the UI. */
  position: number;
  nullable: boolean;
}

/** Table-level metadata before profiling. */
export interface TableMeta {
  schema: string;
  table: string;
  columns: ColumnMeta[];
}

/**
 * Per-column statistical profile. Bounded — every field is derived from a
 * single capped query per table (approx_distinct, count, min/max, a sampled
 * distinct-value set), never a full scan when stats are available.
 */
export interface ColumnProfile {
  name: string;
  /** Raw Trino data type. */
  dataType: string;
  /** Fraction of rows where the column is NULL, 0–1. */
  nullPct: number;
  /** `approx_distinct(col)` — cardinality estimate. */
  approxDistinct: number;
  /** Total rows scanned for the estimate (the table's `count(*)`). */
  rowCount: number;
  /** approxDistinct ≈ rowCount (within tolerance) ⇒ likely a key. */
  isUnique: boolean;
  /** Min observed value, stringified (null when not applicable / unavailable). */
  min: string | null;
  /** Max observed value, stringified. */
  max: string | null;
  /** Small bounded set of distinct sample values (for UI + LLM grounding). */
  sampleValues: string[];
}

/** Result of profiling one table — what `profileTable` returns. */
export interface TableProfile {
  schema: string;
  table: string;
  rowCount: number;
  columns: ColumnProfile[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Inference (Phase 2) — populated by raw-schema-inference.ts
// ─────────────────────────────────────────────────────────────────────────────

/** Cube member role a column maps to. */
export type FieldRole = 'dimension' | 'measure' | 'time' | 'primary_key' | 'ignore';

/** Onboarding mode — feeds the inference prior. */
export type OnboardingMode = 'cold' | 'warm';

/** One classified column with a confidence + human-readable rationale. */
export interface InferredField {
  /** Source column name. */
  column: string;
  /** Raw Trino data type carried through for the scaffolder. */
  dataType: string;
  role: FieldRole;
  /** 0–1; the UI only surfaces low-confidence calls for review. */
  confidence: number;
  /** Short why-string shown as a tooltip in the triage canvas. */
  rationale: string;
  /** Suggested Cube aggregation for measures (sum/count/count_distinct…). */
  agg?: string;
}

/** A candidate join between two profiled tables. */
export interface InferredJoin {
  /** FK column on this cube. */
  fromColumn: string;
  /** Target cube (table) name. */
  toCube: string;
  /** Target PK column. */
  toColumn: string;
  relationship: 'many_to_one' | 'one_to_many' | 'one_to_one';
  confidence: number;
  rationale: string;
}

/** Inferred model skeleton for a single table → cube. */
export interface InferredCube {
  /** Cube name (slug of the table). */
  name: string;
  /** Source `schema.table` for `sql_table`. */
  sqlTable: string;
  fields: InferredField[];
  joins: InferredJoin[];
  /** Detected primary-key column, if any. */
  primaryKey: string | null;
}

/** Full inference output across one dataset's tables. */
export interface InferredSchema {
  schema: string;
  mode: OnboardingMode;
  cubes: InferredCube[];
}
