/**
 * Integration tests for GET /debug/leaderboard/skills.
 *
 * Covers: owner isolation, days clamp, gameId filter, empty result,
 * sorted by p95 desc, 401 without header, invalid days param.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import Fastify from 'fastify';
import { migrate } from '../../src/db/migrate.js';
import * as chatStore from '../../src/db/chat-store.js';

vi.mock('../../src/config.js', () => ({
  config: {
    port: 3005, logLevel: 'silent', anthropicApiKey: 'test-key',
    anthropicBaseUrl: 'https://test.example', chatModel: 'claude-test',
    chatMaxOutputTokens: 4096, serverBaseUrl: 'http://localhost:3004',
    cubeApiUrl: 'http://localhost:4000', chatDbPath: ':memory:',
    chatMaxTurnsPerSession: 40, chatMaxTokensPerTurn: 8000,
    streamRegistryRingSize: 100, streamRegistryMaxTurns: 10,
    streamRegistryTtlMs: 60_000, streamRegistrySweepIntervalMs: 60_000,
    rateLimitPerOwnerPerMin: 60,
  },
}));

vi.mock('../../src/db/snapshot-store.js', () => ({
  writeChatSnapshot: vi.fn(),
  hydrateChatFromSnapshot: vi.fn(() => ({ hydrated: false, counts: {} })),
  getChatSyncStatus: vi.fn(() => null),
  CHAT_SNAPSHOT_PATH: '/tmp/test-snapshot.json',
}));

import debugLeaderboardRoutes from '../../src/api/debug-leaderboard.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

async function buildApp(db: Database.Database) {
  const fastify = Fastify({ logger: false });
  await fastify.register(debugLeaderboardRoutes, { db });
  await fastify.ready();
  return fastify;
}

/**
 * Insert an assistant turn with explicit skill, latency, cost, stop_reason.
 * started_at defaults to now - offsetMs.
 */
function seedAssistantTurn(
  db: Database.Database,
  opts: {
    ownerId?: string;
    gameId?: string;
    skill?: string;
    latencyMs?: number;
    costUsd?: number;
    stopReason?: string | null;
    offsetMs?: number;
  } = {},
) {
  const ownerId = opts.ownerId ?? 'owner-a';
  const gameId = opts.gameId ?? 'game-1';
  const session = chatStore.createSession(db, { ownerId, gameId, title: 'test' });
  const turnId = 'turn-' + Math.random().toString(36).slice(2);
  const startedAt = Date.now() - (opts.offsetMs ?? 0);
  const endedAt = opts.latencyMs != null ? startedAt + opts.latencyMs : null;
  db.prepare(
    `INSERT INTO chat_turns
       (id, session_id, turn_index, role, skill, started_at, ended_at, cost_usd, stop_reason)
     VALUES (?, ?, 0, 'assistant', ?, ?, ?, ?, ?)`,
  ).run(
    turnId,
    session.id,
    opts.skill ?? 'analytics',
    startedAt,
    endedAt,
    opts.costUsd ?? null,
    opts.stopReason !== undefined ? opts.stopReason : 'end_turn',
  );
  return { session, turnId };
}

describe('GET /debug/leaderboard/skills', () => {
  let db: Database.Database;

  beforeEach(() => { db = makeDb(); });

  it('returns 401 without X-Owner-Id', async () => {
    const app = await buildApp(db);
    const res = await app.inject({ method: 'GET', url: '/debug/leaderboard/skills' });
    expect(res.statusCode).toBe(401);
  });

  it('returns empty skills array when no turns exist', async () => {
    const app = await buildApp(db);
    const res = await app.inject({
      method: 'GET', url: '/debug/leaderboard/skills',
      headers: { 'x-owner-id': 'owner-a' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.skills).toEqual([]);
    expect(body.computedAt).toBeTruthy();
  });

  it('returns 400 for invalid days param', async () => {
    const app = await buildApp(db);
    const res = await app.inject({
      method: 'GET', url: '/debug/leaderboard/skills?days=abc',
      headers: { 'x-owner-id': 'owner-a' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('owner isolation: owner-b cannot see owner-a turns', async () => {
    const app = await buildApp(db);
    seedAssistantTurn(db, { ownerId: 'owner-a', skill: 'analytics' });

    const res = await app.inject({
      method: 'GET', url: '/debug/leaderboard/skills',
      headers: { 'x-owner-id': 'owner-b' },
    });
    expect(res.json().skills).toHaveLength(0);
  });

  it('gameId filter: only returns turns for that game', async () => {
    const app = await buildApp(db);
    seedAssistantTurn(db, { ownerId: 'owner-a', gameId: 'game-1', skill: 'analytics' });
    seedAssistantTurn(db, { ownerId: 'owner-a', gameId: 'game-2', skill: 'reporting' });

    const res = await app.inject({
      method: 'GET', url: '/debug/leaderboard/skills?game=game-1',
      headers: { 'x-owner-id': 'owner-a' },
    });
    const { skills } = res.json();
    expect(skills).toHaveLength(1);
    expect(skills[0].skill).toBe('analytics');
  });

  it('days filter: excludes turns older than the window', async () => {
    const app = await buildApp(db);
    const msIn8Days = 8 * 24 * 3600 * 1000;
    // Turn within 7 days → excluded; turn within 8 days excluded for days=7
    seedAssistantTurn(db, { ownerId: 'owner-a', skill: 'old', offsetMs: msIn8Days });
    seedAssistantTurn(db, { ownerId: 'owner-a', skill: 'new', offsetMs: 1000 });

    const res = await app.inject({
      method: 'GET', url: '/debug/leaderboard/skills?days=7',
      headers: { 'x-owner-id': 'owner-a' },
    });
    const { skills } = res.json();
    const names = skills.map((s: { skill: string }) => s.skill);
    expect(names).not.toContain('old');
    expect(names).toContain('new');
  });

  it('default days=30 is applied when not specified', async () => {
    const app = await buildApp(db);
    seedAssistantTurn(db, { ownerId: 'owner-a', skill: 'analytics', offsetMs: 1000 });
    const res = await app.inject({
      method: 'GET', url: '/debug/leaderboard/skills',
      headers: { 'x-owner-id': 'owner-a' },
    });
    expect(res.json().skills).toHaveLength(1);
  });

  it('sorted by p95 latency descending', async () => {
    const app = await buildApp(db);
    // skill-fast: single turn, latency 100ms
    seedAssistantTurn(db, { ownerId: 'owner-a', skill: 'fast', latencyMs: 100 });
    // skill-slow: single turn, latency 9000ms
    seedAssistantTurn(db, { ownerId: 'owner-a', skill: 'slow', latencyMs: 9000 });
    // skill-medium: single turn, latency 500ms
    seedAssistantTurn(db, { ownerId: 'owner-a', skill: 'medium', latencyMs: 500 });

    const res = await app.inject({
      method: 'GET', url: '/debug/leaderboard/skills',
      headers: { 'x-owner-id': 'owner-a' },
    });
    const { skills } = res.json();
    expect(skills[0].skill).toBe('slow');
    expect(skills[1].skill).toBe('medium');
    expect(skills[2].skill).toBe('fast');
  });

  it('successRate is null when all turns have null stop_reason (legacy)', async () => {
    const app = await buildApp(db);
    seedAssistantTurn(db, { ownerId: 'owner-a', skill: 'legacy', stopReason: null });

    const res = await app.inject({
      method: 'GET', url: '/debug/leaderboard/skills',
      headers: { 'x-owner-id': 'owner-a' },
    });
    const { skills } = res.json();
    expect(skills[0].successRate).toBeNull();
    expect(skills[0].legacyCount).toBe(1);
  });

  it('successRate computed correctly (mixed end_turn and error)', async () => {
    const app = await buildApp(db);
    seedAssistantTurn(db, { ownerId: 'owner-a', skill: 'mixed', stopReason: 'end_turn' });
    seedAssistantTurn(db, { ownerId: 'owner-a', skill: 'mixed', stopReason: 'error' });
    seedAssistantTurn(db, { ownerId: 'owner-a', skill: 'mixed', stopReason: 'end_turn' });

    const res = await app.inject({
      method: 'GET', url: '/debug/leaderboard/skills',
      headers: { 'x-owner-id': 'owner-a' },
    });
    const { skills } = res.json();
    expect(skills[0].successRate).toBeCloseTo(2 / 3);
  });

  it('aggregates count, totalCostUsd, avgCostUsd correctly', async () => {
    const app = await buildApp(db);
    seedAssistantTurn(db, { ownerId: 'owner-a', skill: 'analytics', costUsd: 0.01 });
    seedAssistantTurn(db, { ownerId: 'owner-a', skill: 'analytics', costUsd: 0.03 });

    const res = await app.inject({
      method: 'GET', url: '/debug/leaderboard/skills',
      headers: { 'x-owner-id': 'owner-a' },
    });
    const row = res.json().skills[0];
    expect(row.count).toBe(2);
    expect(row.totalCostUsd).toBeCloseTo(0.04);
    expect(row.avgCostUsd).toBeCloseTo(0.02);
  });
});
