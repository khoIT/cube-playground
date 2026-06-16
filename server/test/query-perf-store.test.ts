/**
 * Tests for query-perf-store: insert/read/prune, NAMES-only PII gate passthrough,
 * shouldCapture sampling, error_excerpt truncation/sanitisation, and summary KPIs.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const tmp = mkdtempSync(join(tmpdir(), 'query-perf-store-test-'));
process.env.DB_PATH = join(tmp, 'test.db');
process.env.PERF_SAMPLE_RATE = '10';
process.env.PERF_SLOW_MS = '3000';

import { getDb } from '../src/db/sqlite.js';
import {
  insertQueryPerf,
  queryPerf,
  getQueryPerfById,
  summarizeQueryPerf,
  pruneQueryPerfBefore,
  shouldCapture,
  errorExcerptOf,
  type QueryPerfInput,
} from '../src/services/query-perf-store.js';

let db: ReturnType<typeof getDb>;

beforeAll(() => { db = getDb(); });
afterAll(() => {
  try { db.close(); } catch { /* ignore */ }
  rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => { db.exec('DELETE FROM query_perf'); });

function base(overrides: Partial<QueryPerfInput> = {}): QueryPerfInput {
  return {
    actorSub: 'kc-sub-1',
    actorEmail: 'a@b.com',
    workspace: 'local',
    game: 'cfm_vn',
    method: 'POST',
    status: 200,
    latencyMs: 1234,
    ts: 1_000_000,
    ...overrides,
  };
}

describe('insertQueryPerf + queryPerf', () => {
  it('persists a row and reads it back', () => {
    const row = insertQueryPerf(db, base({ status: 504, latencyMs: 30500, errorBody: { error: 'Cube request timed out after 30s' } }));
    expect(row.id).toBeGreaterThan(0);
    const [read] = queryPerf(db, {});
    expect(read.status).toBe(504);
    expect(read.latencyMs).toBe(30500);
    expect(read.errorExcerpt).toBe('Cube request timed out after 30s');
  });

  it('PII gate: stores member NAMES only — no filter values, dateRange, or UID list', () => {
    insertQueryPerf(db, base({
      query: {
        measures: ['mf_users.count'],
        dimensions: ['mf_users.user_id'],
        timeDimensions: [{ dimension: 'mf_users.last_active_date', dateRange: ['2026-04-19', '2026-05-19'] }],
        filters: [{ member: 'mf_users.ltv_30d_vnd', operator: 'gt', values: ['1000000'] }],
        uid_list: ['secret-uid-1', 'secret-uid-2'],
      },
    }));
    const [read] = queryPerf(db, {});
    const json = JSON.stringify(read.shape);
    expect(read.shape?.measures).toContain('mf_users.count');
    expect(read.shape?.dimensions).toEqual(expect.arrayContaining(['mf_users.user_id', 'mf_users.last_active_date']));
    // No leakage of values / bounds / UIDs.
    expect(json).not.toContain('1000000');
    expect(json).not.toContain('2026-04-19');
    expect(json).not.toContain('secret-uid');
  });

  it('stores used_preaggs raw (incl. empty array for lambda)', () => {
    insertQueryPerf(db, base({ usedPreaggs: [] }));
    insertQueryPerf(db, base({ ts: 1_000_001, usedPreaggs: ['mf_users.main'] }));
    const rows = queryPerf(db, {});
    expect(rows.map((r) => r.usedPreaggs)).toEqual(expect.arrayContaining(['[]', '["mf_users.main"]']));
  });

  it('never stores an error_excerpt on a 200', () => {
    const row = insertQueryPerf(db, base({ status: 200, errorBody: { error: 'should be ignored' } }));
    expect(row.errorExcerpt).toBeNull();
  });

  it('filters by statusClass and caps limit', () => {
    insertQueryPerf(db, base({ status: 200, ts: 1 }));
    insertQueryPerf(db, base({ status: 504, ts: 2 }));
    insertQueryPerf(db, base({ status: 400, ts: 3 }));
    expect(queryPerf(db, { statusClass: 'fail' })).toHaveLength(2);
    expect(queryPerf(db, { statusClass: 'success' })).toHaveLength(1);
  });

  it('getQueryPerfById returns the row or null', () => {
    const row = insertQueryPerf(db, base());
    expect(getQueryPerfById(db, row.id)?.id).toBe(row.id);
    expect(getQueryPerfById(db, 999999)).toBeNull();
  });
});

describe('shouldCapture', () => {
  it('always captures non-200s', () => {
    expect(shouldCapture(504, 10, 1)).toBe(true);
    expect(shouldCapture(400, 10, 7)).toBe(true);
  });
  it('always captures slow 200s (>= SLOW_MS)', () => {
    expect(shouldCapture(200, 3000, 1)).toBe(true);
    expect(shouldCapture(200, 5000, 3)).toBe(true);
  });
  it('samples fast 200s 1-in-N', () => {
    expect(shouldCapture(200, 100, 0)).toBe(true);   // 0 % 10 === 0
    expect(shouldCapture(200, 100, 10)).toBe(true);
    expect(shouldCapture(200, 100, 3)).toBe(false);
  });
});

describe('errorExcerptOf', () => {
  it('truncates to 200 chars', () => {
    const long = 'x'.repeat(500);
    const out = errorExcerptOf({ error: long })!;
    expect(out.length).toBeLessThanOrEqual(201); // 200 + ellipsis
    expect(out.endsWith('…')).toBe(true);
  });
  it('handles string / object / empty', () => {
    expect(errorExcerptOf('boom')).toBe('boom');
    expect(errorExcerptOf({ error: 'nope' })).toBe('nope');
    expect(errorExcerptOf(null)).toBeNull();
    expect(errorExcerptOf({})).toBeNull();
  });
});

describe('summarizeQueryPerf', () => {
  it('computes counts, fallthrough, and percentiles', () => {
    insertQueryPerf(db, base({ status: 200, latencyMs: 100, usedPreaggs: ['x'], ts: 1 }));
    insertQueryPerf(db, base({ status: 200, latencyMs: 4000, usedPreaggs: [], ts: 2 }));   // slow + fallthrough
    insertQueryPerf(db, base({ status: 504, latencyMs: 30000, ts: 3 }));                   // failure
    const s = summarizeQueryPerf(db);
    expect(s.total).toBe(3);
    expect(s.failures).toBe(1);
    expect(s.slow).toBe(1);
    expect(s.fallthrough).toBe(1);
    expect(s.p95LatencyMs).toBeGreaterThan(0);
  });
  it('is safe on an empty table', () => {
    const s = summarizeQueryPerf(db);
    expect(s).toMatchObject({ total: 0, failures: 0, p50LatencyMs: 0, p95LatencyMs: 0 });
  });
});

describe('pruneQueryPerfBefore', () => {
  it('removes rows older than cutoff', () => {
    insertQueryPerf(db, base({ ts: 100 }));
    insertQueryPerf(db, base({ ts: 5000 }));
    const removed = pruneQueryPerfBefore(db, 1000);
    expect(removed).toBe(1);
    expect(queryPerf(db, {})).toHaveLength(1);
  });
});
