/**
 * Session aggregator — gap-based sessionization of the activity spine.
 * Covers the gap boundary (60-min threshold), single-event sessions, empty
 * timelines (no sub / no events), malformed query-shape tolerance, the daily
 * sparkline, the limit cap, and newest-first / chronological ordering.
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
import { buildUserSessions } from '../src/services/session-aggregator.js';
import type { Principal } from '../src/auth/principal.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');
const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_MS = 60 * 1000;
const NOW = 1_000 * DAY_MS;

function makeMemDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  }
  return db;
}

function seedUser(email: string, sub: string | null) {
  upsertUserAccess({ email, role: 'editor', status: 'active' });
  if (sub) getDb().prepare('UPDATE user_access SET kc_sub = ? WHERE email = ?').run(sub, email);
}

function principal(sub: string): Principal {
  return { sub, email: null, role: 'editor', workspaces: [], allowedGames: [], features: {} };
}

function feature(sub: string, target: string, ts: number) {
  insertActivity(getDb(), principal(sub), { eventType: 'feature_open', targetId: target, ts });
}

describe('session-aggregator', () => {
  beforeEach(() => {
    setDb(makeMemDb());
    __resetAccessCache();
    seedUser('alice@corp.com', 'alice-sub');
  });
  afterEach(() => { closeDb(); __resetAccessCache(); });

  it('gap boundary: events 60 min apart stay one session; 61 min apart split', () => {
    // Two events exactly 60 min apart → single session (gap must EXCEED 60).
    feature('alice-sub', 'segments', NOW - 90 * MIN_MS);
    feature('alice-sub', 'dashboards', NOW - 30 * MIN_MS); // 60 min after the first
    let r = buildUserSessions('alice@corp.com', { now: NOW });
    expect(r.sessions30).toBe(1);
    expect(r.sessions[0].events).toHaveLength(2);

    // Reset and place them 61 min apart → two sessions.
    setDb(makeMemDb());
    __resetAccessCache();
    seedUser('alice@corp.com', 'alice-sub');
    feature('alice-sub', 'segments', NOW - 91 * MIN_MS);
    feature('alice-sub', 'dashboards', NOW - 30 * MIN_MS); // 61 min later
    r = buildUserSessions('alice@corp.com', { now: NOW });
    expect(r.sessions30).toBe(2);
  });

  it('single-event session has duration 0', () => {
    feature('alice-sub', 'catalog', NOW - 10 * MIN_MS);
    const r = buildUserSessions('alice@corp.com', { now: NOW });
    expect(r.sessions30).toBe(1);
    expect(r.sessions[0].durationMs).toBe(0);
    expect(r.sessions[0].start).toBe(r.sessions[0].end);
  });

  it('never-logged-in / no events → empty timeline (not null, no throw)', () => {
    // alice has a sub but no events.
    const r = buildUserSessions('alice@corp.com', { now: NOW });
    expect(r.sessions).toEqual([]);
    expect(r.sessions30).toBe(0);
    expect(r.avgDurationMs).toBe(0);
    expect(r.sparkline).toHaveLength(30);
    expect(r.sparkline.every((n) => n === 0)).toBe(true);
  });

  it('user without a resolved sub → empty timeline', () => {
    seedUser('nosub@corp.com', null);
    const r = buildUserSessions('nosub@corp.com', { now: NOW });
    expect(r.sessions30).toBe(0);
  });

  it('tolerates a malformed query_run detail (shape null, no throw)', () => {
    // Hand-insert a corrupt detail_json that JSON.parse cannot read.
    getDb()
      .prepare(
        `INSERT INTO activity_events (actor_sub, actor_email, event_type, detail_json, ts)
         VALUES (?, ?, 'query_run', ?, ?)`,
      )
      .run('alice-sub', null, '{not json', NOW - 5 * MIN_MS);
    const r = buildUserSessions('alice@corp.com', { now: NOW });
    expect(r.sessions30).toBe(1);
    expect(r.sessions[0].events[0].shape).toBeNull();
    expect(r.sessions[0].events[0].type).toBe('query_run');
  });

  it('query_run carries the parsed member-name shape; feature_open carries target', () => {
    insertActivity(getDb(), principal('alice-sub'), {
      eventType: 'query_run',
      ts: NOW - 5 * MIN_MS,
      detail: { cubes: ['Orders'], measures: ['Orders.count'], dimensions: [] },
    });
    feature('alice-sub', 'segments', NOW - 4 * MIN_MS);
    const r = buildUserSessions('alice@corp.com', { now: NOW });
    const evs = r.sessions[0].events; // chronological within session
    expect(evs[0]).toMatchObject({ type: 'query_run', target: null, shape: { cubes: ['Orders'] } });
    expect(evs[1]).toMatchObject({ type: 'feature_open', target: 'segments', shape: null });
  });

  it('sparkline buckets events by day (last index = today)', () => {
    feature('alice-sub', 'a', NOW - 2 * MIN_MS);   // today
    feature('alice-sub', 'b', NOW - 3 * MIN_MS);   // today
    feature('alice-sub', 'c', NOW - 1 * DAY_MS - 2 * MIN_MS); // yesterday
    const r = buildUserSessions('alice@corp.com', { now: NOW });
    expect(r.sparkline[29]).toBe(2); // today
    expect(r.sparkline[28]).toBe(1); // yesterday
  });

  it('returns newest sessions first, capped at limit', () => {
    // 3 sessions spread > 1h apart; request limit 2 → 2 newest.
    feature('alice-sub', 's1', NOW - 10 * DAY_MS);
    feature('alice-sub', 's2', NOW - 5 * DAY_MS);
    feature('alice-sub', 's3', NOW - 1 * DAY_MS);
    const r = buildUserSessions('alice@corp.com', { now: NOW, limit: 2 });
    expect(r.sessions30).toBe(3);             // total across window
    expect(r.sessions).toHaveLength(2);       // capped
    expect(r.sessions[0].start).toBeGreaterThan(r.sessions[1].start); // newest first
  });
});
