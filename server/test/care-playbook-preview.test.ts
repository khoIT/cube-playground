/**
 * POST /api/care/playbooks/:id/preview-count — READ-ONLY live count of a
 * candidate condition. The cohort fetcher (the only /load touch) is stubbed so
 * the test asserts the route's count == the fetched cohort size, the same
 * availability/eval guards the sweep uses, and that NO case rows are written.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Stub the cohort fetcher (the route's only live /load) to a fixed cohort, so
// the count is deterministic and no real Cube query runs. Keep the rest of the
// module real (mergePlaybooks/availability still drive the guards).
vi.mock('../src/care/care-case-sweep.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/care/care-case-sweep.js')>();
  return {
    ...actual,
    makeCubeCohortFetcher: vi.fn(() => async () => ({ uids: ['u1', 'u2', 'u3'] })),
  };
});

import { buildApp } from '../src/index.js';
import { setDb, closeDb } from '../src/db/sqlite.js';
import { resetAvailabilityCache } from '../src/care/availability.js';
import { listCases } from '../src/care/care-case-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');

function makeMemDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  }
  return db;
}

// jus-like /meta: payment + activity cubes, NO gameplay/event tables.
const JUS_META = {
  cubes: [
    {
      name: 'mf_users',
      dimensions: [
        { name: 'mf_users.first_recharge_date' },
        { name: 'mf_users.first_active_date' },
        { name: 'mf_users.days_since_last_active' },
      ],
      measures: [{ name: 'mf_users.ltv_total_vnd' }, { name: 'mf_users.count' }],
    },
    {
      name: 'user_recharge_daily',
      dimensions: [{ name: 'user_recharge_daily.log_date' }],
      measures: [{ name: 'user_recharge_daily.revenue_vnd' }],
    },
  ],
};

const URL_BASE = '/api/care/playbooks';

describe('POST /api/care/playbooks/:id/preview-count', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    setDb(makeMemDb());
    resetAvailabilityCache();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => JUS_META })));
    app = await buildApp();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (app) await app.close();
    closeDb();
  });

  it('returns the cohort size for an available abs condition, and writes nothing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${URL_BASE}/new/preview-count?game=jus_vn`,
      payload: { condition: { kind: 'abs', member: 'mf_users.ltv_total_vnd', op: 'gte', value: 50_000_000 } },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.matched).toBe(3); // == stubbed cohort
    expect(body.gated).toBe(true); // VIP-base member present
    expect(typeof body.elapsedMs).toBe('number');

    // READ-ONLY: a preview must never open a case.
    expect(listCases({ gameId: 'jus_vn' })).toHaveLength(0);
  });

  it('409 when the condition references members absent from the game', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${URL_BASE}/06/preview-count?game=jus_vn`,
      payload: { condition: { kind: 'abs', member: 'leaderboard.rank', op: 'lte', value: 100 } },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('PLAYBOOK_UNAVAILABLE');
  });

  it('ratio rules have no static cohort → matched 0 with a note', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${URL_BASE}/04/preview-count?game=jus_vn`,
      payload: {
        condition: {
          kind: 'ratio',
          member: 'user_recharge_daily.revenue_vnd',
          vs: 'user_recharge_daily.revenue_vnd',
          op: 'lt',
          value: 0.5,
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.matched).toBe(0);
    expect(body.note).toBeTruthy();
  });

  it('fails closed when the condition compiles to an empty filter (no full-cohort count)', async () => {
    // 'next 3 days' is an unsupported future window the translator drops → empty
    // filter → must report 0, NOT the whole VIP base.
    const res = await app.inject({
      method: 'POST',
      url: `${URL_BASE}/new/preview-count?game=jus_vn`,
      payload: { condition: { kind: 'event', member: 'mf_users.first_recharge_date', window: 'next 3 days' } },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.matched).toBe(0);
    expect(body.note).toContain('empty filter');
  });

  it('400 on a missing game', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${URL_BASE}/new/preview-count`,
      payload: { condition: { kind: 'abs', member: 'mf_users.ltv_total_vnd', op: 'gte', value: 1 } },
    });
    expect(res.statusCode).toBe(400);
  });
});
