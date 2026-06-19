import { describe, it, expect } from 'vitest';
import { inlineSqlParams, runnableSqlFromSqlQuery } from '../inline-sql-params';

describe('inlineSqlParams', () => {
  it('inlines positional params in order', () => {
    const sql =
      "WHERE t.dteventtime >= from_iso8601_timestamp(?) AND t.dteventtime <= from_iso8601_timestamp(?) AND label = ?";
    expect(
      inlineSqlParams(sql, ['2026-04-01T00:00:00.000', '2026-04-30T23:59:59.999', 'dat_bom'])
    ).toBe(
      "WHERE t.dteventtime >= from_iso8601_timestamp('2026-04-01T00:00:00.000') AND t.dteventtime <= from_iso8601_timestamp('2026-04-30T23:59:59.999') AND label = 'dat_bom'"
    );
  });

  it('returns SQL unchanged when there are no params', () => {
    expect(inlineSqlParams('SELECT 1', [])).toBe('SELECT 1');
  });

  it('renders numbers, booleans, and null without quotes', () => {
    expect(inlineSqlParams('a=? b=? c=?', [5, true, null])).toBe('a=5 b=TRUE c=NULL');
  });

  it('escapes single quotes in string literals', () => {
    expect(inlineSqlParams('name = ?', ["O'Brien"])).toBe("name = 'O''Brien'");
  });

  it('leaves extra placeholders untouched if params run out', () => {
    expect(inlineSqlParams('a=? b=?', ['x'])).toBe("a='x' b=?");
  });
});

describe('runnableSqlFromSqlQuery', () => {
  it('inlines from the rawQuery() [sql, params] tuple', () => {
    const sqlQuery = {
      rawQuery: () => ({ sql: ['x = ? AND y = ?', ['a', 2]] as [string, unknown[]] }),
      sql: () => 'x = ? AND y = ?',
    };
    expect(runnableSqlFromSqlQuery(sqlQuery)).toBe("x = 'a' AND y = 2");
  });

  it('falls back to sql() when no raw tuple is present', () => {
    const sqlQuery = { rawQuery: () => undefined, sql: () => 'SELECT 1' };
    expect(runnableSqlFromSqlQuery(sqlQuery)).toBe('SELECT 1');
  });
});
