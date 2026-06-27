/**
 * Serving lifecycle endpoints + the demote kill-switch at the public pull path.
 *
 * Runs as the bootstrap admin (AUTH_DISABLED), so it covers the publish/demote
 * behaviour and the lifecycle gate; the non-admin 403 path reuses the same
 * guardSegment('administer') gate already covered by the share/delete tests.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { buildApp } from '../src/index.js';
import { setDb, getDb, closeDb } from '../src/db/sqlite.js';
import { createKey, __resetApiKeyCaches } from '../src/auth/api-key-store.js';
import { __resetRateLimiter } from '../src/services/api-key-rate-limiter.js';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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

describe('segment serving endpoints', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    setDb(makeMemDb());
    __resetApiKeyCaches();
    __resetRateLimiter();
    app = await buildApp();
  });
  afterEach(async () => {
    await app.close();
    closeDb();
    __resetApiKeyCaches();
    __resetRateLimiter();
    delete process.env.SEGMENT_SNAPSHOT_ENABLED;
  });

  async function makeSegment(): Promise<{ id: string; workspace: string }> {
    const created = await app.inject({ method: 'POST', url: '/api/segments', payload: { name: 'Whales', type: 'manual' } });
    expect(created.statusCode).toBe(201);
    const body = created.json();
    return { id: body.id, workspace: body.workspace };
  }

  it('refuses to publish when snapshotting is disabled', async () => {
    const { id } = await makeSegment();
    const res = await app.inject({ method: 'POST', url: `/api/segments/${id}/serve` });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('SNAPSHOT_DISABLED');
  });

  it('publishes (Off cadence auto-promotes to daily) and gates the pull path on served', async () => {
    process.env.SEGMENT_SNAPSHOT_ENABLED = 'true';
    const { id, workspace } = await makeSegment();
    getDb().prepare("UPDATE segments SET track_cadence = 'Off', uid_list_json = ?, uid_count = 2 WHERE id = ?")
      .run(JSON.stringify(['a', 'b']), id);

    const pub = await app.inject({ method: 'POST', url: `/api/segments/${id}/serve` });
    expect(pub.statusCode).toBe(200);
    expect(pub.json().serving.lifecycle).toBe('served');
    expect(pub.json().serving.cadence).toBe('daily'); // Off → daily on publish

    const { plaintext } = createKey({ label: 'app', workspace, segmentIds: [id], createdBy: 'admin@vng.com.vn' });
    __resetApiKeyCaches();
    const pull = await app.inject({
      method: 'GET',
      url: `/api/public/v1/segments/${id}/members?format=json`,
      headers: { authorization: `Bearer ${plaintext}` },
    });
    expect(pull.statusCode).toBe(200);

    // Demote kill-switch: once not served, the pull path 403s (not 404).
    getDb().prepare("UPDATE segments SET lifecycle = 'draft' WHERE id = ?").run(id);
    const after = await app.inject({
      method: 'GET',
      url: `/api/public/v1/segments/${id}/members?format=json`,
      headers: { authorization: `Bearer ${plaintext}` },
    });
    expect(after.statusCode).toBe(403);
    expect(after.json().error.code).toBe('SEGMENT_NOT_SERVED');
  });

  it('demotes cleanly to draft when there are no consumers', async () => {
    process.env.SEGMENT_SNAPSHOT_ENABLED = 'true';
    const { id } = await makeSegment();
    await app.inject({ method: 'POST', url: `/api/segments/${id}/serve` });
    const res = await app.inject({ method: 'DELETE', url: `/api/segments/${id}/serve` });
    expect(res.statusCode).toBe(200);
    expect(res.json().serving.lifecycle).toBe('draft');
  });

  it('blocks demote with entitled consumers unless forced (→ deprecated)', async () => {
    process.env.SEGMENT_SNAPSHOT_ENABLED = 'true';
    const { id, workspace } = await makeSegment();
    await app.inject({ method: 'POST', url: `/api/segments/${id}/serve` });
    createKey({ label: 'consumer', workspace, segmentIds: [id], createdBy: 'admin@vng.com.vn' });
    __resetApiKeyCaches();

    const blocked = await app.inject({ method: 'DELETE', url: `/api/segments/${id}/serve` });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe('HAS_CONSUMERS');

    const forced = await app.inject({ method: 'DELETE', url: `/api/segments/${id}/serve?force=true` });
    expect(forced.statusCode).toBe(200);
    expect(forced.json().serving.lifecycle).toBe('deprecated');
  });
});
