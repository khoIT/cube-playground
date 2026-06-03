/**
 * Admin telemetry bridge — GET /internal/stats.
 *
 * Proves: bulk per-sub aggregation is correct; the secret gate rejects (401)
 * without a valid x-internal-secret EVEN when AUTH_DISABLED=true (unconditional,
 * never fail-open); and the public self-scoped /stats is left unbroken (still
 * 403s a cross-user request).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { migrate } from '../src/db/migrate.js';
import { createSession, appendTurn } from '../src/db/chat-store.js';
import internalStatsRoutes from '../src/api/internal-stats.js';
import statsRoutes from '../src/api/stats.js';

// Minimal env so config doesn't throw on required vars (also satisfied by .env).
process.env['ANTHROPIC_API_KEY'] = 'test-key';
process.env['ANTHROPIC_BASE_URL'] = 'http://localhost:9999';

const SECRET = 'test-internal-secret';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function seedTurn(db: Database.Database, ownerId: string, idx: number, input: number, output: number, startedAt: number) {
  const session = createSession(db, { ownerId, gameId: 'g1' });
  appendTurn(db, {
    sessionId: session.id,
    turnIndex: idx,
    role: 'assistant',
    skill: 'explore',
    inputTokens: input,
    outputTokens: output,
    startedAt,
    endedAt: startedAt + 100,
  });
}

describe('GET /internal/stats (admin bridge)', () => {
  let app: FastifyInstance;
  let db: Database.Database;
  const prev = process.env.AUTH_DISABLED;

  beforeEach(async () => {
    db = makeDb();
    seedTurn(db, 'alice-sub', 0, 100, 50, 1_000);
    seedTurn(db, 'alice-sub', 1, 200, 80, 2_000);
    seedTurn(db, 'bob-sub', 0, 10, 5, 1_500);

    app = Fastify();
    await app.register(internalStatsRoutes, { db, secretGate: { expectedSecret: SECRET } });
    await app.register(statsRoutes, { db });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
    process.env.AUTH_DISABLED = prev;
  });

  it('returns correct per-sub aggregates for a bulk request', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/internal/stats?subs=alice-sub,bob-sub&from=1970-01-01T00:00:00Z&to=2100-01-01T00:00:00Z',
      headers: { 'x-internal-secret': SECRET },
    });
    expect(res.statusCode).toBe(200);
    const { stats } = res.json() as { stats: Record<string, { turns: number; input_tokens: number; output_tokens: number }> };
    expect(stats['alice-sub'].turns).toBe(2);
    expect(stats['alice-sub'].input_tokens).toBe(300);
    expect(stats['alice-sub'].output_tokens).toBe(130);
    expect(stats['bob-sub'].turns).toBe(1);
    expect(stats['bob-sub'].input_tokens).toBe(10);
  });

  it('includes a zeroed entry for a sub with no activity', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/internal/stats?subs=ghost-sub',
      headers: { 'x-internal-secret': SECRET },
    });
    expect(res.statusCode).toBe(200);
    const { stats } = res.json() as { stats: Record<string, { turns: number }> };
    expect(stats['ghost-sub'].turns).toBe(0);
  });

  it('rejects (401) without the secret EVEN when AUTH_DISABLED=true', async () => {
    process.env.AUTH_DISABLED = 'true';
    const res = await app.inject({
      method: 'GET',
      url: '/internal/stats?subs=alice-sub',
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects (401) with a wrong secret', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/internal/stats?subs=alice-sub',
      headers: { 'x-internal-secret': 'wrong' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('400s when subs is missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/internal/stats',
      headers: { 'x-internal-secret': SECRET },
    });
    expect(res.statusCode).toBe(400);
  });

  it('503s when the secret is not configured (fails loud, never open)', async () => {
    const open = Fastify();
    await open.register(internalStatsRoutes, { db, secretGate: { expectedSecret: '' } });
    const res = await open.inject({
      method: 'GET',
      url: '/internal/stats?subs=alice-sub',
      headers: { 'x-internal-secret': 'anything' },
    });
    expect(res.statusCode).toBe(503);
    await open.close();
  });

  it('public /stats still self-scopes (403 cross-user)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/stats?owner=alice-sub',
      headers: { 'x-owner-id': 'bob-sub' },
    });
    expect(res.statusCode).toBe(403);
  });
});
