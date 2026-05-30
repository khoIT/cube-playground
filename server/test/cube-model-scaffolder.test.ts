/**
 * Unit tests for the cube-model scaffolder: Zod round-trip, YAML shape (matches
 * cube-dev key style), default count measure, time-dim TIMESTAMP cast, and the
 * collision suffix.
 */
import { describe, expect, it } from 'vitest';
import { load as yamlLoad } from 'js-yaml';
import { scaffoldCubeModel, scaffoldDatasetModel, toYaml } from '../src/services/cube-model-scaffolder.js';
import { CubeModelSchema } from '../src/types/cube-model.js';
import type { InferredSchema } from '../src/types/raw-schema.js';

const inferred: InferredSchema = {
  schema: 'ballistar_vn',
  mode: 'cold',
  cubes: [
    {
      name: 'active_daily',
      sqlTable: 'active_daily',
      primaryKey: 'user_id',
      fields: [
        { column: 'user_id', dataType: 'varchar', role: 'primary_key', confidence: 0.95, rationale: 'pk' },
        { column: 'log_date', dataType: 'date', role: 'time', confidence: 0.95, rationale: 'time' },
        { column: 'country_code', dataType: 'varchar', role: 'dimension', confidence: 0.85, rationale: 'enum' },
        { column: 'total_online_time', dataType: 'bigint', role: 'measure', confidence: 0.85, rationale: 'measure', agg: 'sum' },
      ],
      joins: [
        { fromColumn: 'user_id', toCube: 'mf_users', toColumn: 'user_id', relationship: 'many_to_one', confidence: 0.8, rationale: 'fk' },
      ],
    },
  ],
};

describe('scaffoldCubeModel', () => {
  it('produces a CubeModelSchema-valid model', () => {
    const { model } = scaffoldCubeModel(inferred);
    expect(() => CubeModelSchema.parse(model)).not.toThrow();
  });

  it('always adds a default count measure', () => {
    const { model } = scaffoldCubeModel(inferred);
    const measures = model.cubes[0].measures;
    expect(measures.some((m) => m.name === 'count' && m.type === 'count')).toBe(true);
  });

  it('marks the primary key dimension', () => {
    const { model } = scaffoldCubeModel(inferred);
    const pk = model.cubes[0].dimensions.find((d) => d.name === 'user_id');
    expect(pk?.primary_key).toBe(true);
  });

  it('casts DATE time dimensions to TIMESTAMP (Cube AT TIME ZONE safety)', () => {
    const { model } = scaffoldCubeModel(inferred);
    const t = model.cubes[0].dimensions.find((d) => d.name === 'log_date');
    expect(t?.type).toBe('time');
    expect(t?.sql).toMatch(/CAST\(\{CUBE\}\.log_date AS TIMESTAMP\)/);
  });

  it('emits joins with a relationship + sql condition', () => {
    const { model } = scaffoldCubeModel(inferred);
    const joins = model.cubes[0].joins ?? [];
    expect(joins.length).toBe(1);
    expect(joins[0].relationship).toBe('many_to_one');
    expect(joins[0].sql).toContain('{CUBE}.user_id');
  });

  it('qualifies sql_table with the schema', () => {
    const { model } = scaffoldCubeModel(inferred);
    expect(model.cubes[0].sql_table).toBe('ballistar_vn.active_daily');
  });

  it('suffixes the cube name on collision', () => {
    const taken = new Set(['active_daily', 'active_daily_2']);
    const { cubeName } = scaffoldCubeModel(inferred, taken);
    expect(cubeName).toBe('active_daily_3');
  });
});

describe('toYaml', () => {
  it('round-trips through YAML back to the same structure', () => {
    const { model } = scaffoldCubeModel(inferred);
    const yaml = toYaml(model);
    const reparsed = yamlLoad(yaml);
    expect(() => CubeModelSchema.parse(reparsed)).not.toThrow();
    expect(reparsed).toEqual(model);
  });

  it('emits cube-dev block style (top-level cubes list, 2-space indent)', () => {
    const { model } = scaffoldCubeModel(inferred);
    const yaml = toYaml(model);
    expect(yaml.startsWith('cubes:')).toBe(true);
    expect(yaml).toMatch(/\n {2}- name: active_daily/);
  });
});

describe('scaffoldDatasetModel', () => {
  it('scaffolds multiple cubes with unique names', () => {
    const two: InferredSchema = {
      ...inferred,
      cubes: [inferred.cubes[0], { ...inferred.cubes[0] }],
    };
    const model = scaffoldDatasetModel(two);
    const names = model.cubes.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('active_daily');
    expect(names).toContain('active_daily_2');
  });
});
