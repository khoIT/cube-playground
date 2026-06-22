/**
 * Unit tests for the measure-distribution service.
 *
 * All Trino I/O is injected via deps.runQuery — no real Trino connection needed.
 * Tests cover: SQL builder correctness, bucket invariants (sum == total, monotonic
 * edges), catalog miss → buckets:null, timeout/throw → buckets:null (not a throw).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  buildEdgesSql,
  buildCountsSql,
  buildWhereClause,
  parseEdgesRow,
  parseBucketRow,
} from '../src/services/measure-distribution-sql.js';
import {
  computeDistribution,
  type DistributionRequest,
  type QueryExecutor,
} from '../src/services/measure-distribution.js';
import { __resetCatalogCache } from '../src/services/segmentable-measures-catalog.js';
import type { SegmentableMeasure } from '../src/services/segmentable-measures-catalog.js';
import type { PredicateNode } from '../src/types/predicate-tree.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FAKE_MEASURE: SegmentableMeasure = {
  game: 'cfm_vn',
  concept: 'spend',
  label: 'Spend (VND)',
  cube: 'mf_users',
  dimension: 'mf_users.ltv_vnd',
  window: 'lifetime',
  currency: 'vnd',
  physicalTable: 'game_integration.cfm_vn.mf_users',
  physicalColumn: 'ltv_vnd',
  defaultPopulation: null,
  identityMerge: null,
  confidence: 1,
};

/** A minimal catalog with the fake measure. */
vi.mock('../src/services/segmentable-measures-catalog.js', async (importActual) => {
  const actual = await importActual<typeof import('../src/services/segmentable-measures-catalog.js')>();
  return {
    ...actual,
    getSegmentableMeasures: (game: string) => {
      if (game === 'cfm_vn' || game === 'cfm') return [FAKE_MEASURE];
      return [];
    },
  };
});

/** Mock the cs-trino-connector so it never actually resolves. */
vi.mock('../src/lakehouse/cs-trino-connector.js', () => ({
  resolveCsTrinoConnector: () => ({
    id: 'test',
    host: 'trino-test',
    port: 443,
    user: 'test',
    password: '',
    catalog: 'game_integration',
    ssl: false,
  }),
}));

const FAKE_CONNECTOR = {
  id: 'test',
  label: 'test',
  workspaceId: 'local',
  sourceType: 'trino',
  host: 'trino-test',
  port: 443,
  user: 'test',
  password: '',
  catalog: 'game_integration',
  ssl: false,
};

// Decile edges returned by the approx_percentile pass (9 boundary points for
// 10 buckets). The last two entries are p50 and p90 summary stats appended by
// buildEdgesSql (neither 0.5 nor 0.9 coincide with decile boundaries 0.1–0.9
// for this fixture because 0.5 == 5/10 = boundary index 4 and 0.9 == 9/10 =
// boundary index 8 — both ARE boundary fractions, so they are NOT appended as
// separate summary stats). Actually for 10 buckets: fractions are
// [0.1,0.2,...,0.9] and 0.5 is fraction[4], 0.9 is fraction[8]. They are
// already in the array so summaryIndices point into the boundary array.
// We build a synthetic Trino row that has 9 elements (no extras appended).
const DECILE_EDGES = [100, 200, 300, 400, 500, 600, 700, 800, 900];

function makeEdgesRow(edges: number[], total: number): unknown[] {
  // Trino REST returns ARRAY as a JS array in the data field.
  return [edges, total];
}

function makeCountsRow(counts: number[]): unknown[] {
  return counts.map(Number);
}

// ---------------------------------------------------------------------------
// SQL builder tests
// ---------------------------------------------------------------------------

describe('buildWhereClause', () => {
  it('returns null when no predicates are given', () => {
    expect(buildWhereClause(null, undefined)).toBeNull();
  });

  it('returns the default population clause alone', () => {
    const pop: PredicateNode = {
      kind: 'leaf',
      id: 'l1',
      member: 'ltv_vnd',
      type: 'number',
      op: 'gt',
      values: [0],
    };
    const clause = buildWhereClause(pop, undefined);
    expect(clause).toBe('ltv_vnd > 0');
  });

  it('returns the request predicate alone when no default population', () => {
    const req: PredicateNode = {
      kind: 'leaf',
      id: 'r1',
      member: 'country',
      type: 'string',
      op: 'equals',
      values: ['VN'],
    };
    expect(buildWhereClause(null, req)).toBe("country = 'VN'");
  });

  it('ANDs both clauses together', () => {
    const pop: PredicateNode = { kind: 'leaf', id: 'p1', member: 'ltv_vnd', type: 'number', op: 'gt', values: [0] };
    const req: PredicateNode = { kind: 'leaf', id: 'r1', member: 'country', type: 'string', op: 'equals', values: ['VN'] };
    const clause = buildWhereClause(pop, req);
    expect(clause).toContain('AND');
    expect(clause).toContain('ltv_vnd > 0');
    expect(clause).toContain("country = 'VN'");
  });
});

describe('buildEdgesSql', () => {
  it('produces valid SQL for 10 buckets without WHERE', () => {
    const sql = buildEdgesSql({
      physicalTable: 'game_integration.cfm_vn.mf_users',
      physicalColumn: 'ltv_vnd',
      identityMerge: null,
      where: null,
      bucketCount: 10,
    });
    expect(sql).toContain('approx_percentile');
    expect(sql).toContain('ltv_vnd');
    expect(sql).toContain('count(*)');
    // Should have 9 boundary fractions (10 buckets → 9 interior points)
    // plus any summary stats not already in the array.
    expect(sql).toContain('ARRAY[');
    expect(sql).not.toContain('WHERE');
  });

  it('injects WHERE when provided', () => {
    const sql = buildEdgesSql({
      physicalTable: 'game_integration.cfm_vn.mf_users',
      physicalColumn: 'ltv_vnd',
      identityMerge: null,
      where: 'ltv_vnd > 0',
      bucketCount: 10,
    });
    expect(sql).toContain('WHERE ltv_vnd > 0');
  });

  it('wraps the table in a merge sub-query when identityMerge is set', () => {
    const sql = buildEdgesSql({
      physicalTable: 'game_integration.jus_vn.mf_users',
      physicalColumn: 'ltv_vnd',
      identityMerge: { idColumn: 'uid', transform: 'split_part_at', agg: 'max' },
      where: null,
      bucketCount: 10,
    });
    // buildMergedFrom wraps in a subquery aliased 'm'
    expect(sql).toContain('GROUP BY 1) m');
    expect(sql).toContain('split_part');
  });
});

describe('buildCountsSql', () => {
  it('produces one SUM/CASE per bucket', () => {
    const edges = [100, 200, 300];
    const sql = buildCountsSql({
      physicalTable: 'game_integration.cfm_vn.mf_users',
      physicalColumn: 'ltv_vnd',
      identityMerge: null,
      where: null,
      edges,
    });
    // 4 buckets → b0, b1, b2, b3
    expect(sql).toContain('b0');
    expect(sql).toContain('b1');
    expect(sql).toContain('b2');
    expect(sql).toContain('b3');
    expect(sql).not.toContain('b4');
  });

  it('handles single-bucket edge case (no edges)', () => {
    const sql = buildCountsSql({
      physicalTable: 'game_integration.cfm_vn.mf_users',
      physicalColumn: 'ltv_vnd',
      identityMerge: null,
      where: null,
      edges: [],
    });
    expect(sql).toContain('count(*)');
  });
});

// ---------------------------------------------------------------------------
// Parsing tests
// ---------------------------------------------------------------------------

describe('parseEdgesRow', () => {
  it('returns null on empty row', () => {
    expect(parseEdgesRow([], 10)).toBeNull();
  });

  it('parses a standard 10-bucket edges row', () => {
    // For 10 buckets: fractions [0.1,...,0.9]; 0.5 is index 4, 0.9 is index 8.
    // Both are already in the boundary array — no extra elements appended.
    const edges = [100, 200, 300, 400, 500, 600, 700, 800, 900];
    const row: unknown[] = [edges, 1000];
    const result = parseEdgesRow(row, 10);
    expect(result).not.toBeNull();
    expect(result!.total).toBe(1000);
    expect(result!.edges).toHaveLength(9);
    // p50 maps to fraction 0.5 = index 4 of the fractions array → edges[4] = 500
    expect(result!.p50).toBe(500);
    // p90 maps to fraction 0.9 = index 8 of the fractions array → edges[8] = 900
    expect(result!.p90).toBe(900);
  });

  it('parses a JSON-string encoded edges array (Trino serialization variant)', () => {
    const row: unknown[] = [JSON.stringify([100, 200, 300, 400, 500, 600, 700, 800, 900]), 500];
    const result = parseEdgesRow(row, 10);
    expect(result).not.toBeNull();
    expect(result!.total).toBe(500);
  });
});

describe('parseBucketRow', () => {
  it('returns correct lo/hi/count for 3 buckets (2 edges)', () => {
    const edges = [100, 300];
    const row: unknown[] = [10, 20, 5];
    const buckets = parseBucketRow(row, edges);
    expect(buckets).not.toBeNull();
    expect(buckets).toHaveLength(3);
    // First bucket: (−∞, 100]
    expect(buckets![0].hi).toBe(100);
    expect(buckets![0].count).toBe(10);
    // Middle bucket: (100, 300]
    expect(buckets![1].lo).toBe(100);
    expect(buckets![1].hi).toBe(300);
    expect(buckets![1].count).toBe(20);
    // Last bucket: (300, +∞)
    expect(buckets![2].lo).toBe(300);
    expect(buckets![2].count).toBe(5);
  });

  it('returns null when the row is shorter than expected', () => {
    expect(parseBucketRow([10, 20], [100, 300])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// computeDistribution integration (injected executor)
// ---------------------------------------------------------------------------

const BASE_REQ: DistributionRequest = {
  game_id: 'cfm_vn',
  member: 'mf_users.ltv_vnd',
};

function makeRunQuery(edgesRow: unknown[], countsRow: unknown[]): QueryExecutor {
  let callCount = 0;
  return vi.fn(async () => {
    callCount++;
    if (callCount === 1) return { columns: [], rows: [edgesRow] };
    return { columns: [], rows: [countsRow] };
  });
}

describe('computeDistribution', () => {
  it('returns a histogram with sum(bucket.count) === total', async () => {
    const bucketCounts = [50, 100, 150, 200, 100, 50, 50, 100, 100, 100];
    const total = bucketCounts.reduce((a, b) => a + b, 0); // 1000
    const edgesRow = makeEdgesRow(DECILE_EDGES, total);
    const countsRow = makeCountsRow(bucketCounts);

    const result = await computeDistribution(BASE_REQ, {
      connector: FAKE_CONNECTOR,
      runQuery: makeRunQuery(edgesRow, countsRow),
    });

    expect(result.buckets).not.toBeNull();
    if (!result.buckets) throw new Error('expected buckets');

    const sum = result.buckets.reduce((acc, b) => acc + b.count, 0);
    expect(sum).toBe(total);
    expect((result as { total: number }).total).toBe(total);
    expect((result as { approx: boolean }).approx).toBe(true);
  });

  it('returns monotonically non-decreasing bucket edges', async () => {
    const bucketCounts = Array(10).fill(100);
    const total = 1000;
    const result = await computeDistribution(BASE_REQ, {
      connector: FAKE_CONNECTOR,
      runQuery: makeRunQuery(makeEdgesRow(DECILE_EDGES, total), makeCountsRow(bucketCounts)),
    });

    expect(result.buckets).not.toBeNull();
    if (!result.buckets) throw new Error('expected buckets');

    for (let i = 1; i < result.buckets.length; i++) {
      expect(result.buckets[i].lo).toBeGreaterThanOrEqual(result.buckets[i - 1].lo);
    }
  });

  it('returns { buckets: null, reason: "measure_not_segmentable" } for unknown member', async () => {
    const result = await computeDistribution(
      { game_id: 'cfm_vn', member: 'mf_users.nonexistent_field' },
      { connector: FAKE_CONNECTOR, runQuery: vi.fn() },
    );
    expect(result.buckets).toBeNull();
    expect((result as { reason: string }).reason).toBe('measure_not_segmentable');
  });

  it('returns { buckets: null } for a game not in the catalog', async () => {
    const result = await computeDistribution(
      { game_id: 'unknown_game', member: 'mf_users.ltv_vnd' },
      { connector: FAKE_CONNECTOR, runQuery: vi.fn() },
    );
    expect(result.buckets).toBeNull();
  });

  it('returns { buckets: null } when connector is null — does NOT throw', async () => {
    const result = await computeDistribution(BASE_REQ, { connector: null });
    expect(result.buckets).toBeNull();
    expect((result as { reason: string }).reason).toBe('no_connector');
  });

  it('returns { buckets: null } when the executor throws — does NOT throw', async () => {
    const runQuery: QueryExecutor = vi.fn(async () => {
      throw new Error('Trino statement timed out after 20s');
    });
    const result = await computeDistribution(BASE_REQ, {
      connector: FAKE_CONNECTOR,
      runQuery,
    });
    expect(result.buckets).toBeNull();
    expect((result as { reason: string }).reason).toContain('timeout');
  });

  it('returns { buckets: null } on a non-timeout query error — does NOT throw', async () => {
    const runQuery: QueryExecutor = vi.fn(async () => {
      throw new Error('Trino 500: internal server error');
    });
    const result = await computeDistribution(BASE_REQ, {
      connector: FAKE_CONNECTOR,
      runQuery,
    });
    expect(result.buckets).toBeNull();
    expect((result as { reason: string }).reason).toContain('query_error');
  });

  it('returns empty buckets array (not null) when total is 0', async () => {
    const runQuery: QueryExecutor = vi.fn(async () => ({
      columns: [],
      rows: [[[0, 0, 0, 0, 0, 0, 0, 0, 0], 0]],
    }));
    const result = await computeDistribution(BASE_REQ, {
      connector: FAKE_CONNECTOR,
      runQuery,
    });
    expect(result.buckets).not.toBeNull();
    expect(result.buckets).toHaveLength(0);
    expect((result as { total: number }).total).toBe(0);
  });

  it('includes took_ms in every response shape', async () => {
    const result = await computeDistribution(BASE_REQ, { connector: null });
    expect(typeof result.took_ms).toBe('number');
    expect(result.took_ms).toBeGreaterThanOrEqual(0);
  });

  it('respects custom bucket count of 5', async () => {
    // 5 buckets → 4 boundary edges
    const edges = [250, 500, 750, 900];
    const bucketCounts = [20, 30, 25, 15, 10];
    const total = bucketCounts.reduce((a, b) => a + b, 0);

    const runQuery = makeRunQuery(makeEdgesRow(edges, total), makeCountsRow(bucketCounts));
    const result = await computeDistribution(
      { ...BASE_REQ, buckets: 5 },
      { connector: FAKE_CONNECTOR, runQuery },
    );
    expect(result.buckets).not.toBeNull();
    if (!result.buckets) throw new Error('expected buckets');
    // After dedup the 4 unique edges → 5 buckets
    expect(result.buckets).toHaveLength(5);
    const sum = result.buckets.reduce((acc, b) => acc + b.count, 0);
    expect(sum).toBe(total);
  });
});
