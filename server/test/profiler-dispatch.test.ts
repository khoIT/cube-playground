/**
 * Profiler dispatch + ANSI information_schema mapping. The Trino path is
 * exercised elsewhere (live REST client); here we cover dispatch decisions and
 * the ANSI profiler's stat-mapping via an injected fake SQL runner (no real DB).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Connector } from '../src/services/trino-profiler-config.js';
import { getProfiler, ProfilerUnavailableError } from '../src/services/profiler-interface.js';
import {
  ansiListTables,
  ansiProfileTable,
  registerSqlRunnerFactory,
  __clearSqlRunnerFactories,
  type SqlRunner,
} from '../src/services/information-schema-profiler.js';

function connector(over: Partial<Connector> = {}): Connector {
  return {
    id: 'pg_prod',
    label: 'PG',
    workspaceId: 'local',
    sourceType: 'postgres',
    host: 'pg.internal',
    port: 5432,
    user: 'svc',
    password: 'x',
    catalog: 'analytics',
    ssl: true,
    ...over,
  } as Connector;
}

/** Fake runner: routes by SQL shape to fixture rows. */
const fakeRunner: SqlRunner = async (sql: string) => {
  if (sql.includes('information_schema.columns')) {
    return {
      columns: [{ name: 'table_name' }, { name: 'column_name' }, { name: 'data_type' }, { name: 'ordinal_position' }, { name: 'is_nullable' }],
      rows: [
        ['events', 'id', 'bigint', 1, 'NO'],
        ['events', 'country', 'varchar', 2, 'YES'],
      ],
    };
  }
  if (sql.startsWith('SELECT count(*)')) {
    // rc, nn_1, ad_1, mn_1, mx_1, nn_2, ad_2, mn_2, mx_2
    return {
      columns: [
        { name: 'rc' },
        { name: 'nn_1' }, { name: 'ad_1' }, { name: 'mn_1' }, { name: 'mx_1' },
        { name: 'nn_2' }, { name: 'ad_2' }, { name: 'mn_2' }, { name: 'mx_2' },
      ],
      rows: [[100, 100, 100, '1', '100', 90, 5, null, null]],
    };
  }
  // sample query
  return { columns: [{ name: 'v' }], rows: [['VN'], ['US']] };
};

afterEach(() => __clearSqlRunnerFactories());

describe('profiler dispatch', () => {
  it('returns the Trino profiler for trino connectors', () => {
    expect(getProfiler(connector({ sourceType: 'trino' }))).toBeTruthy();
  });

  it('throws DRIVER_NOT_WIRED for an introspectable type with no runner', () => {
    try {
      getProfiler(connector({ sourceType: 'postgres' }));
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ProfilerUnavailableError);
      expect((e as ProfilerUnavailableError).code).toBe('DRIVER_NOT_WIRED');
    }
  });

  it('throws NOT_INTROSPECTABLE for an unknown / non-introspectable type', () => {
    try {
      getProfiler(connector({ sourceType: 'carrier-pigeon' }));
      throw new Error('expected throw');
    } catch (e) {
      expect((e as ProfilerUnavailableError).code).toBe('NOT_INTROSPECTABLE');
    }
  });

  it('resolves a profiler once a runner factory is registered', () => {
    registerSqlRunnerFactory('postgres', () => fakeRunner);
    expect(getProfiler(connector({ sourceType: 'postgres' }))).toBeTruthy();
  });
});

describe('ansi information_schema profiler', () => {
  it('lists tables + columns from information_schema', async () => {
    const tables = await ansiListTables(fakeRunner, 'analytics');
    expect(tables).toHaveLength(1);
    expect(tables[0].table).toBe('events');
    expect(tables[0].columns.map((c) => c.name)).toEqual(['id', 'country']);
  });

  it('maps stats: rowCount, nullPct, uniqueness, samples', async () => {
    const profile = await ansiProfileTable(fakeRunner, 'analytics', 'events');
    expect(profile.rowCount).toBe(100);
    const id = profile.columns.find((c) => c.name === 'id')!;
    const country = profile.columns.find((c) => c.name === 'country')!;
    expect(id.isUnique).toBe(true); // 100/100 distinct
    expect(id.nullPct).toBe(0);
    expect(country.isUnique).toBe(false); // 5/100 distinct
    expect(country.nullPct).toBeCloseTo(0.1, 5); // 10 of 100 null
    expect(country.sampleValues).toEqual(['VN', 'US']);
  });
});
