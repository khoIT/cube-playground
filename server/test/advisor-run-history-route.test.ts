/**
 * advisor-run-history routes — the user-facing, owner-scoped view of one's OWN
 * past Drive investigations (distinct from the admin audit console). Real-auth
 * mode so req.user is populated; owner parity is on `username` (the form the live
 * run records). Data seeded directly via the run store on an in-memory DB.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/index.js';
import { setDb, closeDb } from '../src/db/sqlite.js';
import { signAppJwt } from '../src/services/app-jwt.js';
import { __resetAccessCache } from '../src/auth/access-store.js';
import { upsertUserAccess, setFeatures } from '../src/auth/access-store-mutators.js';
import { persistTurn, type TurnFlush, type ToolCallInput } from '../src/advisor/agent/advisor-run-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');
const JWT_SECRET = 'test-jwt-secret-must-be-at-least-16-chars';

function makeMemDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  }
  return db;
}

function seed(opts: {
  sessionId: string;
  owner: string;
  stop?: string;
  createdAt?: number;
  toolCalls?: ToolCallInput[];
}): void {
  const now = opts.createdAt ?? 1_700_000_000_000;
  const flush: TurnFlush = {
    run: {
      sessionId: opts.sessionId,
      gameId: 'cfm_vn',
      segmentId: null,
      scopeKind: 'game',
      goal: 'revenue',
      mode: 'drive',
      owner: opts.owner,
      model: 'claude-opus-4-8',
      turnCount: 1,
      totalCostUsd: 0.42,
      finalStopReason: opts.stop ?? 'end_turn',
      hadError: false,
      createdAt: now,
      lastActiveAt: now,
    },
    turn: {
      sessionId: opts.sessionId,
      turnIndex: 0,
      mode: 'drive',
      message: 'Grow revenue here',
      narration: 'Here is what I found…',
      toolCallCount: opts.toolCalls?.length ?? 1,
      stopReason: opts.stop ?? 'end_turn',
      costUsd: 0.42,
      startedAt: now,
      endedAt: now + 500,
      durationMs: 500,
    },
    toolCalls: opts.toolCalls ?? [{ callId: 'c1', tool: 'diagnose', seq: 0, state: 'ok', durationMs: 40 }],
    events: [{ turnIndex: 0, eventIndex: 0, eventType: 'done', eventJson: '{"type":"done"}', ts: now }],
  };
  persistTurn(flush);
}

describe('advisor-run-history routes (owner-scoped)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const prev = { AUTH_DISABLED: process.env.AUTH_DISABLED, JWT_SECRET: process.env.JWT_SECRET };
  let aliceAuth: { authorization: string };
  let bobAuth: { authorization: string };

  beforeEach(async () => {
    process.env.AUTH_DISABLED = 'false';
    process.env.JWT_SECRET = JWT_SECRET;
    setDb(makeMemDb());
    __resetAccessCache();
    upsertUserAccess({ email: 'alice@corp.com', role: 'editor', status: 'active' });
    upsertUserAccess({ email: 'bob@corp.com', role: 'editor', status: 'active' });
    // Advisor is a restricted (default-off) feature — grant it to both users so
    // the run-history routes (now feature-gated) are reachable in these tests.
    setFeatures('alice@corp.com', { advisor: true });
    setFeatures('bob@corp.com', { advisor: true });
    // Owner is recorded as `username` by the live run — match that form.
    seed({ sessionId: 'alice-1', owner: 'alice', createdAt: 1_700_000_000_000 });
    seed({ sessionId: 'alice-2', owner: 'alice', createdAt: 1_700_000_100_000, stop: 'timeout' });
    seed({ sessionId: 'bob-1', owner: 'bob' });
    app = await buildApp();
    aliceAuth = { authorization: `Bearer ${await signAppJwt({ sub: 'alice-sub', username: 'alice', email: 'alice@corp.com', role: 'editor' })}` };
    bobAuth = { authorization: `Bearer ${await signAppJwt({ sub: 'bob-sub', username: 'bob', email: 'bob@corp.com', role: 'editor' })}` };
  });

  afterEach(async () => {
    if (app) await app.close();
    closeDb();
    process.env.AUTH_DISABLED = prev.AUTH_DISABLED;
    process.env.JWT_SECRET = prev.JWT_SECRET;
  });

  it('lists only the caller’s own runs, newest first', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/advisor/runs', headers: aliceAuth });
    expect(res.statusCode).toBe(200);
    const runs = (res.json() as { runs: Array<{ sessionId: string }> }).runs;
    expect(runs.map((r) => r.sessionId)).toEqual(['alice-2', 'alice-1']); // newest first, no bob-1
  });

  it('bob sees only bob’s run', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/advisor/runs', headers: bobAuth });
    const runs = (res.json() as { runs: Array<{ sessionId: string }> }).runs;
    expect(runs.map((r) => r.sessionId)).toEqual(['bob-1']);
  });

  it('403s a user who lacks the restricted advisor feature', async () => {
    setFeatures('alice@corp.com', { advisor: false });
    const res = await app.inject({ method: 'GET', url: '/api/advisor/runs', headers: aliceAuth });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { feature: string } }).error.feature).toBe('advisor');
  });

  it('replay returns the run’s turns for an own run', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/advisor/runs/alice-1', headers: aliceAuth });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { run: { goal: string }; turns: Array<{ narration: string | null; toolCalls: Array<{ tool: string; validated: boolean }> }> };
    expect(body.run.goal).toBe('revenue');
    expect(body.turns[0].narration).toBe('Here is what I found…');
    expect(body.turns[0].toolCalls[0]).toMatchObject({ tool: 'diagnose', validated: true });
  });

  it('payload omits sensitive fields (locks the no-leak contract)', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/advisor/runs', headers: aliceAuth });
    const item = (list.json() as { runs: Array<Record<string, unknown>> }).runs[0];
    for (const leaky of ['owner', 'authLane', 'authSource', 'inputTokens', 'model']) {
      expect(item).not.toHaveProperty(leaky);
    }
    const detail = await app.inject({ method: 'GET', url: '/api/advisor/runs/alice-1', headers: aliceAuth });
    const body = detail.json() as { run: Record<string, unknown>; turns: Array<{ toolCalls: Array<Record<string, unknown>> }> };
    expect(body.run).not.toHaveProperty('owner');
    expect(body.run).not.toHaveProperty('authLane');
    // Tool calls expose only tool/state/validated — never raw I/O or error text.
    const call = body.turns[0].toolCalls[0];
    expect(Object.keys(call).sort()).toEqual(['state', 'tool', 'validated']);
  });

  it('404 (not 403) when requesting another user’s run — no existence leak', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/advisor/runs/bob-1', headers: aliceAuth });
    expect(res.statusCode).toBe(404);
  });

  it('404 for an unknown session id', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/advisor/runs/nope', headers: aliceAuth });
    expect(res.statusCode).toBe(404);
  });

  it('an ok output carrying an embedded error is NOT validated', async () => {
    seed({
      sessionId: 'alice-emb',
      owner: 'alice',
      createdAt: 1_700_000_200_000,
      toolCalls: [
        { callId: 'e1', tool: 'cube_query', seq: 0, state: 'ok', embeddedError: true, embeddedErrorMessage: 'Cube 400 hidden', durationMs: 50 },
        { callId: 'e2', tool: 'diagnose', seq: 1, state: 'ok', durationMs: 40 },
      ],
    });
    const res = await app.inject({ method: 'GET', url: '/api/advisor/runs/alice-emb', headers: aliceAuth });
    const turns = (res.json() as { turns: Array<{ toolCalls: Array<{ tool: string; validated: boolean }> }> }).turns;
    const calls = turns[0].toolCalls;
    expect(calls.find((c) => c.tool === 'cube_query')!.validated).toBe(false);
    expect(calls.find((c) => c.tool === 'diagnose')!.validated).toBe(true);
  });
});
