/**
 * Pure inference: raw column profiles → an inferred Cube-model skeleton.
 *
 * No I/O — deterministic on fixed input, so it is exhaustively unit-testable
 * (Phase 08). Every decision carries a 0–1 confidence + a short rationale; the
 * triage UI auto-accepts high-confidence calls and only surfaces the rest.
 *
 * Heuristics (tuned constants centralized in THRESHOLDS):
 *   - time      : date/timestamp/time data type.
 *   - primary_key: isUnique (approxDistinct ≈ rowCount) AND id-shaped name.
 *   - dimension : low-cardinality string/enum/boolean, or a key/FK column.
 *   - measure   : numeric, high-cardinality, not an id.
 *   - join      : `<stem>_id` whose stem matches another table's name/PK.
 *
 * `mode` is the onboarding prior: warm-start (imitate sibling cubes) nudges
 * ambiguous numeric columns toward measures; cold-start stays conservative.
 */

import type {
  ColumnProfile,
  TableProfile,
  InferredField,
  InferredJoin,
  InferredCube,
  InferredSchema,
  OnboardingMode,
  FieldRole,
} from '../types/raw-schema.js';

export const THRESHOLDS = {
  /** approxDistinct/rowCount below this on a string ⇒ enum-like dimension. */
  enumDistinctRatio: 0.1,
  /** approxDistinct/rowCount above this on a number ⇒ measure-like. */
  measureDistinctRatio: 0.3,
  /** Min confidence to auto-accept without DA review. */
  autoAccept: 0.8,
} as const;

const TIME_TYPE = /^(date|timestamp|time)/i;
const NUMERIC_TYPE = /^(bigint|integer|smallint|tinyint|double|real|decimal)/i;
const BOOL_TYPE = /^boolean/i;
const ID_NAME = /(^id$|_id$|_key$|^id_)/i;
/** Names that are numeric but identifiers, not measures. */
const ID_LIKE_NUMERIC = /(_id$|^id$|_code$|_no$|_num$|year$|month$|day$|_ts$|timestamp)/i;
/** Names that strongly read as additive measures. */
const MEASURE_NAME = /(amount|amt|count|cnt|total|sum|qty|quantity|revenue|price|value|score|duration|sec|seconds|ms|size|bytes|level|exp|gold|coin|gem|spend)/i;

function ratio(p: ColumnProfile): number {
  return p.rowCount > 0 ? p.approxDistinct / p.rowCount : 0;
}

/** Suggest a Cube aggregation for a measure column. */
function aggFor(p: ColumnProfile): string {
  const n = p.name.toLowerCase();
  if (/(count|cnt|_num$)/.test(n)) return 'sum';
  if (/(rate|ratio|avg|average|pct|percent)/.test(n)) return 'avg';
  return 'sum';
}

/** Detect whether a column is the table's primary key. */
function isPrimaryKey(p: ColumnProfile, table: string): { ok: boolean; confidence: number } {
  if (!p.isUnique) return { ok: false, confidence: 0 };
  const n = p.name.toLowerCase();
  const idShaped = n === 'id' || n === `${table.toLowerCase()}_id` || ID_NAME.test(n);
  if (idShaped) return { ok: true, confidence: 0.95 };
  // Unique but oddly named — still a PK candidate, lower confidence.
  return { ok: true, confidence: 0.6 };
}

/** Classify one column into a role with confidence + rationale. */
function classifyColumn(p: ColumnProfile, table: string): InferredField {
  const base = { column: p.name, dataType: p.dataType };
  const r = ratio(p);

  // 1. Time dimensions — type-driven, high confidence.
  if (TIME_TYPE.test(p.dataType)) {
    return { ...base, role: 'time', confidence: 0.95, rationale: `${p.dataType} → time dimension` };
  }

  // 2. Primary key.
  const pk = isPrimaryKey(p, table);
  if (pk.ok) {
    return {
      ...base,
      role: 'primary_key',
      confidence: pk.confidence,
      rationale: `unique (${(r * 100).toFixed(0)}% distinct) + id-shaped name`,
    };
  }

  // 3. Booleans → low-cardinality dimensions.
  if (BOOL_TYPE.test(p.dataType)) {
    return { ...base, role: 'dimension', confidence: 0.9, rationale: 'boolean → dimension' };
  }

  // 4. Numeric: measure vs identifier vs categorical code.
  if (NUMERIC_TYPE.test(p.dataType)) {
    if (ID_LIKE_NUMERIC.test(p.name)) {
      return { ...base, role: 'dimension', confidence: 0.7, rationale: 'numeric id/code → dimension' };
    }
    if (MEASURE_NAME.test(p.name) || r >= THRESHOLDS.measureDistinctRatio) {
      const conf = MEASURE_NAME.test(p.name) ? 0.85 : 0.65;
      return { ...base, role: 'measure', confidence: conf, rationale: 'numeric, high-cardinality → measure', agg: aggFor(p) };
    }
    // Low-cardinality numeric — ambiguous (could be a code or a coarse measure).
    return { ...base, role: 'dimension', confidence: 0.55, rationale: 'low-cardinality numeric → dimension (review)', };
  }

  // 5. Strings: enum-like → dimension; high-cardinality free text → dimension (low conf).
  if (r <= THRESHOLDS.enumDistinctRatio) {
    return { ...base, role: 'dimension', confidence: 0.85, rationale: `enum-like string (${(r * 100).toFixed(0)}% distinct)` };
  }
  if (ID_NAME.test(p.name)) {
    return { ...base, role: 'dimension', confidence: 0.75, rationale: 'id-shaped string → dimension/FK' };
  }
  return { ...base, role: 'dimension', confidence: 0.5, rationale: 'high-cardinality string → dimension (review)' };
}

/** Apply the warm-start prior: nudge ambiguous numerics toward measures. */
function applyModePrior(field: InferredField, mode: OnboardingMode): InferredField {
  if (mode !== 'warm') return field;
  if (field.role === 'dimension' && /low-cardinality numeric/.test(field.rationale)) {
    return { ...field, role: 'measure', confidence: 0.6, agg: 'sum', rationale: `${field.rationale} — warm-start prefers measure` };
  }
  return field;
}

/** Infer join candidates from `<stem>_id` columns matching another table. */
function inferJoins(
  table: string,
  fields: InferredField[],
  pkByTable: Map<string, string>,
  tableNames: Set<string>,
): InferredJoin[] {
  const joins: InferredJoin[] = [];
  for (const f of fields) {
    if (f.role === 'primary_key') continue; // a table's own PK is never a FK
    const m = /^(.*)_id$/i.exec(f.column);
    if (!m) continue;
    const stem = m[1].toLowerCase();
    if (stem === table.toLowerCase()) continue; // own PK, not a FK
    // Match stem against ANOTHER table name (singular/plural tolerant).
    const target = [...tableNames].find(
      (t) =>
        t.toLowerCase() !== table.toLowerCase() &&
        (t.toLowerCase() === stem || t.toLowerCase() === `${stem}s` || `${t.toLowerCase()}s` === stem),
    );
    if (!target) continue;
    const toColumn = pkByTable.get(target) ?? `${stem}_id`;
    joins.push({
      fromColumn: f.column,
      toCube: target,
      toColumn,
      relationship: 'many_to_one',
      confidence: pkByTable.has(target) ? 0.8 : 0.55,
      rationale: `${f.column} matches ${target}.${toColumn}`,
    });
  }
  return joins;
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * Infer a full model skeleton across a dataset's profiled tables.
 * `mode` selects the inference prior (cold = conservative, warm = imitate).
 */
export function inferSchema(profiles: TableProfile[], mode: OnboardingMode = 'cold'): InferredSchema {
  const tableNames = new Set(profiles.map((t) => t.table));

  // First pass: classify columns + detect each table's PK.
  const classified = new Map<string, InferredField[]>();
  const pkByTable = new Map<string, string>();
  for (const t of profiles) {
    const fields = t.columns.map((c) => applyModePrior(classifyColumn(c, t.table), mode));
    classified.set(t.table, fields);
    const pk = fields.find((f) => f.role === 'primary_key');
    if (pk) pkByTable.set(t.table, pk.column);
  }

  // Second pass: joins (needs every table's PK known first).
  const cubes: InferredCube[] = profiles.map((t) => {
    const fields = classified.get(t.table)!;
    const joins = inferJoins(t.table, fields, pkByTable, tableNames);
    return {
      name: slug(t.table),
      sqlTable: t.table,
      fields,
      joins,
      primaryKey: pkByTable.get(t.table) ?? null,
    };
  });

  return { schema: profiles[0]?.schema ?? '', mode, cubes };
}

/** True when a field/join is confident enough to skip DA review. */
export function isAutoAccept(confidence: number): boolean {
  return confidence >= THRESHOLDS.autoAccept;
}

export type { FieldRole };
