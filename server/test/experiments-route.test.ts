/**
 * Experiment routes — create / assign / scorecard over an in-memory DB. The
 * outcome reader is mocked (no Trino); the cube outcome path itself is covered
 * by experiment-outcome-reader.test. Runs in AUTH_DISABLED (dev = bootstrap
 * admin) so the write-gated mutations pass without minting JWTs.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

vi.mock('../src/experiments/experiment-outcome-reader.js', () => ({
  readOutcomes: vi.fn(async (_ctx, treatment: string[], control: string[]) => ({
    arms: [
      { arm: 'treatment', assigned: treatment.length, payers: Math.round(treatment.length * 0.25), grossVnd: 5_000_000, txns: 40 },
      { arm: 'control', assigned: control.length, payers: Math.round(control.length * 0.15), grossVnd: 3_000_000, txns: 25 },
    ],
    series: [{ date: '2026-06-15', treatmentGrossVnd: 5_000_000, controlGrossVnd: 3_000_000 }],
    currencies: ['VND'],
  })),
}));

import { buildApp } from '../src/index.js';
import { setDb, closeDb, getDb } from '../src/db/sqlite.js';
import { signAppJwt } from '../src/services/app-jwt.js';
import { __resetAccessCache } from '../src/auth/access-store.js';
import { upsertUserAccess } from '../src/auth/access-store-mutators.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');

function makeMemDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  }
  return db;
}

function seedSegment(id: string, gameId: string, n: number): void {
  getDb()
    .prepare(
      `INSERT INTO segments (id, name, type, owner, game_id, uid_count, uid_list_json)
       VALUES (?, ?, 'predicate', 'dev', ?, ?, ?)`,
    )
    .run(id, `seg ${id}`, gameId, n, JSON.stringify(Array.from({ length: n }, (_, i) => `u${i}`)));
}

describe('experiments routes', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const prev = process.env.AUTH_DISABLED;

  beforeEach(async () => {
    process.env.AUTH_DISABLED = 'true';
    setDb(makeMemDb());
    seedSegment('seg-1', 'cfm_vn', 400);
    app = await buildApp();
  });
  afterEach(async () => {
    if (app) await app.close();
    closeDb();
    process.env.AUTH_DISABLED = prev;
  });

  async function createExp(body: Record<string, unknown>) {
    return app.inject({ method: 'POST', url: '/api/experiments', payload: body });
  }

  it('creates a draft from a segment', async () => {
    const res = await createExp({ game: 'cfm_vn', name: 'Win-back test', segmentId: 'seg-1', splitPct: 50 });
    expect(res.statusCode).toBe(201);
    const exp = (res.json() as { experiment: { id: string; status: string } }).experiment;
    expect(exp.status).toBe('draft');

    const list = await app.inject({ method: 'GET', url: '/api/experiments?game=cfm_vn' });
    expect((list.json() as { experiments: unknown[] }).experiments).toHaveLength(1);
  });

  it('list carries per-row arm counts and supports a segment filter', async () => {
    seedSegment('seg-2', 'cfm_vn', 100);
    const a = (await createExp({ game: 'cfm_vn', name: 'On seg-1', segmentId: 'seg-1', splitPct: 50 })).json() as {
      experiment: { id: string };
    };
    await createExp({ game: 'cfm_vn', name: 'On seg-2', segmentId: 'seg-2', splitPct: 50 });
    // Freeze the first so it has real arm counts.
    await app.inject({ method: 'POST', url: `/api/experiments/${a.experiment.id}/assign` });

    const all = (await app.inject({ method: 'GET', url: '/api/experiments?game=cfm_vn' })).json() as {
      experiments: { segmentId: string; arms: { treatment: number; control: number } }[];
    };
    expect(all.experiments).toHaveLength(2);
    const frozen = all.experiments.find((e) => e.segmentId === 'seg-1')!;
    expect(frozen.arms.treatment + frozen.arms.control).toBe(400);

    // Segment filter narrows to one segment's experiments.
    const filtered = (await app.inject({ method: 'GET', url: '/api/experiments?game=cfm_vn&segment=seg-2' })).json() as {
      experiments: { segmentId: string }[];
    };
    expect(filtered.experiments).toHaveLength(1);
    expect(filtered.experiments[0].segmentId).toBe('seg-2');
  });

  it('400 on unknown game, 404 on missing segment, 400 on cross-game segment', async () => {
    expect((await createExp({ game: 'nope_game', name: 'X test', segmentId: 'seg-1' })).statusCode).toBe(400);
    expect((await createExp({ game: 'cfm_vn', name: 'X test', segmentId: 'ghost' })).statusCode).toBe(404);
    seedSegment('seg-jus', 'jus_vn', 10);
    expect((await createExp({ game: 'cfm_vn', name: 'X test', segmentId: 'seg-jus' })).statusCode).toBe(400);
  });

  it('assign freezes the split and scorecard returns real-shaped lift', async () => {
    const exp = (await createExp({ game: 'cfm_vn', name: 'Freeze test', segmentId: 'seg-1', splitPct: 50 })).json() as {
      experiment: { id: string };
    };
    const id = exp.experiment.id;

    // Scorecard before assign → 409.
    expect((await app.inject({ method: 'GET', url: `/api/experiments/${id}/scorecard` })).statusCode).toBe(409);

    const assign = await app.inject({ method: 'POST', url: `/api/experiments/${id}/assign` });
    expect(assign.statusCode).toBe(200);
    const a = (assign.json() as { assignment: { total: number } }).assignment;
    expect(a.total).toBe(400);

    const sc = await app.inject({ method: 'GET', url: `/api/experiments/${id}/scorecard` });
    expect(sc.statusCode).toBe(200);
    const body = sc.json() as { scorecard: { repayRate: { liftPp: number }; verdict: string }; arms: unknown[] };
    expect(body.arms).toHaveLength(2);
    expect(body.scorecard.repayRate.liftPp).toBeGreaterThan(0);
  });

  it('404 for an unknown experiment id', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/experiments/nope' })).statusCode).toBe(404);
  });
});

describe('experiments routes — write-role gate (real-auth)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const prev = { AUTH_DISABLED: process.env.AUTH_DISABLED, JWT_SECRET: process.env.JWT_SECRET };
  const JWT_SECRET = 'test-jwt-secret-must-be-at-least-16-chars';

  beforeEach(async () => {
    process.env.AUTH_DISABLED = 'false';
    process.env.JWT_SECRET = JWT_SECRET;
    setDb(makeMemDb());
    seedSegment('seg-1', 'cfm_vn', 40);
    __resetAccessCache();
    upsertUserAccess({ email: 'viewer@corp.com', role: 'viewer', status: 'active' });
    upsertUserAccess({ email: 'editor@corp.com', role: 'editor', status: 'active' });
    app = await buildApp();
  });
  afterEach(async () => {
    if (app) await app.close();
    closeDb();
    process.env.AUTH_DISABLED = prev.AUTH_DISABLED;
    process.env.JWT_SECRET = prev.JWT_SECRET;
  });

  it('blocks a viewer from creating an experiment, allows an editor', async () => {
    const viewer = { authorization: `Bearer ${await signAppJwt({ sub: 'v', username: 'v', email: 'viewer@corp.com', role: 'viewer' })}` };
    const editor = { authorization: `Bearer ${await signAppJwt({ sub: 'e', username: 'e', email: 'editor@corp.com', role: 'editor' })}` };
    const body = { game: 'cfm_vn', name: 'Gate test', segmentId: 'seg-1' };

    const denied = await app.inject({ method: 'POST', url: '/api/experiments', payload: body, headers: viewer });
    expect(denied.statusCode).toBe(403);

    const ok = await app.inject({ method: 'POST', url: '/api/experiments', payload: body, headers: editor });
    expect(ok.statusCode).toBe(201);

    // A viewer also can't freeze the assignment.
    const id = (ok.json() as { experiment: { id: string } }).experiment.id;
    const assignDenied = await app.inject({ method: 'POST', url: `/api/experiments/${id}/assign`, headers: viewer });
    expect(assignDenied.statusCode).toBe(403);
  });

  it('allows a viewer to READ the experiment list (reads stay open)', async () => {
    const viewer = { authorization: `Bearer ${await signAppJwt({ sub: 'v', username: 'v', email: 'viewer@corp.com', role: 'viewer' })}` };
    const res = await app.inject({ method: 'GET', url: '/api/experiments?game=cfm_vn', headers: viewer });
    expect(res.statusCode).toBe(200);
  });
});
