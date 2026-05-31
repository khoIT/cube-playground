/**
 * Unit tests for connector-store edit/disable lifecycle.
 *
 * Asserts the secret-preserving update contract (blank secret keeps the sealed
 * credential; a non-empty secret reseals), the 'update'/'disable' audit trail,
 * unknown-id → null, and the read-only worked-example refusal. Uses a temp DB +
 * a real vault key so seal/open round-trips.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const tmp = mkdtempSync(join(tmpdir(), 'connector-store-test-'));
process.env.DB_PATH = join(tmp, 'cs.db');
process.env.CONNECTOR_SECRET_KEY = randomBytes(32).toString('base64');

import { getDb, closeDb } from '../src/db/sqlite.js';
import { __resetVaultKeyCache } from '../src/services/connector-secret-vault.js';
import {
  createConnector,
  updateConnector,
  disableConnector,
  getConnectorMeta,
  getStoredConnector,
  listStoredMeta,
  listConnectorAudit,
} from '../src/services/connector-store.js';

const baseConfig = { host: 'h', port: 443, user: 'u', catalog: 'game_integration', ssl: true };

function seed(id = 'c1', secret = 'pw-original') {
  return createConnector({ id, workspaceId: 'local', sourceType: 'trino', label: 'C1', config: { ...baseConfig }, secret });
}

beforeAll(() => {
  __resetVaultKeyCache();
});
beforeEach(() => {
  getDb().exec('DELETE FROM connector_audit; DELETE FROM connectors;');
});
afterAll(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

describe('updateConnector — secret preservation', () => {
  it('keeps the existing secret when the new secret is blank', () => {
    seed();
    updateConnector('c1', { config: { ...baseConfig, host: 'h2' } }, 'editor@vng');
    const stored = getStoredConnector('c1');
    expect(stored?.password).toBe('pw-original'); // unchanged
    expect(stored?.host).toBe('h2'); // config did change
  });

  it('keeps the secret when secret is an empty string', () => {
    seed();
    updateConnector('c1', { config: { ...baseConfig }, secret: '' }, 'editor@vng');
    expect(getStoredConnector('c1')?.password).toBe('pw-original');
  });

  it('reseals when a new non-empty secret is supplied', () => {
    seed();
    updateConnector('c1', { config: { ...baseConfig }, secret: 'rotated-pw' }, 'editor@vng');
    expect(getStoredConnector('c1')?.password).toBe('rotated-pw');
  });

  it('updates the label when provided, keeps it otherwise', () => {
    seed();
    updateConnector('c1', { label: 'Renamed', config: { ...baseConfig } }, 'editor@vng');
    expect(getConnectorMeta('c1')?.label).toBe('Renamed');
    updateConnector('c1', { config: { ...baseConfig } }, 'editor@vng');
    expect(getConnectorMeta('c1')?.label).toBe('Renamed');
  });
});

describe('updateConnector — audit + guards', () => {
  it('audits update with config vs config+secret detail', () => {
    seed();
    updateConnector('c1', { config: { ...baseConfig } }, 'editor@vng');
    updateConnector('c1', { config: { ...baseConfig }, secret: 'x' }, 'editor@vng');
    const details = listConnectorAudit('c1')
      .filter((a) => a.action === 'update')
      .map((a) => a.detail);
    expect(details).toContain('config');
    expect(details).toContain('config+secret');
  });

  it('returns null for an unknown id (no row created)', () => {
    expect(updateConnector('nope', { config: { ...baseConfig } }, null)).toBeNull();
    expect(getConnectorMeta('nope')).toBeNull();
  });

  it('refuses the read-only worked example', () => {
    expect(() => updateConnector('existing-model', { config: { ...baseConfig } }, null)).toThrow(/READ_ONLY/);
  });
});

describe('disableConnector', () => {
  it('drops the connector out of listStoredMeta and audits disable', () => {
    seed();
    expect(disableConnector('c1', 'admin@vng')).toBe(true);
    expect(listStoredMeta().find((m) => m.id === 'c1')).toBeUndefined();
    expect(getConnectorMeta('c1')?.status).toBe('disabled');
    expect(listConnectorAudit('c1').some((a) => a.action === 'disable')).toBe(true);
  });

  it('returns false when already disabled', () => {
    seed();
    disableConnector('c1', null);
    expect(disableConnector('c1', null)).toBe(false);
  });
});
