import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getDb, setDb, closeDb } from '../src/db/sqlite.js';

vi.mock('../src/services/member360-runner.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/services/member360-runner.js')>();
  return { ...mod, precomputeSegmentMembers360: vi.fn(async () => null) };
});
import { precomputeSegmentMembers360 } from '../src/services/member360-runner.js';
import {
  parsePrecomputeWindow,
  isInsideWindow,
  currentWindowStartMs,
  listDueMember360Segments,
  maybeRunMember360Precompute,
  triggerMember360Precompute,
  resetMember360TriggerState,
} from '../src/services/member360-precompute-scheduler.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');

function makeMemDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }
  return db;
}

function seedSegment(id: string, tiersJson: string | null, lastRunAt: string | null): void {
  const now = new Date().toISOString();
  getDb().prepare(`
    INSERT INTO segments (
      id, name, type, owner, status, cube,
      predicate_tree_json, cube_query_json, uid_count, uid_list_json,
      refresh_cadence_min, last_refreshed_at, created_at, updated_at,
      game_id, member_tiers_json, member360_last_run_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(id, 'sched test', 'predicate', 'tester', 'fresh', 'mf_users',
    '{}', '{"filters":[]}', 0, '[]', 60, null, now, now, 'ballistar', tiersJson, lastRunAt);
}

// 2026-06-06 20:30 UTC == 2026-06-07 03:30 GMT+7 (inside the default window).
const INSIDE_DEFAULT = Date.UTC(2026, 5, 6, 20, 30);
// 2026-06-06 05:00 UTC == 12:00 GMT+7 (outside).
const OUTSIDE_DEFAULT = Date.UTC(2026, 5, 6, 5, 0);

describe('precompute window math (GMT+7)', () => {
  it('parses HH:MM-HH:MM and falls back to 02:00-06:00 on malformed input', () => {
    expect(parsePrecomputeWindow('03:15-05:45')).toEqual({ startMin: 195, endMin: 345 });
    for (const bad of [undefined, '', 'banana', '25:0-1:2x']) {
      expect(parsePrecomputeWindow(bad)).toEqual({ startMin: 120, endMin: 360 });
    }
  });

  it('gates by GMT+7 minutes-of-day', () => {
    const w = parsePrecomputeWindow('02:00-06:00');
    expect(isInsideWindow(INSIDE_DEFAULT, w)).toBe(true);
    expect(isInsideWindow(OUTSIDE_DEFAULT, w)).toBe(false);
    // Boundary: 06:00 GMT+7 exactly is OUTSIDE (end-exclusive).
    expect(isInsideWindow(Date.UTC(2026, 5, 6, 23, 0), w)).toBe(false);
  });

  it('handles a window wrapping midnight', () => {
    const w = parsePrecomputeWindow('22:00-02:00');
    const at2330gmt7 = Date.UTC(2026, 5, 6, 16, 30); // 23:30 GMT+7
    const at0100gmt7 = Date.UTC(2026, 5, 6, 18, 0); // 01:00 GMT+7 next day
    expect(isInsideWindow(at2330gmt7, w)).toBe(true);
    expect(isInsideWindow(at0100gmt7, w)).toBe(true);
    // 01:00 GMT+7 Jun 7 wrapped past midnight → window start was the previous
    // GMT+7 day's 22:00 (Jun 6 22:00 GMT+7 == Jun 6 15:00 UTC).
    const start = currentWindowStartMs(at0100gmt7, w);
    expect(new Date(start).toISOString()).toBe('2026-06-06T15:00:00.000Z');
  });

  it('computes the current window start for the plain case', () => {
    const w = parsePrecomputeWindow('02:00-06:00');
    // 03:30 GMT+7 → window started 02:00 GMT+7 == 19:00 UTC the previous day.
    expect(new Date(currentWindowStartMs(INSIDE_DEFAULT, w)).toISOString())
      .toBe('2026-06-06T19:00:00.000Z');
  });
});

describe('listDueMember360Segments', () => {
  beforeEach(() => setDb(makeMemDb()));
  afterEach(() => closeDb());

  it('selects tiered segments never run or last run before this window', () => {
    const w = parsePrecomputeWindow('02:00-06:00');
    seedSegment('never-ran', '{"tiers":{}}', null);
    seedSegment('ran-yesterday', '{"tiers":{}}', '2026-06-05T20:10:00.000Z');
    seedSegment('ran-this-window', '{"tiers":{}}', '2026-06-06T19:10:00.000Z');
    seedSegment('no-tiers', null, null);

    expect(listDueMember360Segments(INSIDE_DEFAULT, w).sort())
      .toEqual(['never-ran', 'ran-yesterday']);
  });
});

describe('maybeRunMember360Precompute', () => {
  beforeEach(() => {
    setDb(makeMemDb());
    vi.mocked(precomputeSegmentMembers360).mockClear();
    delete process.env.MEMBER360_PRECOMPUTE_WINDOW;
  });
  afterEach(() => closeDb());

  it('no-ops outside the nightly window', async () => {
    seedSegment('due', '{"tiers":{}}', null);
    await maybeRunMember360Precompute(OUTSIDE_DEFAULT);
    expect(precomputeSegmentMembers360).not.toHaveBeenCalled();
  });

  it('drains due segments serially inside the window', async () => {
    seedSegment('a', '{"tiers":{}}', null);
    seedSegment('b', '{"tiers":{}}', null);
    await maybeRunMember360Precompute(INSIDE_DEFAULT);
    expect(vi.mocked(precomputeSegmentMembers360).mock.calls.map((c) => c[0]).sort())
      .toEqual(['a', 'b']);
  });

  it('a failing segment does not block the rest of the pass', async () => {
    seedSegment('a', '{"tiers":{}}', null);
    seedSegment('b', '{"tiers":{}}', null);
    vi.mocked(precomputeSegmentMembers360)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(null);
    await maybeRunMember360Precompute(INSIDE_DEFAULT);
    expect(precomputeSegmentMembers360).toHaveBeenCalledTimes(2);
  });
});

describe('triggerMember360Precompute (manual)', () => {
  beforeEach(() => {
    setDb(makeMemDb());
    resetMember360TriggerState();
    vi.mocked(precomputeSegmentMembers360).mockClear().mockResolvedValue(null);
  });
  afterEach(() => closeDb());

  it('accepts the first trigger, rate-limits repeats within 10 minutes', () => {
    const t0 = Date.now();
    expect(triggerMember360Precompute('seg1', t0)).toEqual({ accepted: true });
    const second = triggerMember360Precompute('seg1', t0 + 60_000);
    expect(second.accepted).toBe(false);
    expect(second.retryAfterMs).toBe(9 * 60_000);
    // A different segment is independently limited.
    expect(triggerMember360Precompute('seg2', t0 + 60_000).accepted).toBe(true);
    // After the cooldown, accepted again.
    expect(triggerMember360Precompute('seg1', t0 + 10 * 60_000).accepted).toBe(true);
  });
});
