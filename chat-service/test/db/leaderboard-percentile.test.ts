/**
 * Unit tests for leaderboard-store:
 * - percentileSorted helper (edge cases)
 * - computeSkillLeaderboard: dailyCounts bucketing with a 7-day window + sparse data
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../../src/db/migrate.js';
import * as chatStore from '../../src/db/chat-store.js';
import { percentileSorted, computeSkillLeaderboard } from '../../src/db/leaderboard-store.js';

// Silence config validation for DB-only tests
vi.mock('../../src/config.js', () => ({
  config: {
    port: 3005, logLevel: 'silent', anthropicApiKey: 'test',
    anthropicBaseUrl: 'https://test', chatModel: 'claude-test',
    chatMaxOutputTokens: 4096, serverBaseUrl: 'http://localhost:3004',
    cubeApiUrl: 'http://localhost:4000', chatDbPath: ':memory:',
    chatMaxTurnsPerSession: 40, chatMaxTokensPerTurn: 8000,
    skillLoaderTtlMs: 5000, contextBudgetTokens: 180000,
    titleModel: 'claude-haiku', rateLimitPerOwnerPerMin: 30,
    costPer1kInputUsd: 0.003, costPer1kOutputUsd: 0.015,
    mcpEnabled: false, starterRankMinSessions: 3,
  },
}));

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

/** Insert one assistant turn for a skill at a specific timestamp (ms). */
function insertTurn(
  db: Database.Database,
  sessionId: string,
  skill: string,
  startedAtMs: number,
  idx: number,
) {
  const turnId = `turn-${idx}-${Math.random().toString(36).slice(2)}`;
  db.prepare(
    `INSERT INTO chat_turns (id, session_id, turn_index, role, skill, started_at, ended_at, cost_usd, stop_reason)
     VALUES (?, ?, ?, 'assistant', ?, ?, ?, 0.001, 'end_turn')`,
  ).run(turnId, sessionId, idx, skill, startedAtMs, startedAtMs + 500);
}

/** Insert one assistant turn with an explicit stop_reason (NULL when omitted). */
function insertTurnWithStop(
  db: Database.Database,
  sessionId: string,
  skill: string,
  stopReason: string | null,
  idx: number,
) {
  const turnId = `turn-${idx}-${Math.random().toString(36).slice(2)}`;
  const now = Date.now();
  db.prepare(
    `INSERT INTO chat_turns (id, session_id, turn_index, role, skill, started_at, ended_at, cost_usd, stop_reason)
     VALUES (?, ?, ?, 'assistant', ?, ?, ?, 0.001, ?)`,
  ).run(turnId, sessionId, idx, skill, now, now + 500, stopReason);
}

describe('percentileSorted', () => {
  it('returns null for empty array', () => {
    expect(percentileSorted([], 0.5)).toBeNull();
    expect(percentileSorted([], 0.95)).toBeNull();
  });

  it('returns the sole element for 1-element array', () => {
    expect(percentileSorted([42], 0.5)).toBe(42);
    expect(percentileSorted([42], 0.95)).toBe(42);
    expect(percentileSorted([42], 0)).toBe(42);
    expect(percentileSorted([42], 1)).toBe(42);
  });

  it('p50 on 2-element array returns lower element (floor-based)', () => {
    // floor((2-1) * 0.5) = floor(0.5) = 0 → first element
    expect(percentileSorted([10, 20], 0.5)).toBe(10);
  });

  it('p95 on 2-element array returns second element', () => {
    // floor((2-1) * 0.95) = floor(0.95) = 0 → first element
    expect(percentileSorted([10, 20], 0.95)).toBe(10);
  });

  it('p95 on 3-element array returns last element', () => {
    // floor((3-1) * 0.95) = floor(1.9) = 1 → index 1
    expect(percentileSorted([10, 50, 100], 0.95)).toBe(50);
  });

  it('p50 on 4-element array returns index 1 (floor-based median)', () => {
    // floor((4-1) * 0.5) = floor(1.5) = 1
    expect(percentileSorted([10, 20, 30, 40], 0.5)).toBe(20);
  });

  it('p95 on 20-element array', () => {
    const arr = Array.from({ length: 20 }, (_, i) => i + 1); // [1..20]
    // floor((20-1) * 0.95) = floor(18.05) = 18 → value 19
    expect(percentileSorted(arr, 0.95)).toBe(19);
  });

  it('p0 always returns first element', () => {
    expect(percentileSorted([5, 10, 15], 0)).toBe(5);
  });

  it('p1 always returns last element', () => {
    expect(percentileSorted([5, 10, 15], 1)).toBe(15);
  });

  it('handles equal values', () => {
    expect(percentileSorted([100, 100, 100], 0.5)).toBe(100);
    expect(percentileSorted([100, 100, 100], 0.95)).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// computeSkillLeaderboard — dailyCounts bucketing
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000;

describe('computeSkillLeaderboard — dailyCounts', () => {
  let db: Database.Database;
  let sessionId: string;
  const OWNER = 'owner-daily';
  const GAME = 'game-daily';

  beforeEach(() => {
    db = makeDb();
    const session = chatStore.createSession(db, { ownerId: OWNER, gameId: GAME, title: 'test' });
    sessionId = session.id;
  });

  it('returns zero-filled dailyCounts for window with no data', () => {
    const rows = computeSkillLeaderboard(db, { ownerId: OWNER, days: 7 });
    expect(rows).toHaveLength(0);
  });

  it('dailyCounts array length equals days param', () => {
    // Insert one turn today
    insertTurn(db, sessionId, 'skill-a', Date.now(), 0);
    const rows7 = computeSkillLeaderboard(db, { ownerId: OWNER, days: 7 });
    expect(rows7[0].dailyCounts).toHaveLength(7);

    const rows30 = computeSkillLeaderboard(db, { ownerId: OWNER, days: 30 });
    expect(rows30[0].dailyCounts).toHaveLength(30);
  });

  it('places today turn in the last bucket (index days-1)', () => {
    const now = Date.now();
    insertTurn(db, sessionId, 'skill-a', now, 0);
    const rows = computeSkillLeaderboard(db, { ownerId: OWNER, days: 7 });
    const counts = rows[0].dailyCounts;
    // Only the last bucket should be non-zero
    expect(counts[6]).toBe(1);
    expect(counts.slice(0, 6).every((v) => v === 0)).toBe(true);
  });

  it('places a 3-day-old turn in index 3 (clampedDays-1-3 = 3 for 7-day window)', () => {
    const now = Date.now();
    const threeDaysAgo = now - 3 * MS_PER_DAY;
    insertTurn(db, sessionId, 'skill-a', threeDaysAgo, 0);
    const rows = computeSkillLeaderboard(db, { ownerId: OWNER, days: 7 });
    const counts = rows[0].dailyCounts;
    // Anchored to today: today = idx 6, 3 days ago = idx 3
    expect(counts[3]).toBe(1);
    // All other buckets should be zero
    expect(counts.filter((_, i) => i !== 3).every((v) => v === 0)).toBe(true);
  });

  it('accumulates multiple turns on the same day into one bucket', () => {
    const today = Date.now();
    insertTurn(db, sessionId, 'skill-b', today - 100, 0);
    insertTurn(db, sessionId, 'skill-b', today - 200, 1);
    insertTurn(db, sessionId, 'skill-b', today - 300, 2);
    const rows = computeSkillLeaderboard(db, { ownerId: OWNER, days: 7 });
    const skillRow = rows.find((r) => r.skill === 'skill-b')!;
    expect(skillRow.dailyCounts[6]).toBe(3);
    expect(skillRow.dailyCounts.reduce((s, v) => s + v, 0)).toBe(3);
  });

  it('keeps per-skill counts independent across skills', () => {
    const now = Date.now();
    insertTurn(db, sessionId, 'skill-x', now, 0);
    insertTurn(db, sessionId, 'skill-x', now - 100, 1);
    insertTurn(db, sessionId, 'skill-y', now, 2);
    const rows = computeSkillLeaderboard(db, { ownerId: OWNER, days: 7 });
    const x = rows.find((r) => r.skill === 'skill-x')!;
    const y = rows.find((r) => r.skill === 'skill-y')!;
    expect(x.dailyCounts[6]).toBe(2);
    expect(y.dailyCounts[6]).toBe(1);
  });

  it('zero-fills days outside the window (turns before sinceMs are excluded)', () => {
    // Turn 8 days ago — should be outside a 7-day window
    const eightDaysAgo = Date.now() - 8 * MS_PER_DAY;
    insertTurn(db, sessionId, 'skill-c', eightDaysAgo, 0);
    const rows = computeSkillLeaderboard(db, { ownerId: OWNER, days: 7 });
    // The SQL WHERE filters this out — no rows expected
    expect(rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// computeSkillLeaderboard — successRate classification by stop_reason
// ---------------------------------------------------------------------------

describe('computeSkillLeaderboard — successRate by stop_reason', () => {
  let db: Database.Database;
  let sessionId: string;
  const OWNER = 'owner-stop';
  const GAME = 'game-stop';

  beforeEach(() => {
    db = makeDb();
    const session = chatStore.createSession(db, { ownerId: OWNER, gameId: GAME, title: 'test' });
    sessionId = session.id;
  });

  it('counts timeout as a non-success failure (lowers successRate)', () => {
    insertTurnWithStop(db, sessionId, 'explore', 'end_turn', 0);
    insertTurnWithStop(db, sessionId, 'explore', 'timeout', 1);
    const row = computeSkillLeaderboard(db, { ownerId: OWNER, days: 7 }).find((r) => r.skill === 'explore')!;
    // 1 success / 2 scorable = 0.5
    expect(row.successRate).toBe(0.5);
    expect(row.legacyCount).toBe(0);
  });

  it('excludes null (legacy) and user_cancel from the success denominator', () => {
    insertTurnWithStop(db, sessionId, 'explore', 'end_turn', 0);
    insertTurnWithStop(db, sessionId, 'explore', null, 1);
    insertTurnWithStop(db, sessionId, 'explore', 'user_cancel', 2);
    const row = computeSkillLeaderboard(db, { ownerId: OWNER, days: 7 }).find((r) => r.skill === 'explore')!;
    // scorable = 3 total - 1 legacy(null) - 1 excluded(user_cancel) = 1; 1 success → 1.0
    expect(row.successRate).toBe(1);
    expect(row.legacyCount).toBe(1);
  });
});
