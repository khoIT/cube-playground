/**
 * Unit tests for the env→DB bootstrap seed. Asserts: no host → no-op; host but
 * no vault key → degrade (no-op, no crash); host + vault key → materializes an
 * editable DB row whose secret decrypts to the env password; idempotent on a
 * second call. Manipulates TRINO_PROFILER_* + CONNECTOR_SECRET_KEY per case.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

const tmp = mkdtempSync(join(tmpdir(), 'connector-bootstrap-test-'));
process.env.DB_PATH = join(tmp, 'boot.db');

import { getDb, closeDb } from '../src/db/sqlite.js';
import { __resetVaultKeyCache } from '../src/services/connector-secret-vault.js';
import { seedEnvConnectorIntoDb, ENV_CONNECTOR_ID } from '../src/services/connector-bootstrap.js';
import { getConnectorMeta, getStoredConnector } from '../src/services/connector-store.js';

const KEY = randomBytes(32).toString('base64');

function setEnv(opts: { host?: string; key?: string; pass?: string }) {
  if (opts.host === undefined) delete process.env.TRINO_PROFILER_HOST;
  else process.env.TRINO_PROFILER_HOST = opts.host;
  if (opts.key === undefined) delete process.env.CONNECTOR_SECRET_KEY;
  else process.env.CONNECTOR_SECRET_KEY = opts.key;
  if (opts.pass === undefined) delete process.env.TRINO_PROFILER_PASS;
  else process.env.TRINO_PROFILER_PASS = opts.pass;
  __resetVaultKeyCache();
}

beforeEach(() => {
  getDb().exec('DELETE FROM connector_audit; DELETE FROM connectors;');
  setEnv({});
});
afterAll(() => {
  closeDb();
  setEnv({});
  rmSync(tmp, { recursive: true, force: true });
});

describe('seedEnvConnectorIntoDb', () => {
  it('no-ops when no TRINO_PROFILER_HOST is set', () => {
    const res = seedEnvConnectorIntoDb();
    expect(res.seeded).toBe(false);
    expect(getConnectorMeta(ENV_CONNECTOR_ID)).toBeNull();
  });

  it('degrades (no-op, no throw) when host is set but no vault key', () => {
    setEnv({ host: 'trino.internal' });
    const res = seedEnvConnectorIntoDb();
    expect(res.seeded).toBe(false);
    expect(res.reason).toMatch(/CONNECTOR_SECRET_KEY/);
    expect(getConnectorMeta(ENV_CONNECTOR_ID)).toBeNull();
  });

  it('materializes an editable DB row whose secret decrypts to the env password', () => {
    setEnv({ host: 'trino.internal', key: KEY, pass: 'env-secret-pw' });
    const res = seedEnvConnectorIntoDb();
    expect(res.seeded).toBe(true);
    expect(getConnectorMeta(ENV_CONNECTOR_ID)?.status).toBe('active');
    const stored = getStoredConnector(ENV_CONNECTOR_ID);
    expect(stored?.host).toBe('trino.internal');
    expect(stored?.password).toBe('env-secret-pw');
  });

  it('is idempotent — a second call does not re-seed', () => {
    setEnv({ host: 'trino.internal', key: KEY, pass: 'env-secret-pw' });
    expect(seedEnvConnectorIntoDb().seeded).toBe(true);
    const again = seedEnvConnectorIntoDb();
    expect(again.seeded).toBe(false);
    expect(again.reason).toMatch(/already present/);
  });
});
