/**
 * Unit tests for the cross-game join scaffolder helpers (pure, no DB/disk).
 * Asserts: FQ table reference shape; join entry addresses the target by cube
 * name with an explicit ON condition; column-identifier guard; append validates
 * + guards against a missing cube and duplicate edges.
 */
import { describe, expect, it } from 'vitest';
import { CubeModelSchema, type CubeModel } from '../src/types/cube-model.js';
import { fqSqlTable, buildCrossGameJoin, addCrossGameJoin } from '../src/services/cube-model-scaffolder.js';

function baseModel(): CubeModel {
  return CubeModelSchema.parse({
    cubes: [
      {
        name: 'active_daily',
        sql_table: 'game_integration.ballistar_vn.active_daily',
        dimensions: [{ name: 'user_id', sql: 'user_id', type: 'string', primary_key: true }],
        measures: [{ name: 'count', type: 'count' }],
      },
    ],
  });
}

describe('fqSqlTable', () => {
  it('joins catalog.schema.table', () => {
    expect(fqSqlTable('game_integration', 'cfm_vn', 'active_daily')).toBe('game_integration.cfm_vn.active_daily');
  });
});

describe('buildCrossGameJoin', () => {
  it('addresses the target by cube name with an explicit ON condition', () => {
    const join = buildCrossGameJoin({ targetCube: 'cfm_active_daily', fromColumn: 'user_id', toColumn: 'user_id', relationship: 'many_to_one' });
    expect(join.name).toBe('cfm_active_daily');
    expect(join.relationship).toBe('many_to_one');
    expect(join.sql).toBe('{CUBE}.user_id = {cfm_active_daily}.user_id');
  });

  it('rejects a non-identifier column (injection guard)', () => {
    expect(() => buildCrossGameJoin({ targetCube: 'cfm_x', fromColumn: 'a; DROP TABLE', toColumn: 'b', relationship: 'one_to_one' })).toThrow(/fromColumn/);
  });
});

describe('addCrossGameJoin', () => {
  it('appends a validated cross-game join to the named cube', () => {
    const next = addCrossGameJoin(baseModel(), 'active_daily', { targetCube: 'cfm_active_daily', fromColumn: 'user_id', toColumn: 'user_id', relationship: 'many_to_one' });
    const joins = next.cubes[0].joins ?? [];
    expect(joins).toHaveLength(1);
    expect(joins[0].name).toBe('cfm_active_daily');
  });

  it('throws when the cube is not in the model', () => {
    expect(() => addCrossGameJoin(baseModel(), 'nope', { targetCube: 'x', fromColumn: 'a', toColumn: 'b', relationship: 'one_to_one' })).toThrow(/not found/);
  });

  it('refuses a duplicate edge to the same target', () => {
    const once = addCrossGameJoin(baseModel(), 'active_daily', { targetCube: 'cfm_x', fromColumn: 'user_id', toColumn: 'user_id', relationship: 'many_to_one' });
    expect(() => addCrossGameJoin(once, 'active_daily', { targetCube: 'cfm_x', fromColumn: 'user_id', toColumn: 'user_id', relationship: 'many_to_one' })).toThrow(/already exists/);
  });
});
