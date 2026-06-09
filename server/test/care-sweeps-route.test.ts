/**
 * Sweep comparison routes: runs list / trend / diff / diff-vips — game validation,
 * cross-game run leakage guard, entered/left diff envelope, and pagination params.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/index.js';
import { setDb, closeDb } from '../src/db/sqlite.js';
import { recordSweep } from '../src/care/care-sweep-run-store.js';
import type { PlaybookSweepSummary } from '../src/care/care-case-sweep.js';

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

const pb = (id: string, uids: string[]): PlaybookSweepSummary => ({
  playbookId: id, cohortSize: uids.length, opened: uids.length, lapsed: 0, alreadyOpen: 0, uids,
});
const run = (game: string, startedAt: string) => ({
  game, workspaceId: 'local', source: 'manual' as const, startedAt, finishedAt: startedAt,
  openedTotal: 1, lapsedTotal: 0, profilesRefreshed: 0,
});

describe('care sweep comparison routes', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let runA: string;
  let runB: string;

  beforeEach(async () => {
    setDb(makeMemDb());
    app = await buildApp();
    runA = recordSweep(run('jus_vn', '2026-06-08T00:00:00Z'), [pb('01', ['a', 'b'])]);
    runB = recordSweep(run('jus_vn', '2026-06-09T00:00:00Z'), [pb('01', ['b', 'c'])]);
  });
  afterEach(async () => {
    if (app) await app.close();
    closeDb();
  });

  it('lists runs and trend for a game (viewer-ok read)', async () => {
    const runs = await app.inject({ method: 'GET', url: '/api/care/sweeps/runs?game=jus_vn' });
    expect(runs.statusCode).toBe(200);
    expect(runs.json().runs).toHaveLength(2);

    const trend = await app.inject({ method: 'GET', url: '/api/care/sweeps/trend?game=jus_vn' });
    expect(trend.statusCode).toBe(200);
    expect(trend.json().trends[0].points).toHaveLength(2);
  });

  it('diffs two runs: entered=B\\A, left=A\\B', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/care/sweeps/diff?game=jus_vn&runA=${runA}&runB=${runB}` });
    expect(res.statusCode).toBe(200);
    const d01 = res.json().playbooks.find((p: { playbookId: string }) => p.playbookId === '01');
    expect(d01.enteredCount).toBe(1); // c
    expect(d01.leftCount).toBe(1); // a
  });

  it('blocks cross-game run leakage (runs of jus_vn requested under another game) → 400', async () => {
    // cfm_vn is a valid game but these runs belong to jus_vn.
    const res = await app.inject({ method: 'GET', url: `/api/care/sweeps/diff?game=cfm_vn&runA=${runA}&runB=${runB}` });
    expect(res.statusCode).toBe(400);
  });

  it('diff/vips requires a playbook and paginates entered VIPs', async () => {
    const missing = await app.inject({ method: 'GET', url: `/api/care/sweeps/diff/vips?game=jus_vn&runA=${runA}&runB=${runB}` });
    expect(missing.statusCode).toBe(400);

    const ok = await app.inject({
      method: 'GET',
      url: `/api/care/sweeps/diff/vips?game=jus_vn&runA=${runA}&runB=${runB}&playbook=01&direction=entered&page=1&pageSize=50`,
    });
    expect(ok.statusCode).toBe(200);
    const b = ok.json();
    expect(b.vips.map((v: { uid: string }) => v.uid)).toEqual(['c']); // entered B\A
    expect(b.total).toBe(1);
    expect(b.membershipAvailable).toBe(true);
  });

  it('rejects an unknown game on the sweeps routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/care/sweeps/runs?game=not_a_game' });
    expect(res.statusCode).toBe(400);
  });
});
