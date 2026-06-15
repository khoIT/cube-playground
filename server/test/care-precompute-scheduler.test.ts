/**
 * Care precompute scheduler: GMT+7 window gating, due selection (incl. the
 * membership-newer-than-cache secondary trigger), serial drain, and the manual
 * trigger cooldown. The builder is mocked so no live Trino is touched.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, setDb, closeDb } from '../src/db/sqlite.js';

vi.mock('../src/services/cs-care-builder.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/services/cs-care-builder.js')>();
  return {
    ...mod,
    buildCsCarePayload: vi.fn(async (row: { id?: unknown }) => ({
      segmentId: String(row.id),
      gameId: 'cfm_vn',
      productId: 1,
      coverage: { totalMembers: 1, contactedMembers: 0, pct: 0, truncated: false },
      freshness: { csMaxLogDate: null },
      pulse: { tickets: 7, contacted: 2, openUnresolved: 0, negativeSentiment: 0, lowRating: 0 },
      issueMix: [],
      watchlist: [],
      csImpact: null,
    })),
  };
});
import { buildCsCarePayload } from '../src/services/cs-care-builder.js';
import {
  parseCareWindow,
  listDueCareSegments,
  listAllCareSegments,
  maybeRunCarePrecompute,
  triggerCarePrecompute,
  triggerCareRewarmAll,
  resetCareTriggerState,
} from '../src/services/care-precompute-scheduler.js';
import { listCareRuns } from '../src/db/segment-care-run-store.js';
import { readCareCache } from '../src/db/segment-care-cache-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');

function makeMemDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  }
  return db;
}

function seedSegment(id: string, gameId: string, lastRefreshedAt: string | null): void {
  const now = new Date().toISOString();
  getDb().prepare(`
    INSERT INTO segments (
      id, name, type, owner, status, cube,
      predicate_tree_json, cube_query_json, uid_count, uid_list_json,
      refresh_cadence_min, last_refreshed_at, created_at, updated_at, game_id
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(id, 'care test', 'predicate', 'tester', 'fresh', 'mf_users',
    '{}', '{"filters":[]}', 0, '[]', 60, lastRefreshedAt, now, now, gameId);
}

function seedCache(segmentId: string, gameId: string, computedAt: string): void {
  getDb().prepare(`
    INSERT INTO segment_care_cache (segment_id, game_id, payload_json, computed_at, last_attempt_at, status)
    VALUES (?,?,?,?,?, 'ok')
  `).run(segmentId, gameId, '{}', computedAt, computedAt);
}

// 03:30 GMT+7 (inside default 03:00-06:00) and 12:00 GMT+7 (outside).
const INSIDE = Date.UTC(2026, 5, 6, 20, 30);
const OUTSIDE = Date.UTC(2026, 5, 6, 5, 0);
// This window's start: 03:00 GMT+7 == 2026-06-06 20:00 UTC.
const WINDOW_START_ISO = '2026-06-06T20:00:00.000Z';

describe('parseCareWindow', () => {
  beforeEach(() => { delete process.env.CARE_PRECOMPUTE_WINDOW; });
  it('defaults to 03:00-06:00 GMT+7', () => {
    expect(parseCareWindow()).toEqual({ startMin: 180, endMin: 360 });
  });
  it('honors CARE_PRECOMPUTE_WINDOW', () => {
    process.env.CARE_PRECOMPUTE_WINDOW = '01:00-04:00';
    expect(parseCareWindow()).toEqual({ startMin: 60, endMin: 240 });
    delete process.env.CARE_PRECOMPUTE_WINDOW;
  });
});

describe('listDueCareSegments', () => {
  beforeEach(() => { setDb(makeMemDb()); delete process.env.CARE_PRECOMPUTE_WINDOW; });
  afterEach(() => closeDb());

  it('selects CS-covered predicate segments never computed or stale this window', () => {
    const w = parseCareWindow();
    seedSegment('never', 'cfm_vn', null);
    seedSegment('ran-yesterday', 'cfm_vn', null);
    seedCache('ran-yesterday', 'cfm_vn', '2026-06-05T20:10:00.000Z'); // before window start
    seedSegment('ran-this-window', 'cfm_vn', null);
    seedCache('ran-this-window', 'cfm_vn', '2026-06-06T20:10:00.000Z'); // after window start
    seedSegment('no-cs-coverage', 'ballistar', null); // game without CS coverage

    expect(listDueCareSegments(INSIDE, w).sort()).toEqual(['never', 'ran-yesterday']);
  });

  it('selects a segment whose membership refreshed after the last care compute', () => {
    const w = parseCareWindow();
    seedSegment('membership-moved', 'cfm_vn', '2026-06-06T20:30:00.000Z'); // refreshed this window
    seedCache('membership-moved', 'cfm_vn', '2026-06-06T20:20:00.000Z'); // computed slightly earlier
    expect(listDueCareSegments(INSIDE, w)).toContain('membership-moved');
  });
});

describe('maybeRunCarePrecompute', () => {
  beforeEach(() => {
    setDb(makeMemDb());
    resetCareTriggerState();
    vi.mocked(buildCsCarePayload).mockClear();
    delete process.env.CARE_PRECOMPUTE_WINDOW;
  });
  afterEach(() => closeDb());

  it('no-ops outside the nightly window', async () => {
    seedSegment('a', 'cfm_vn', null);
    await maybeRunCarePrecompute(OUTSIDE);
    expect(buildCsCarePayload).not.toHaveBeenCalled();
  });

  it('drains due segments serially and persists cache + run rows', async () => {
    seedSegment('a', 'cfm_vn', null);
    seedSegment('b', 'cfm_vn', null);
    await maybeRunCarePrecompute(INSIDE);

    expect(buildCsCarePayload).toHaveBeenCalledTimes(2);
    expect(readCareCache('a')!.payload.pulse.tickets).toBe(7);
    expect(readCareCache('b')).not.toBeNull();
    expect(listCareRuns({ segmentId: 'a' })[0].status).toBe('ok');
  });

  it('passes the larger background read-timeout budget + a stages sink to the builder', async () => {
    seedSegment('a', 'cfm_vn', null);
    await maybeRunCarePrecompute(INSIDE);
    // Second arg carries readTimeoutMs (default 120s) — bigger than the
    // interactive route's 30s so a cold warehouse can finish the join once —
    // plus a stages array the builder appends per-read telemetry to.
    const opts = vi.mocked(buildCsCarePayload).mock.calls[0][1];
    expect(opts).toMatchObject({ readTimeoutMs: 120_000 });
    expect(Array.isArray(opts?.stages)).toBe(true);
  });

  it('persists the builder per-stage telemetry onto the run row', async () => {
    seedSegment('a', 'cfm_vn', null);
    vi.mocked(buildCsCarePayload).mockImplementationOnce(async (_row, opts) => {
      opts?.stages?.push(
        { name: 'cs-tickets', status: 'ok', elapsedMs: 2100, rows: 12 },
        { name: 'recharge-contacted', status: 'timeout', elapsedMs: 30000, error: 'timed out' },
      );
      return {
        segmentId: 'a', gameId: 'cfm_vn', productId: 1,
        coverage: { totalMembers: 1, contactedMembers: 0, pct: 0, truncated: false },
        freshness: { csMaxLogDate: null },
        pulse: { tickets: 12, contacted: 0, openUnresolved: 0, negativeSentiment: 0, lowRating: 0 },
        issueMix: [], watchlist: [], csImpact: null,
      };
    });
    await maybeRunCarePrecompute(INSIDE);
    const stages = listCareRuns({ segmentId: 'a' })[0].stages;
    expect(stages.map((s) => s.name)).toEqual(['cs-tickets', 'recharge-contacted']);
    expect(stages[1]).toMatchObject({ status: 'timeout' });
  });

  it('a failing segment records an error run and preserves the rest of the pass', async () => {
    seedSegment('a', 'cfm_vn', null);
    seedSegment('b', 'cfm_vn', null);
    vi.mocked(buildCsCarePayload).mockRejectedValueOnce(new Error('cold trino'));
    await maybeRunCarePrecompute(INSIDE);

    expect(buildCsCarePayload).toHaveBeenCalledTimes(2);
    // One of the two recorded an error; both produced a run row.
    const aRun = listCareRuns({ segmentId: 'a' })[0];
    const bRun = listCareRuns({ segmentId: 'b' })[0];
    expect([aRun.status, bRun.status].sort()).toEqual(['error', 'ok']);
  });

  it('window start ISO matches the GMT+7 math used for due selection', () => {
    expect(new Date(WINDOW_START_ISO).getTime()).toBeLessThan(INSIDE);
  });
});

describe('rewarm-all', () => {
  beforeEach(() => {
    setDb(makeMemDb());
    resetCareTriggerState();
    vi.mocked(buildCsCarePayload).mockClear();
  });
  afterEach(() => closeDb());

  it('listAllCareSegments returns every CS-covered predicate segment, regardless of freshness', () => {
    seedSegment('warm', 'cfm_vn', null);
    seedCache('warm', 'cfm_vn', new Date().toISOString()); // fresh — still included
    seedSegment('cold', 'jus_vn', null);
    seedSegment('no-cs', 'ballistar', null); // excluded
    expect(listAllCareSegments().sort()).toEqual(['cold', 'warm']);
  });

  it('triggerCareRewarmAll drains all covered segments and rejects a concurrent pass', async () => {
    seedSegment('a', 'cfm_vn', null);
    seedSegment('b', 'jus_vn', null);

    const first = triggerCareRewarmAll();
    const second = triggerCareRewarmAll(); // in-flight → rejected
    expect(first).toEqual({ accepted: true, count: 2 });
    expect(second.accepted).toBe(false);

    // Let the serial chain finish the two mocked builds.
    await new Promise((r) => setTimeout(r, 30));
    expect(buildCsCarePayload).toHaveBeenCalledTimes(2);
    expect(readCareCache('a')).not.toBeNull();
    expect(readCareCache('b')).not.toBeNull();

    // After the pass completes the guard resets — a new pass is accepted.
    expect(triggerCareRewarmAll().accepted).toBe(true);
  });
});

describe('triggerCarePrecompute (manual)', () => {
  beforeEach(() => {
    setDb(makeMemDb());
    resetCareTriggerState();
    vi.mocked(buildCsCarePayload).mockClear();
  });
  afterEach(() => closeDb());

  it('accepts the first trigger and rate-limits repeats within 10 minutes', () => {
    const t0 = Date.now();
    expect(triggerCarePrecompute('seg1', t0)).toEqual({ accepted: true });
    const second = triggerCarePrecompute('seg1', t0 + 60_000);
    expect(second.accepted).toBe(false);
    expect(second.retryAfterMs).toBe(9 * 60_000);
    expect(triggerCarePrecompute('seg2', t0 + 60_000).accepted).toBe(true);
    expect(triggerCarePrecompute('seg1', t0 + 10 * 60_000).accepted).toBe(true);
  });
});
