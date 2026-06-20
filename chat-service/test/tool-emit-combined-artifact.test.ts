/**
 * Tests for the emit_combined_artifact tool handler. Mocks cube-meta-cache and
 * the Cube load path so no HTTP is made. Covers the happy dual-axis emit and the
 * deterministic two-card fallbacks (canMerge reject, snapped-range divergence,
 * empty side).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ToolContext, QueryArtifact, CubeQuery } from '../src/types.js';
import type { LoadCubeResult } from '../src/services/load-cube-rows.js';

vi.mock('../src/core/cube-meta-cache.js', () => ({
  getMeta: vi.fn(),
  extractMemberNames: vi.fn(),
  getMetaVersion: vi.fn().mockResolvedValue('v1'),
  invalidate: vi.fn(),
}));

vi.mock('../src/services/load-cube-rows.js', () => ({
  loadCubeRowsCovered: vi.fn(),
}));

import * as cubeMetaCache from '../src/core/cube-meta-cache.js';
import { loadCubeRowsCovered } from '../src/services/load-cube-rows.js';
import { handler } from '../src/tools/emit-combined-artifact.js';

const FIXTURE_META = {
  cubes: [
    {
      name: 'active_daily',
      measures: [{ name: 'active_daily.paying_dau', shortTitle: 'Paying DAU', type: 'number' }],
      dimensions: [{ name: 'active_daily.log_date', shortTitle: 'Date', type: 'time' }],
    },
    {
      name: 'user_recharge_daily',
      measures: [{ name: 'user_recharge_daily.revenue_vnd_total', shortTitle: 'Revenue', type: 'number' }],
      dimensions: [{ name: 'user_recharge_daily.log_date', shortTitle: 'Date', type: 'time' }],
    },
  ],
};
const KNOWN = new Set([
  'active_daily.paying_dau',
  'active_daily.log_date',
  'user_recharge_daily.revenue_vnd_total',
  'user_recharge_daily.log_date',
]);

const RANGE: [string, string] = ['2026-06-01', '2026-06-02'];
const PRIMARY: CubeQuery = {
  measures: ['active_daily.paying_dau'],
  timeDimensions: [{ dimension: 'active_daily.log_date', granularity: 'day', dateRange: RANGE }],
};
const OVERLAY: CubeQuery = {
  measures: ['user_recharge_daily.revenue_vnd_total'],
  timeDimensions: [{ dimension: 'user_recharge_daily.log_date', granularity: 'day', dateRange: RANGE }],
};

const PRIMARY_ROWS = [
  { 'active_daily.log_date.day': '2026-06-01', 'active_daily.paying_dau': 40000 },
  { 'active_daily.log_date.day': '2026-06-02', 'active_daily.paying_dau': 41000 },
];
const OVERLAY_ROWS = [
  { 'user_recharge_daily.log_date.day': '2026-06-01', 'user_recharge_daily.revenue_vnd_total': 8000000 },
  { 'user_recharge_daily.log_date.day': '2026-06-02', 'user_recharge_daily.revenue_vnd_total': 8200000 },
];

function makeCtx(): ToolContext {
  return {
    ownerId: 'o', gameId: 'cfm_vn', cubeToken: 'Bearer t', workspace: 'local',
    sessionId: 's1', turnId: 's1:1', sseEmitter: new EventEmitter(),
  };
}

/** Route the mocked loader by the query's measure. */
function mockLoad(impl: (q: CubeQuery) => LoadCubeResult) {
  vi.mocked(loadCubeRowsCovered).mockImplementation(async (q) => impl(q as CubeQuery));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(cubeMetaCache.getMeta).mockResolvedValue(FIXTURE_META);
  vi.mocked(cubeMetaCache.extractMemberNames).mockReturnValue(KNOWN);
  vi.mocked(cubeMetaCache.getMetaVersion).mockResolvedValue('v1');
});

function collect(ctx: ToolContext): QueryArtifact[] {
  const out: QueryArtifact[] = [];
  ctx.sseEmitter.on('query_artifact', (a: QueryArtifact) => out.push(a));
  return out;
}

describe('emit_combined_artifact handler', () => {
  it('emits ONE dual-axis artifact merging both series on the date axis', async () => {
    mockLoad((q) =>
      q.measures?.[0] === 'active_daily.paying_dau'
        ? { rows: PRIMARY_ROWS, query: PRIMARY }
        : { rows: OVERLAY_ROWS, query: OVERLAY },
    );
    const ctx = makeCtx();
    const arts = collect(ctx);

    const res = await handler(
      { title: 'DAU vs Revenue', summary: 'Daily paying DAU and revenue', primary: PRIMARY, overlay: OVERLAY, source: 'raw' },
      ctx,
    );

    expect(res).toMatchObject({ ok: true, combined: true });
    expect(arts).toHaveLength(1);
    const a = arts[0];
    expect(a.combined).toBe(true);
    expect(a.overlay).toBeTruthy();
    expect(a.chart?.spec.type).toBe('dual-axis');
    expect(a.chart?.spec.encoding).toMatchObject({
      category: '__date',
      value: 'active_daily.paying_dau',
      series: 'user_recharge_daily.revenue_vnd_total',
    });
    expect(a.chart?.spec.data).toHaveLength(2);
    // Forced session-storage + combined flag; payload stays the runnable primary.
    expect(a.deeplinkVia).toBe('session-storage');
    expect(a.deeplinkUrl).toContain('combined=1');
    expect(a.payload).toMatchObject({ measures: ['active_daily.paying_dau'] });
  });

  it('falls back to two cards on a granularity mismatch (canMerge reject)', async () => {
    mockLoad((q) => ({ rows: q.measures?.[0] === 'active_daily.paying_dau' ? PRIMARY_ROWS : OVERLAY_ROWS, query: q }));
    const ctx = makeCtx();
    const arts = collect(ctx);

    const weekOverlay: CubeQuery = {
      ...OVERLAY,
      timeDimensions: [{ dimension: 'user_recharge_daily.log_date', granularity: 'week', dateRange: RANGE }],
    };
    const res = await handler(
      { title: 'T', summary: 'S', primary: PRIMARY, overlay: weekOverlay, source: 'raw' },
      ctx,
    );

    expect(res).toMatchObject({ ok: true, combined: false, reason: 'granularity_mismatch' });
    expect(arts).toHaveLength(2);
    expect(arts.every((a) => !a.combined)).toBe(true);
  });

  it('falls back to two cards when the snapped ranges diverge', async () => {
    // Both relative; cubes at different freshness snap to different windows.
    mockLoad((q) =>
      q.measures?.[0] === 'active_daily.paying_dau'
        ? { rows: PRIMARY_ROWS, query: PRIMARY, snap: { member: 'active_daily.log_date', latestDate: '2026-06-02', applied: true, kind: 'relative', snappedRange: ['2026-06-01', '2026-06-02'] } }
        : { rows: OVERLAY_ROWS, query: OVERLAY, snap: { member: 'user_recharge_daily.log_date', latestDate: '2026-05-20', applied: true, kind: 'relative', snappedRange: ['2026-05-19', '2026-05-20'] } },
    );
    const ctx = makeCtx();
    const arts = collect(ctx);

    const relPrimary = { ...PRIMARY, timeDimensions: [{ ...PRIMARY.timeDimensions![0], dateRange: 'last 2 days' }] };
    const relOverlay = { ...OVERLAY, timeDimensions: [{ ...OVERLAY.timeDimensions![0], dateRange: 'last 2 days' }] };
    const res = await handler(
      { title: 'T', summary: 'S', primary: relPrimary, overlay: relOverlay, source: 'raw' },
      ctx,
    );

    expect(res).toMatchObject({ ok: true, combined: false, reason: 'snapped_range_divergence' });
    expect(arts).toHaveLength(2);
  });

  it('falls back to two cards when one side returns no rows', async () => {
    mockLoad((q) => (q.measures?.[0] === 'active_daily.paying_dau' ? { rows: PRIMARY_ROWS, query: PRIMARY } : { rows: [], query: OVERLAY }));
    const ctx = makeCtx();
    const arts = collect(ctx);

    const res = await handler(
      { title: 'T', summary: 'S', primary: PRIMARY, overlay: OVERLAY, source: 'raw' },
      ctx,
    );

    expect(res).toMatchObject({ ok: true, combined: false, reason: 'empty_result' });
    expect(arts).toHaveLength(2);
  });

  it('rejects an unknown member without loading', async () => {
    const ctx = makeCtx();
    const res = await handler(
      { title: 'T', summary: 'S', primary: { measures: ['active_daily.bogus'] }, overlay: OVERLAY, source: 'raw' },
      ctx,
    );
    expect(res).toMatchObject({ ok: false, error: 'unknown_member', detail: { which: 'measure', value: 'active_daily.bogus' } });
    expect(loadCubeRowsCovered).not.toHaveBeenCalled();
  });
});
