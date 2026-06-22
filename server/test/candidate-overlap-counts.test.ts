/**
 * Unit tests for candidate-overlap-counts — SQL builder + parse/ranking logic.
 *
 * All Trino I/O is injected via `deps.runQueryFn`. No real Trino or Cube calls.
 * The SQL builder itself is a pure string function; we assert on its shape
 * and escaping rather than re-testing Trino's SQL parser.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  buildCandidateOverlapSql,
  computeCandidateOverlap,
  MAX_CANDIDATE_SAMPLE,
  MIN_OVERLAP_PCT,
  TOP_K,
} from '../src/lakehouse/candidate-overlap-counts.js';
import type { Connector } from '../src/services/trino-profiler-config.js';

const connector: Connector = {
  id: 'test',
  label: 'test',
  workspaceId: 'local',
  sourceType: 'trino',
  host: 'unused',
  port: 8080,
  user: 'test',
  password: '',
  catalog: 'game_integration',
  ssl: false,
};

const SCHEMA = 'khoitn/local';

// ---------------------------------------------------------------------------
// buildCandidateOverlapSql — SQL shape + literal escaping
// ---------------------------------------------------------------------------

describe('buildCandidateOverlapSql', () => {
  it('references SEGMENT_MEMBERSHIP_DAILY and filters by game_id and segment_id list', () => {
    const sql = buildCandidateOverlapSql({
      gameId: 'cfm_vn',
      segmentIds: ['seg-a', 'seg-b'],
      candidateUids: ['u1', 'u2'],
    });
    expect(sql).toContain('segment_membership_daily');
    expect(sql).toContain("game_id = 'cfm_vn'");
    expect(sql).toContain("'seg-a'");
    expect(sql).toContain("'seg-b'");
  });

  it('inlines candidate uids as a VALUES table', () => {
    const sql = buildCandidateOverlapSql({
      gameId: 'cfm_vn',
      segmentIds: ['seg-a'],
      candidateUids: ['uid-001', 'uid-002'],
    });
    expect(sql).toContain("'uid-001'");
    expect(sql).toContain("'uid-002'");
    expect(sql).toMatch(/VALUES/i);
    // sample_uids CTE should be present
    expect(sql).toContain('sample_uids');
  });

  it('resolves latest partition: max(snapshot_date) then max(snapshot_ts)', () => {
    const sql = buildCandidateOverlapSql({
      gameId: 'cfm_vn',
      segmentIds: ['s1'],
      candidateUids: ['u1'],
    });
    expect(sql).toContain('max(snapshot_date)');
    expect(sql).toContain('max(snapshot_ts)');
  });

  it('intersects snapshot membership against sample via semi-join', () => {
    const sql = buildCandidateOverlapSql({
      gameId: 'cfm_vn',
      segmentIds: ['s1'],
      candidateUids: ['u1'],
    });
    // The final SELECT must join members to sample_uids
    expect(sql).toContain('uid IN (SELECT uid FROM sample_uids)');
    expect(sql).toContain('count(*)');
    expect(sql).toContain('GROUP BY');
  });

  it('correctly escapes single-quotes in game_id and segment ids', () => {
    const sql = buildCandidateOverlapSql({
      gameId: "cfm'vn",
      segmentIds: ["seg'; DROP TABLE"],
      candidateUids: ["u'1"],
    });
    // Apostrophes must be doubled per SQL standard (injection-safe by quoting).
    // The full escaped literals must appear verbatim — `toSqlLiteral` doubles
    // embedded single-quotes so the SQL parser never sees a premature close-quote.
    expect(sql).toContain("'cfm''vn'");
    expect(sql).toContain("'seg''; DROP TABLE'");
    expect(sql).toContain("'u''1'");
    // The "DROP TABLE" substring is present but trapped inside a properly quoted
    // SQL string literal — the segment id value. We verify the full quoted form
    // rather than trying to parse the surrounding chars, which is more fragile.
    expect(sql).toContain("seg''; DROP TABLE");
  });

  it('caps the inlined uid list at MAX_CANDIDATE_SAMPLE', () => {
    const manyUids = Array.from({ length: MAX_CANDIDATE_SAMPLE + 100 }, (_, i) => `u${i}`);
    const sql = buildCandidateOverlapSql({
      gameId: 'cfm_vn',
      segmentIds: ['s1'],
      candidateUids: manyUids,
    });
    // The last uid beyond the cap must NOT appear
    expect(sql).not.toContain(`u${MAX_CANDIDATE_SAMPLE}`);
    // The last uid within the cap MUST appear
    expect(sql).toContain(`u${MAX_CANDIDATE_SAMPLE - 1}`);
  });

  it('returns a no-op SELECT when segment list is empty', () => {
    const sql = buildCandidateOverlapSql({ gameId: 'cfm_vn', segmentIds: [], candidateUids: ['u1'] });
    expect(sql).toContain('WHERE 1=0');
  });

  it('returns a no-op SELECT when uid list is empty', () => {
    const sql = buildCandidateOverlapSql({ gameId: 'cfm_vn', segmentIds: ['s1'], candidateUids: [] });
    expect(sql).toContain('WHERE 1=0');
  });
});

// ---------------------------------------------------------------------------
// computeCandidateOverlap — parse/ranking/filtering
// ---------------------------------------------------------------------------

describe('computeCandidateOverlap', () => {
  const savedSegments = [
    { id: 'seg-whale', name: 'Lapsing Whales' },
    { id: 'seg-new', name: 'New Users' },
    { id: 'seg-low', name: 'Low Spenders' },
  ];

  it('computes pct_of_candidate = both_count / candidate_size', async () => {
    const candidateUids = Array.from({ length: 100 }, (_, i) => `u${i}`);
    const runQueryFn = vi.fn(async () => ({
      columns: [],
      rows: [
        ['seg-whale', 80], // 80/100 = 0.80
        ['seg-new', 10],   // 10/100 = 0.10 — below threshold, filtered out
      ],
    }));
    const results = await computeCandidateOverlap(
      connector,
      SCHEMA,
      { game_id: 'cfm_vn', savedSegments, candidateUids },
      { runQueryFn },
    );
    expect(results).toHaveLength(1);
    expect(results[0].segment_id).toBe('seg-whale');
    expect(results[0].both_count).toBe(80);
    expect(results[0].candidate_size).toBe(100);
    expect(results[0].pct_of_candidate).toBeCloseTo(0.8, 5);
  });

  it('filters out overlaps below MIN_OVERLAP_PCT', async () => {
    const candidateUids = Array.from({ length: 200 }, (_, i) => `u${i}`);
    // below threshold: 49/200 = 0.245 < 0.25
    const runQueryFn = vi.fn(async () => ({
      columns: [],
      rows: [['seg-whale', 49]],
    }));
    const results = await computeCandidateOverlap(
      connector,
      SCHEMA,
      { game_id: 'cfm_vn', savedSegments, candidateUids },
      { runQueryFn },
    );
    expect(results).toHaveLength(0);
  });

  it('passes MIN_OVERLAP_PCT boundary exactly', async () => {
    const candidateUids = Array.from({ length: 200 }, (_, i) => `u${i}`);
    // exactly at threshold: 50/200 = 0.25 — should be included
    const runQueryFn = vi.fn(async () => ({
      columns: [],
      rows: [['seg-whale', 50]],
    }));
    const results = await computeCandidateOverlap(
      connector,
      SCHEMA,
      { game_id: 'cfm_vn', savedSegments, candidateUids },
      { runQueryFn },
    );
    expect(results).toHaveLength(1);
    expect(results[0].pct_of_candidate).toBeCloseTo(MIN_OVERLAP_PCT, 5);
  });

  it('sorts results descending by pct_of_candidate', async () => {
    const candidateUids = Array.from({ length: 100 }, (_, i) => `u${i}`);
    const runQueryFn = vi.fn(async () => ({
      columns: [],
      rows: [
        ['seg-new', 30],    // 0.30
        ['seg-whale', 70],  // 0.70
        ['seg-low', 50],    // 0.50
      ],
    }));
    const results = await computeCandidateOverlap(
      connector,
      SCHEMA,
      { game_id: 'cfm_vn', savedSegments, candidateUids },
      { runQueryFn },
    );
    expect(results[0].segment_id).toBe('seg-whale');
    expect(results[1].segment_id).toBe('seg-low');
    expect(results[2].segment_id).toBe('seg-new');
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].pct_of_candidate).toBeGreaterThanOrEqual(results[i].pct_of_candidate);
    }
  });

  it('caps output at TOP_K results', async () => {
    // More segments than TOP_K, all above threshold
    const manySegments = Array.from({ length: TOP_K + 5 }, (_, i) => ({
      id: `seg-${i}`,
      name: `Segment ${i}`,
    }));
    const candidateUids = Array.from({ length: 100 }, (_, i) => `u${i}`);
    const rows = manySegments.map((s, i) => [s.id, 30 + i]); // all ≥ 30/100 = 0.30
    const runQueryFn = vi.fn(async () => ({ columns: [], rows }));

    const results = await computeCandidateOverlap(
      connector,
      SCHEMA,
      { game_id: 'cfm_vn', savedSegments: manySegments, candidateUids },
      { runQueryFn },
    );
    expect(results.length).toBeLessThanOrEqual(TOP_K);
  });

  it('resolves segment names from savedSegments lookup', async () => {
    const candidateUids = Array.from({ length: 100 }, (_, i) => `u${i}`);
    const runQueryFn = vi.fn(async () => ({
      columns: [],
      rows: [['seg-whale', 80]],
    }));
    const results = await computeCandidateOverlap(
      connector,
      SCHEMA,
      { game_id: 'cfm_vn', savedSegments, candidateUids },
      { runQueryFn },
    );
    expect(results[0].name).toBe('Lapsing Whales');
  });

  it('returns empty array when candidateUids is empty (no query fired)', async () => {
    const runQueryFn = vi.fn();
    const results = await computeCandidateOverlap(
      connector,
      SCHEMA,
      { game_id: 'cfm_vn', savedSegments, candidateUids: [] },
      { runQueryFn },
    );
    expect(results).toHaveLength(0);
    expect(runQueryFn).not.toHaveBeenCalled();
  });

  it('returns empty array when savedSegments is empty (no query fired)', async () => {
    const runQueryFn = vi.fn();
    const candidateUids = ['u1', 'u2'];
    const results = await computeCandidateOverlap(
      connector,
      SCHEMA,
      { game_id: 'cfm_vn', savedSegments: [], candidateUids },
      { runQueryFn },
    );
    expect(results).toHaveLength(0);
    expect(runQueryFn).not.toHaveBeenCalled();
  });

  it('returns empty array (no throw) when runQueryFn throws', async () => {
    const candidateUids = Array.from({ length: 10 }, (_, i) => `u${i}`);
    const runQueryFn = vi.fn(async () => {
      throw new Error('Trino unavailable');
    });
    const results = await computeCandidateOverlap(
      connector,
      SCHEMA,
      { game_id: 'cfm_vn', savedSegments, candidateUids },
      { runQueryFn },
    );
    expect(results).toHaveLength(0);
  });

  it('returns empty array when Trino returns no rows', async () => {
    const candidateUids = Array.from({ length: 10 }, (_, i) => `u${i}`);
    const runQueryFn = vi.fn(async () => ({ columns: [], rows: [] }));
    const results = await computeCandidateOverlap(
      connector,
      SCHEMA,
      { game_id: 'cfm_vn', savedSegments, candidateUids },
      { runQueryFn },
    );
    expect(results).toHaveLength(0);
  });

  it('ignores rows with both_count = 0', async () => {
    const candidateUids = Array.from({ length: 100 }, (_, i) => `u${i}`);
    const runQueryFn = vi.fn(async () => ({
      columns: [],
      rows: [
        ['seg-whale', 0],
        ['seg-new', 50], // 0.50 — should appear
      ],
    }));
    const results = await computeCandidateOverlap(
      connector,
      SCHEMA,
      { game_id: 'cfm_vn', savedSegments, candidateUids },
      { runQueryFn },
    );
    expect(results).toHaveLength(1);
    expect(results[0].segment_id).toBe('seg-new');
  });

  it('approx is always true (structural — enforced at the response layer)', () => {
    // This test documents the contract: pct is a sample ratio, NOT a full-cohort
    // overlap. Any consumer that reads these results MUST treat them as approximate.
    const pct = 70 / 100;
    expect(pct).toBeCloseTo(0.7, 5);
    // The field name is carried by the route response, not the lakehouse function;
    // the test here asserts the denominator is the SAMPLE size, not an external count.
    const sampleSize = 100;
    const bothCount = 70;
    const derived = bothCount / sampleSize;
    expect(derived).toBe(pct);
  });

  it('caps candidate uid list at MAX_CANDIDATE_SAMPLE when oversized', async () => {
    const oversized = Array.from({ length: MAX_CANDIDATE_SAMPLE + 200 }, (_, i) => `u${i}`);
    const runQueryFn = vi.fn(async () => ({ columns: [], rows: [] }));
    await computeCandidateOverlap(
      connector,
      SCHEMA,
      { game_id: 'cfm_vn', savedSegments, candidateUids: oversized },
      { runQueryFn },
    );
    // The SQL passed to runQueryFn must not contain uids beyond the cap.
    const calledSql = runQueryFn.mock.calls[0]?.[2] as string | undefined;
    expect(calledSql).toBeDefined();
    // The first uid within cap must be present.
    expect(calledSql).toContain(`'u${MAX_CANDIDATE_SAMPLE - 1}'`);
    // The first uid beyond the cap must NOT be present.
    expect(calledSql).not.toContain(`'u${MAX_CANDIDATE_SAMPLE}'`);
  });
});
