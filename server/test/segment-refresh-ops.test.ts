/**
 * Segment-refresh ops derivation + watchdog.
 *
 * Pins the derived-state taxonomy (the two alarm states — wedged + degraded —
 * are the whole reason the monitor exists), the wedge-threshold floor, the
 * aggregate collector over seeded segments + card cache, and the watchdog that
 * self-heals refreshing rows past their threshold while leaving fresh in-flight
 * refreshes alone.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// The watchdog skips the id the refresh queue is actively draining; mock that
// signal so we can exercise both the reap and the skip-active paths.
let mockActiveId: string | null = null;
vi.mock('../src/jobs/refresh-queue.js', () => ({
  currentlyProcessing: () => mockActiveId,
}));

import { getDb, setDb, closeDb } from '../src/db/sqlite.js';
import {
  deriveRefreshState,
  wedgeThresholdMs,
  collectSegmentRefreshOps,
  runWedgeWatchdog,
  WEDGE_FLOOR_MIN,
} from '../src/services/segment-refresh-ops.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');

const NOW = Date.parse('2026-06-11T00:00:00.000Z');
const minsAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

function makeMemDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  }
  return db;
}

interface SeedOpts {
  id: string;
  status: string;
  cadenceMin?: number | null;
  lastRefreshedAt?: string | null;
  updatedAt?: string | null;
  uidCount?: number;
  brokenReason?: string | null;
  type?: string;
}

function seedSegment(o: SeedOpts): void {
  getDb().prepare(`
    INSERT INTO segments (
      id, name, type, owner, status, cube,
      predicate_tree_json, cube_query_json, uid_count, uid_list_json,
      refresh_cadence_min, last_refreshed_at, broken_reason, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    o.id, `seg ${o.id}`, o.type ?? 'predicate', 'tester', o.status, 'mf_users',
    '{}', '{"filters":[]}', o.uidCount ?? 100, '[]',
    o.cadenceMin === undefined ? 60 : o.cadenceMin,
    o.lastRefreshedAt ?? null, o.brokenReason ?? null,
    minsAgo(0), o.updatedAt ?? minsAgo(0),
  );
}

function seedCard(segmentId: string, cardId: string, status: 'ok' | 'error', error: string | null = null): void {
  getDb().prepare(`
    INSERT INTO segment_card_cache (segment_id, card_id, query_hash, rows_json, fetched_at, status, error)
    VALUES (?,?,?,?,?,?,?)
  `).run(segmentId, cardId, 'h', '[]', minsAgo(1), status, error);
}

describe('deriveRefreshState', () => {
  const base = { lastRefreshedAt: minsAgo(5), updatedAt: minsAgo(5), cadenceMin: 60, errorCards: 0, now: NOW };

  it('broken status → broken (highest precedence)', () => {
    expect(deriveRefreshState({ ...base, status: 'broken', errorCards: 3 })).toBe('broken');
  });

  it('refreshing under threshold → in_flight', () => {
    expect(deriveRefreshState({ ...base, status: 'refreshing', updatedAt: minsAgo(5), cadenceMin: 60 })).toBe('in_flight');
  });

  it('refreshing past threshold → wedged', () => {
    expect(deriveRefreshState({ ...base, status: 'refreshing', updatedAt: minsAgo(90), cadenceMin: 60 })).toBe('wedged');
  });

  it('serving state with erroring cards → degraded', () => {
    expect(deriveRefreshState({ ...base, status: 'fresh', errorCards: 2 })).toBe('degraded');
  });

  it('stale with prior data → serving_stale', () => {
    expect(deriveRefreshState({ ...base, status: 'stale' })).toBe('serving_stale');
  });

  it('fresh past cadence → due', () => {
    expect(deriveRefreshState({ ...base, status: 'fresh', lastRefreshedAt: minsAgo(120), cadenceMin: 60 })).toBe('due');
  });

  it('fresh on time → healthy', () => {
    expect(deriveRefreshState({ ...base, status: 'fresh', lastRefreshedAt: minsAgo(10), cadenceMin: 60 })).toBe('healthy');
  });

  it('never-refreshed fresh → due', () => {
    expect(deriveRefreshState({ ...base, status: 'fresh', lastRefreshedAt: null })).toBe('due');
  });
});

describe('wedgeThresholdMs', () => {
  it('floors short cadences at WEDGE_FLOOR_MIN', () => {
    expect(wedgeThresholdMs(5)).toBe(WEDGE_FLOOR_MIN * 60_000);
    expect(wedgeThresholdMs(null)).toBe(WEDGE_FLOOR_MIN * 60_000);
  });
  it('uses the cadence when it exceeds the floor', () => {
    expect(wedgeThresholdMs(1440)).toBe(1440 * 60_000);
  });
});

describe('collectSegmentRefreshOps', () => {
  beforeEach(() => setDb(makeMemDb()));
  afterEach(() => closeDb());

  it('derives per-segment state, tallies cards, and rolls up the summary', () => {
    seedSegment({ id: 'healthy1', status: 'fresh', lastRefreshedAt: minsAgo(5), cadenceMin: 60 });
    seedCard('healthy1', 'c1', 'ok');

    seedSegment({ id: 'wedged1', status: 'refreshing', updatedAt: minsAgo(90), cadenceMin: 60 });

    seedSegment({ id: 'degraded1', status: 'fresh', lastRefreshedAt: minsAgo(5), cadenceMin: 60 });
    seedCard('degraded1', 'c1', 'ok');
    seedCard('degraded1', 'c2', 'error', 'cold query timeout');

    seedSegment({ id: 'manualX', status: 'fresh', type: 'manual' }); // excluded

    const payload = collectSegmentRefreshOps({
      now: NOW,
      lastTickAt: minsAgo(1),
      tickIntervalMs: 60_000,
      queueProcessing: false,
      queueSize: 0,
    });

    expect(payload.summary.total).toBe(3); // manual excluded
    expect(payload.summary.wedged).toBe(1);
    expect(payload.summary.degraded).toBe(1);
    expect(payload.summary.healthy).toBe(1);

    const degraded = payload.segments.find((x) => x.id === 'degraded1')!;
    expect(degraded.derivedState).toBe('degraded');
    expect(degraded.cards).toEqual({ ok: 1, error: 1, total: 2 });
    expect(degraded.erroringCards).toEqual([{ cardId: 'c2', error: 'cold query timeout' }]);

    expect(payload.cron.sinceLastTickMs).toBe(60_000);
    expect(payload.watchdog.wedgeFloorMin).toBe(WEDGE_FLOOR_MIN);
  });

  it('handles an empty DB without throwing', () => {
    const payload = collectSegmentRefreshOps({
      now: NOW, lastTickAt: null, tickIntervalMs: 60_000, queueProcessing: false, queueSize: 0,
    });
    expect(payload.summary.total).toBe(0);
    expect(payload.segments).toEqual([]);
    expect(payload.cron.lastTickAt).toBeNull();
    expect(payload.cron.sinceLastTickMs).toBeNull();
  });
});

describe('runWedgeWatchdog', () => {
  beforeEach(() => { setDb(makeMemDb()); mockActiveId = null; });
  afterEach(() => closeDb());

  const statusOf = (id: string) =>
    (getDb().prepare('SELECT status FROM segments WHERE id = ?').get(id) as { status: string }).status;

  it("resets refreshing rows past the threshold to 'stale' and leaves fresh in-flight ones", () => {
    seedSegment({ id: 'stuck', status: 'refreshing', updatedAt: minsAgo(90), cadenceMin: 60 });
    seedSegment({ id: 'running', status: 'refreshing', updatedAt: minsAgo(5), cadenceMin: 60 });

    const reset = runWedgeWatchdog(NOW);

    expect(reset).toEqual(['stuck']);
    expect(statusOf('stuck')).toBe('stale');
    expect(statusOf('running')).toBe('refreshing');
  });

  it('treats a refreshing row with an unparseable updated_at as wedged (guards a corrupt timestamp)', () => {
    seedSegment({ id: 'badTs', status: 'refreshing', updatedAt: 'not-a-date', cadenceMin: 60 });
    expect(runWedgeWatchdog(NOW)).toEqual(['badTs']);
    expect(statusOf('badTs')).toBe('stale');
  });

  it('never reaps the segment the queue is actively draining, even past threshold', () => {
    // A slow legitimate refresh can outrun the threshold while still running.
    seedSegment({ id: 'slow', status: 'refreshing', updatedAt: minsAgo(90), cadenceMin: 60 });
    mockActiveId = 'slow';
    expect(runWedgeWatchdog(NOW)).toEqual([]);
    expect(statusOf('slow')).toBe('refreshing');
  });
});
