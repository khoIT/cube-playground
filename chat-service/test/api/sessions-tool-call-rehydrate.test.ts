/**
 * Reload rehydration: the tool-progress chips a user watched live (resolve
 * terms → fetch measures → …) must survive a session reload.
 *
 * The /agent/turn pipeline persists each tool call into the tool_invocations
 * table but never copies it onto chat_turns.tool_calls_json. So the
 * session-replay endpoint must reconstruct the chips from tool_invocations —
 * otherwise a turn whose visible output was mostly its tool trail (e.g. one
 * that ended on a clarifying question) collapses to a bare answer on refresh.
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
const GAME = 'jus_vn';

function insertToolInvocation(
  db: Database.Database,
  turnId: string,
  i: number,
  v: { toolUseId: string; name: string; ok: number; latencyMs: number; summary: string; startedAt: number },
): void {
  db.prepare(
    `INSERT INTO tool_invocations
       (id, turn_id, tool_use_id, name, args_json, result_summary, ok, latency_ms, started_at, ended_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(`inv-${i}`, turnId, v.toolUseId, v.name, '{}', v.summary, v.ok, v.latencyMs, v.startedAt, v.startedAt + v.latencyMs);
}

describe('sessions replay — tool-call rehydrate', () => {
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = makeDb();
    app = await buildApp(db);
  });
  afterEach(async () => {
    await app.close();
  });

  it('reconstructs assistant tool chips from tool_invocations in start-time order', async () => {
    const sessionId = chatStore.createSession(db, { ownerId: OWNER, gameId: GAME, workspace: 'local' }).id;
    chatStore.appendTurn(db, { sessionId, turnIndex: 0, role: 'user', userText: 'create a segment', startedAt: 1000 });
    const turnId = 'asst-1';
    chatStore.appendTurn(db, {
      id: turnId,
      sessionId,
      turnIndex: 1,
      role: 'assistant',
      assistantText: '', // ended on a clarifying question — no prose answer
      startedAt: 1000,
      endedAt: 2000,
    });
    // Out-of-order inserts to prove the endpoint orders by started_at.
    insertToolInvocation(db, turnId, 2, { toolUseId: 'tu-b', name: 'get_segmentable_measures', ok: 1, latencyMs: 37, summary: '{"ok":true}', startedAt: 1200 });
    insertToolInvocation(db, turnId, 1, { toolUseId: 'tu-a', name: 'resolve_query_terms', ok: 1, latencyMs: 286, summary: '{"results":[]}', startedAt: 1100 });

    const res = await app.inject({ method: 'GET', url: `/sessions/${sessionId}`, headers: { 'x-owner-id': OWNER } });
    expect(res.statusCode).toBe(200);
    const turns = res.json().turns as Array<{ role: string; toolCalls: Array<{ id: string; name: string; ok: boolean; ms: number; summary: string }> }>;
    const assistant = turns.find((t) => t.role === 'assistant')!;
    expect(assistant.toolCalls).toHaveLength(2);
    // Ordered by started_at (a before b) despite reverse insert order.
    expect(assistant.toolCalls.map((c) => c.name)).toEqual(['resolve_query_terms', 'get_segmentable_measures']);
    expect(assistant.toolCalls[0]).toMatchObject({ id: 'tu-a', ok: true, ms: 286, summary: '{"results":[]}' });
  });

  it('user turns carry no reconstructed tool chips', async () => {
    const sessionId = chatStore.createSession(db, { ownerId: OWNER, gameId: GAME, workspace: 'local' }).id;
    chatStore.appendTurn(db, { sessionId, turnIndex: 0, role: 'user', userText: 'hi', startedAt: 1000 });
    const res = await app.inject({ method: 'GET', url: `/sessions/${sessionId}`, headers: { 'x-owner-id': OWNER } });
    const turns = res.json().turns as Array<{ role: string; toolCalls: unknown[] }>;
    expect(turns.find((t) => t.role === 'user')!.toolCalls).toEqual([]);
  });
});
