/**
 * GET /api/care/playbooks?game= — merged registry + per-game availability,
 * with /meta stubbed via the global fetch mock. Verifies the route greys NHÓM 2
 * for a game whose gameplay cubes are absent and fails closed when /meta errors.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/index.js';
import { setDb, closeDb } from '../src/db/sqlite.js';
import { resetAvailabilityCache } from '../src/care/availability.js';

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
      dimensions: [{ name: 'user_recharge_daily.recharge_date' }],
      measures: [{ name: 'user_recharge_daily.revenue_vnd' }],
    },
    {
      name: 'active_daily',
      dimensions: [{ name: 'active_daily.active_date' }],
      measures: [{ name: 'active_daily.online_time_sec' }],
    },
  ],
};

describe('GET /api/care/playbooks', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    setDb(makeMemDb());
    resetAvailabilityCache();
    app = await buildApp();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (app) await app.close();
    closeDb();
  });

  it('400 when game is missing', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/care/playbooks' });
    expect(res.statusCode).toBe(400);
  });

  it('jus_vn: 21 playbooks, NHÓM 2 unavailable, payment/churn available', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => JUS_META })));
    const res = await app.inject({ method: 'GET', url: '/api/care/playbooks?game=jus_vn' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.playbooks).toHaveLength(21);
    expect(body.meta_members).toBeGreaterThan(0);

    const byId = Object.fromEntries(body.playbooks.map((p: { id: string }) => [p.id, p]));
    expect(byId['02'].availability).toBe('available'); // VIP tier
    expect(byId['14'].availability).toBe('available'); // no-login
    expect(byId['06'].availability).toBe('unavailable'); // leaderboard (no gameplay cube)
    expect(byId['12'].availability).toBe('unavailable'); // gacha
    expect(byId['05'].availability).toBe('unavailable'); // payment failure (blocked)
    expect(byId['19'].availability).toBe('partial'); // pre-patch (ops)
    expect(body.counts.total).toBe(21);
  });

  it('fails closed (all unavailable) when /meta is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, text: async () => 'boom' })));
    const res = await app.inject({ method: 'GET', url: '/api/care/playbooks?game=jus_vn' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.meta_members).toBe(0);
    // ops-driven (19,20) still partial; everything member-gated is unavailable.
    expect(body.counts.available).toBe(0);
    expect(body.counts.partial).toBe(2);
  });
});
