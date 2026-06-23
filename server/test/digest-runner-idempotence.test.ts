/**
 * Digest runner — idempotence + next_run_at cadence advance tests.
 *
 * Rules under test:
 *   1. When last_run_date === today → delivery skipped, next_run_at still advanced.
 *   2. Daily cadence advances next_run_at by +1d (≈86 400 000 ms).
 *   3. Weekly cadence advances next_run_at by +7d.
 *   4. Normal (non-idempotent) path: processes the subscription, delivers, advances.
 *   5. Empty metrics_json → skipped without delivery.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock all I/O ──────────────────────────────────────────────────────────────

vi.mock('../src/db/sqlite.js', () => ({ getDb: vi.fn() }));
vi.mock('../src/services/cube-client.js', () => ({ load: vi.fn(async () => ({ data: [] })) }));
vi.mock('../src/services/resolve-cube-token.js', () => ({
  resolveCubeTokenForGame: vi.fn(() => 'mock-token'),
}));
vi.mock('../src/services/notify-client.js', () => ({
  sendNotification: vi.fn(async () => true),
}));
vi.mock('../src/services/anomaly-state-store.js', () => ({
  listAnomalies: vi.fn(() => []),
}));

import { getDb } from '../src/db/sqlite.js';
import { load } from '../src/services/cube-client.js';
import { sendNotification } from '../src/services/notify-client.js';
import { maybeRunDigests } from '../src/jobs/digest-runner.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

const TODAY_ISO = new Date().toISOString().slice(0, 10);
const YESTERDAY_ISO = new Date(Date.now() - DAY_MS).toISOString().slice(0, 10);

interface SubRow {
  id: number;
  owner: string;
  game: string;
  metrics_json: string;
  cadence: 'daily' | 'weekly';
  channel: string;
  next_run_at: number | null;
  last_run_date: string | null;
  created_at: number;
}

function makeSub(overrides: Partial<SubRow> = {}): SubRow {
  return {
    id: 1,
    owner: 'khoitn',
    game: 'cfm_vn',
    metrics_json: JSON.stringify(['active_daily.dau']),
    cadence: 'daily',
    channel: 'in_app',
    next_run_at: Date.now() - 1000, // overdue
    last_run_date: null,
    created_at: Date.now() - DAY_MS,
    ...overrides,
  };
}

/**
 * Returns captured UPDATE calls so tests can assert on next_run_at / last_run_date.
 */
function mockDbWithSubs(rows: SubRow[]) {
  const updateCalls: Array<{ nextRunAt: number; lastRunDate: string; id: number }> = [];

  const mockDb = {
    prepare: vi.fn((sql: string) => {
      if (sql.includes('SELECT')) {
        return { all: vi.fn(() => rows) };
      }
      if (sql.includes('UPDATE')) {
        return {
          run: vi.fn((nextRunAt: number, lastRunDate: string, id: number) => {
            updateCalls.push({ nextRunAt, lastRunDate, id });
          }),
        };
      }
      return { all: vi.fn(() => []), run: vi.fn() };
    }),
  };

  vi.mocked(getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);
  return { updateCalls };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(sendNotification).mockResolvedValue(true);
  // cube-client load mock: return empty data (no metric values needed for these tests)
  vi.mocked(load).mockResolvedValue({ data: [] } as unknown as Awaited<ReturnType<typeof load>>);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('digest_runner_idempotence_guard', () => {
  it('skips delivery when last_run_date already equals today', async () => {
    const { updateCalls } = mockDbWithSubs([
      makeSub({ last_run_date: TODAY_ISO }),
    ]);
    const now = Date.now();

    const result = await maybeRunDigests(now);

    // processed=0 — the idempotence guard fires before the processed++ increment
    expect(result.processed).toBe(0);
    expect(result.delivered).toBe(0);
    expect(vi.mocked(sendNotification)).not.toHaveBeenCalled();

    // next_run_at must still be advanced so the row doesn't keep scanning
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].lastRunDate).toBe(TODAY_ISO);
  });

  it('does NOT skip delivery when last_run_date is yesterday', async () => {
    mockDbWithSubs([makeSub({ last_run_date: YESTERDAY_ISO })]);

    const result = await maybeRunDigests(Date.now());

    expect(result.processed).toBe(1);
    expect(result.delivered).toBe(1);
    expect(vi.mocked(sendNotification)).toHaveBeenCalledOnce();
  });

  it('does NOT skip delivery when last_run_date is null (first run)', async () => {
    mockDbWithSubs([makeSub({ last_run_date: null })]);

    const result = await maybeRunDigests(Date.now());

    expect(result.processed).toBe(1);
    expect(vi.mocked(sendNotification)).toHaveBeenCalledOnce();
  });
});

describe('digest_runner_next_run_at_cadence_advance', () => {
  it('daily cadence: next_run_at advances by ~+1d from now', async () => {
    const { updateCalls } = mockDbWithSubs([
      makeSub({ cadence: 'daily', last_run_date: null }),
    ]);
    const beforeRun = Date.now();
    await maybeRunDigests(beforeRun);
    const afterRun = Date.now();

    // Find the update call that came from advanceNextRunAt (not the idempotence path)
    const advance = updateCalls.find((c) => c.id === 1);
    expect(advance).toBeDefined();

    const elapsed = advance!.nextRunAt - beforeRun;
    // Allow ±5 s tolerance for test execution
    expect(elapsed).toBeGreaterThanOrEqual(DAY_MS - 5_000);
    expect(elapsed).toBeLessThanOrEqual(DAY_MS + afterRun - beforeRun + 5_000);
  });

  it('weekly cadence: next_run_at advances by ~+7d from now', async () => {
    const { updateCalls } = mockDbWithSubs([
      makeSub({ cadence: 'weekly', last_run_date: null }),
    ]);
    const beforeRun = Date.now();
    await maybeRunDigests(beforeRun);
    const afterRun = Date.now();

    const advance = updateCalls.find((c) => c.id === 1);
    expect(advance).toBeDefined();

    const elapsed = advance!.nextRunAt - beforeRun;
    expect(elapsed).toBeGreaterThanOrEqual(WEEK_MS - 5_000);
    expect(elapsed).toBeLessThanOrEqual(WEEK_MS + afterRun - beforeRun + 5_000);
  });
});

describe('digest_runner_empty_metrics_skipped', () => {
  it('advances but does not deliver when metrics_json is an empty array', async () => {
    const { updateCalls } = mockDbWithSubs([
      makeSub({ metrics_json: '[]', last_run_date: null }),
    ]);

    const result = await maybeRunDigests(Date.now());

    // processed increments because the idempotence check passed
    expect(result.processed).toBe(1);
    // but delivery never fires — no metrics to compose
    expect(result.delivered).toBe(0);
    expect(vi.mocked(sendNotification)).not.toHaveBeenCalled();
    // next_run_at is still advanced
    expect(updateCalls).toHaveLength(1);
  });
});

// NOTE: The concurrent-run gate (module-level `running` flag) is not directly
// testable without a __reset export from digest-runner — a never-resolving
// sendNotification would permanently poison the `running` flag for all subsequent
// tests in the same module instance. Skipped intentionally. The gate is covered
// by code inspection: if (running) return { processed: 0, delivered: 0 }.

