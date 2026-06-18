/**
 * Short-lived result cache for the /load proxy path: hit/miss, TTL expiry,
 * has-rows gating (never cache empty / error / continue-wait), realtime bypass,
 * and bounded eviction. Pure module — no app/auth harness, clock injected.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getCachedLoad,
  putCachedLoad,
  isCacheableResult,
  loadResultHasRows,
  isRealtimeQuery,
  resultCacheSnapshot,
  __setClockForTest,
  __resetResultCacheForTest,
  type CachedLoadResult,
} from '../src/routes/cube-load-result-cache.js';

beforeEach(() => __resetResultCacheForTest());
afterEach(() => {
  delete process.env.CUBE_LOAD_RESULT_CACHE_ENABLED;
  delete process.env.CUBE_LOAD_RESULT_CACHE_TTL_MS;
  delete process.env.CUBE_LOAD_RESULT_CACHE_MAX_ENTRIES;
});

const rows = (n = 1): CachedLoadResult => ({
  status: 200,
  body: { data: Array.from({ length: n }, (_, i) => ({ x: i })) },
});

describe('loadResultHasRows', () => {
  it('true for non-empty single-query and multi shapes', () => {
    expect(loadResultHasRows({ data: [{ x: 1 }] })).toBe(true);
    expect(loadResultHasRows({ results: [{ data: [{ x: 1 }] }] })).toBe(true);
  });
  it('false for empty, error, continue-wait, and junk', () => {
    expect(loadResultHasRows({ data: [] })).toBe(false);
    expect(loadResultHasRows({ results: [{ data: [] }] })).toBe(false);
    expect(loadResultHasRows({ error: 'Continue wait' })).toBe(false);
    expect(loadResultHasRows({ data: [{ x: 1 }], error: 'x' })).toBe(false);
    expect(loadResultHasRows(null)).toBe(false);
  });
});

describe('isCacheableResult', () => {
  it('only a non-empty 200 is cacheable', () => {
    expect(isCacheableResult(rows())).toBe(true);
    expect(isCacheableResult({ status: 200, body: { data: [] } })).toBe(false);
    expect(isCacheableResult({ status: 500, body: { data: [{ x: 1 }] } })).toBe(false);
    expect(isCacheableResult({ status: 200, body: { error: 'Continue wait' } })).toBe(false);
  });
});

describe('isRealtimeQuery', () => {
  it('detects a realtime cube member anywhere in the shape', () => {
    expect(isRealtimeQuery({ measures: ['cfm_vn__payment_delivery_realtime.cnt'] })).toBe(true);
    expect(
      isRealtimeQuery({ dimensions: ['x.a'], timeDimensions: [{ dimension: 'active_performance_realtime.ts' }] }),
    ).toBe(true);
  });
  it('false for a normal daily query', () => {
    expect(isRealtimeQuery({ measures: ['cfm_vn__performance_monthly.revenue'] })).toBe(false);
  });
});

describe('getCachedLoad / putCachedLoad', () => {
  it('miss then hit after a cacheable put', () => {
    expect(getCachedLoad('k')).toBeNull();
    putCachedLoad('k', rows());
    expect(getCachedLoad('k')).toEqual(rows());
  });

  it('never stores an empty / error result', () => {
    putCachedLoad('empty', { status: 200, body: { data: [] } });
    putCachedLoad('err', { status: 500, body: { error: 'boom' } });
    expect(getCachedLoad('empty')).toBeNull();
    expect(getCachedLoad('err')).toBeNull();
  });

  it('expires after the TTL', () => {
    let t = 1_000;
    __setClockForTest(() => t);
    process.env.CUBE_LOAD_RESULT_CACHE_TTL_MS = '5000';
    putCachedLoad('k', rows());
    t = 5_999;
    expect(getCachedLoad('k')).toEqual(rows()); // still fresh
    t = 6_001;
    expect(getCachedLoad('k')).toBeNull(); // past 1000 + 5000
  });

  it('honours the disable flag for both read and write', () => {
    process.env.CUBE_LOAD_RESULT_CACHE_ENABLED = 'false';
    putCachedLoad('k', rows());
    expect(getCachedLoad('k')).toBeNull();
    expect(resultCacheSnapshot().enabled).toBe(false);
  });

  it('evicts the oldest entry past the max size', () => {
    process.env.CUBE_LOAD_RESULT_CACHE_MAX_ENTRIES = '2';
    putCachedLoad('a', rows());
    putCachedLoad('b', rows());
    putCachedLoad('c', rows()); // evicts 'a' (oldest)
    expect(getCachedLoad('a')).toBeNull();
    expect(getCachedLoad('b')).not.toBeNull();
    expect(getCachedLoad('c')).not.toBeNull();
  });
});
