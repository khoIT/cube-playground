/**
 * Integration tests for GET /api/preagg-runs, /current, and /:id.
 *
 * Uses real-auth mode (AUTH_DISABLED=false) with a JWT-signed admin token
 * to exercise the requireRole('admin') guard, mirroring admin-activity-route.test.ts.
 *
 * The /current endpoint calls computePreaggReadiness → the workspace config
 * falls back to the FALLBACK local workspace, which issues /load probes.
 * Those will fail in a test environment — the route must handle the error
 * gracefully (the readiness service returns an empty game list, not a 500).
 *
 * We stub computePreaggReadiness via a module-level env-gate: the route
 * calls getDefaultWorkspace() then computePreaggReadiness(). In a unit-test
 * context with no real Cube API, computePreaggReadiness returns an empty
 * games list because the workspace falls back to local with no reachable API.
 * We test the shape, not the count.
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
import { upsertSweep } from '../src/db/preagg-run-store.js';
import type { PreaggSweepInput, PreaggSweepItemInput } from '../src/types/preagg-run.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');
const JWT_SECRET = 'test-jwt-secret-preagg-must-be-16ch';

function makeMemDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  }
  return db;
}

function makeSweep(startedAt: string): PreaggSweepInput {
  return {
    startedAt,
    endedAt: startedAt,
    durationMs: 60_000,
    source: 'probe-snapshot',
    gamesCount: 1,
    rollupsTotal: 5,
    sealedCount: 4,
    staleCount: 1,
    failedCount: 0,
    unbuiltCount: 0,
    collectorStatus: 'online',
  };
}

function makeItem(sweepId: number): PreaggSweepItemInput {
  return {
    sweepId,
    game: 'cfm_vn',
    cube: 'active_daily',
    rollup: 'dau_batch',
    outcome: 'sealed',
    serveable: true,
    lastSealedAt: null,
    errorSig: null,
    errorMessage: null,
    observedAt: '2026-06-10T07:00:00.000Z',
  };
}

describe('preagg-runs routes', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let adminAuth: { authorization: string };
  let editorAuth: { authorization: string };
  let db: Database.Database;

  const prevEnv = {
    AUTH_DISABLED: process.env.AUTH_DISABLED,
    JWT_SECRET: process.env.JWT_SECRET,
    CUBESTORE_INTROSPECT_ENABLED: process.env.CUBESTORE_INTROSPECT_ENABLED,
  };

  beforeEach(async () => {
    process.env.AUTH_DISABLED = 'false';
    process.env.JWT_SECRET = JWT_SECRET;
    // Keep CubeStore introspection off so these tests never touch a live :3306 —
    // the routes must return enabled:false deterministically.
    process.env.CUBESTORE_INTROSPECT_ENABLED = 'false';

    db = makeMemDb();
    setDb(db);
    __resetAccessCache();

    upsertUserAccess({ email: 'admin@corp.com', role: 'admin', status: 'active' });
    upsertUserAccess({ email: 'editor@corp.com', role: 'editor', status: 'active' });
    db.prepare('UPDATE user_access SET kc_sub = ? WHERE email = ?').run('admin-sub', 'admin@corp.com');
    db.prepare('UPDATE user_access SET kc_sub = ? WHERE email = ?').run('editor-sub', 'editor@corp.com');

    adminAuth = {
      authorization: `Bearer ${await signAppJwt({ sub: 'admin-sub', email: 'admin@corp.com', role: 'admin' }, JWT_SECRET)}`,
    };
    editorAuth = {
      authorization: `Bearer ${await signAppJwt({ sub: 'editor-sub', email: 'editor@corp.com', role: 'editor' }, JWT_SECRET)}`,
    };

    app = await buildApp();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    closeDb();
    process.env.AUTH_DISABLED = prevEnv.AUTH_DISABLED;
    process.env.JWT_SECRET = prevEnv.JWT_SECRET;
    process.env.CUBESTORE_INTROSPECT_ENABLED = prevEnv.CUBESTORE_INTROSPECT_ENABLED;
  });

  // ── CubeStore storage introspection ──────────────────────────────────────

  describe('GET /api/preagg-runs/cubestore/tables', () => {
    it('returns 403 for editor role', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/preagg-runs/cubestore/tables', headers: editorAuth });
      expect(res.statusCode).toBe(403);
    });

    it('returns enabled:false (200) when introspection is off', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/preagg-runs/cubestore/tables', headers: adminAuth });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.enabled).toBe(false);
      expect(body.schemas).toEqual([]);
    });
  });

  describe('POST /api/preagg-runs/cubestore/query-cache', () => {
    it('400s on a missing/unknown game', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/preagg-runs/cubestore/query-cache', headers: adminAuth,
        payload: { game: 'no_such_game', query: { measures: ['x.y'] } },
      });
      expect(res.statusCode).toBe(400);
    });

    it('400s when the query object is missing', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/preagg-runs/cubestore/query-cache', headers: adminAuth,
        payload: { game: 'cfm_vn' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns enabled:false (200) for a valid request when introspection is off', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/preagg-runs/cubestore/query-cache', headers: adminAuth,
        payload: { game: 'cfm_vn', query: { measures: ['active_daily.dau'] } },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().enabled).toBe(false);
    });
  });

  // ── GET /api/preagg-runs ─────────────────────────────────────────────────

  describe('GET /api/preagg-runs', () => {
    it('returns 401 for unauthenticated request', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/preagg-runs' });
      expect(res.statusCode).toBe(401);
    });

    it('returns 403 for editor role', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/preagg-runs',
        headers: editorAuth,
      });
      expect(res.statusCode).toBe(403);
    });

    it('returns 200 with empty sweeps list when no data', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/preagg-runs',
        headers: adminAuth,
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { sweeps: unknown[] };
      expect(Array.isArray(body.sweeps)).toBe(true);
      expect(body.sweeps).toHaveLength(0);
    });

    it('returns seeded sweeps newest first', async () => {
      upsertSweep(db, makeSweep('2026-06-10T05:00:00.000Z'), []);
      upsertSweep(db, makeSweep('2026-06-10T07:00:00.000Z'), []);

      const res = await app.inject({
        method: 'GET',
        url: '/api/preagg-runs',
        headers: adminAuth,
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { sweeps: Array<{ startedAt: string }> };
      expect(body.sweeps).toHaveLength(2);
      expect(body.sweeps[0].startedAt).toBe('2026-06-10T07:00:00.000Z');
    });

    it('attaches built-work lines to sweeps that rebuilt partitions', async () => {
      upsertSweep(db, makeSweep('2026-06-10T05:00:00.000Z'), [
        {
          ...makeItem(0),
          game: 'muaw',
          cube: 'recharge',
          buildMs: 9_000,
          partitionsBuilt: 1,
          rollupsBuilt: [{ rollup: 'revenue_daily_by_channel_batch', partitions: 1, buildMs: 9_000 }],
        },
        makeItem(0), // sealed, nothing rebuilt — not in the summary
      ]);
      upsertSweep(db, makeSweep('2026-06-10T07:00:00.000Z'), [makeItem(0)]);

      const res = await app.inject({
        method: 'GET',
        url: '/api/preagg-runs',
        headers: adminAuth,
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as {
        sweeps: Array<{ startedAt: string; built?: Array<{ game: string; cube: string; rollups: string[]; partitions: number }> }>;
      };
      // newest sweep rebuilt nothing — no built field at all
      expect(body.sweeps[0].built).toBeUndefined();
      // older sweep names its built work
      expect(body.sweeps[1].built).toEqual([
        { game: 'muaw', cube: 'recharge', rollups: ['revenue_daily_by_channel_batch'], partitions: 1 },
      ]);
    });

    it('respects limit query param', async () => {
      for (let h = 0; h < 5; h++) {
        upsertSweep(db, makeSweep(`2026-06-10T0${h}:00:00.000Z`), []);
      }
      const res = await app.inject({
        method: 'GET',
        url: '/api/preagg-runs?limit=2',
        headers: adminAuth,
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { sweeps: unknown[] };
      expect(body.sweeps).toHaveLength(2);
    });
  });

  // ── GET /api/preagg-runs/:id ─────────────────────────────────────────────

  describe('GET /api/preagg-runs/:id', () => {
    it('returns 404 for unknown id', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/preagg-runs/99999',
        headers: adminAuth,
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 400 for non-integer id', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/preagg-runs/not-a-number',
        headers: adminAuth,
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns sweep with items for known id', async () => {
      const sweep = upsertSweep(db, makeSweep('2026-06-10T07:00:00.000Z'), [makeItem(0)]);

      const res = await app.inject({
        method: 'GET',
        url: `/api/preagg-runs/${sweep.id}`,
        headers: adminAuth,
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as {
        sweep: { id: number; sealedCount: number };
        items: Array<{ cube: string }>;
      };
      expect(body.sweep.id).toBe(sweep.id);
      expect(body.sweep.sealedCount).toBe(4);
      expect(body.items).toHaveLength(1);
      expect(body.items[0].cube).toBe('active_daily');
    });
  });

  // ── GET /api/preagg-runs/current ─────────────────────────────────────────

  describe('GET /api/preagg-runs/current', () => {
    it('returns 401 without auth', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/preagg-runs/current' });
      expect(res.statusCode).toBe(401);
    });

    it('returns 200 (never 500) with expected shape for admin', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/preagg-runs/current',
        headers: adminAuth,
      });
      // The probe runs in the background and is never awaited in the handler,
      // so a cold/unreachable Cube can't 500 this route. With no cache yet the
      // first call returns a calm warming snapshot (empty games, warming:true).
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as {
        summary: { gamesCount: number };
        collector: { status: string };
        warming?: boolean;
      };
      expect(typeof body.summary.gamesCount).toBe('number');
      expect(typeof body.warming).toBe('boolean');
      expect(['online', 'degraded', 'disabled']).toContain(body.collector.status);
    });
  });
});
