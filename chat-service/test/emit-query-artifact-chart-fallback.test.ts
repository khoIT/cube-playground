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
  config: { serverBaseUrl: 'http://localhost:3004' },
}));

vi.mock('../src/core/cube-meta-cache.js', () => ({
  getMeta: vi.fn().mockResolvedValue({}),
  extractMemberNames: vi.fn(
    () => new Set(['billing_detail.cash_charged_gross', 'billing_detail.order_date']),
  ),
  getMetaVersion: vi.fn().mockResolvedValue('meta-hash'),
  invalidate: vi.fn(),
}));

import { handler } from '../src/tools/emit-query-artifact.js';
import type { ToolContext, QueryArtifact } from '../src/types.js';

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

describe('emit_query_artifact chart fallback', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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
