/**
 * cubestore-query-cache-check: extract planned pre-aggs from a /sql dry-run
 * body (single-object vs array shapes) and map each to a cache verdict against
 * CubeStore materialisation. Cube client + CubeStore introspect are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/services/cube-client.js', () => ({ sqlWithCtx: vi.fn() }));
vi.mock('../src/services/resolve-cube-token.js', () => ({
  resolveCubeTokenForWorkspace: vi.fn(() => ({ token: 't' })),
}));
vi.mock('../src/services/cubestore-introspect.js', () => ({
  isCubestoreIntrospectEnabled: vi.fn(() => true),
  findPreaggByTableName: vi.fn(),
}));

import { sqlWithCtx } from '../src/services/cube-client.js';
import { isCubestoreIntrospectEnabled, findPreaggByTableName } from '../src/services/cubestore-introspect.js';
import { extractPlannedPreaggs, checkQueryCache } from '../src/services/cubestore-query-cache-check.js';
import type { WorkspaceDef } from '../src/services/workspaces-config-loader.js';

const mockSql = sqlWithCtx as ReturnType<typeof vi.fn>;
const mockEnabled = isCubestoreIntrospectEnabled as ReturnType<typeof vi.fn>;
const mockFind = findPreaggByTableName as ReturnType<typeof vi.fn>;

const WS: WorkspaceDef = { id: 'local', label: 'Local', cubeApiUrl: 'http://c:4000', authMode: 'minted', gameModel: 'game_id' };
const mat = (over: Record<string, unknown> = {}) => ({
  schema: 'preagg_cfm', base: 'active_daily_dau_batch', tableCount: 1, sealedCount: 1, readyCount: 1,
  partitions: 2, activePartitions: 1, rows: 10, bytes: 100, buildRangeEnd: '2026-06-01T00:00:00Z', sealAt: null, ...over,
});

beforeEach(() => { mockSql.mockReset(); mockEnabled.mockReturnValue(true); mockFind.mockReset(); });

describe('extractPlannedPreaggs', () => {
  it('reads from a single sql object', () => {
    const out = extractPlannedPreaggs({ sql: { preAggregations: [{ preAggregationId: 'active_daily.dau_batch', tableName: 'preagg_cfm.active_daily_dau_batch' }] } });
    expect(out).toEqual([{ preAggregationId: 'active_daily.dau_batch', tableName: 'preagg_cfm.active_daily_dau_batch' }]);
  });
  it('reads from an array sql shape and tolerates missing fields', () => {
    expect(extractPlannedPreaggs({ sql: [{ preAggregations: [{}] }] })).toEqual([{ preAggregationId: '', tableName: '' }]);
  });
  it('returns [] when no preAggregations planned', () => {
    expect(extractPlannedPreaggs({ sql: { preAggregations: [] } })).toEqual([]);
    expect(extractPlannedPreaggs({})).toEqual([]);
  });
});

describe('checkQueryCache', () => {
  it('short-circuits with enabled:false when introspection is off', async () => {
    mockEnabled.mockReturnValue(false);
    const r = await checkQueryCache(WS, 'cfm_vn', { measures: ['active_daily.dau'] });
    expect(r.enabled).toBe(false);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('reports passthrough when the query plans no rollup', async () => {
    mockSql.mockResolvedValue({ sql: { preAggregations: [] } });
    const r = await checkQueryCache(WS, 'cfm_vn', { measures: ['active_daily.dau'] });
    expect(r.willServeFromCache).toBe(false);
    expect(r.preaggs).toHaveLength(0);
    expect(r.note).toMatch(/routes to source/i);
  });

  it('verdict=materialized when the planned rollup is active + ready', async () => {
    mockSql.mockResolvedValue({ sql: { preAggregations: [{ preAggregationId: 'active_daily.dau_batch', tableName: 'preagg_cfm.active_daily_dau_batch' }] } });
    mockFind.mockResolvedValue(mat({ activePartitions: 2, readyCount: 1 }));
    const r = await checkQueryCache(WS, 'cfm_vn', {});
    expect(r.willServeFromCache).toBe(true);
    expect(r.preaggs[0].verdict).toBe('materialized');
  });

  it('verdict=registered-not-active when the rollup exists but has no active partitions', async () => {
    mockSql.mockResolvedValue({ sql: { preAggregations: [{ preAggregationId: 'x.y', tableName: 'preagg_cfm.y' }] } });
    mockFind.mockResolvedValue(mat({ activePartitions: 0, readyCount: 1 }));
    const r = await checkQueryCache(WS, 'cfm_vn', {});
    expect(r.willServeFromCache).toBe(false);
    expect(r.preaggs[0].verdict).toBe('registered-not-active');
  });

  it('verdict=not-built when CubeStore has no matching table', async () => {
    mockSql.mockResolvedValue({ sql: { preAggregations: [{ preAggregationId: 'x.y', tableName: 'preagg_cfm.y' }] } });
    mockFind.mockResolvedValue(null);
    const r = await checkQueryCache(WS, 'cfm_vn', {});
    expect(r.preaggs[0].verdict).toBe('not-built');
  });

  it('returns an error payload when the dry-run throws', async () => {
    mockSql.mockRejectedValue(new Error('cube down'));
    const r = await checkQueryCache(WS, 'cfm_vn', {});
    expect(r.error).toBe('cube down');
    expect(r.willServeFromCache).toBe(false);
  });
});
