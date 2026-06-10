/**
 * Pure-logic tests for the lakehouse snapshot writers: param inlining
 * (injection-safety boundary), Cube-default-limit stripping, multi-statement
 * splitting, and per-game schema canonicalization. No Trino / no DB.
 */

import { describe, it, expect } from 'vitest';
import { inlineSqlParams, toSqlLiteral } from '../src/lakehouse/inline-sql-params.js';
import { stripTrailingLimit } from '../src/lakehouse/segment-snapshot-writer.js';
import {
  splitSqlStatements,
  lakehouseSchemaForGame,
} from '../src/lakehouse/lakehouse-trino-connector.js';
import { canonicalGameId } from '../src/services/trino-profiler-config.js';

describe('toSqlLiteral', () => {
  it('renders typed literals', () => {
    expect(toSqlLiteral(42)).toBe('42');
    expect(toSqlLiteral(3.14)).toBe('3.14');
    expect(toSqlLiteral(true)).toBe('TRUE');
    expect(toSqlLiteral(false)).toBe('FALSE');
    expect(toSqlLiteral(null)).toBe('NULL');
    expect(toSqlLiteral(undefined)).toBe('NULL');
    expect(toSqlLiteral('abc')).toBe("'abc'");
  });

  it('escapes single quotes by doubling (injection-safe)', () => {
    expect(toSqlLiteral("O'Brien")).toBe("'O''Brien'");
    // A classic injection attempt is neutralized into a single quoted literal.
    expect(toSqlLiteral("x'); DROP TABLE t; --")).toBe("'x''); DROP TABLE t; --'");
  });

  it('rejects non-finite numbers', () => {
    expect(() => toSqlLiteral(NaN)).toThrow();
    expect(() => toSqlLiteral(Infinity)).toThrow();
  });
});

describe('inlineSqlParams', () => {
  it('replaces positional ? in order', () => {
    expect(inlineSqlParams('WHERE a = ? AND b = ?', ['true', 5])).toBe(
      "WHERE a = 'true' AND b = 5",
    );
  });

  it('does NOT treat ? inside a string literal as a placeholder', () => {
    // The literal 'is it ?' contains a question mark that must be preserved.
    const out = inlineSqlParams("WHERE label = 'is it ?' AND x = ?", [9]);
    expect(out).toBe("WHERE label = 'is it ?' AND x = 9");
  });

  it('handles doubled single quotes inside a string literal', () => {
    const out = inlineSqlParams("WHERE n = 'O''Brien?' AND y = ?", ['z']);
    expect(out).toBe("WHERE n = 'O''Brien?' AND y = 'z'");
  });

  it('throws on placeholder/param count mismatch', () => {
    expect(() => inlineSqlParams('a = ?', [])).toThrow();
    expect(() => inlineSqlParams('a = ?', [1, 2])).toThrow();
  });

  it('throws on an unterminated string literal', () => {
    expect(() => inlineSqlParams("a = 'oops", [])).toThrow();
  });

  it('mirrors the real Cube boolean-cast shape', () => {
    const sql =
      'SELECT "mf_users".user_id FROM mf_users WHERE (CASE WHEN x > 0 THEN TRUE ELSE FALSE END = CAST(? AS BOOLEAN)) GROUP BY 1';
    expect(inlineSqlParams(sql, ['true'])).toContain("CAST('true' AS BOOLEAN)");
  });
});

describe('stripTrailingLimit', () => {
  it('strips Cube default trailing LIMIT', () => {
    expect(stripTrailingLimit('SELECT 1 ORDER BY 1 ASC LIMIT 10000')).toBe(
      'SELECT 1 ORDER BY 1 ASC',
    );
  });

  it('strips trailing LIMIT … OFFSET', () => {
    expect(stripTrailingLimit('SELECT 1 LIMIT 5000 OFFSET 100')).toBe('SELECT 1');
  });

  it('strips trailing FETCH FIRST n ROWS ONLY', () => {
    expect(stripTrailingLimit('SELECT 1 FETCH FIRST 10000 ROWS ONLY')).toBe('SELECT 1');
    expect(stripTrailingLimit('SELECT 1 FETCH FIRST 1 ROW ONLY')).toBe('SELECT 1');
  });

  it('leaves a LIMIT that is not at the end untouched', () => {
    const sql = 'SELECT * FROM (SELECT a FROM t LIMIT 3) z';
    expect(stripTrailingLimit(sql)).toBe(sql);
  });

  it('is a no-op when there is no LIMIT', () => {
    expect(stripTrailingLimit('SELECT 1 GROUP BY 1')).toBe('SELECT 1 GROUP BY 1');
  });
});

describe('splitSqlStatements', () => {
  it('splits on ; and strips -- line comments', () => {
    const sql = [
      '-- header comment',
      'CREATE TABLE a (x INT);',
      '-- another',
      'CREATE TABLE b (y INT);',
    ].join('\n');
    expect(splitSqlStatements(sql)).toEqual([
      'CREATE TABLE a (x INT)',
      'CREATE TABLE b (y INT)',
    ]);
  });

  it('drops empty / comment-only chunks', () => {
    expect(splitSqlStatements('-- just a comment\n\n;')).toEqual([]);
  });
});

describe('lakehouseSchemaForGame / canonicalGameId', () => {
  it('maps canonical game ids', () => {
    expect(lakehouseSchemaForGame('ballistar')).toBe('ballistar_vn');
    expect(lakehouseSchemaForGame('cfm')).toBe('cfm_vn');
    expect(lakehouseSchemaForGame('jus')).toBe('jus_vn');
  });

  it('maps country-suffixed aliases through canonicalization', () => {
    expect(canonicalGameId('cfm_vn')).toBe('cfm');
    expect(canonicalGameId('jus_vn')).toBe('jus');
    expect(canonicalGameId('ballistar_vn')).toBe('ballistar');
    expect(lakehouseSchemaForGame('cfm_vn')).toBe('cfm_vn');
    expect(lakehouseSchemaForGame('ballistar_vn')).toBe('ballistar_vn');
  });

  it('returns null for an unknown game', () => {
    expect(lakehouseSchemaForGame('nope')).toBeNull();
  });
});
