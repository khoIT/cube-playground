/**
 * Phase-6 authoring: override CRUD, seed-protection (seeds overridden not
 * deleted), merged read reflects the override, net-new appears as custom, and
 * the write-role gate blocks viewers.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/index.js';
import { setDb, closeDb } from '../src/db/sqlite.js';
import { signAppJwt } from '../src/services/app-jwt.js';
import { __resetAccessCache } from '../src/auth/access-store.js';
import { upsertUserAccess } from '../src/auth/access-store-mutators.js';
import { listOverrides } from '../src/care/care-playbooks-store.js';
import { mergePlaybooks } from '../src/care/playbook-merge.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');

function makeMemDb() {
  const db = new Database(':memory:');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  }
  return db;
}

const overrideBody = {
  base_id: '04',
  name: 'Spend drop (tuned)',
  group: 'payment',
  priority: 'cao',
  condition: { kind: 'ratio', member: 'user_recharge_daily.revenue_7d', vs: 'user_recharge_daily.revenue_30d_avg', value: 0.25, op: 'lt' },
  watchedMetric: { member: 'user_recharge_daily.revenue_vnd', label: '7d spend' },
  action: { text: 'reach out', channels: ['call'], slaMinutes: 1440 },
  dataRequirements: ['user_recharge_daily.revenue_vnd', 'user_recharge_daily.recharge_date'],
  enabled: true,
};

describe('care playbook authoring (dev/admin)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeEach(async () => {
    setDb(makeMemDb());
    app = await buildApp();
  });
  afterEach(async () => {
    if (app) await app.close();
    closeDb();
  });

  it('creates a seed override; merge reflects it; seed config in code untouched', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/care/playbooks?game=jus_vn', payload: overrideBody });
    expect(res.statusCode).toBe(201);
    const ovId = res.json().id;
    expect(res.json().baseId).toBe('04'); // CarePlaybookOverride uses camelCase

    // Merge over a member set where 04's data exists → override wins per field.
    const members = new Set(['user_recharge_daily.revenue_vnd', 'user_recharge_daily.recharge_date']);
    const merged = mergePlaybooks('jus_vn', members, listOverrides('jus_vn'));
    const p04 = merged.find((p) => p.id === '04')!;
    expect(p04.source).toBe('override');
    expect(p04.name).toBe('Spend drop (tuned)');
    expect(merged).toHaveLength(21); // still 21 — override replaces, not adds
    expect(ovId).toBeTruthy();
  });

  it('rejects an override targeting an unknown seed', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/care/playbooks?game=jus_vn', payload: { ...overrideBody, base_id: '99' } });
    expect(res.statusCode).toBe(400);
  });

  it('creates net-new (base_id null) → appears as custom; PATCH + DELETE work', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/care/playbooks?game=jus_vn',
      payload: { ...overrideBody, base_id: null, name: 'Custom whale watch', condition: { kind: 'abs', member: 'mf_users.ltv_total_vnd', op: 'gte', value: 200000000 }, dataRequirements: ['mf_users.ltv_total_vnd'] },
    });
    expect(create.statusCode).toBe(201);
    const id = create.json().id;

    const patch = await app.inject({ method: 'PATCH', url: `/api/care/playbooks/${id}`, payload: { priority: 'tb' } });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().priority).toBe('tb');

    const merged = mergePlaybooks('jus_vn', new Set(['mf_users.ltv_total_vnd']), listOverrides('jus_vn'));
    expect(merged.find((p) => p.overrideId === id)?.source).toBe('custom');

    const del = await app.inject({ method: 'DELETE', url: `/api/care/playbooks/${id}` });
    expect(del.statusCode).toBe(204);
    expect(listOverrides('jus_vn')).toHaveLength(0);
  });

  it('404 on patching/deleting a missing override', async () => {
    expect((await app.inject({ method: 'PATCH', url: '/api/care/playbooks/nope', payload: { priority: 'tb' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: '/api/care/playbooks/nope' })).statusCode).toBe(404);
  });
});

describe('care playbook authoring write-role gate (real auth)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const prev = { AUTH_DISABLED: process.env.AUTH_DISABLED, JWT_SECRET: process.env.JWT_SECRET };
  const JWT_SECRET = 'test-jwt-secret-must-be-at-least-16-chars';
  const tok = (sub: string, email: string, role: 'viewer' | 'editor' | 'admin') =>
    signAppJwt({ sub, username: sub, email, role });

  beforeEach(async () => {
    process.env.AUTH_DISABLED = 'false';
    process.env.JWT_SECRET = JWT_SECRET;
    setDb(makeMemDb());
    __resetAccessCache();
    upsertUserAccess({ email: 'viewer@corp.com', role: 'viewer', status: 'active' });
    app = await buildApp();
  });
  afterEach(async () => {
    process.env.AUTH_DISABLED = prev.AUTH_DISABLED;
    process.env.JWT_SECRET = prev.JWT_SECRET;
    if (app) await app.close();
    closeDb();
  });

  it('viewer cannot create a playbook (403)', async () => {
    const viewer = { authorization: `Bearer ${await tok('v', 'viewer@corp.com', 'viewer')}` };
    const res = await app.inject({ method: 'POST', url: '/api/care/playbooks?game=jus_vn', headers: viewer, payload: overrideBody });
    expect(res.statusCode).toBe(403);
  });
});
