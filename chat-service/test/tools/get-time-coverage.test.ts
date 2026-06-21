/**
 * Tool test for get_time_coverage — backward 31-day window walk to find the
 * latest date with data, member-kind rejection, and not-found exhaustion.
 * Mocks meta cache + fetch.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const META = {
  cubes: [
    {
      name: 'etl_money_flow',
      measures: [{ name: 'etl_money_flow.total_out', type: 'number' }],
      dimensions: [
        { name: 'etl_money_flow.log_date', type: 'time', title: 'Log date' },
        { name: 'etl_money_flow.reason_base_label', type: 'string', title: 'Reason' },
      ],
    },
  ],
};

vi.mock('../../src/config.js', () => ({
  config: { serverBaseUrl: 'http://localhost:3004' },
}));
vi.mock('../../src/core/cube-meta-cache.js', () => ({
  getMeta: vi.fn(async () => META),
}));

import { handler } from '../../src/tools/get-time-coverage.js';
import type { ToolContext } from '../../src/types.js';

const ctx = { gameId: 'g1', workspace: 'local' } as unknown as ToolContext;
const MEMBER = 'etl_money_flow.log_date';

/** Stub fetch with one /load response per call, in order. */
function mockLoadSequence(responses: Array<string | null>) {
  const fetchSpy = vi.fn(async () => {
    const next = responses.shift();
    const data = next === null || next === undefined ? [] : [{ [MEMBER]: `${next}T00:00:00.000` }];
    return { ok: true, json: async () => ({ data }) } as unknown as Response;
  });
  vi.stubGlobal('fetch', fetchSpy);
  return fetchSpy;
}

describe('get_time_coverage tool', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the latest date from the first window when recent data exists', async () => {
    const fetchSpy = mockLoadSequence(['2026-06-04']);
    const out = (await handler({ member: MEMBER }, ctx)) as {
      found: boolean; latestDate: string; probedWindows: number;
    };
    expect(out.found).toBe(true);
    expect(out.latestDate).toBe('2026-06-04');
    expect(out.probedWindows).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('walks back through empty windows until it finds data', async () => {
    // Two empty recent windows, data two months back — the d57eb4d8 shape.
    const fetchSpy = mockLoadSequence([null, null, '2026-04-30']);
    const out = (await handler({ member: MEMBER }, ctx)) as {
      found: boolean; latestDate: string; probedWindows: number;
    };
    expect(out.found).toBe(true);
    expect(out.latestDate).toBe('2026-04-30');
    expect(out.probedWindows).toBe(3);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('sends a bounded ≤31-day dateRange per probe', async () => {
    const fetchSpy = mockLoadSequence(['2026-06-04']);
    await handler({ member: MEMBER }, ctx);
    const body = JSON.parse((fetchSpy.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    const [start, end] = body.query.timeDimensions[0].dateRange as [string, string];
    const days = (Date.parse(end) - Date.parse(start)) / 86_400_000 + 1;
    expect(days).toBeLessThanOrEqual(31);
    expect(body.query.limit).toBe(1);
    expect(body.query.order).toEqual({ [MEMBER]: 'desc' });
  });

  it('reports not-found after exhausting maxWindows (rollup AND source both empty)', async () => {
    // 2 empty rollup windows + 2 empty source-confirm windows = genuinely no data.
    const fetchSpy = mockLoadSequence([null, null, null, null]);
    const out = (await handler({ member: MEMBER, maxWindows: 2 }, ctx)) as {
      found: boolean; probedWindows: number; note?: string;
    };
    expect(out.found).toBe(false);
    expect(out.note).toMatch(/no data/i);
    // Rollup walk (2) THEN a source-confirm walk (2) before declaring absence.
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  it('confirms against source when the rollup walk finds nothing (dormant-rollup masking)', async () => {
    // Rollup walk: both windows empty (unbuilt/dormant rollup partition).
    // Source-confirm walk: window 1 still empty (data older than 31d), window 2
    // returns the real latest date the empty rollup was masking.
    const fetchSpy = mockLoadSequence([null, null, null, '2026-05-15']);
    const out = (await handler({ member: MEMBER, maxWindows: 2 }, ctx)) as {
      found: boolean; latestDate: string; viaSource?: boolean; rollupDormant?: boolean; note?: string;
    };
    expect(out.found).toBe(true);
    expect(out.latestDate).toBe('2026-05-15');
    expect(out.viaSource).toBe(true);
    expect(out.rollupDormant).toBe(true);
    expect(out.note).toMatch(/pre-aggregation|rollup/i);
  });

  it('source-confirm probe uses hour granularity to bypass a day-grained rollup', async () => {
    const fetchSpy = mockLoadSequence([null, '2026-05-15']);
    await handler({ member: MEMBER, maxWindows: 1 }, ctx);
    // Call 1 = rollup walk; call 2 = source-confirm, which forces hour granularity
    // (no day-grained rollup can serve hour) so an empty rollup can't mask source.
    const rollupBody = JSON.parse((fetchSpy.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    const sourceBody = JSON.parse((fetchSpy.mock.calls[1] as unknown as [string, { body: string }])[1].body);
    expect(rollupBody.query.timeDimensions[0].granularity).not.toBe('hour');
    expect(sourceBody.query.timeDimensions[0].granularity).toBe('hour');
  });

  it('rejects a measure without querying Cube', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const out = (await handler({ member: 'etl_money_flow.total_out' }, ctx)) as {
      found: boolean; error?: string;
    };
    expect(out.found).toBe(false);
    expect(out.error).toMatch(/measure/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a non-time dimension without querying Cube', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const out = (await handler({ member: 'etl_money_flow.reason_base_label' }, ctx)) as {
      found: boolean; error?: string;
    };
    expect(out.found).toBe(false);
    expect(out.error).toMatch(/dimension/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('attaches an additive measure + day granularity to route the probe to a rollup', async () => {
    // A retention-shaped cube exposing a sum measure — the cold-scan case.
    const RETENTION_META = {
      cubes: [
        {
          name: 'retention',
          // Mirror Cube /meta: result type in `type`, aggregation in `aggType`.
          measures: [{ name: 'retention.cohort_size', type: 'number', aggType: 'sum' }],
          dimensions: [{ name: 'retention.install_date', type: 'time', title: 'Install date' }],
        },
      ],
    };
    const metaCache = await import('../../src/core/cube-meta-cache.js');
    vi.mocked(metaCache.getMeta).mockResolvedValueOnce(RETENTION_META);

    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ 'retention.install_date': '2026-06-17T00:00:00.000' }] }),
    } as unknown as Response));
    vi.stubGlobal('fetch', fetchSpy);

    const out = (await handler({ member: 'retention.install_date' }, ctx)) as {
      found: boolean; latestDate: string;
    };
    expect(out.found).toBe(true);
    expect(out.latestDate).toBe('2026-06-17');
    const body = JSON.parse((fetchSpy.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body.query.measures).toEqual(['retention.cohort_size']);
    expect(body.query.timeDimensions[0].granularity).toBe('day');
    expect(body.query.dimensions).toBeUndefined();
  });

  it('bails with timedOut on an aborted (cold-backend) probe instead of walking every window', async () => {
    const fetchSpy = vi.fn(async () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const out = (await handler({ member: MEMBER, maxWindows: 6 }, ctx)) as {
      found: boolean; timedOut?: boolean; probedWindows: number; note?: string;
    };
    expect(out.found).toBe(false);
    expect(out.timedOut).toBe(true);
    expect(out.probedWindows).toBe(1);
    expect(out.note).toMatch(/timed out/i);
    // Critically: it did NOT chain all 6 cold probes into the turn budget.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
