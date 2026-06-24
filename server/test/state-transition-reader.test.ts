/**
 * state-transition-reader unit tests.
 *
 * Two layers, no live warehouse:
 *  - SQL builders (pure) — structural assertions on the dedup CTE, the 5-state
 *    classification CASE priority, the tier COALESCE, date/game literals, and the
 *    self-join shape.
 *  - readMatrix driver — runQuery is mocked so we exercise the degrade paths
 *    (unknown game, <2 snapshot days, query error) and the happy 2-day path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/services/trino-rest-client.js', () => ({ runQuery: vi.fn() }));
vi.mock('../src/lakehouse/lakehouse-trino-connector.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    lakehouseConnectorFromEnv: vi.fn(() => ({ id: 'mock' })),
    // cfm_vn maps to a schema; "nope" does not.
    lakehouseSchemaForGame: vi.fn((g: string) => (g === 'cfm_vn' ? 'cfm_schema' : null)),
  };
});

import { runQuery } from '../src/services/trino-rest-client.js';
import {
  buildLifecycleTransitionSql,
  buildTierMigrationSql,
  readLifecycleTransitions,
  readTierMigration,
  SNAPSHOT_DATE_RE,
} from '../src/lakehouse/state-transition-reader.js';

beforeEach(() => vi.mocked(runQuery).mockReset());

// ── SQL builders ────────────────────────────────────────────────────────────

describe('buildLifecycleTransitionSql', () => {
  const sql = buildLifecycleTransitionSql('cfm_vn', '2026-06-22', '2026-06-23');

  it('dedups to one row per (date, uid) by latest snapshot_ts', () => {
    expect(sql).toContain('WITH dedup AS');
    expect(sql).toContain('ROW_NUMBER() OVER (PARTITION BY snapshot_date, uid ORDER BY snapshot_ts DESC)');
  });

  it('classifies the 5 states in priority order New > Reactivated > Core > Lapsing > Churned', () => {
    const iNew = sql.indexOf(`THEN 'new'`);
    const iReact = sql.indexOf(`THEN 'reactivated'`);
    const iCore = sql.indexOf(`THEN 'core'`);
    const iLaps = sql.indexOf(`THEN 'lapsing'`);
    const iChurn = sql.indexOf(`THEN 'churned'`);
    expect(iNew).toBeGreaterThan(-1);
    expect(iNew).toBeLessThan(iReact);
    expect(iReact).toBeLessThan(iCore);
    expect(iCore).toBeLessThan(iLaps);
    expect(iLaps).toBeLessThan(iChurn);
  });

  it('treats is_paying_user (VARCHAR) as boolean and uses install_date for New', () => {
    expect(sql).toContain(`lower(CAST(is_paying_user AS VARCHAR)) IN ('true','t','1')`);
    expect(sql).toContain(`install_date >= date_add('day', -7, DATE '2026-06-22')`);
    expect(sql).toContain(`install_date >= date_add('day', -7, DATE '2026-06-23')`);
  });

  it('self-joins prev↔curr on uid and excludes unclassified rows', () => {
    expect(sql).toContain('JOIN curr c ON p.uid = c.uid');
    expect(sql).toContain('WHERE p.state IS NOT NULL AND c.state IS NOT NULL');
    expect(sql).toContain('GROUP BY 1, 2');
  });

  it('interpolates game + dates as quoted literals (no raw injection point)', () => {
    expect(sql).toContain(`game_id = 'cfm_vn'`);
    expect(sql).toContain(`DATE '2026-06-22'`);
    expect(sql).toContain(`DATE '2026-06-23'`);
  });
});

describe('buildTierMigrationSql', () => {
  const sql = buildTierMigrationSql('cfm_vn', '2026-06-22', '2026-06-23');

  it('buckets payer_tier with an unknown fallback, no lifecycle CASE', () => {
    expect(sql).toContain(`COALESCE(CAST(payer_tier AS VARCHAR), 'unknown') AS tier`);
    expect(sql).not.toContain(`THEN 'lapsing'`);
  });

  it('self-joins prev↔curr on uid and groups by from/to', () => {
    expect(sql).toContain('JOIN curr c ON p.uid = c.uid');
    expect(sql).toContain('GROUP BY 1, 2');
  });
});

describe('SNAPSHOT_DATE_RE', () => {
  it('accepts ISO dates and rejects junk', () => {
    expect(SNAPSHOT_DATE_RE.test('2026-06-23')).toBe(true);
    expect(SNAPSHOT_DATE_RE.test("2026-06-23'; DROP")).toBe(false);
    expect(SNAPSHOT_DATE_RE.test('2026-6-3')).toBe(false);
  });
});

// ── readMatrix driver (mocked runQuery) ───────────────────────────────────────

describe('readLifecycleTransitions degrade paths', () => {
  it('unknown game → available:false, no query issued', async () => {
    const res = await readLifecycleTransitions('nope');
    expect(res.available).toBe(false);
    expect(res.capturedDays).toBe(0);
    expect(vi.mocked(runQuery)).not.toHaveBeenCalled();
  });

  it('fewer than two snapshot days → accumulating, available:false', async () => {
    // First call: latest-dates query returns a single date.
    vi.mocked(runQuery).mockResolvedValueOnce({ columns: [], rows: [['2026-06-23']] });
    const res = await readLifecycleTransitions('cfm_vn');
    expect(res.available).toBe(false);
    expect(res.capturedDays).toBe(1);
    expect(res.reason).toMatch(/1 of 2/);
    // Only the dates query ran — no matrix query.
    expect(vi.mocked(runQuery)).toHaveBeenCalledTimes(1);
  });

  it('latest-dates query throwing → disclosed-empty, not a thrown error', async () => {
    vi.mocked(runQuery).mockRejectedValueOnce(new Error('Trino down'));
    const res = await readLifecycleTransitions('cfm_vn');
    expect(res.available).toBe(false);
    expect(res.reason).toMatch(/not reachable/);
  });

  it('two days → parses cells and sums coverage', async () => {
    vi.mocked(runQuery)
      .mockResolvedValueOnce({ columns: [], rows: [['2026-06-23'], ['2026-06-22']] })
      .mockResolvedValueOnce({
        columns: [],
        rows: [
          ['core', 'core', 100],
          ['core', 'lapsing', 25],
          ['lapsing', 'churned', 10],
        ],
      });
    const res = await readLifecycleTransitions('cfm_vn');
    expect(res.available).toBe(true);
    expect(res.prevDate).toBe('2026-06-22');
    expect(res.currDate).toBe('2026-06-23');
    expect(res.cells).toHaveLength(3);
    expect(res.coverageUsers).toBe(135);
  });
});

describe('readTierMigration', () => {
  it('two days → parses tier cells', async () => {
    vi.mocked(runQuery)
      .mockResolvedValueOnce({ columns: [], rows: [['2026-06-23'], ['2026-06-22']] })
      .mockResolvedValueOnce({
        columns: [],
        rows: [
          ['minnow', 'dolphin', 5],
          ['dolphin', 'dolphin', 40],
        ],
      });
    const res = await readTierMigration('cfm_vn');
    expect(res.available).toBe(true);
    expect(res.cells).toEqual([
      { from: 'minnow', to: 'dolphin', count: 5 },
      { from: 'dolphin', to: 'dolphin', count: 40 },
    ]);
  });
});
