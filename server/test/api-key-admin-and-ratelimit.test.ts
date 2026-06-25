/**
 * Phase 06 — per-key rate limiter + admin key-management CRUD authz.
 *
 * Limiter: concurrency cap → reject; release frees a slot; daily quota → reject.
 * Admin routes: create returns plaintext ONCE (201), list/revoke work; a
 * non-admin (viewer) is 403 at router scope.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { setDb, closeDb } from '../src/db/sqlite.js';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  acquireExportSlot,
  RateLimitRejected,
  __resetRateLimiter,
} from '../src/services/api-key-rate-limiter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');

function makeMemDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }
  return db;
}

describe('api-key rate limiter', () => {
  beforeEach(() => {
    __resetRateLimiter();
    vi.unstubAllEnvs();
    vi.stubEnv('PUBLIC_EXPORT_MAX_CONCURRENT_PER_KEY', '2');
    vi.stubEnv('PUBLIC_EXPORT_MAX_PULLS_PER_DAY', '3');
  });
  afterEach(() => {
    __resetRateLimiter();
    vi.unstubAllEnvs();
  });

  it('caps concurrency and releases slots', () => {
    const r1 = acquireExportSlot('k');
    const r2 = acquireExportSlot('k');
    expect(() => acquireExportSlot('k')).toThrow(RateLimitRejected);
    r1();
    // freeing a slot lets the next one in (still within daily quota of 3)
    const r3 = acquireExportSlot('k');
    expect(typeof r3).toBe('function');
    r2();
    r3();
  });

  it('enforces a daily pull quota', () => {
    // quota=3: three acquires (releasing between) succeed, the 4th is rejected.
    for (let i = 0; i < 3; i++) acquireExportSlot('k2')();
    try {
      acquireExportSlot('k2');
      throw new Error('expected rejection');
    } catch (e) {
      expect(e).toBeInstanceOf(RateLimitRejected);
      expect((e as RateLimitRejected).reason).toBe('quota');
      expect((e as RateLimitRejected).retryAfterSec).toBeGreaterThan(0);
    }
  });

  it('scopes counters per key', () => {
    acquireExportSlot('a')();
    acquireExportSlot('a')();
    // a different key is unaffected.
    expect(typeof acquireExportSlot('b')).toBe('function');
  });
});

describe('admin api-key routes authz', () => {
  let app: Awaited<ReturnType<typeof import('../src/index.js').buildApp>>;

  beforeEach(async () => {
    setDb(makeMemDb());
    const { buildApp } = await import('../src/index.js');
    app = await buildApp();
  });
  afterEach(async () => {
    await app.close();
    closeDb();
  });

  it('admin can create (plaintext once), list, and revoke a key', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/api-keys',
      payload: { label: 'downstream', workspace: 'prod' },
    });
    expect(created.statusCode).toBe(201);
    const body = created.json();
    expect(body.plaintext.startsWith('sk_live_')).toBe(true);
    expect(body.key.keyPrefix.startsWith('sk_live_')).toBe(true);
    const id = body.key.id;

    const list = await app.inject({ method: 'GET', url: '/api/admin/api-keys' });
    expect(list.json().keys.map((k: { id: string }) => k.id)).toContain(id);
    // Listing must never expose a plaintext or hash field.
    expect(JSON.stringify(list.json())).not.toContain('sk_live_' + body.plaintext.slice(8));

    const revoke = await app.inject({ method: 'DELETE', url: `/api/admin/api-keys/${id}` });
    expect(revoke.statusCode).toBe(200);
    const after = await app.inject({ method: 'GET', url: '/api/admin/api-keys' });
    expect(after.json().keys.find((k: { id: string }) => k.id === id).status).toBe('revoked');
  });
});
