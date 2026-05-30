/**
 * Cube-model scaffolder: an accepted `InferredSchema` → a Zod-valid Cube model
 * object + its YAML serialization, in cube-dev's exact key style.
 *
 * Doctrine mirrors `metric-stub-scaffolder.ts` (Zod-valid draft, collision
 * suffix) but emits a DIFFERENT artifact — a Cube data-model, not a business
 * metric — in its own module. Intentionally NOT coupled to that file.
 *
 * Pure: no disk I/O. Persistence + write-back live in Phase 04/05.
 *
 * Role → Cube member mapping:
 *   primary_key → dimension { type, primary_key: true }
 *   time        → dimension { type: time }   (sql wrapped to TIMESTAMP — see note)
 *   dimension   → dimension { type: string|number|boolean }
 *   measure     → measure   { type: <agg>, sql }   + always a default `count`.
 *   join        → joins[] { name, relationship, sql }
 */

import { dump } from 'js-yaml';
import type { InferredCube, InferredField, InferredSchema } from '../types/raw-schema.js';
import {
  CubeModelSchema,
  type Cube,
  type CubeDimension,
  type CubeMeasure,
  type CubeJoin,
  type CubeModel,
} from '../types/cube-model.js';

const NAME_RE = /^[a-z][a-z0-9_]*$/;

function slug(name: string): string {
  let s = name.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  if (!NAME_RE.test(s)) s = `c_${s}`.replace(/[^a-z0-9_]+/g, '_');
  return s;
}

/** Map an inferred Trino data type to a Cube dimension `type`. */
function dimType(dataType: string): CubeDimension['type'] {
  if (/^(date|timestamp|time)/i.test(dataType)) return 'time';
  if (/^boolean/i.test(dataType)) return 'boolean';
  if (/^(bigint|integer|smallint|tinyint|double|real|decimal)/i.test(dataType)) return 'number';
  return 'string';
}

/** Map an inferred measure agg to a valid Cube measure type. */
function measureType(agg: string | undefined): CubeMeasure['type'] {
  switch (agg) {
    case 'avg':
      return 'avg';
    case 'min':
      return 'min';
    case 'max':
      return 'max';
    case 'count':
      return 'count';
    case 'count_distinct':
      return 'count_distinct';
    default:
      return 'sum';
  }
}

/**
 * Time dimension SQL must resolve to TIMESTAMP. Trino DATE columns break Cube's
 * `AT TIME ZONE` / `from_iso8601_timestamp` wrapping, so cast at the column
 * expression. Non-date time types (timestamp) are passed through bare.
 */
function timeSql(field: InferredField): string {
  if (/^date/i.test(field.dataType)) {
    return `CAST({CUBE}.${field.column} AS TIMESTAMP)`;
  }
  return field.column;
}

function fieldToDimension(f: InferredField): CubeDimension | null {
  if (f.role === 'measure' || f.role === 'ignore') return null;
  const name = slug(f.column);
  if (f.role === 'time') {
    return { name, sql: timeSql(f), type: 'time' };
  }
  const dim: CubeDimension = { name, sql: f.column, type: dimType(f.dataType) };
  if (f.role === 'primary_key') dim.primary_key = true;
  return dim;
}

function fieldToMeasure(f: InferredField): CubeMeasure | null {
  if (f.role !== 'measure') return null;
  return { name: slug(f.column), type: measureType(f.agg), sql: f.column };
}

function joinToCube(j: InferredCube['joins'][number]): CubeJoin {
  return {
    name: slug(j.toCube),
    relationship: j.relationship,
    sql: `{CUBE}.${j.fromColumn} = {${slug(j.toCube)}}.${j.toColumn}`,
  };
}

/** Build one Cube object from an inferred cube. */
function buildCube(inferred: InferredCube, schema: string, dataSource?: string): Cube {
  const dimensions = inferred.fields
    .map(fieldToDimension)
    .filter((d): d is CubeDimension => d !== null);

  const measures: CubeMeasure[] = [
    // Default `count` measure — every cube gets a baseline (matches cube-dev).
    { name: 'count', type: 'count' },
    ...inferred.fields.map(fieldToMeasure).filter((m): m is CubeMeasure => m !== null),
  ];

  const joins = inferred.joins.map(joinToCube);

  const cube: Cube = {
    name: slug(inferred.name),
    sql_table: schema ? `${schema}.${inferred.sqlTable}` : inferred.sqlTable,
    description: `Draft — scaffolded from ${schema || '(schema)'}.${inferred.sqlTable}. Review before approval.`,
    dimensions,
    measures,
  };
  // Stamp the dataSource so cubes from multiple connectors co-exist in one model.
  // Omitted for the default (Trino) source to preserve legacy cube behavior.
  if (dataSource) cube.data_source = dataSource;
  if (joins.length > 0) cube.joins = joins;
  return cube;
}

export interface ScaffoldCubeResult {
  model: CubeModel;
  /** Cube name the caller should collision-check before staging. */
  cubeName: string;
}

/**
 * Scaffold a single cube from the first inferred cube in `inferred`. `takenNames`
 * pre-seeds existing cube names so we suffix on collision (`active_daily` →
 * `active_daily_2`). Output is guaranteed `CubeModelSchema`-valid.
 */
export function scaffoldCubeModel(
  inferred: InferredSchema,
  takenNames: Set<string> = new Set(),
  dataSource?: string,
): ScaffoldCubeResult {
  const first = inferred.cubes[0];
  if (!first) throw new Error('inferred schema has no cubes');

  let cubeName = slug(first.name);
  if (takenNames.has(cubeName)) {
    let n = 2;
    while (takenNames.has(`${cubeName}_${n}`)) n++;
    cubeName = `${cubeName}_${n}`;
  }

  const cube = buildCube({ ...first, name: cubeName }, inferred.schema, dataSource);
  const model = CubeModelSchema.parse({ cubes: [cube] });
  return { model, cubeName };
}

/** Scaffold every inferred cube into one multi-cube model (for whole-dataset gen). */
export function scaffoldDatasetModel(inferred: InferredSchema): CubeModel {
  const taken = new Set<string>();
  const cubes: Cube[] = [];
  for (const c of inferred.cubes) {
    let name = slug(c.name);
    if (taken.has(name)) {
      let n = 2;
      while (taken.has(`${name}_${n}`)) n++;
      name = `${name}_${n}`;
    }
    taken.add(name);
    cubes.push(buildCube({ ...c, name }, inferred.schema));
  }
  return CubeModelSchema.parse({ cubes });
}

/**
 * Serialize a Cube model to YAML matching cube-dev's block style:
 * 2-space indent, no line folding (`lineWidth: -1`), keys in insertion order.
 */
export function toYaml(model: CubeModel): string {
  return dump(model, {
    indent: 2,
    lineWidth: -1,
    noRefs: true,
    quotingType: '"',
    forceQuotes: false,
  });
}
