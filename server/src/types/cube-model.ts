/**
 * Zod contract for a Cube data-model file (`cube-dev/cube/model/cubes/{game}/*.yml`).
 *
 * Single source of truth for server + frontend. Shape verified against
 * `cube-dev/cube/model/cubes/ballistar/active_daily.yml`: a top-level `cubes[]`,
 * each with `name` + `sql_table`, optional `title`/`description`/`joins`, and
 * `dimensions[]` / `measures[]`. Optional `segments`/`pre_aggregations` are
 * passed through untouched so an authored file round-trips without loss.
 *
 * Zod-as-contract (mirrors `business-metric.ts`): the scaffolder `.parse()`s
 * before returning, guaranteeing only valid models ever reach the writer.
 */

import { z } from 'zod';

/** Cube member/cube name: lower snake, starts with a letter. */
const NAME = z.string().regex(/^[a-z][a-z0-9_]*$/, 'must be lower_snake_case');

export const CUBE_DIM_TYPES = ['string', 'number', 'time', 'boolean', 'geo'] as const;
export const CUBE_MEASURE_TYPES = [
  'count',
  'count_distinct',
  'count_distinct_approx',
  'sum',
  'avg',
  'min',
  'max',
  'number',
  'string',
] as const;
export const CUBE_RELATIONSHIPS = ['many_to_one', 'one_to_many', 'one_to_one'] as const;

export const CubeDimensionSchema = z.object({
  name: NAME,
  sql: z.string().optional(),
  type: z.enum(CUBE_DIM_TYPES),
  primary_key: z.boolean().optional(),
  public: z.boolean().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
});

export const CubeMeasureSchema = z.object({
  name: NAME,
  type: z.enum(CUBE_MEASURE_TYPES),
  sql: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
});

export const CubeJoinSchema = z.object({
  name: NAME,
  relationship: z.enum(CUBE_RELATIONSHIPS),
  sql: z.string().min(1),
});

export const CubeSchema = z.object({
  name: NAME,
  sql_table: z.string().min(1),
  title: z.string().optional(),
  description: z.string().optional(),
  joins: z.array(CubeJoinSchema).optional(),
  dimensions: z.array(CubeDimensionSchema),
  measures: z.array(CubeMeasureSchema),
  // Pass-through for authored extras (kept opaque so round-trip is lossless).
  segments: z.array(z.record(z.unknown())).optional(),
  pre_aggregations: z.array(z.record(z.unknown())).optional(),
});

export const CubeModelSchema = z.object({
  cubes: z.array(CubeSchema).min(1),
});

export type CubeDimension = z.infer<typeof CubeDimensionSchema>;
export type CubeMeasure = z.infer<typeof CubeMeasureSchema>;
export type CubeJoin = z.infer<typeof CubeJoinSchema>;
export type Cube = z.infer<typeof CubeSchema>;
export type CubeModel = z.infer<typeof CubeModelSchema>;
