/**
 * Pure coverage-range helpers: relative detection, window width, snap math, and
 * the cached coverage probe. No warehouse — the probe is mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/tools/get-time-coverage.js', () => ({
  handler: vi.fn(),
}));

import { handler as getTimeCoverage } from '../src/tools/get-time-coverage.js';
import {
  isRelativeRange,
  rangeWidthDays,
  snapWindow,
  addDays,
  resolveCoverageLatest,
  DEFAULT_WINDOW_DAYS,
  __resetCoverageForTest,
} from '../src/services/resolve-coverage-range.js';

const probe = getTimeCoverage as unknown as ReturnType<typeof vi.fn>;
const ctx = { gameId: 'cfm_vn', workspace: 'local' } as never;

beforeEach(() => {
  __resetCoverageForTest();
  probe.mockReset();
});

describe('isRelativeRange', () => {
  it('treats absent and relative-phrase strings as relative, tuples as explicit', () => {
    expect(isRelativeRange(undefined)).toBe(true);
    expect(isRelativeRange('last 30 days')).toBe(true);
    expect(isRelativeRange('this month')).toBe(true);
    expect(isRelativeRange(['2026-01-01', '2026-01-31'])).toBe(false);
  });
  it('treats a single explicit ISO date as a PIN (not relative)', () => {
    // A bare YYYY-MM-DD is a user-pinned day — must never be silently snapped.
    expect(isRelativeRange('2026-06-01')).toBe(false);
    expect(isRelativeRange(' 2026-06-01 ')).toBe(false);
  });
});

describe('rangeWidthDays', () => {
  it('counts inclusive days for a tuple', () => {
    expect(rangeWidthDays(['2026-01-01', '2026-01-30'])).toBe(30);
    expect(rangeWidthDays(['2026-01-01', '2026-01-01'])).toBe(1);
  });
  it('parses relative phrases by unit', () => {
    expect(rangeWidthDays('last 30 days')).toBe(30);
    expect(rangeWidthDays('last 2 weeks')).toBe(14);
    expect(rangeWidthDays('last 3 months')).toBe(90);
  });
  it('sizes count-less calendar phrases by their natural width', () => {
    expect(rangeWidthDays('today')).toBe(1);
    expect(rangeWidthDays('yesterday')).toBe(1);
    expect(rangeWidthDays('this week')).toBe(7);
    expect(rangeWidthDays('last week')).toBe(7);
    expect(rangeWidthDays('this month')).toBe(30);
    expect(rangeWidthDays('this quarter')).toBe(91);
    expect(rangeWidthDays('last year')).toBe(365);
  });
  it('treats a single ISO date as a 1-day width', () => {
    expect(rangeWidthDays('2026-06-01')).toBe(1);
  });
  it('defaults on unknown / malformed ranges', () => {
    expect(rangeWidthDays(undefined)).toBe(DEFAULT_WINDOW_DAYS);
    expect(rangeWidthDays('whenever')).toBe(DEFAULT_WINDOW_DAYS);
    expect(rangeWidthDays(['bad', 'worse'])).toBe(DEFAULT_WINDOW_DAYS);
  });
});

describe('snapWindow / addDays', () => {
  it('builds a width-day window ending on latest', () => {
    expect(snapWindow('2026-04-30', 30)).toEqual(['2026-04-01', '2026-04-30']);
    expect(snapWindow('2026-04-30', 1)).toEqual(['2026-04-30', '2026-04-30']);
  });
  it('addDays crosses month boundaries', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-04-30', -29)).toBe('2026-04-01');
  });
});

describe('resolveCoverageLatest', () => {
  it('returns latestDate when the probe finds data', async () => {
    probe.mockResolvedValue({ found: true, latestDate: '2026-04-30' });
    expect(await resolveCoverageLatest('active_daily.log_date', ctx)).toBe('2026-04-30');
  });

  it('returns null when not found and caches the result (one probe)', async () => {
    probe.mockResolvedValue({ found: false });
    expect(await resolveCoverageLatest('x.ts', ctx)).toBeNull();
    expect(await resolveCoverageLatest('x.ts', ctx)).toBeNull();
    expect(probe).toHaveBeenCalledTimes(1); // second call served from cache
  });

  it('never throws — a probe error resolves to null', async () => {
    probe.mockRejectedValue(new Error('cold backend'));
    expect(await resolveCoverageLatest('y.ts', ctx)).toBeNull();
  });

  it('does NOT cache a transient probe error — re-probes on the next call', async () => {
    // A timeout/error must not freeze re-anchoring for the full TTL: the next
    // empty query should re-probe and pick up real coverage once it succeeds.
    probe.mockRejectedValueOnce(new Error('timeout'));
    expect(await resolveCoverageLatest('flaky.ts', ctx)).toBeNull();
    probe.mockResolvedValueOnce({ found: true, latestDate: '2026-04-30' });
    expect(await resolveCoverageLatest('flaky.ts', ctx)).toBe('2026-04-30');
    expect(probe).toHaveBeenCalledTimes(2); // error was not cached
  });

  it('caches a positive hit (no re-probe within TTL)', async () => {
    probe.mockResolvedValue({ found: true, latestDate: '2026-04-30' });
    await resolveCoverageLatest('z.ts', ctx);
    await resolveCoverageLatest('z.ts', ctx);
    expect(probe).toHaveBeenCalledTimes(1);
  });
});
