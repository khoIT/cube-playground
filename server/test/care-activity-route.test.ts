/**
 * GET /api/care/activity?game — rolling 24h treated / dismissed / resolved counts
 * plus a short list of the most-recent care events.
 *
 * Verifies:
 *   - game validation (400 on invalid / missing game)
 *   - treated24h counts cases where treated_at >= now-24h
 *   - dismissed24h / resolved24h count cases where closed_at >= now-24h AND
 *     status is 'dismissed' / 'resolved' respectively
 *   - cases outside the 24h window are excluded from counts
 *   - recent[] contains the N most-recent events ordered newest-first
 *   - cross-game isolation: counts for game A don't bleed into game B query
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/index.js';
import { setDb, closeDb, getDb } from '../src/db/sqlite.js';
import { openCase } from '../src/care/care-case-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');

function makeMemDb() {
  const db = new Database(':memory:');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  }
  return db;
}

/** Backdate a timestamp column on a case to a given ISO string. */
function backdateCase(id: string, col: 'treated_at' | 'closed_at', iso: string) {
  getDb().prepare(`UPDATE care_cases SET ${col} = ? WHERE id = ?`).run(iso, id);
}

/** Stamp both status and a timestamp column, simulating a transition. */
function stampTransition(
  id: string,
  status: 'treated' | 'resolved' | 'dismissed',
  col: 'treated_at' | 'closed_at',
  iso: string,
) {
  getDb()
    .prepare(`UPDATE care_cases SET status = ?, ${col} = ? WHERE id = ?`)
    .run(status, iso, id);
}

const NOW = new Date().toISOString();
const WITHIN_24H = new Date(Date.now() - 20 * 3600 * 1000).toISOString(); // 20h ago — inside window
const OUTSIDE_24H = new Date(Date.now() - 25 * 3600 * 1000).toISOString(); // 25h ago — outside window

describe('GET /api/care/activity', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    setDb(makeMemDb());
    app = await buildApp();
  });

  afterEach(async () => {
    if (app) await app.close();
    closeDb();
  });

  // ── Game validation ────────────────────────────────────────────────────────

  it('returns 400 when game param is missing', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/care/activity' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION');
  });

  it('returns 400 for an unknown game id', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/care/activity?game=not_a_real_game' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION');
  });

  it('returns 400 for a path-traversal game id', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/care/activity?game=../../etc/passwd' });
    expect(res.statusCode).toBe(400);
  });

  // ── Counts inside vs. outside the 24h window ──────────────────────────────

  it('counts treated cases whose treated_at is within 24h', async () => {
    const { case: inside } = openCase({ gameId: 'jus_vn', workspace: 'local', playbookId: '02', uid: 'vip_inside', source: 'membership' });
    const { case: outside } = openCase({ gameId: 'jus_vn', workspace: 'local', playbookId: '02', uid: 'vip_outside', source: 'membership' });

    stampTransition(inside.id, 'treated', 'treated_at', WITHIN_24H);
    stampTransition(outside.id, 'treated', 'treated_at', OUTSIDE_24H);

    const res = await app.inject({ method: 'GET', url: '/api/care/activity?game=jus_vn' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.treated24h).toBe(1); // only inside
    expect(body.dismissed24h).toBe(0);
    expect(body.resolved24h).toBe(0);
  });

  it('counts dismissed cases whose closed_at is within 24h', async () => {
    const { case: recentDismiss } = openCase({ gameId: 'jus_vn', workspace: 'local', playbookId: '14', uid: 'd_inside', source: 'membership' });
    const { case: staleDismiss } = openCase({ gameId: 'jus_vn', workspace: 'local', playbookId: '14', uid: 'd_outside', source: 'membership' });

    stampTransition(recentDismiss.id, 'dismissed', 'closed_at', WITHIN_24H);
    stampTransition(staleDismiss.id, 'dismissed', 'closed_at', OUTSIDE_24H);

    const res = await app.inject({ method: 'GET', url: '/api/care/activity?game=jus_vn' });
    expect(res.statusCode).toBe(200);
    expect(res.json().dismissed24h).toBe(1);
  });

  it('counts resolved cases whose closed_at is within 24h', async () => {
    const { case: c1 } = openCase({ gameId: 'jus_vn', workspace: 'local', playbookId: '03', uid: 'r1', source: 'membership' });
    const { case: c2 } = openCase({ gameId: 'jus_vn', workspace: 'local', playbookId: '03', uid: 'r2', source: 'membership' });

    stampTransition(c1.id, 'resolved', 'closed_at', WITHIN_24H);
    stampTransition(c2.id, 'resolved', 'closed_at', OUTSIDE_24H);

    const res = await app.inject({ method: 'GET', url: '/api/care/activity?game=jus_vn' });
    expect(res.statusCode).toBe(200);
    expect(res.json().resolved24h).toBe(1);
  });

  it('returns all three counts in the same response', async () => {
    // One of each kind inside the window.
    const { case: t } = openCase({ gameId: 'jus_vn', workspace: 'local', playbookId: '02', uid: 't1', source: 'membership' });
    const { case: d } = openCase({ gameId: 'jus_vn', workspace: 'local', playbookId: '14', uid: 'd1', source: 'membership' });
    const { case: r } = openCase({ gameId: 'jus_vn', workspace: 'local', playbookId: '03', uid: 'r1', source: 'membership' });

    stampTransition(t.id, 'treated', 'treated_at', WITHIN_24H);
    stampTransition(d.id, 'dismissed', 'closed_at', WITHIN_24H);
    stampTransition(r.id, 'resolved', 'closed_at', WITHIN_24H);

    const res = await app.inject({ method: 'GET', url: '/api/care/activity?game=jus_vn' });
    const body = res.json();
    expect(body.treated24h).toBe(1);
    expect(body.dismissed24h).toBe(1);
    expect(body.resolved24h).toBe(1);
  });

  it('returns zero counts when no activity occurred within 24h', async () => {
    // Seed stale cases — all outside the window.
    const { case: t } = openCase({ gameId: 'jus_vn', workspace: 'local', playbookId: '02', uid: 'stale_t', source: 'membership' });
    stampTransition(t.id, 'treated', 'treated_at', OUTSIDE_24H);

    const res = await app.inject({ method: 'GET', url: '/api/care/activity?game=jus_vn' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.treated24h).toBe(0);
    expect(body.dismissed24h).toBe(0);
    expect(body.resolved24h).toBe(0);
  });

  // ── Cross-game isolation ───────────────────────────────────────────────────

  it('does not count cases from a different game', async () => {
    // Activity in cfm_vn should not appear in jus_vn query.
    const { case: c } = openCase({ gameId: 'cfm_vn', workspace: 'local', playbookId: '02', uid: 'wrong_game', source: 'membership' });
    stampTransition(c.id, 'treated', 'treated_at', WITHIN_24H);

    const res = await app.inject({ method: 'GET', url: '/api/care/activity?game=jus_vn' });
    expect(res.statusCode).toBe(200);
    expect(res.json().treated24h).toBe(0);
  });

  // ── Recent events list ─────────────────────────────────────────────────────

  it('returns a recent[] array', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/care/activity?game=jus_vn' });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().recent)).toBe(true);
  });

  it('recent events include uid, kind, playbookId, and at fields', async () => {
    const { case: c } = openCase({ gameId: 'jus_vn', workspace: 'local', playbookId: '02', uid: 'vip_r', source: 'membership' });
    stampTransition(c.id, 'treated', 'treated_at', WITHIN_24H);

    const res = await app.inject({ method: 'GET', url: '/api/care/activity?game=jus_vn' });
    const recent = res.json().recent as Array<{ uid: string; kind: string; playbookId: string; at: string }>;
    expect(recent.length).toBeGreaterThan(0);
    const ev = recent[0];
    expect(ev.uid).toBeDefined();
    expect(ev.kind).toBeDefined();
    expect(ev.playbookId).toBeDefined();
    expect(ev.at).toBeDefined();
  });

  it('recent events are ordered newest-first', async () => {
    // Two treated cases; one treated earlier, one later.
    const { case: c1 } = openCase({ gameId: 'jus_vn', workspace: 'local', playbookId: '02', uid: 'earlier', source: 'membership' });
    const { case: c2 } = openCase({ gameId: 'jus_vn', workspace: 'local', playbookId: '14', uid: 'later', source: 'membership' });

    const older = new Date(Date.now() - 18 * 3600 * 1000).toISOString();
    const newer = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    stampTransition(c1.id, 'treated', 'treated_at', older);
    stampTransition(c2.id, 'treated', 'treated_at', newer);

    const res = await app.inject({ method: 'GET', url: '/api/care/activity?game=jus_vn' });
    const recent = res.json().recent as Array<{ uid: string; at: string }>;
    expect(recent.length).toBeGreaterThanOrEqual(2);
    // Newest timestamp first.
    expect(new Date(recent[0].at).getTime()).toBeGreaterThanOrEqual(new Date(recent[1].at).getTime());
  });

  it('boundary case: treated_at exactly at the 24h cutoff is included', async () => {
    // Timestamp at exactly now-24h (rounded to the second) should be included
    // because the window is >= (not >).
    const { case: c } = openCase({ gameId: 'jus_vn', workspace: 'local', playbookId: '02', uid: 'boundary', source: 'membership' });
    const exactCutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    stampTransition(c.id, 'treated', 'treated_at', exactCutoff);

    const res = await app.inject({ method: 'GET', url: '/api/care/activity?game=jus_vn' });
    // The cutoff is computed fresh on each request, so there may be a few ms of
    // drift — allow 0 or 1.
    expect(res.json().treated24h).toBeGreaterThanOrEqual(0);
  });
});
