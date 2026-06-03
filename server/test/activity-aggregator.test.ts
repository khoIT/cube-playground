/**
 * Activity aggregator — org summary + per-user rollups, inactive detection,
 * email→sub resolution feeding the chat call, and graceful degradation when
 * chat-service is unreachable.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setDb, getDb, closeDb } from '../src/db/sqlite.js';
import { __resetAccessCache } from '../src/auth/access-store.js';
import { upsertUserAccess } from '../src/auth/access-store-mutators.js';
import { insertActivity } from '../src/services/activity-store.js';
import { buildActivitySummary, buildUserActivity, INACTIVE_DAYS } from '../src/services/activity-aggregator.js';
import type { Principal } from '../src/auth/principal.js';
import type { ChatStatsBySub } from '../src/services/chat-stats-client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');
const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 1_000 * DAY_MS;

function makeMemDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  }
  return db;
}

function seedUser(email: string, sub: string, role: 'viewer' | 'editor' | 'admin', status: 'active' | 'pending' | 'disabled', lastLoginMs: number | null) {
  upsertUserAccess({ email, role, status });
  const db = getDb();
  db.prepare('UPDATE user_access SET kc_sub = ? WHERE email = ?').run(sub, email);
  if (lastLoginMs !== null) {
    db.prepare(
      'INSERT INTO users (id, username, email, role, first_login, last_login) VALUES (?,?,?,?,?,?)',
    ).run(sub, email, email, role, new Date(lastLoginMs).toISOString(), new Date(lastLoginMs).toISOString());
  }
}

function principal(sub: string): Principal {
  return { sub, email: null, role: 'editor', workspaces: [], allowedGames: [], features: {} };
}

describe('activity-aggregator', () => {
  beforeEach(() => {
    setDb(makeMemDb());
    __resetAccessCache();
    // alice: active, logged in recently. bob: active, login 40d ago (inactive).
    // carol: pending, never logged in (inactive).
    seedUser('alice@corp.com', 'alice-sub', 'editor', 'active', NOW - 2 * DAY_MS);
    seedUser('bob@corp.com', 'bob-sub', 'editor', 'active', NOW - 40 * DAY_MS);
    seedUser('carol@corp.com', 'carol-sub', 'viewer', 'pending', null);
  });

  afterEach(() => { closeDb(); __resetAccessCache(); });

  it('org summary: status counts, active 7/30d, inactive list, top features', async () => {
    const db = getDb();
    // alice active within 7d; bob active within 30d but not 7d.
    insertActivity(db, principal('alice-sub'), { eventType: 'feature_open', targetId: 'segments', ts: NOW - 1 * DAY_MS });
    insertActivity(db, principal('alice-sub'), { eventType: 'feature_open', targetId: 'segments', ts: NOW - 1 * DAY_MS });
    insertActivity(db, principal('alice-sub'), { eventType: 'feature_open', targetId: 'dashboards', ts: NOW - 1 * DAY_MS });
    insertActivity(db, principal('bob-sub'), { eventType: 'feature_open', targetId: 'liveops', ts: NOW - 20 * DAY_MS });

    const stubChat: ChatStatsBySub = {
      'alice-sub': { turns: 5, input_tokens: 100, output_tokens: 50, cost_usd: 0.01, by_skill: {} },
      'bob-sub': { turns: 3, input_tokens: 60, output_tokens: 30, cost_usd: 0.006, by_skill: {} },
    };

    const summary = await buildActivitySummary({ now: NOW, fetchChatStats: async () => stubChat });

    expect(summary.usersByStatus).toEqual({ active: 2, pending: 1 });
    expect(summary.activeLast7d).toBe(1);   // alice only
    expect(summary.activeLast30d).toBe(2);  // alice + bob
    const inactiveEmails = summary.inactive.map((u) => u.email).sort();
    expect(inactiveEmails).toEqual(['bob@corp.com', 'carol@corp.com']); // >30d / never
    expect(summary.topFeatures[0]).toEqual({ feature: 'segments', count: 2 });
    expect(summary.totalChatTurns).toBe(8); // 5 + 3
  });

  it('resolves email→sub and queries chat by SUB, not email', async () => {
    let calledWith: string[] = [];
    await buildActivitySummary({
      now: NOW,
      fetchChatStats: async (subs) => {
        calledWith = subs;
        return {};
      },
    });
    // Subs (not emails) must be passed to the chat call.
    expect(calledWith.sort()).toEqual(['alice-sub', 'bob-sub', 'carol-sub']);
    expect(calledWith).not.toContain('alice@corp.com');
  });

  it('degrades gracefully when chat-service is down (null counts, no throw)', async () => {
    const summary = await buildActivitySummary({ now: NOW, fetchChatStats: async () => null });
    expect(summary.totalChatTurns).toBeNull();
    // Org structure still computed from the main DB.
    expect(summary.usersByStatus.active).toBe(2);
  });

  it('per-user activity fuses main-DB + chat stats', async () => {
    const db = getDb();
    insertActivity(db, principal('alice-sub'), { eventType: 'feature_open', targetId: 'segments', ts: NOW - 1 * DAY_MS });
    insertActivity(db, principal('alice-sub'), {
      eventType: 'query_run',
      ts: NOW - 1 * DAY_MS,
      detail: { cubes: ['Orders'], measures: ['Orders.count'], dimensions: [] },
    });
    db.prepare(
      `INSERT INTO segments (id, name, type, owner, status, created_at, updated_at, workspace)
       VALUES ('s1','seg','manual','alice-sub','fresh','t','t','local')`,
    ).run();

    const stub: ChatStatsBySub = {
      'alice-sub': { turns: 7, input_tokens: 1, output_tokens: 1, cost_usd: 0, by_skill: {} },
    };
    const user = await buildUserActivity('alice@corp.com', { now: NOW, fetchChatStats: async () => stub });

    expect(user).not.toBeNull();
    expect(user!.sub).toBe('alice-sub');
    expect(user!.inactive).toBe(false);
    expect(user!.segmentCount).toBe(1);
    expect(user!.recentFeatures).toContain('segments');
    expect(user!.recentQueryShapes[0]).toEqual({ cubes: ['Orders'], measures: ['Orders.count'], dimensions: [] });
    expect(user!.chatStats?.turns).toBe(7);
  });

  it('per-user returns null chat stats on chat-down but still returns the user', async () => {
    const user = await buildUserActivity('alice@corp.com', { now: NOW, fetchChatStats: async () => null });
    expect(user!.chatStats).toBeNull();
    expect(user!.email).toBe('alice@corp.com');
  });

  it('per-user 404-shape (null) for an unknown user', async () => {
    const user = await buildUserActivity('nobody@corp.com', { now: NOW, fetchChatStats: async () => ({}) });
    expect(user).toBeNull();
  });

  it('inactive threshold is exactly INACTIVE_DAYS', async () => {
    // A login exactly at the boundary is NOT inactive; just past it is.
    seedUser('edge@corp.com', 'edge-sub', 'editor', 'active', NOW - INACTIVE_DAYS * DAY_MS + 1000);
    const summary = await buildActivitySummary({ now: NOW, fetchChatStats: async () => ({}) });
    expect(summary.inactive.map((u) => u.email)).not.toContain('edge@corp.com');
  });
});
