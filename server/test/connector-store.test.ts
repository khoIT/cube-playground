/**
 * Integration tests for the DB-backed connector store + its merge into the
 * trino-profiler-config public list / resolver. Temp DB file (migration 024
 * applies on open); unique temp dir avoids cross-suite DB_PATH races.
 *
 * Key invariant under test: NO secret material ever appears in the public
 * projection (listConnectors / listStoredMeta).
 */
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

const tmp = mkdtempSync(join(tmpdir(), 'connector-store-test-'));
process.env.DB_PATH = join(tmp, 'connectors.db');
process.env.CONNECTOR_SECRET_KEY = randomBytes(32).toString('base64');

import { getDb, closeDb } from '../src/db/sqlite.js';
import { __resetVaultKeyCache } from '../src/services/connector-secret-vault.js';
import {
  createConnector,
  listStoredMeta,
  getStoredConnector,
  getConnectorMeta,
  disableConnector,
  listConnectorAudit,
  type CreateConnectorInput,
} from '../src/services/connector-store.js';
import { listConnectors, getConnector } from '../src/services/trino-profiler-config.js';

function input(overrides: Partial<CreateConnectorInput> = {}): CreateConnectorInput {
  return {
    id: 'pg_prod',
    workspaceId: 'local',
    sourceType: 'postgres',
    label: 'Prod Postgres',
    config: { host: 'pg.internal', port: 5432, user: 'svc', catalog: 'analytics', ssl: true },
    secret: 'p@ssw0rd-do-not-leak',
    createdBy: 'alice@vng',
    ...overrides,
  };
}

beforeEach(() => {
  __resetVaultKeyCache();
  getDb().exec('DELETE FROM connectors; DELETE FROM connector_audit;');
});
afterAll(() => closeDb());

describe('connector-store', () => {
  it('creates a connector and reads back decrypted credentials (server-only)', () => {
    createConnector(input());
    const full = getStoredConnector('pg_prod');
    expect(full).toMatchObject({
      id: 'pg_prod',
      sourceType: 'postgres',
      host: 'pg.internal',
      port: 5432,
      user: 'svc',
      password: 'p@ssw0rd-do-not-leak',
      ssl: true,
    });
  });

  it('never exposes the secret in metadata or the public list', () => {
    createConnector(input());
    const meta = getConnectorMeta('pg_prod');
    expect(JSON.stringify(meta)).not.toContain('p@ssw0rd-do-not-leak');

    const pub = listConnectors().find((c) => c.id === 'pg_prod');
    expect(pub).toBeTruthy();
    expect(JSON.stringify(pub)).not.toContain('p@ssw0rd-do-not-leak');
    // and no plaintext anywhere in the stored-meta list
    expect(JSON.stringify(listStoredMeta())).not.toContain('p@ssw0rd-do-not-leak');
  });

  it('surfaces a DB connector in the public list with source type + host', () => {
    createConnector(input());
    const pub = listConnectors().find((c) => c.id === 'pg_prod');
    expect(pub).toMatchObject({
      id: 'pg_prod',
      sourceType: 'postgres',
      host: 'pg.internal',
      catalog: 'analytics',
      configured: true,
    });
  });

  it('resolves a DB connector via getConnector (full creds)', () => {
    createConnector(input());
    expect(getConnector('pg_prod')?.password).toBe('p@ssw0rd-do-not-leak');
  });

  it('upserts on id conflict (re-provision updates coordinates)', () => {
    createConnector(input());
    createConnector(input({ label: 'Renamed', config: { host: 'pg2.internal', port: 5433, user: 'svc2', catalog: 'analytics', ssl: false }, secret: 'new-secret' }));
    const full = getStoredConnector('pg_prod');
    expect(full).toMatchObject({ label: 'Renamed', host: 'pg2.internal', port: 5433, password: 'new-secret' });
    expect(listStoredMeta()).toHaveLength(1);
  });

  it('soft-disables a connector (drops from active list + resolver)', () => {
    createConnector(input());
    expect(disableConnector('pg_prod', 'alice@vng')).toBe(true);
    expect(listStoredMeta()).toHaveLength(0);
    expect(getStoredConnector('pg_prod')).toBeNull();
    expect(listConnectors().find((c) => c.id === 'pg_prod')).toBeUndefined();
  });

  it('writes an append-only audit trail (create + disable, no secret)', () => {
    createConnector(input());
    disableConnector('pg_prod', 'bob@vng');
    const audit = listConnectorAudit('pg_prod');
    expect(audit.map((a) => a.action)).toEqual(['disable', 'create']); // newest-first
    expect(JSON.stringify(audit)).not.toContain('p@ssw0rd-do-not-leak');
  });
});
