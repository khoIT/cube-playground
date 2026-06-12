/**
 * Tests for the translatability gate.
 *
 * Every operator that buildPredicateFromRows silently drops (not present in
 * CUBE_TO_TREE_OP) must produce ok=false with a blocked-reason entry so the
 * Update button is disabled rather than silently widening the cohort.
 *
 * Operators that ARE translatable must produce ok=true.
 *
 * timeDimension without dateRange must be flagged (granularity-only windows
 * are not expressible as a predicate node in uid-mode).
 */

import { describe, it, expect } from 'vitest';
import type { Query } from '@cubejs-client/core';
import { checkTranslatability } from '../translatability-gate';

// ── Helpers ──────────────────────────────────────────────────────────────────

function queryWithOp(operator: string): Query {
  return {
    // Cast: test intentionally uses arbitrary operator strings to probe the gate.
    filters: [{ member: 'mf_users.spend', operator: operator as any, values: ['100'] }],
  };
}

// ── Translatable operators → ok ───────────────────────────────────────────────

describe('checkTranslatability — translatable operators', () => {
  // 'in'/'notIn' as direct Cube operators are NOT in CUBE_TO_TREE_OP in
  // build-predicate-from-rows.ts, so they are intentionally excluded here.
  // Multi-value equals/notEquals are handled via value-count promotion inside
  // cubeFilterToNode — the source operator arriving here is still 'equals'.
  const translatableOps = [
    'equals',
    'notEquals',
    'gt',
    'lt',
    'gte',
    'lte',
    'contains',
    'set',
    'notSet',
    'inDateRange',
    'beforeDate',
    'afterDate',
  ];

  for (const op of translatableOps) {
    it(`accepts operator "${op}"`, () => {
      const result = checkTranslatability(queryWithOp(op));
      expect(result.ok).toBe(true);
      expect(result.blockedReasons).toHaveLength(0);
    });
  }

  it('returns ok=false for an empty query — match-everyone guard', () => {
    // An empty query (no filters, no dated timeDimensions) would produce
    // AND([]) which, when saved, creates a match-everyone segment. Block it.
    const result = checkTranslatability({});
    expect(result.ok).toBe(false);
    expect(result.blockedReasons[0]).toContain('empty definition');
  });

  it('returns ok=true when all filters are translatable', () => {
    const q: Query = {
      filters: [
        { member: 'mf_users.country', operator: 'equals', values: ['VN'] },
        { member: 'mf_users.spend', operator: 'gt', values: ['100'] },
      ],
      timeDimensions: [
        { dimension: 'active_daily.log_date', dateRange: 'last 30 days' },
      ],
    };
    expect(checkTranslatability(q).ok).toBe(true);
  });
});

// ── Untranslatable operators → blocked ────────────────────────────────────────

describe('checkTranslatability — untranslatable operators (build-predicate-from-rows silently drops these)', () => {
  // 'in'/'notIn' as direct Cube operators are not in CUBE_TO_TREE_OP —
  // they would be silently dropped. Multi-value equals/notEquals are safe
  // because cubeFilterToNode handles them via value-count promotion.
  const untranslatableOps = [
    'notContains',
    'startsWith',
    'notStartsWith',
    'endsWith',
    'notEndsWith',
    'notInDateRange',
    'beforeOrOnDate',
    'afterOrOnDate',
    'in',
    'notIn',
  ];

  for (const op of untranslatableOps) {
    it(`blocks operator "${op}"`, () => {
      const result = checkTranslatability(queryWithOp(op));
      expect(result.ok).toBe(false);
      expect(result.blockedReasons.length).toBeGreaterThan(0);
      expect(result.blockedReasons[0]).toContain(op);
    });
  }
});

// ── Nested logical filters ────────────────────────────────────────────────────

describe('checkTranslatability — nested logical filters', () => {
  it('recurses into "and" groups to find untranslatable operators', () => {
    const q: Query = {
      filters: [
        {
          and: [
            { member: 'mf_users.country', operator: 'notContains', values: ['VN'] },
          ],
        } as any,
      ],
    };
    const result = checkTranslatability(q);
    expect(result.ok).toBe(false);
    expect(result.blockedReasons[0]).toContain('notContains');
  });

  it('recurses into "or" groups to find untranslatable operators', () => {
    const q: Query = {
      filters: [
        {
          or: [
            { member: 'mf_users.spend', operator: 'startsWith', values: ['10'] },
            { member: 'mf_users.country', operator: 'equals', values: ['VN'] },
          ],
        } as any,
      ],
    };
    const result = checkTranslatability(q);
    expect(result.ok).toBe(false);
    expect(result.blockedReasons[0]).toContain('startsWith');
  });

  it('a mixed query with one blocked op is not ok', () => {
    const q: Query = {
      filters: [
        { member: 'mf_users.country', operator: 'equals', values: ['VN'] },
        { member: 'mf_users.name', operator: 'notEndsWith', values: ['bot'] },
      ],
    };
    const result = checkTranslatability(q);
    expect(result.ok).toBe(false);
    expect(result.blockedReasons).toHaveLength(1);
    expect(result.blockedReasons[0]).toContain('notEndsWith');
  });
});

// ── timeDimension without dateRange ───────────────────────────────────────────

describe('checkTranslatability — timeDimension without dateRange', () => {
  it('flags a granularity-only timeDimension as unconsumed', () => {
    // A granularity-only timeDimension has no dateRange, so it cannot map to
    // a predicate leaf AND the query has no other constraints. The empty-predicate
    // guard fires first (no filters, no dated timeDimension), so the blocked
    // reason describes "empty definition" rather than the specific member.
    // Adding a filter alongside makes the empty-predicate check pass and exposes
    // the granularity-only blocked reason.
    const q: Query = {
      filters: [{ member: 'mf_users.country', operator: 'equals', values: ['VN'] }],
      timeDimensions: [
        { dimension: 'active_daily.log_date', granularity: 'day' },
      ],
    };
    const result = checkTranslatability(q);
    expect(result.ok).toBe(false);
    expect(result.blockedReasons[0]).toContain('active_daily.log_date');
  });

  it('does NOT flag a timeDimension with a dateRange', () => {
    const q: Query = {
      timeDimensions: [
        { dimension: 'active_daily.log_date', dateRange: 'last 30 days' },
      ],
    };
    expect(checkTranslatability(q).ok).toBe(true);
  });

  it('does NOT flag a timeDimension with an array dateRange', () => {
    const q: Query = {
      timeDimensions: [
        { dimension: 'active_daily.log_date', dateRange: ['2025-01-01', '2025-01-31'] },
      ],
    };
    expect(checkTranslatability(q).ok).toBe(true);
  });
});

// ── Empty-predicate guard ─────────────────────────────────────────────────────

describe('checkTranslatability — empty-predicate guard', () => {
  it('blocks an empty query (no filters, no dated timeDimensions)', () => {
    const result = checkTranslatability({});
    expect(result.ok).toBe(false);
    expect(result.blockedReasons[0]).toContain('empty definition');
  });

  it('blocks a query with only granularity-only timeDimension (no dateRange, no filters)', () => {
    const q: Query = {
      timeDimensions: [{ dimension: 'active_daily.log_date', granularity: 'day' }],
    };
    const result = checkTranslatability(q);
    expect(result.ok).toBe(false);
    // May have both the empty-predicate reason and the granularity-only reason
    expect(result.blockedReasons.length).toBeGreaterThan(0);
  });

  it('allows a query with only a dated timeDimension (no separate filters)', () => {
    const q: Query = {
      timeDimensions: [{ dimension: 'active_daily.log_date', dateRange: 'last 30 days' }],
    };
    // A dated timeDimension is a valid predicate leaf — not empty
    expect(checkTranslatability(q).ok).toBe(true);
  });

  it('allows a query with at least one filter', () => {
    const q: Query = {
      filters: [{ member: 'mf_users.country', operator: 'equals', values: ['VN'] }],
    };
    expect(checkTranslatability(q).ok).toBe(true);
  });
});

// ── Round-trip property: after echo-stripping, a plain predicate query is ok ─

describe('checkTranslatability — round-trip property', () => {
  it('a typical segment predicate query (post echo-strip) is fully translatable', () => {
    // Represents what the save bar would see after stripping the game echo.
    const q: Query = {
      measures: ['mf_users.count'],
      dimensions: ['mf_users.user_id'],
      filters: [
        { member: 'mf_users.country', operator: 'equals', values: ['VN'] },
        { member: 'mf_users.spend', operator: 'gte', values: ['100'] },
      ],
      timeDimensions: [
        { dimension: 'active_daily.log_date', dateRange: 'last 30 days' },
      ],
      segments: ['mf_users.whales'],
    };
    expect(checkTranslatability(q).ok).toBe(true);
  });
});
