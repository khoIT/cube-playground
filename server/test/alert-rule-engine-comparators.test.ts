/**
 * Alert rule engine — comparator evaluation unit tests.
 *
 * Exercises isBreach() logic for all 6 comparator types via the exported
 * evaluateAlertRules() with fully mocked dependencies (no live Cube, no DB).
 * The `__resetAlertRuleEngineState` export gives each test a clean slate so
 * the in-memory throttle map and evaluating flag don't bleed between tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock external dependencies ─────────────────────────────────────────────

vi.mock('../src/db/sqlite.js', () => ({
  getDb: vi.fn(),
}));
vi.mock('../src/services/resolve-cube-token.js', () => ({
  resolveCubeTokenForGame: vi.fn(() => 'mock-token'),
}));
vi.mock('../src/services/notify-client.js', () => ({
  sendNotification: vi.fn(async () => true),
}));
vi.mock('../src/services/cube-client.js', () => ({
  load: vi.fn(),
}));

import { getDb } from '../src/db/sqlite.js';
import { load } from '../src/services/cube-client.js';
import { sendNotification } from '../src/services/notify-client.js';
import {
  evaluateAlertRules,
  __resetAlertRuleEngineState,
} from '../src/services/alert-rule-engine.js';
import type { AlertRule } from '../src/services/alert-rule-engine.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRule(overrides: Partial<AlertRule> = {}): AlertRule {
  return {
    id: 1,
    owner: 'khoitn',
    game: 'cfm_vn',
    metric: 'active_daily.dau',
    comparator: '<',
    threshold: 1000,
    window: null,
    channel: 'in_app',
    enabled: 1,
    created_at: Date.now(),
    ...overrides,
  };
}

function mockDbWithRules(rules: AlertRule[]) {
  const mockDb = {
    prepare: vi.fn(() => ({
      all: vi.fn(() => rules),
    })),
  };
  vi.mocked(getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);
}

function mockCubeLoad(latest: number, prev: number | null) {
  const metric = 'active_daily.dau';
  const rows =
    prev !== null
      ? [{ [metric]: latest }, { [metric]: prev }]
      : [{ [metric]: latest }];
  vi.mocked(load).mockResolvedValue({ data: rows } as unknown as Awaited<ReturnType<typeof load>>);
}

beforeEach(() => {
  __resetAlertRuleEngineState();
  vi.mocked(sendNotification).mockResolvedValue(true);
});

// ── Absolute comparators ──────────────────────────────────────────────────────

describe('alert_rule_comparator_less_than', () => {
  it('breaches when latest < threshold', async () => {
    mockDbWithRules([makeRule({ comparator: '<', threshold: 1000 })]);
    mockCubeLoad(800, null);
    const { breached } = await evaluateAlertRules();
    expect(breached).toBe(1);
  });

  it('does not breach when latest >= threshold', async () => {
    mockDbWithRules([makeRule({ comparator: '<', threshold: 1000 })]);
    mockCubeLoad(1000, null);
    const { breached } = await evaluateAlertRules();
    expect(breached).toBe(0);
  });
});

describe('alert_rule_comparator_greater_than', () => {
  it('breaches when latest > threshold', async () => {
    mockDbWithRules([makeRule({ comparator: '>', threshold: 500 })]);
    mockCubeLoad(600, null);
    const { breached } = await evaluateAlertRules();
    expect(breached).toBe(1);
  });

  it('does not breach when latest <= threshold', async () => {
    mockDbWithRules([makeRule({ comparator: '>', threshold: 500 })]);
    mockCubeLoad(500, null);
    const { breached } = await evaluateAlertRules();
    expect(breached).toBe(0);
  });
});

describe('alert_rule_comparator_less_than_or_equal', () => {
  it('breaches when latest === threshold (boundary)', async () => {
    mockDbWithRules([makeRule({ comparator: '<=', threshold: 300 })]);
    mockCubeLoad(300, null);
    const { breached } = await evaluateAlertRules();
    expect(breached).toBe(1);
  });

  it('does not breach when latest > threshold', async () => {
    mockDbWithRules([makeRule({ comparator: '<=', threshold: 300 })]);
    mockCubeLoad(301, null);
    const { breached } = await evaluateAlertRules();
    expect(breached).toBe(0);
  });
});

describe('alert_rule_comparator_greater_than_or_equal', () => {
  it('breaches when latest === threshold (boundary)', async () => {
    mockDbWithRules([makeRule({ comparator: '>=', threshold: 700 })]);
    mockCubeLoad(700, null);
    const { breached } = await evaluateAlertRules();
    expect(breached).toBe(1);
  });

  it('does not breach when latest < threshold', async () => {
    mockDbWithRules([makeRule({ comparator: '>=', threshold: 700 })]);
    mockCubeLoad(699, null);
    const { breached } = await evaluateAlertRules();
    expect(breached).toBe(0);
  });
});

// ── Relative comparators ──────────────────────────────────────────────────────

describe('alert_rule_comparator_pct_drop', () => {
  it('breaches when drop% >= threshold%', async () => {
    // prev=1000, latest=850 → drop = 15% ≥ 10%
    mockDbWithRules([makeRule({ comparator: 'pct_drop', threshold: 10 })]);
    mockCubeLoad(850, 1000);
    const { breached } = await evaluateAlertRules();
    expect(breached).toBe(1);
  });

  it('does not breach when drop% < threshold%', async () => {
    // prev=1000, latest=950 → drop = 5% < 10%
    mockDbWithRules([makeRule({ comparator: 'pct_drop', threshold: 10 })]);
    mockCubeLoad(950, 1000);
    const { breached } = await evaluateAlertRules();
    expect(breached).toBe(0);
  });

  it('does not breach when prev is null (no baseline)', async () => {
    mockDbWithRules([makeRule({ comparator: 'pct_drop', threshold: 10 })]);
    mockCubeLoad(500, null);
    const { breached } = await evaluateAlertRules();
    expect(breached).toBe(0);
  });

  it('does not breach when prev === 0 (avoids divide-by-zero)', async () => {
    mockDbWithRules([makeRule({ comparator: 'pct_drop', threshold: 10 })]);
    mockCubeLoad(0, 0);
    const { breached } = await evaluateAlertRules();
    expect(breached).toBe(0);
  });
});

describe('alert_rule_comparator_pct_rise', () => {
  it('breaches when rise% >= threshold%', async () => {
    // prev=1000, latest=1250 → rise = 25% ≥ 20%
    mockDbWithRules([makeRule({ comparator: 'pct_rise', threshold: 20 })]);
    mockCubeLoad(1250, 1000);
    const { breached } = await evaluateAlertRules();
    expect(breached).toBe(1);
  });

  it('does not breach when rise% < threshold%', async () => {
    // prev=1000, latest=1150 → rise = 15% < 20%
    mockDbWithRules([makeRule({ comparator: 'pct_rise', threshold: 20 })]);
    mockCubeLoad(1150, 1000);
    const { breached } = await evaluateAlertRules();
    expect(breached).toBe(0);
  });

  it('does not breach when prev is null (no baseline)', async () => {
    mockDbWithRules([makeRule({ comparator: 'pct_rise', threshold: 20 })]);
    mockCubeLoad(2000, null);
    const { breached } = await evaluateAlertRules();
    expect(breached).toBe(0);
  });
});

// ── Throttle + no-data guards ─────────────────────────────────────────────────

describe('alert_rule_daily_throttle', () => {
  it('does not fire the same rule twice in the same evaluation run', async () => {
    mockDbWithRules([makeRule({ comparator: '<', threshold: 1000 })]);
    mockCubeLoad(500, null);

    const first = await evaluateAlertRules();
    expect(first.breached).toBe(1);

    // Second run same day — throttle map should block re-fire
    const second = await evaluateAlertRules();
    expect(second.breached).toBe(0);
  });
});

describe('alert_rule_no_data_no_breach', () => {
  it('does not fire when Cube returns no rows', async () => {
    mockDbWithRules([makeRule({ comparator: '<', threshold: 1000 })]);
    vi.mocked(load).mockResolvedValue({ data: [] } as unknown as Awaited<ReturnType<typeof load>>);
    const { breached } = await evaluateAlertRules();
    expect(breached).toBe(0);
  });
});
