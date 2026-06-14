/**
 * admin-advisor-audit routes — admin-only read access to the in-process advisor
 * agent's audit trail. Real-auth mode (AUTH_DISABLED='false') to verify the
 * role + feature gate fires. Data is seeded directly via the run store on an
 * in-memory DB; no live agent needed.
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
import { upsertUserAccess } from '../src/auth/access-store-mutators.js';
import { persistTurn, type TurnFlush } from '../src/advisor/agent/advisor-run-store.js';

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

function seed(sessionId: string, stop: string, hadError: boolean): void {
  const now = 1_700_000_000_000;
  const flush: TurnFlush = {
    run: {
      sessionId,
      gameId: 'cfm_vn',
      segmentId: 'seg-1',
      scopeKind: 'segment',
      goal: 'revenue',
      mode: 'drive',
      owner: 'analyst@corp.com',
      model: 'claude-opus-4-8',
      turnCount: 1,
      totalCostUsd: 0.03,
      finalStopReason: stop,
      hadError,
      createdAt: now,
      lastActiveAt: now,
    },
    turn: {
      sessionId,
      turnIndex: 1,
      mode: 'drive',
      message: 'q',
      narration: 'n',
      toolCallCount: 1,
      stopReason: stop,
      costUsd: 0.03,
      startedAt: now,
      endedAt: now + 500,
      durationMs: 500,
    },
    toolCalls: [{ callId: 'c1', tool: 'cube_query', seq: 0, state: hadError ? 'failed' : 'ok', errorMessage: hadError ? 'timeout' : undefined, durationMs: 400 }],
    events: [{ turnIndex: 1, eventIndex: 0, eventType: 'done', eventJson: '{"type":"done"}', ts: now }],
  };
  persistTurn(flush);
}

describe('admin-advisor-audit routes (real-auth)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const prev = { AUTH_DISABLED: process.env.AUTH_DISABLED, JWT_SECRET: process.env.JWT_SECRET };
  let editorAuth: { authorization: string };
  let adminAuth: { authorization: string };

  beforeEach(async () => {
    process.env.AUTH_DISABLED = 'false';
    process.env.JWT_SECRET = JWT_SECRET;
    setDb(makeMemDb());
    __resetAccessCache();
    upsertUserAccess({ email: 'editor@corp.com', role: 'editor', status: 'active' });
    upsertUserAccess({ email: 'admin@corp.com', role: 'admin', status: 'active' });
    seed('run-ok', 'end_turn', false);
    seed('run-timeout', 'timeout', true);
    app = await buildApp();
    editorAuth = { authorization: `Bearer ${await signAppJwt({ sub: 'editor-sub', username: 'editor', email: 'editor@corp.com', role: 'editor' })}` };
    adminAuth = { authorization: `Bearer ${await signAppJwt({ sub: 'admin-sub', username: 'admin', email: 'admin@corp.com', role: 'admin' })}` };
  });

  afterEach(async () => {
    if (app) await app.close();
    closeDb();
    process.env.AUTH_DISABLED = prev.AUTH_DISABLED;
    process.env.JWT_SECRET = prev.JWT_SECRET;
  });

  it('401 unauthenticated, 403 non-admin on the runs list', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/admin/advisor/runs' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/admin/advisor/runs', headers: editorAuth })).statusCode).toBe(403);
  });

  it('admin lists runs and filters by stopReason', async () => {
    const all = await app.inject({ method: 'GET', url: '/api/admin/advisor/runs', headers: adminAuth });
    expect(all.statusCode).toBe(200);
    expect((all.json() as { runs: unknown[] }).runs).toHaveLength(2);

    const timeouts = await app.inject({ method: 'GET', url: '/api/admin/advisor/runs?stopReason=timeout', headers: adminAuth });
    const runs = (timeouts.json() as { runs: Array<{ sessionId: string }> }).runs;
    expect(runs).toHaveLength(1);
    expect(runs[0].sessionId).toBe('run-timeout');
  });

  it('returns run detail with turns and their tool calls', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/advisor/runs/run-timeout', headers: adminAuth });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { run: { finalStopReason: string }; turns: Array<{ toolCalls: Array<{ state: string }> }> };
    expect(body.run.finalStopReason).toBe('timeout');
    expect(body.turns[0].toolCalls[0].state).toBe('failed');
  });

  it('404 for an unknown session id', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/advisor/runs/nope', headers: adminAuth });
    expect(res.statusCode).toBe(404);
  });

  it('paginates events and lists owners', async () => {
    const ev = await app.inject({ method: 'GET', url: '/api/admin/advisor/runs/run-ok/events', headers: adminAuth });
    expect(ev.statusCode).toBe(200);
    expect((ev.json() as { events: unknown[] }).events.length).toBeGreaterThan(0);

    const owners = await app.inject({ method: 'GET', url: '/api/admin/advisor/owners', headers: adminAuth });
    expect(owners.statusCode).toBe(200);
    expect((owners.json() as { owners: string[] }).owners).toContain('analyst@corp.com');
  });

  it('403 for non-admin on detail, events, and owners', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/admin/advisor/runs/run-ok', headers: editorAuth })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/admin/advisor/runs/run-ok/events', headers: editorAuth })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/admin/advisor/owners', headers: editorAuth })).statusCode).toBe(403);
  });
});
