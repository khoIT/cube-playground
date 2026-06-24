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

/** Insert a row with an explicit actor_sub + actor_email — used to simulate a
 *  person whose events are keyed under a sub that no longer matches their frozen
 *  user_access.kc_sub (e.g. after an IdP realm/client change). */
function insertRaw(sub: string, email: string | null, target: string, ts: number) {
  getDb()
    .prepare(
      `INSERT INTO activity_events (actor_sub, actor_email, event_type, target_id, ts)
       VALUES (?, ?, 'feature_open', ?, ?)`,
    )
    .run(sub, email, target, ts);
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

  it('recovers events keyed under a foreign sub via the denormalised email (frozen kc_sub)', () => {
    // alice's user_access.kc_sub is 'alice-sub' (set in beforeEach), but her
    // recent events are keyed under a NEW sub minted by an auth migration — with
    // actor_email still carrying her email. A sub-only read would miss them.
    insertRaw('alice-new-uuid', 'alice@corp.com', 'segments', NOW - 20 * MIN_MS);
    insertRaw('alice-new-uuid', 'alice@corp.com', 'dashboards', NOW - 18 * MIN_MS);
    const r = buildUserSessions('alice@corp.com', { now: NOW });
    expect(r.sessions30).toBe(1);
    expect(r.sessions[0].events).toHaveLength(2);
    expect(r.sparkline[29]).toBe(2);
  });

  it('email match is case-insensitive and does not leak another user’s events', () => {
    insertRaw('some-uuid', 'Alice@Corp.com', 'segments', NOW - 15 * MIN_MS); // mixed case
    insertRaw('bob-uuid', 'bob@corp.com', 'admin', NOW - 14 * MIN_MS);       // different user
    const r = buildUserSessions('alice@corp.com', { now: NOW });
    expect(r.sessions30).toBe(1);
    expect(r.sessions[0].events).toHaveLength(1);
    expect(r.sessions[0].events[0].target).toBe('segments'); // bob's 'admin' excluded
  });

  it('cube_outage health flaps are excluded from the timeline, counts, and sparkline', () => {
    // One real session (two feature opens), interleaved with outage flaps that
    // would otherwise show as "open recovered" and inflate the event count.
    feature('alice-sub', 'segments', NOW - 30 * MIN_MS);
    feature('alice-sub', 'dashboards', NOW - 25 * MIN_MS);
    for (const phase of ['unreachable', 'recovered', 'unreachable', 'recovered']) {
      insertActivity(getDb(), principal('alice-sub'), {
        eventType: 'cube_outage', targetType: 'cube_api', targetId: phase, ts: NOW - 27 * MIN_MS,
      });
    }
    const r = buildUserSessions('alice@corp.com', { now: NOW });
    expect(r.sessions30).toBe(1);
    expect(r.sessions[0].events).toHaveLength(2); // only the two feature opens
    expect(r.sessions[0].events.every((e) => e.type !== 'cube_outage')).toBe(true);
    expect(r.sparkline[29]).toBe(2); // today: outage flaps not counted
  });

  it('a window of ONLY cube_outage flaps yields no phantom sessions', () => {
    // A tab left open while Cube blips emits outage beacons with no user action.
    for (let i = 0; i < 6; i += 1) {
      insertActivity(getDb(), principal('alice-sub'), {
        eventType: 'cube_outage', targetType: 'cube_api',
        targetId: i % 2 === 0 ? 'unreachable' : 'recovered', ts: NOW - (i + 1) * MIN_MS,
      });
    }
    const r = buildUserSessions('alice@corp.com', { now: NOW });
    expect(r.sessions30).toBe(0);
    expect(r.sessions).toEqual([]);
    expect(r.sparkline.every((n) => n === 0)).toBe(true);
  });

  it('headline count + sparkline reflect the true 30d window, not just the detail-scan cap', () => {
    // An old session beyond the newest 1000 events: the capped detail scan can't
    // see it, but the full-window count + sparkline must.
    // Both old events sit firmly inside one "days-ago" bucket (12d ago, index 17).
    const oldStart = NOW - 12 * DAY_MS - 30 * MIN_MS;
    feature('alice-sub', 'a', oldStart);
    feature('alice-sub', 'b', oldStart + 2 * MIN_MS); // old session (2 events)
    // 1000 recent events today, all within one session (well under the gap).
    for (let i = 0; i < 1000; i += 1) {
      feature('alice-sub', 'segments', NOW - (1000 - i) * 1000); // 1s apart, ascending
    }
    const r = buildUserSessions('alice@corp.com', { now: NOW, limit: 10 });
    expect(r.sessions30).toBe(2);              // both sessions counted across 30d
    expect(r.sparkline[29]).toBe(1000);        // today
    expect(r.sparkline[17]).toBe(2);           // 12 days ago
    // Detail scan is capped at the newest 1000 events → only the recent session
    // surfaces in the returned cards, but the headline still counts both.
    expect(r.sessions.length).toBeGreaterThanOrEqual(1);
  });
});
