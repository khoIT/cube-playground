/**
 * PATCH /api/segments/:id — snapshot_cadence (capture cadence) setter.
 *
 * The lakehouse snapshot job reads snapshot_cadence to decide how often to
 * materialize a segment. The Movement tab sets it via PATCH; verify it
 * validates against the allowed set, persists (survives a re-read), defaults to
 * 'daily', and is independent of refresh_cadence_min.
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');
const JWT_SECRET = 'test-jwt-secret-must-be-at-least-16-chars';

function makeMemDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  }
  return db;
}

describe('PATCH /api/segments/:id — snapshot_cadence', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const prev = { AUTH_DISABLED: process.env.AUTH_DISABLED, JWT_SECRET: process.env.JWT_SECRET };
  let ownerAuth: { authorization: string };

  beforeEach(async () => {
    process.env.AUTH_DISABLED = 'false';
    process.env.JWT_SECRET = JWT_SECRET;
    setDb(makeMemDb());
    __resetAccessCache();
    upsertUserAccess({ email: 'alice@corp.com', role: 'editor', status: 'active' });
    app = await buildApp();
    ownerAuth = {
      authorization: `Bearer ${await signAppJwt({ sub: 'alice-sub', username: 'alice-sub', email: 'alice@corp.com', role: 'editor' })}`,
    };
  });

  afterEach(async () => {
    if (app) await app.close();
    closeDb();
    process.env.AUTH_DISABLED = prev.AUTH_DISABLED;
    process.env.JWT_SECRET = prev.JWT_SECRET;
  });

  async function makeSegment(): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/segments',
      headers: ownerAuth,
      payload: { name: 'cohort', type: 'manual', cube: 'mf_users', uid_list: ['u1'] },
    });
    expect(res.statusCode).toBe(201);
    return res.json().id;
  }

  it('defaults to daily on a freshly created segment', async () => {
    const id = await makeSegment();
    const res = await app.inject({ method: 'GET', url: `/api/segments/${id}`, headers: ownerAuth });
    expect(res.json().snapshot_cadence).toBe('daily');
  });

  it('persists a valid cadence and survives a re-read', async () => {
    const id = await makeSegment();
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/segments/${id}`,
      headers: ownerAuth,
      payload: { snapshot_cadence: '1h' },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().snapshot_cadence).toBe('1h');

    const reread = await app.inject({ method: 'GET', url: `/api/segments/${id}`, headers: ownerAuth });
    expect(reread.json().snapshot_cadence).toBe('1h');
  });

  it('rejects an out-of-set cadence value', async () => {
    const id = await makeSegment();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/segments/${id}`,
      headers: ownerAuth,
      payload: { snapshot_cadence: '7m' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('leaves refresh_cadence_min untouched when only snapshot_cadence changes', async () => {
    const id = await makeSegment();
    await app.inject({
      method: 'PATCH',
      url: `/api/segments/${id}`,
      headers: ownerAuth,
      payload: { refresh_cadence_min: 120 },
    });
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/segments/${id}`,
      headers: ownerAuth,
      payload: { snapshot_cadence: '6h' },
    });
    expect(patch.statusCode).toBe(200);
    const body = patch.json();
    expect(body.snapshot_cadence).toBe('6h');
    expect(body.refresh_cadence_min).toBe(120);
  });

  // ── Unified track_cadence: one knob dual-writes the two legacy columns ──────

  it('track_cadence dual-writes refresh_cadence_min + snapshot_cadence', async () => {
    const id = await makeSegment();
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/segments/${id}`,
      headers: ownerAuth,
      payload: { track_cadence: '1h' },
    });
    expect(patch.statusCode).toBe(200);
    const body = patch.json();
    expect(body.track_cadence).toBe('1h');
    expect(body.refresh_cadence_min).toBe(60); // derived bucket width in minutes
    expect(body.snapshot_cadence).toBe('1h'); // capture cadence follows the knob

    const reread = await app.inject({ method: 'GET', url: `/api/segments/${id}`, headers: ownerAuth });
    expect(reread.json().track_cadence).toBe('1h');
  });

  it('track_cadence=30m is accepted and derives a 30-min recompute', async () => {
    const id = await makeSegment();
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/segments/${id}`,
      headers: ownerAuth,
      payload: { track_cadence: '30m' },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().refresh_cadence_min).toBe(30);
  });

  it('track_cadence=Off stops auto recompute (null minutes), leaves capture cadence', async () => {
    const id = await makeSegment();
    // seed a non-default capture cadence first
    await app.inject({
      method: 'PATCH',
      url: `/api/segments/${id}`,
      headers: ownerAuth,
      payload: { snapshot_cadence: '6h' },
    });
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/segments/${id}`,
      headers: ownerAuth,
      payload: { track_cadence: 'Off' },
    });
    expect(patch.statusCode).toBe(200);
    const body = patch.json();
    expect(body.track_cadence).toBe('Off');
    expect(body.refresh_cadence_min).toBeNull();
    expect(body.snapshot_cadence).toBe('6h'); // capture cadence untouched by Off
  });

  it('rejects an out-of-set track_cadence value', async () => {
    const id = await makeSegment();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/segments/${id}`,
      headers: ownerAuth,
      payload: { track_cadence: '7m' },
    });
    expect(res.statusCode).toBe(400);
  });

  // Precedence contract when the unified knob and a legacy field arrive together.
  it('track_cadence wins over a co-sent snapshot_cadence', async () => {
    const id = await makeSegment();
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/segments/${id}`,
      headers: ownerAuth,
      payload: { track_cadence: '1h', snapshot_cadence: '6h' },
    });
    expect(patch.statusCode).toBe(200);
    const body = patch.json();
    expect(body.track_cadence).toBe('1h');
    expect(body.snapshot_cadence).toBe('1h'); // track derivation wins, not the co-sent 6h
    expect(body.refresh_cadence_min).toBe(60);
  });

  it('track_cadence wins over a co-sent refresh_cadence_min', async () => {
    const id = await makeSegment();
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/segments/${id}`,
      headers: ownerAuth,
      payload: { track_cadence: '3h', refresh_cadence_min: 999 },
    });
    expect(patch.statusCode).toBe(200);
    const body = patch.json();
    expect(body.track_cadence).toBe('3h');
    expect(body.refresh_cadence_min).toBe(180); // derived from track, not the co-sent 999
  });

  it('Off wins on recompute but the co-sent snapshot_cadence still applies', async () => {
    const id = await makeSegment();
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/segments/${id}`,
      headers: ownerAuth,
      payload: { track_cadence: 'Off', snapshot_cadence: '6h' },
    });
    expect(patch.statusCode).toBe(200);
    const body = patch.json();
    expect(body.track_cadence).toBe('Off');
    expect(body.refresh_cadence_min).toBeNull(); // Off → no auto recompute
    expect(body.snapshot_cadence).toBe('6h'); // Off leaves capture; co-sent value applies
  });
});
