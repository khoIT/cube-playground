/**
 * Integration tests for the connector provisioning HTTP surface:
 * GET /source-types, POST /connectors/test, POST /connectors. Asserts the SSRF
 * guard, validation, the degraded (driver-not-wired) path, and — critically —
 * that no secret is ever echoed back.
 */
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const tmp = mkdtempSync(join(tmpdir(), 'connector-api-test-'));
process.env.DB_PATH = join(tmp, 'connectors.db');
process.env.DATASOURCES_CONFIG_PATH = join(tmp, 'datasources.config.json');
process.env.CONNECTOR_SECRET_KEY = randomBytes(32).toString('base64');

const { getDb, closeDb } = await import('../src/db/sqlite.js');
const { __resetVaultKeyCache } = await import('../src/services/connector-secret-vault.js');
const onboardingRoutes = (await import('../src/routes/onboarding.js')).default;

let app: FastifyInstance;

beforeEach(async () => {
  __resetVaultKeyCache();
  getDb().exec('DELETE FROM connectors; DELETE FROM connector_audit;');
  app = Fastify();
  await app.register(onboardingRoutes);
});
afterAll(async () => {
  closeDb();
});

const PG_FIELDS = { host: 'pg.internal', port: 5432, catalog: 'analytics', user: 'svc', password: 'do-not-leak', ssl: true };

describe('connector provisioning API', () => {
  it('GET /source-types returns the registry with trino + postgres', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/onboarding/source-types' });
    expect(res.statusCode).toBe(200);
    const ids = res.json().sourceTypes.map((s: { id: string }) => s.id);
    expect(ids).toEqual(expect.arrayContaining(['trino', 'postgres', 'bigquery']));
  });

  it('test → DRIVER_NOT_WIRED for postgres (honest, no fake success)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/onboarding/connectors/test',
      payload: { sourceType: 'postgres', fields: PG_FIELDS },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: false, code: 'DRIVER_NOT_WIRED' });
  });

  it('test → HOST_NOT_ALLOWED for an SSRF metadata host', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/onboarding/connectors/test',
      payload: { sourceType: 'trino', fields: { host: '169.254.169.254', catalog: 'c', user: 'u' } },
    });
    expect(res.json()).toMatchObject({ ok: false, code: 'HOST_NOT_ALLOWED' });
  });

  it('provisions a postgres connector (201, degraded, no secret echoed)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/onboarding/connectors',
      payload: { label: 'Prod Postgres', sourceType: 'postgres', fields: PG_FIELDS },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.connector).toMatchObject({ id: 'prod_postgres', sourceType: 'postgres', host: 'pg.internal' });
    expect(body.liveTested).toBe(false);
    expect(body.note).toBeTruthy();
    expect(res.payload).not.toContain('do-not-leak');

    // appears in the connector list, still secret-free
    const list = await app.inject({ method: 'GET', url: '/api/onboarding/connectors' });
    expect(list.payload).not.toContain('do-not-leak');
    expect(list.json().connectors.map((c: { id: string }) => c.id)).toContain('prod_postgres');
  });

  it('400 VALIDATION when a required field is missing', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/onboarding/connectors',
      payload: { label: 'Broken', sourceType: 'postgres', fields: { host: 'pg.internal' } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION');
  });

  it('400 HOST_NOT_ALLOWED when provisioning an SSRF host', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/onboarding/connectors',
      payload: { label: 'Evil', sourceType: 'postgres', fields: { ...PG_FIELDS, host: '127.0.0.1' } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('HOST_NOT_ALLOWED');
  });
});
