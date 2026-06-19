import { describe, it, expect } from 'vitest';
import { deriveTrinoSourceSql, sourceSqlNote, type RawSqlQuery } from '../rollup-source-sql';

// Mirrors the live /sql response shape when a query is served from a rollup.
const SOURCE_SELECT =
  'SELECT "g".media_source "g__media_source", date_trunc(\'day\', "g".report_date) "g__report_date_day", sum("g".cost_vnd) "g__cost_vnd" FROM cons_game_key_metrics_daily AS "g" WHERE (from_iso8601_timestamp(CAST("g".report_date AS VARCHAR)) >= from_iso8601_timestamp(?) AND from_iso8601_timestamp(CAST("g".report_date AS VARCHAR)) <= from_iso8601_timestamp(?)) GROUP BY 1, 2';

function rawRollup(overrides: Partial<RawSqlQuery> = {}, paOverrides = {}): RawSqlQuery {
  return {
    external: true,
    lambdaQueries: {},
    sql: [
      'SELECT `g__media_source` `g__media_source`, sum(`g__cost_vnd`) `g__cost_vnd` FROM preagg_cfm.tbl AS `g__roll` WHERE (`g__report_date_day` >= to_timestamp(?) AND `g__report_date_day` <= to_timestamp(?)) GROUP BY 1 ORDER BY 2 DESC LIMIT 10000',
      ['2026-05-20T00:00:00.000', '2026-06-18T23:59:59.999'],
    ],
    preAggregations: [
      {
        tableName: 'preagg_cfm.tbl',
        preAggregationsSchema: 'preagg_cfm',
        preAggregationId: 'game_key_metrics.key_metrics_by_source_daily_batch',
        aggregationsColumns: ['sum("g__cost_vnd")'],
        // The live source SELECT comes back with partition-range sentinel params.
        sql: [SOURCE_SELECT, ['__FROM_PARTITION_RANGE', '__TO_PARTITION_RANGE']],
        matchedTimeDimensionDateRange: ['2026-05-20T00:00:00.000', '2026-06-18T23:59:59.999'],
        ...paOverrides,
      },
    ],
    ...overrides,
  };
}

describe('deriveTrinoSourceSql', () => {
  it('returns null when the query was not pre-agg served', () => {
    expect(deriveTrinoSourceSql({ external: false })).toBeNull();
    expect(deriveTrinoSourceSql(undefined)).toBeNull();
  });

  it('rebuilds the exact query in Trino dialect for additive rollups', () => {
    const res = deriveTrinoSourceSql(rawRollup());
    expect(res?.kind).toBe('exact');
    const sql = res!.sql;
    // dialect translated
    expect(sql).not.toContain('`');
    expect(sql).not.toContain('to_timestamp(');
    expect(sql).toContain('from_iso8601_timestamp(');
    // FROM re-pointed at the source SELECT subquery; no rollup table left
    expect(sql).not.toContain('preagg_cfm');
    expect(sql).toContain('cons_game_key_metrics_daily');
    expect(sql).toContain('AS "g__roll"');
    // params inlined (no `?` placeholders remain)
    expect(sql).not.toContain('?');
    expect(sql).toContain("'2026-05-20T00:00:00.000'");
    // partition sentinels resolved to the matched date range
    expect(sql).not.toContain('__FROM_PARTITION_RANGE');
    expect(sql).not.toContain('__TO_PARTITION_RANGE');
    // outer aggregation + order/limit preserved
    expect(sql).toMatch(/sum\("g__cost_vnd"\)/);
    expect(sql).toContain('ORDER BY 2 DESC');
    expect(sql).toContain('LIMIT 10000');
  });

  it('falls back to the raw source SELECT for non-additive (merge) rollups', () => {
    const res = deriveTrinoSourceSql(
      rawRollup({}, { aggregationsColumns: ['merge("g__uniq_users")'] })
    );
    expect(res?.kind).toBe('rollup-source');
    expect(res!.sql).toContain('cons_game_key_metrics_daily');
    expect(res!.sql).not.toContain('?'); // still inlined
  });

  it('returns null when partition sentinels cannot be resolved (no matched range)', () => {
    const res = deriveTrinoSourceSql(rawRollup({}, { matchedTimeDimensionDateRange: undefined }));
    expect(res).toBeNull();
  });

  it('falls back when a lambda (union) rollup is involved', () => {
    const res = deriveTrinoSourceSql(rawRollup({ lambdaQueries: { 'g.roll': {} } }));
    expect(res?.kind).toBe('rollup-source');
  });

  it('falls back when CubeStore-only constructs survive translation', () => {
    // exec uses merge() which has no Trino equivalent → must not be emitted as exact
    const res = deriveTrinoSourceSql(
      rawRollup({
        sql: [
          'SELECT `g__media_source` `g__media_source`, merge(`g__uniq`) `g__uniq` FROM preagg_cfm.tbl AS `g__roll` GROUP BY 1',
          [],
        ],
      })
    );
    expect(res?.kind).toBe('rollup-source');
  });
});

describe('sourceSqlNote', () => {
  it('labels exact vs rollup-grain results as paste-safe comments', () => {
    expect(sourceSqlNote({ sql: '', kind: 'exact', preAggregationId: 'a.b' })).toMatch(
      /^-- Trino source SQL — rebuilt from rollup "a\.b"/
    );
    expect(sourceSqlNote({ sql: '', kind: 'rollup-source', preAggregationId: 'a.b' })).toMatch(
      /^-- Trino source SQL at rollup grain/
    );
  });
});
