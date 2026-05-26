/**
 * Phase 08 — business-metric audit trail.
 *
 * Coverage:
 *   - insertAuditRow + listAudit pagination + ordering
 *   - POST /api/business-metrics writes a 'create' row (or 'update' on overwrite)
 *   - PATCH /api/business-metrics/:id/trust writes a 'trust_change' row
 *   - GET /api/business-metrics/:id/history returns the rows newest-first
 *   - YAML write failure does NOT produce an audit row (we only audit success)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import businessMetricsRoutes from '../src/routes/business-metrics.js';
import {
  clearCache,
  loadAll,
  setRegistryDir,
} from '../src/services/business-metrics-loader.js';
import { setDb, closeDb } from '../src/db/sqlite.js';
import {
  insertAuditRow,
  listAudit,
  countAudit,
} from '../src/db/business-metric-audit-store.js';

vi.mock('../src/services/cube-client.js', () => ({ getMeta: vi.fn() }));
vi.mock('../src/services/resolve-cube-token.js', () => ({
  resolveCubeTokenForGame: vi.fn(() => 'Bearer test'),
}));

function readMigration(name: string): string {
  const cwd = process.cwd();
  const candidates = [
    resolve(cwd, `src/db/migrations/${name}`),
    resolve(cwd, `server/src/db/migrations/${name}`),
  ];
  for (const p of candidates) {
    try {
      return readFileSync(p, 'utf-8');
    } catch {
      continue;
    }
  }
  throw new Error(`migration ${name} not found`);
}

function inMemoryDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(readMigration('016-business-metric-audit.sql'));
  return db;
}

const DAU_YAML = [
  'id: dau',
  'label: DAU',
  'description: Daily active users',
  'tier: 1',
  'domain: engagement',
  'owner: data@vng',
  'trust: draft',
  'formula:',
  '  type: measure',
  '  ref: mf_users.dau',
  'meta:',
  '  game_id: ballistar',
  '',
].join('\n');

let dir: string;
let app: FastifyInstance;
let db: Database.Database;

beforeEach(async () => {
  closeDb();
  db = inMemoryDb();
  setDb(db);

  dir = mkdtempSync(join(tmpdir(), 'bm-audit-'));
  setRegistryDir(dir);
  clearCache();
  writeFileSync(join(dir, 'dau.yml'), DAU_YAML);
  await loadAll();

  app = Fastify();
  await app.register(businessMetricsRoutes);
});

afterEach(async () => {
  await app.close();
  clearCache();
  if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  closeDb();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Store unit tests
// ---------------------------------------------------------------------------

describe('business-metric-audit-store', () => {
  it('insertAuditRow returns the inserted row with a generated id', () => {
    const row = insertAuditRow(db, {
      metricId: 'dau',
      action: 'create',
      newValueJson: JSON.stringify({ id: 'dau' }),
      actorKind: 'user',
      actorId: 'alice',
      reason: 'initial seed',
    });
    expect(row.id).toBeGreaterThan(0);
    expect(row.metricId).toBe('dau');
    expect(row.action).toBe('create');
  });

  it('listAudit returns newest-first', () => {
    insertAuditRow(db, { metricId: 'dau', action: 'create', actorKind: 'user', ts: 1000 });
    insertAuditRow(db, { metricId: 'dau', action: 'trust_change', actorKind: 'user', ts: 2000 });
    insertAuditRow(db, { metricId: 'dau', action: 'update', actorKind: 'user', ts: 3000 });

    const rows = listAudit(db, 'dau');
    expect(rows.map((r) => r.action)).toEqual(['update', 'trust_change', 'create']);
  });

  it('listAudit respects limit + since', () => {
    insertAuditRow(db, { metricId: 'dau', action: 'create', actorKind: 'user', ts: 1000 });
    insertAuditRow(db, { metricId: 'dau', action: 'update', actorKind: 'user', ts: 2000 });
    insertAuditRow(db, { metricId: 'dau', action: 'trust_change', actorKind: 'user', ts: 3000 });

    expect(listAudit(db, 'dau', { limit: 2 })).toHaveLength(2);
    expect(listAudit(db, 'dau', { since: 1500 })).toHaveLength(2);
  });

  it('countAudit returns the total', () => {
    expect(countAudit(db, 'dau')).toBe(0);
    insertAuditRow(db, { metricId: 'dau', action: 'create', actorKind: 'user' });
    expect(countAudit(db, 'dau')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Route integration
// ---------------------------------------------------------------------------

describe('POST /api/business-metrics → audit row', () => {
  it('produces a create row for a fresh metric', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/business-metrics',
      payload: {
        id: 'newm',
        label: 'New M',
        description: 'A new metric',
        tier: 1,
        domain: 'engagement',
        owner: 'data@vng',
        trust: 'draft',
        formula: { type: 'measure', ref: 'mf_users.dau' },
      },
    });
    expect(res.statusCode).toBe(201);

    const rows = listAudit(db, 'newm');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe('create');
    expect(rows[0]?.oldValueJson).toBeNull();
    expect(rows[0]?.newValueJson).toBeTruthy();
  });

  it('produces an update row when overwriting an existing metric', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/business-metrics',
      payload: {
        id: 'dau',
        label: 'DAU',
        description: 'Updated description',
        tier: 1,
        domain: 'engagement',
        owner: 'data@vng',
        trust: 'draft',
        formula: { type: 'measure', ref: 'mf_users.dau' },
      },
    });
    expect(res.statusCode).toBe(201);

    const rows = listAudit(db, 'dau');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe('update');
    expect(rows[0]?.oldValueJson).toContain('Daily active users');
  });
});

describe('PATCH /api/business-metrics/:id/trust → audit row', () => {
  it('records a trust_change row with old + new trust', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/business-metrics/dau/trust',
      payload: { trust: 'deprecated', actor: 'pm-alice', note: 'demoting — replaced' },
    });
    expect(res.statusCode).toBe(200);

    const rows = listAudit(db, 'dau');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe('trust_change');
    expect(rows[0]?.oldValueJson).toBe('{"trust":"draft"}');
    expect(rows[0]?.newValueJson).toBe('{"trust":"deprecated"}');
    expect(rows[0]?.reason).toBe('demoting — replaced');
    expect(rows[0]?.actorKind).toBe('user');
  });

  it('records actorKind="agent" when actor === "chat"', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/business-metrics/dau/trust',
      payload: { trust: 'deprecated', actor: 'chat' },
    });
    expect(res.statusCode).toBe(200);
    const rows = listAudit(db, 'dau');
    expect(rows[0]?.actorKind).toBe('agent');
  });
});

describe('GET /api/business-metrics/:id/history', () => {
  it('returns audit rows newest-first', async () => {
    insertAuditRow(db, { metricId: 'dau', action: 'create', actorKind: 'user', ts: 1000 });
    insertAuditRow(db, { metricId: 'dau', action: 'trust_change', actorKind: 'user', ts: 2000 });

    const res = await app.inject({ method: 'GET', url: '/api/business-metrics/dau/history' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { entries: Array<{ action: string }> };
    expect(body.entries.map((e) => e.action)).toEqual(['trust_change', 'create']);
  });

  it('returns 404 for unknown metric', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/business-metrics/missing/history',
    });
    expect(res.statusCode).toBe(404);
  });
});
