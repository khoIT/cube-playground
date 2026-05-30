/**
 * Unit tests for the dataSource registry writer: atomic upsert/remove, idempotent
 * merge by id, and the secret-free invariant (no credential ever reaches disk).
 */
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const tmp = mkdtempSync(join(tmpdir(), 'ds-registry-test-'));
process.env.DATASOURCES_CONFIG_PATH = join(tmp, 'datasources.config.json');

import {
  upsertDataSource,
  removeDataSource,
  readRegistry,
  type DataSourceEntry,
} from '../src/services/datasource-registry-writer.js';

function entry(over: Partial<DataSourceEntry> = {}): DataSourceEntry {
  return {
    id: 'pg_prod',
    sourceType: 'postgres',
    driverType: 'postgres',
    workspaceId: 'local',
    config: { host: 'pg.internal', port: 5432, catalog: 'analytics', user: 'svc', ssl: true },
    secretRef: 'pg_prod',
    ...over,
  };
}

const path = process.env.DATASOURCES_CONFIG_PATH as string;

beforeEach(() => {
  // start each test from an empty registry
  if (existsSync(path)) removeDataSource('__none__');
  for (const e of readRegistry()) removeDataSource(e.id);
});
afterEach(() => {
  for (const e of readRegistry()) removeDataSource(e.id);
});

describe('datasource-registry-writer', () => {
  it('writes an entry and reads it back', () => {
    upsertDataSource(entry());
    const list = readRegistry();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'pg_prod', driverType: 'postgres', secretRef: 'pg_prod' });
    expect(existsSync(path)).toBe(true);
  });

  it('is idempotent — re-upsert replaces in place (no dupes)', () => {
    upsertDataSource(entry());
    upsertDataSource(entry({ config: { host: 'pg2.internal', port: 5433, catalog: 'analytics', user: 'svc2', ssl: false } }));
    const list = readRegistry();
    expect(list).toHaveLength(1);
    expect(list[0].config).toMatchObject({ host: 'pg2.internal', port: 5433 });
  });

  it('never persists secret-looking keys (defensive sanitize)', () => {
    upsertDataSource(entry({ config: { host: 'pg.internal', password: 'leak-me', apiKey: 'leak2', user: 'svc' } }));
    const onDisk = readFileSync(path, 'utf8');
    expect(onDisk).not.toContain('leak-me');
    expect(onDisk).not.toContain('leak2');
    expect(readRegistry()[0].config).not.toHaveProperty('password');
    expect(readRegistry()[0].config).not.toHaveProperty('apiKey');
  });

  it('removes an entry by id', () => {
    upsertDataSource(entry());
    upsertDataSource(entry({ id: 'bq_prod', sourceType: 'bigquery', driverType: 'bigquery', secretRef: 'bq_prod' }));
    removeDataSource('pg_prod');
    const list = readRegistry();
    expect(list.map((e) => e.id)).toEqual(['bq_prod']);
  });
});
