/**
 * debug-permission-decisions.test.ts — Phase-02
 *
 * Integration test: GET /debug/turns/:turnId returns permissionDecisions[]
 * and stopReason on the session detail turn DTO.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import Fastify from 'fastify';
import { migrate } from '../src/db/migrate.js';
import { insertPermissionDecision, updateTurnStopReason } from '../src/db/observability-store.js';

vi.mock('../src/config.js', () => ({
  config: {
    port: 3005,
    logLevel: 'silent',
    anthropicApiKey: 'test-key',
    anthropicBaseUrl: 'https://test.example',
    chatModel: 'claude-test',
    chatMaxOutputTokens: 4096,
    serverBaseUrl: 'http://localhost:3004',
    cubeApiUrl: 'http://localhost:4000',
    chatDbPath: ':memory:',
    chatMaxTurnsPerSession: 40,
    chatMaxTokensPerTurn: 8000,
    streamRegistryRingSize: 100,
    streamRegistryMaxTurns: 10,
    streamRegistryTtlMs: 60_000,
    streamRegistrySweepIntervalMs: 60_000,
    rateLimitPerOwnerPerMin: 60,
  },
  isLangfuseEnabled: () => false,
}));

vi.mock('../src/db/snapshot-store.js', () => ({
  writeChatSnapshot: vi.fn(),
  hydrateChatFromSnapshot: vi.fn(() => ({ hydrated: false, counts: {} })),
  getChatSyncStatus: vi.fn(() => null),
  CHAT_SNAPSHOT_PATH: '/tmp/test-snapshot.json',
}));

import debugRoutes from '../src/api/debug.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

describe('GET /debug/turns/:turnId — permissionDecisions + stopReason', () => {
  let app: ReturnType<typeof Fastify>;
  let db: Database.Database;
  const ownerId = 'owner-debug-1';
  const sessionId = 'session-debug-1';
  const turnId = 'turn-debug-1';

  beforeAll(async () => {
    db = makeDb();

    // Seed minimal rows
    db.prepare(`INSERT INTO chat_sessions (id, owner_id, game_id, title, created_at, status)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(sessionId, ownerId, 'game-1', 'Test session', Date.now(), 'active');

    db.prepare(`INSERT INTO chat_turns (id, session_id, turn_index, role, started_at)
      VALUES (?, ?, ?, ?, ?)`)
      .run(turnId, sessionId, 0, 'assistant', Date.now());

    // Write stop_reason
    updateTurnStopReason(db, turnId, 'end_turn');

    // Write a permission decision
    insertPermissionDecision(db, {
      id: 'pd-test-1',
      turn_id: turnId,
      tool_name: 'Bash',
      decision: 'denied',
      reason: 'Tool not in allowed list',
      at: Date.now(),
    });

    app = Fastify({ logger: false });
    await app.register(debugRoutes, { db });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    db.close();
  });

  it('returns permissionDecisions array with inserted row', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/debug/turns/${turnId}`,
      headers: { 'x-owner-id': ownerId },
    });

    expect(res.statusCode).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = res.json() as any;
    expect(Array.isArray(body.permissionDecisions)).toBe(true);
    expect(body.permissionDecisions).toHaveLength(1);
    expect(body.permissionDecisions[0].id).toBe('pd-test-1');
    expect(body.permissionDecisions[0].tool_name).toBe('Bash');
    expect(body.permissionDecisions[0].decision).toBe('denied');
  });

  it('returns empty permissionDecisions when none recorded', async () => {
    // Insert a second turn with no decisions
    const turnId2 = 'turn-debug-2';
    db.prepare(`INSERT INTO chat_turns (id, session_id, turn_index, role, started_at)
      VALUES (?, ?, ?, ?, ?)`)
      .run(turnId2, sessionId, 1, 'assistant', Date.now());

    const res = await app.inject({
      method: 'GET',
      url: `/debug/turns/${turnId2}`,
      headers: { 'x-owner-id': ownerId },
    });

    expect(res.statusCode).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = res.json() as any;
    expect(body.permissionDecisions).toHaveLength(0);
  });

  it('returns 403 when owner does not match', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/debug/turns/${turnId}`,
      headers: { 'x-owner-id': 'wrong-owner' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('session detail turn DTO includes stopReason', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/debug/sessions/${sessionId}`,
      headers: { 'x-owner-id': ownerId },
    });

    expect(res.statusCode).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = res.json() as any;
    const assistantTurn = body.turns.find((t: { stopReason: string | null }) => t.stopReason !== undefined);
    expect(assistantTurn?.stopReason).toBe('end_turn');
  });
});
