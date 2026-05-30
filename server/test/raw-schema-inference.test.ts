/**
 * Pure unit tests for the raw-schema inference engine. No I/O — fixed fixtures
 * in, deterministic roles/PK/joins/confidence out.
 */
import { describe, expect, it } from 'vitest';
import { inferSchema, isAutoAccept, THRESHOLDS } from '../src/services/raw-schema-inference.js';
import type { ColumnProfile, TableProfile } from '../src/types/raw-schema.js';

function col(p: Partial<ColumnProfile> & { name: string; dataType: string }): ColumnProfile {
  return {
    nullPct: 0,
    approxDistinct: 100,
    rowCount: 1000,
    isUnique: false,
    min: null,
    max: null,
    sampleValues: [],
    ...p,
  };
}

const activeDaily: TableProfile = {
  schema: 'ballistar_vn',
  table: 'active_daily',
  rowCount: 100_000,
  columns: [
    col({ name: 'user_id', dataType: 'varchar', approxDistinct: 99_000, rowCount: 100_000, isUnique: true }),
    col({ name: 'log_date', dataType: 'date', approxDistinct: 365, rowCount: 100_000 }),
    col({ name: 'country_code', dataType: 'varchar', approxDistinct: 30, rowCount: 100_000 }),
    col({ name: 'total_online_time', dataType: 'bigint', approxDistinct: 80_000, rowCount: 100_000 }),
    col({ name: 'server_id', dataType: 'integer', approxDistinct: 12, rowCount: 100_000 }),
    col({ name: 'is_paying', dataType: 'boolean', approxDistinct: 2, rowCount: 100_000 }),
  ],
};

const users: TableProfile = {
  schema: 'ballistar_vn',
  table: 'users',
  rowCount: 50_000,
  columns: [
    col({ name: 'id', dataType: 'varchar', approxDistinct: 50_000, rowCount: 50_000, isUnique: true }),
    col({ name: 'register_country', dataType: 'varchar', approxDistinct: 40, rowCount: 50_000 }),
  ],
};

describe('inferSchema — column classification', () => {
  const inferred = inferSchema([activeDaily], 'cold');
  const cube = inferred.cubes[0];
  const role = (c: string) => cube.fields.find((f) => f.column === c)!.role;

  it('classifies the unique id-shaped column as primary_key', () => {
    expect(role('user_id')).toBe('primary_key');
    expect(cube.primaryKey).toBe('user_id');
  });

  it('classifies date/timestamp columns as time dimensions', () => {
    expect(role('log_date')).toBe('time');
  });

  it('classifies low-cardinality strings as dimensions', () => {
    expect(role('country_code')).toBe('dimension');
  });

  it('classifies booleans as dimensions', () => {
    expect(role('is_paying')).toBe('dimension');
  });

  it('classifies high-cardinality named numerics as measures with an agg', () => {
    const f = cube.fields.find((x) => x.column === 'total_online_time')!;
    expect(f.role).toBe('measure');
    expect(f.agg).toBeTruthy();
  });

  it('classifies numeric id/code columns as dimensions, not measures', () => {
    expect(role('server_id')).toBe('dimension');
  });

  it('attaches a confidence and rationale to every field', () => {
    for (const f of cube.fields) {
      expect(f.confidence).toBeGreaterThan(0);
      expect(f.confidence).toBeLessThanOrEqual(1);
      expect(f.rationale.length).toBeGreaterThan(0);
    }
  });
});

describe('inferSchema — joins', () => {
  it('detects a cross-table FK→PK join', () => {
    // active_daily has user_id; a "user" table PK would let it join, but our
    // fixture table is named `users` and the FK stem is `user`. Use a matching pair.
    const orders: TableProfile = {
      schema: 'ballistar_vn',
      table: 'orders',
      rowCount: 10_000,
      columns: [
        col({ name: 'order_id', dataType: 'varchar', approxDistinct: 10_000, rowCount: 10_000, isUnique: true }),
        col({ name: 'user_id', dataType: 'varchar', approxDistinct: 8_000, rowCount: 10_000 }),
      ],
    };
    const usersTbl: TableProfile = {
      schema: 'ballistar_vn',
      table: 'user',
      rowCount: 50_000,
      columns: [col({ name: 'user_id', dataType: 'varchar', approxDistinct: 50_000, rowCount: 50_000, isUnique: true })],
    };
    const inferred = inferSchema([orders, usersTbl], 'cold');
    const ordersCube = inferred.cubes.find((c) => c.name === 'orders')!;
    expect(ordersCube.joins.length).toBeGreaterThanOrEqual(1);
    const j = ordersCube.joins[0];
    expect(j.toCube).toBe('user');
    expect(j.fromColumn).toBe('user_id');
    expect(j.relationship).toBe('many_to_one');
  });
});

describe('inferSchema — mode prior + thresholds', () => {
  it('warm-start nudges ambiguous low-cardinality numerics toward measures', () => {
    const t: TableProfile = {
      schema: 's',
      table: 't',
      rowCount: 1000,
      columns: [col({ name: 'rank_bucket', dataType: 'integer', approxDistinct: 5, rowCount: 1000 })],
    };
    const cold = inferSchema([t], 'cold').cubes[0].fields[0];
    const warm = inferSchema([t], 'warm').cubes[0].fields[0];
    expect(cold.role).toBe('dimension');
    expect(warm.role).toBe('measure');
  });

  it('isAutoAccept tracks the threshold', () => {
    expect(isAutoAccept(THRESHOLDS.autoAccept)).toBe(true);
    expect(isAutoAccept(THRESHOLDS.autoAccept - 0.01)).toBe(false);
  });
});

describe('inferSchema — determinism', () => {
  it('is deterministic on fixed input', () => {
    const a = JSON.stringify(inferSchema([activeDaily, users], 'cold'));
    const b = JSON.stringify(inferSchema([activeDaily, users], 'cold'));
    expect(a).toBe(b);
  });
});
