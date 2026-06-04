/**
 * Emit-point integration — a real user action lands exactly one activity_events
 * row keyed on the actor's sub with the right shape. Run under real auth so the
 * recorded `actor_sub` is the JWT sub (not a dev synth admin).
 *
 * query_run is exercised by the projector unit test (activity-store.test.ts) —
 * the cube-proxy path needs a live upstream Cube, out of scope for an in-process
 * inject. segment_op and feature_open are fully in-process and covered here.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/index.js';
import { setDb, getDb, closeDb } from '../src/db/sqlite.js';
import { signAppJwt } from '../src/services/app-jwt.js';
import { __resetAccessCache } from '../src/auth/access-store.js';
import { upsertUserAccess } from '../src/auth/access-store-mutators.js';
import { queryActivity } from '../src/services/activity-store.js';

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

describe('activity emit points (real-auth)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const prev = { AUTH_DISABLED: process.env.AUTH_DISABLED, JWT_SECRET: process.env.JWT_SECRET };
  let aliceAuth: { authorization: string };

  beforeEach(async () => {
    process.env.AUTH_DISABLED = 'false';
    process.env.JWT_SECRET = JWT_SECRET;
    setDb(makeMemDb());
    __resetAccessCache();
    upsertUserAccess({ email: 'alice@corp.com', role: 'editor', status: 'active' });
    app = await buildApp();
    aliceAuth = { authorization: `Bearer ${await signAppJwt({ sub: 'alice-sub', username: 'alice', email: 'alice@corp.com', role: 'editor' })}` };
  });

  afterEach(async () => {
    if (app) await app.close();
    closeDb();
    process.env.AUTH_DISABLED = prev.AUTH_DISABLED;
    process.env.JWT_SECRET = prev.JWT_SECRET;
  });

  it('a segment create emits exactly one segment_op row keyed on the actor sub', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/segments',
      headers: aliceAuth,
      payload: { name: 'cohort', type: 'manual' },
    });
    expect(res.statusCode).toBe(201);
    const segId = res.json().id;

    const rows = queryActivity(getDb(), { actorSub: 'alice-sub', eventType: 'segment_op' });
    expect(rows).toHaveLength(1);
    expect(rows[0].actorSub).toBe('alice-sub');
    expect(rows[0].actorEmail).toBe('alice@corp.com');
    expect(rows[0].targetType).toBe('segment');
    expect(rows[0].targetId).toBe(segId);
    expect(JSON.parse(rows[0].detailJson!)).toEqual({ action: 'create' });
  });

  it('a feature-open beacon emits one feature_open row; unknown keys are rejected', async () => {
    const ok = await app.inject({
      method: 'POST',
      url: '/api/activity',
      headers: aliceAuth,
      payload: { eventType: 'feature_open', targetId: 'segments' },
    });
    expect(ok.statusCode).toBe(202);

    const bad = await app.inject({
      method: 'POST',
      url: '/api/activity',
      headers: aliceAuth,
      payload: { eventType: 'feature_open', targetId: 'not-a-feature' },
    });
    expect(bad.statusCode).toBe(400);

    const rows = queryActivity(getDb(), { actorSub: 'alice-sub', eventType: 'feature_open' });
    expect(rows).toHaveLength(1);
    expect(rows[0].targetId).toBe('segments');
  });

  it('accepts export + workspace_switch but rejects a server-only event type', async () => {
    const exp = await app.inject({
      method: 'POST',
      url: '/api/activity',
      headers: aliceAuth,
      payload: { eventType: 'export', targetType: 'chart', targetId: 'cohort-grid' },
    });
    expect(exp.statusCode).toBe(202);

    const sw = await app.inject({
      method: 'POST',
      url: '/api/activity',
      headers: aliceAuth,
      payload: { eventType: 'workspace_switch', targetId: 'prod' },
    });
    expect(sw.statusCode).toBe(202);

    // query_run is server-emitted only — a client must not be able to forge it.
    const forged = await app.inject({
      method: 'POST',
      url: '/api/activity',
      headers: aliceAuth,
      payload: { eventType: 'query_run' },
    });
    expect(forged.statusCode).toBe(400);

    expect(queryActivity(getDb(), { actorSub: 'alice-sub', eventType: 'export' })).toHaveLength(1);
    expect(queryActivity(getDb(), { actorSub: 'alice-sub', eventType: 'workspace_switch' })).toHaveLength(1);
    expect(queryActivity(getDb(), { actorSub: 'alice-sub', eventType: 'query_run' })).toHaveLength(0);
  });

  it('records cube_outage edges (recovered carries duration); bad phase is rejected', async () => {
    const down = await app.inject({
      method: 'POST',
      url: '/api/activity',
      headers: aliceAuth,
      payload: { eventType: 'cube_outage', targetId: 'unreachable' },
    });
    expect(down.statusCode).toBe(202);

    const up = await app.inject({
      method: 'POST',
      url: '/api/activity',
      headers: aliceAuth,
      payload: { eventType: 'cube_outage', targetId: 'recovered', durationMs: 45_000 },
    });
    expect(up.statusCode).toBe(202);

    // Phase must be one of the known edges — an arbitrary string is rejected.
    const bad = await app.inject({
      method: 'POST',
      url: '/api/activity',
      headers: aliceAuth,
      payload: { eventType: 'cube_outage', targetId: 'flapping' },
    });
    expect(bad.statusCode).toBe(400);

    const rows = queryActivity(getDb(), { actorSub: 'alice-sub', eventType: 'cube_outage' });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.targetType === 'cube_api')).toBe(true);
    const recovered = rows.find((r) => r.targetId === 'recovered');
    expect(JSON.parse(recovered!.detailJson!)).toEqual({ durationMs: 45_000 });
    // The 'unreachable' edge has no duration to record.
    const unreachable = rows.find((r) => r.targetId === 'unreachable');
    expect(unreachable!.detailJson).toBeNull();
  });
});
