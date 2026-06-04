/**
 * Route tests for chat session sharing + per-owner isolation.
 *
 * Covers the publish-to-team contract on the sessions routes:
 *   - private session: owner reads (200), non-owner is denied (403)
 *   - shared session: any authenticated member reads (200) with readOnly=true
 *     for non-owners and readOnly=false for the owner
 *   - share/unshare are owner-only (403 for non-owners) and flip visibility
 *   - GET /sessions/shared lists shared rows across owners (read-only surface)
 *
 * In-memory SQLite with all migrations applied; the sessions plugin mounted
 * standalone (no gateway), so X-Owner-Id stands in for the resolved owner.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { migrate } from '../../src/db/migrate.js';
import * as chatStore from '../../src/db/chat-store.js';
import sessionsRoutes from '../../src/api/sessions.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

async function buildApp(db: Database.Database): Promise<FastifyInstance> {
  const f = Fastify({ logger: false });
  await f.register(sessionsRoutes, { db });
  await f.ready();
  return f;
}

const OWNER = 'khoitn-sub';
const OTHER = 'vyvhy-sub';
const GAME = 'tf';

describe('chat sessions — sharing + isolation', () => {
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = makeDb();
    app = await buildApp(db);
  });
  afterEach(async () => {
    await app.close();
  });

  function seed(ownerId: string): string {
    return chatStore.createSession(db, { ownerId, gameId: GAME, workspace: 'local' }).id;
  }
  const get = (id: string, owner: string) =>
    app.inject({ method: 'GET', url: `/sessions/${id}`, headers: { 'x-owner-id': owner } });
  const post = (path: string, owner: string) =>
    app.inject({ method: 'POST', url: path, headers: { 'x-owner-id': owner } });

  it('private session: owner reads, other user is forbidden', async () => {
    const id = seed(OWNER);
    const ownerRes = await get(id, OWNER);
    expect(ownerRes.statusCode).toBe(200);
    expect(ownerRes.json().readOnly).toBe(false);

    const otherRes = await get(id, OTHER);
    expect(otherRes.statusCode).toBe(403);
  });

  it('share publishes the session; other user can then read it read-only', async () => {
    const id = seed(OWNER);

    const shareRes = await post(`/sessions/${id}/share`, OWNER);
    expect(shareRes.statusCode).toBe(200);
    expect(shareRes.json().visibility).toBe('shared');

    const otherRes = await get(id, OTHER);
    expect(otherRes.statusCode).toBe(200);
    expect(otherRes.json().readOnly).toBe(true);

    // Owner still sees it as writable.
    const ownerRes = await get(id, OWNER);
    expect(ownerRes.json().readOnly).toBe(false);
  });

  it('unshare makes it private again — other user loses access', async () => {
    const id = seed(OWNER);
    await post(`/sessions/${id}/share`, OWNER);
    const unshareRes = await post(`/sessions/${id}/unshare`, OWNER);
    expect(unshareRes.statusCode).toBe(200);
    expect(unshareRes.json().visibility).toBe('private');
    expect((await get(id, OTHER)).statusCode).toBe(403);
  });

  it('share/unshare are owner-only (403 for non-owners)', async () => {
    const id = seed(OWNER);
    expect((await post(`/sessions/${id}/share`, OTHER)).statusCode).toBe(403);
    // session stays private after the rejected attempt
    expect(chatStore.getSession(db, id)!.visibility).toBe('private');
  });

  it('GET /sessions/shared lists only shared rows for the game', async () => {
    const sharedId = seed(OWNER);
    seed(OWNER); // a second, private session must NOT appear
    await post(`/sessions/${sharedId}/share`, OWNER);

    const res = await app.inject({
      method: 'GET',
      url: `/sessions/shared?game=${GAME}`,
      headers: { 'x-owner-id': OTHER, 'x-cube-workspace': 'local' },
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as Array<{ id: string; visibility: string }>;
    expect(rows.map((r) => r.id)).toEqual([sharedId]);
    expect(rows[0].visibility).toBe('shared');
  });

  it('own list stays owner-scoped (no cross-owner leakage)', async () => {
    seed(OWNER);
    const res = await app.inject({
      method: 'GET',
      url: `/sessions?game=${GAME}`,
      headers: { 'x-owner-id': OTHER },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]); // OTHER owns nothing
  });
});
