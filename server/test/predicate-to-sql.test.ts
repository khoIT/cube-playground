import { describe, it, expect } from 'vitest';
import { predicateToSql, escapeIdent, escapeLiteral } from '../src/services/predicate-to-sql.js';
import type { PredicateNode } from '../src/types/predicate-tree.js';

function leaf(member: string, op: string, values: unknown[] = []): PredicateNode {
  return {
    kind: 'leaf',
    id: 'l',
    member,
    type: 'string',
    op: op as PredicateNode['kind'] extends 'leaf' ? string : never,
    values,
  } as PredicateNode;
}

describe('predicate-to-sql', () => {
  describe('escapeIdent', () => {
    it('accepts dotted column names', () => {
      expect(escapeIdent('events.user_id')).toBe('events.user_id');
    });

    it('rejects whitespace and punctuation', () => {
      expect(() => escapeIdent('events; DROP TABLE--')).toThrow();
      expect(() => escapeIdent('events.user id')).toThrow();
      expect(() => escapeIdent('1bad')).toThrow();
    });
  });

  describe('escapeLiteral', () => {
    it('quotes strings with single-quote doubling', () => {
      expect(escapeLiteral("O'Brien")).toBe("'O''Brien'");
    });

    it('emits numbers unquoted', () => {
      expect(escapeLiteral(42)).toBe('42');
    });

    it('rejects non-finite numbers', () => {
      expect(() => escapeLiteral(Infinity)).toThrow();
    });

    it('rejects strings with control chars', () => {
      expect(() => escapeLiteral('ab')).toThrow();
    });

    it('handles boolean and null', () => {
      expect(escapeLiteral(true)).toBe('TRUE');
      expect(escapeLiteral(null)).toBe('NULL');
    });
  });

  describe('leaf operators', () => {
    it('equals single value', () => {
      expect(predicateToSql(leaf('users.country', 'equals', ['VN']))).toBe(
        "users.country = 'VN'",
      );
    });

    it('equals multi-value collapses to IN', () => {
      expect(predicateToSql(leaf('users.country', 'equals', ['VN', 'TH']))).toBe(
        "users.country IN ('VN', 'TH')",
      );
    });

    it('notEquals collapses to NOT IN for multiple', () => {
      expect(predicateToSql(leaf('users.tier', 'notEquals', ['gold', 'silver']))).toBe(
        "users.tier NOT IN ('gold', 'silver')",
      );
    });

    it('gt / lt / gte / lte', () => {
      expect(predicateToSql(leaf('events.amount', 'gt', [100]))).toBe('events.amount > 100');
      expect(predicateToSql(leaf('events.amount', 'lte', [50]))).toBe('events.amount <= 50');
    });

    it('contains wraps with %', () => {
      expect(predicateToSql(leaf('users.name', 'contains', ['fox']))).toBe(
        "users.name LIKE '%fox%'",
      );
    });

    it('set / notSet → IS NULL pair', () => {
      expect(predicateToSql(leaf('users.email', 'set'))).toBe('users.email IS NOT NULL');
      expect(predicateToSql(leaf('users.email', 'notSet'))).toBe('users.email IS NULL');
    });

    it('inDateRange → BETWEEN', () => {
      expect(
        predicateToSql(leaf('events.ts', 'inDateRange', ['2026-01-01', '2026-12-31'])),
      ).toBe("events.ts BETWEEN '2026-01-01' AND '2026-12-31'");
    });

    it('inDateRange accepts the nested `[[start, end]]` shape from the UI authoring path', () => {
      expect(
        predicateToSql(leaf('events.ts', 'inDateRange', [['2026-01-01', '2026-12-31']])),
      ).toBe("events.ts BETWEEN '2026-01-01' AND '2026-12-31'");
    });

    it('empty equals → guaranteed-false sentinel', () => {
      expect(predicateToSql(leaf('users.country', 'equals', []))).toBe('1=0');
    });
  });

  describe('groups', () => {
    it('AND of two leaves', () => {
      const node: PredicateNode = {
        kind: 'group',
        id: 'g',
        op: 'AND',
        children: [
          leaf('users.country', 'equals', ['VN']),
          leaf('events.amount', 'gt', [10]),
        ],
      };
      expect(predicateToSql(node)).toBe(
        "(users.country = 'VN' AND events.amount > 10)",
      );
    });

    it('nested OR inside AND', () => {
      const node: PredicateNode = {
        kind: 'group',
        id: 'g',
        op: 'AND',
        children: [
          {
            kind: 'group',
            id: 'g2',
            op: 'OR',
            children: [
              leaf('users.country', 'equals', ['VN']),
              leaf('users.country', 'equals', ['TH']),
            ],
          },
          leaf('events.amount', 'gt', [50]),
        ],
      };
      expect(predicateToSql(node)).toBe(
        "((users.country = 'VN' OR users.country = 'TH') AND events.amount > 50)",
      );
    });

    it('empty group → tautology', () => {
      expect(predicateToSql({ kind: 'group', id: 'g', op: 'AND', children: [] })).toBe('1=1');
    });
  });

  describe('SQL-injection resistance', () => {
    it('rejects injection via column name', () => {
      expect(() =>
        predicateToSql(leaf("events.id; DROP TABLE segments--", 'equals', ['1'])),
      ).toThrow();
    });

    it('escapes quote chars inside literals', () => {
      const sql = predicateToSql(
        leaf('users.country', 'equals', ["VN'; DROP TABLE segments--"]),
      );
      expect(sql).toBe("users.country = 'VN''; DROP TABLE segments--'");
    });
  });

  describe('derived relative-date', () => {
    it('dateWithinLast → date_diff age <= n against the asOf anchor', () => {
      const sql = predicateToSql(
        leaf('first_login_date', 'dateWithinLast', [{ n: 6, unit: 'month' }]),
        { asOf: '2026-06-14' },
      );
      expect(sql).toBe("date_diff('month', first_login_date, DATE '2026-06-14') <= 6");
    });

    it('dateBeforeLast → date_diff age >= n', () => {
      const sql = predicateToSql(
        leaf('last_active_date', 'dateBeforeLast', [{ n: 30, unit: 'day' }]),
        { asOf: '2026-06-14' },
      );
      expect(sql).toBe("date_diff('day', last_active_date, DATE '2026-06-14') >= 30");
    });

    it('defaults to CURRENT_DATE when no asOf is given', () => {
      const sql = predicateToSql(leaf('first_login_date', 'dateWithinLast', [{ n: 1, unit: 'week' }]));
      expect(sql).toBe("date_diff('week', first_login_date, CURRENT_DATE) <= 1");
    });

    it('throws on a malformed relative value', () => {
      expect(() => predicateToSql(leaf('c', 'dateWithinLast', [{}]))).toThrow(/requires \{ n, unit \}/);
    });
  });

  describe('percentile (inline subquery)', () => {
    it('percentileGte → col >= approx_percentile subquery over the population', () => {
      const sql = predicateToSql(
        leaf('lifetime_vnd', 'percentileGte', [{ p: 75, over: { table: 'cfm.billing_lifetime' } }]),
      );
      expect(sql).toBe(
        'lifetime_vnd >= (SELECT approx_percentile(lifetime_vnd, 0.75) AS cutoff FROM cfm.billing_lifetime)',
      );
    });

    it('percentileLte → col <= subquery, honoring over.column', () => {
      const sql = predicateToSql(
        leaf('arppu', 'percentileLte', [{ p: 25, over: { table: 't', column: 'arppu_all' } }]),
      );
      expect(sql).toBe('arppu <= (SELECT approx_percentile(arppu_all, 0.25) AS cutoff FROM t)');
    });

    it('throws when no population table is given', () => {
      expect(() => predicateToSql(leaf('x', 'percentileGte', [{ p: 50 }]))).toThrow(/needs over\.table/);
    });
  });
});
