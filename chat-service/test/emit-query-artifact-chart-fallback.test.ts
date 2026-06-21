/**
 * emit_query_artifact deterministic chart fallback.
 *
 * When the LLM omits `chart` (or it fails to build), the handler must execute
 * the query and attach a chart derived from the query shape + rows, so an
 * emitted artifact ALWAYS carries a chart. When the LLM DOES supply a valid
 * chart, the fallback must not run (no extra /load).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

vi.mock('../src/config.js', () => ({
  config: { serverBaseUrl: 'http://localhost:3004', analysisMaxWindowDays: 90, cubeLoadTimeoutMs: 30000 },
}));

vi.mock('../src/core/cube-meta-cache.js', () => ({
  getMeta: vi.fn().mockResolvedValue({}),
  extractMemberNames: vi.fn(
    () => new Set(['billing_detail.cash_charged_gross', 'billing_detail.order_date']),
  ),
  getMetaVersion: vi.fn().mockResolvedValue('meta-hash'),
  invalidate: vi.fn(),
}));

// The coverage probe (get_time_coverage) is mocked so the snap-on-empty path is
// deterministic without a warehouse.
vi.mock('../src/tools/get-time-coverage.js', () => ({ handler: vi.fn() }));

import { handler } from '../src/tools/emit-query-artifact.js';
import { handler as getTimeCoverage } from '../src/tools/get-time-coverage.js';
import { __resetCoverageForTest } from '../src/services/resolve-coverage-range.js';
import type { ToolContext, QueryArtifact } from '../src/types.js';

const probe = getTimeCoverage as unknown as ReturnType<typeof vi.fn>;

const cash = 'billing_detail.cash_charged_gross';
const day = 'billing_detail.order_date.day';

function makeCtx(emitter: EventEmitter): ToolContext {
  return {
    ownerId: 'owner-1',
    gameId: 'cfm_vn',
    cubeToken: 'tok',
    workspace: 'prod',
    sessionId: 'sess-1',
    sseEmitter: emitter,
    // no db → no cache, no resolution memory (keeps the test pure)
  } as ToolContext;
}

const baseArgs = {
  title: 'Cash collected — daily',
  summary: 'Daily gross cash for the window',
  query: {
    measures: [cash],
    timeDimensions: [
      { dimension: 'billing_detail.order_date', granularity: 'day' as const, dateRange: ['2026-06-01', '2026-06-03'] as [string, string] },
    ],
  },
  source: 'raw' as const,
};

const SYNTHETIC_ROWS = [
  { [day]: '2026-06-01T00:00:00.000', [cash]: 100 },
  { [day]: '2026-06-02T00:00:00.000', [cash]: 200 },
  { [day]: '2026-06-03T00:00:00.000', [cash]: 150 },
];

function captureArtifact(emitter: EventEmitter): { current: QueryArtifact | null } {
  const ref: { current: QueryArtifact | null } = { current: null };
  emitter.on('query_artifact', (a: QueryArtifact) => { ref.current = a; });
  return ref;
}

// A RELATIVE-range variant (no chart) → exercises the coverage snap-on-empty.
const relativeArgs = {
  ...baseArgs,
  query: {
    measures: [cash],
    timeDimensions: [
      { dimension: 'billing_detail.order_date', granularity: 'day' as const, dateRange: 'last 30 days' },
    ],
  },
};

describe('emit_query_artifact chart fallback', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    probe.mockReset();
    __resetCoverageForTest();
  });

  // Regression: emit must hand the RAW (relative) query to the covered loader.
  // Passing the normalized query turned "last 30 days" into a tuple, read as
  // "explicit", which silently disabled re-anchoring — empty cards shipped.
  it('re-anchors an empty relative range to the latest window with data', async () => {
    const snappedRows = [
      { [day]: '2026-04-29T00:00:00.000', [cash]: 400 },
      { [day]: '2026-04-30T00:00:00.000', [cash]: 500 },
    ];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) }) // first: empty
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: snappedRows }) }); // retry: rows
    vi.stubGlobal('fetch', fetchMock);
    probe.mockResolvedValue({ found: true, latestDate: '2026-04-30' });

    const emitter = new EventEmitter();
    const artifact = captureArtifact(emitter);
    const res = await handler(relativeArgs, makeCtx(emitter));

    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2); // empty → snap → re-run
    expect(artifact.current?.summary).toContain('Showing 2026-04-01–2026-04-30');
    expect(artifact.current?.chart).toBeTruthy(); // real chart, not an empty card
  });

  // Regression (R15): when the snapped re-run is ALSO empty, the card must not
  // claim a window was applied — it discloses the latest date instead.
  it('discloses the latest date when even the snapped window has no rows', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) });
    vi.stubGlobal('fetch', fetchMock);
    probe.mockResolvedValue({ found: true, latestDate: '2026-04-30' });

    const emitter = new EventEmitter();
    const artifact = captureArtifact(emitter);
    const res = await handler(relativeArgs, makeCtx(emitter));

    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(artifact.current?.summary).toContain('No data in the requested range; latest available is 2026-04-30');
    expect(artifact.current?.summary).not.toContain('Showing 2026'); // no false "applied" window
  });

  it('derives a chart when the LLM omits one', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: SYNTHETIC_ROWS }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const emitter = new EventEmitter();
    const artifact = captureArtifact(emitter);
    const res = await handler(baseArgs, makeCtx(emitter));

    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1); // executed the query for the fallback
    expect(artifact.current?.chart).toBeTruthy();
    expect(artifact.current?.chart?.spec.type).toBe('line');
    expect(artifact.current?.chart?.spec.encoding).toEqual({ category: day, value: cash });
    // columns resolved for the derived chart too
    expect(artifact.current?.chart?.columns?.length).toBeGreaterThanOrEqual(2);
  });

  it('does NOT run the fallback when a valid LLM chart is supplied', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const emitter = new EventEmitter();
    const artifact = captureArtifact(emitter);
    const res = await handler(
      {
        ...baseArgs,
        chart: {
          type: 'line',
          title: 'Cash',
          data: SYNTHETIC_ROWS,
          encoding: { category: day, value: cash },
        },
      },
      makeCtx(emitter),
    );

    expect(res.ok).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled(); // LLM chart present → no extra /load
    expect(artifact.current?.chart?.spec.type).toBe('line');
  });

  it('still emits the artifact (chart-less) when the fallback /load fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'err',
      text: async () => 'boom',
    });
    vi.stubGlobal('fetch', fetchMock);

    const emitter = new EventEmitter();
    const artifact = captureArtifact(emitter);
    const res = await handler(baseArgs, makeCtx(emitter));

    expect(res.ok).toBe(true); // artifact still ships
    expect(artifact.current).toBeTruthy();
    expect(artifact.current?.chart).toBeUndefined(); // no chart, but no throw
  });
});
