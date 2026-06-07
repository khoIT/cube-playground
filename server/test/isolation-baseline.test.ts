/**
 * Golden regression lock for per-user isolation + identity.
 *
 * These pin the CURRENT, CORRECT behaviour that later phases MUST NOT regress:
 *   - dashboards are owner(sub)-scoped: another owner never sees them;
 *   - dev-mode owner is deterministic (X-Owner overrides; default = first bootstrap admin);
 *   - req.principal threads the same sub the owned-artifact routes scope by.
 *
 * One block is explicitly a FIXTURE-TO-REPLACE, not a lock: today the segment
 * LIST returns every workspace segment regardless of owner because it never
 * filters on visibility. Phase 2 intentionally flips this to owner-private; the
 * assertion below documents the pre-flip behaviour so that change is a reviewed
 * diff, not a silent regression. Default-deny (real-auth 403) is locked by
 * auth-callback-default-deny.test.ts + admin-access-api.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/index.js';
import { setDb, closeDb } from '../src/db/sqlite.js';

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

describe('isolation baseline — INVARIANT LOCKS', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    setDb(makeMemDb());
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
    closeDb();
  });

  it('LOCK: dashboards are owner(sub)-scoped — another owner never sees them', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/dashboards',
      headers: { 'x-owner': 'alice-sub', 'x-cube-workspace': 'local' },
      payload: { game: 'ballistar', slug: 'alice-board', title: 'Alice Board' },
    });
    expect(created.statusCode).toBe(201);

    // Owner sees it.
    const mine = await app.inject({
      method: 'GET',
      url: '/api/dashboards?game=ballistar',
      headers: { 'x-owner': 'alice-sub', 'x-cube-workspace': 'local' },
    });
    expect((mine.json() as Array<{ slug: string }>).some((d) => d.slug === 'alice-board')).toBe(true);

    // A different owner must NOT see alice's custom dashboard.
    const theirs = await app.inject({
      method: 'GET',
      url: '/api/dashboards?game=ballistar',
      headers: { 'x-owner': 'bob-sub', 'x-cube-workspace': 'local' },
    });
    expect((theirs.json() as Array<{ slug: string }>).some((d) => d.slug === 'alice-board')).toBe(false);
  });

  it('LOCK: dev owner is deterministic — X-Owner overrides, default is the bootstrap admin', async () => {
    const withHeader = await app.inject({
      method: 'POST',
      url: '/api/segments',
      headers: { 'x-owner': 'pinned-owner' },
      payload: { name: 'S1', type: 'manual' },
    });
    expect(withHeader.json().owner).toBe('pinned-owner');

    const noHeader = await app.inject({
      method: 'POST',
      url: '/api/segments',
      payload: { name: 'S2', type: 'manual' },
    });
    expect(noHeader.json().owner).toBe('khoitn@vng.com.vn');
  });

  it('FIXTURE-TO-REPLACE (Phase 2 flips to owner-private): LIST returns all workspace segments regardless of owner', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/segments',
      headers: { 'x-owner': 'alice-sub', 'x-cube-workspace': 'local' },
      payload: { name: 'alice-seg', type: 'manual' },
    });

    // Today bob sees alice's segment because LIST never filters on visibility.
    const bobList = await app.inject({
      method: 'GET',
      url: '/api/segments',
      headers: { 'x-owner': 'bob-sub', 'x-cube-workspace': 'local' },
    });
    const names = (bobList.json() as Array<{ name: string }>).map((s) => s.name);
    expect(names).toContain('alice-seg');
  });
});
