/**
 * applyAdditiveMerge unit shapes — same-cube measure append (idempotent),
 * cross-cube standalone split, filter-additive merge with dedupe, and the
 * nothing-resolved no-op that hands ownership to the clarify path.
 */

import { describe, it, expect } from 'vitest';
import { applyAdditiveMerge } from '../../src/tools/disambiguate-query.js';
import type { DisambiguationResult } from '../../src/nl-to-query/index.js';
import type { CubeQuery } from '../../src/types.js';

const LAST_QUERY: CubeQuery = {
  measures: ['etl_game_detail.matches'],
  order: { 'etl_game_detail.dteventtime': 'asc' },
  limit: 1000,
  timeDimensions: [
    {
      dimension: 'etl_game_detail.dteventtime',
      dateRange: ['2026-04-01', '2026-04-30'],
      granularity: 'day',
    },
  ],
  filters: [
    { member: 'etl_game_detail.game_mode_label', operator: 'equals', values: ['ranked'] },
  ],
};

function resultWith(partial: Partial<DisambiguationResult['slots']>): DisambiguationResult {
  return {
    query: {},
    slots: {
      metric: { confidence: 0 },
      intent: { value: 'aggregate', confidence: 0.6 },
      ...partial,
    },
    unresolved: [],
    clarifications: [
      { slot: 'metric', question_en: 'which metric?', question_vi: '?' },
    ],
    overallConfidence: 0,
    language: 'en',
    action: 'clarify',
    warnings: [],
  };
}

describe('applyAdditiveMerge — measure additive', () => {
  it('appends a same-cube measure, keeps window/order/limit, clears clarifications', () => {
    const r = resultWith({
      metric: { value: 'etl_game_detail.distinct_players', confidence: 0.88 },
    });
    applyAdditiveMerge(r, LAST_QUERY, 'Matches per day');
    expect(r.query.measures).toEqual([
      'etl_game_detail.matches',
      'etl_game_detail.distinct_players',
    ]);
    expect(r.query.timeDimensions).toEqual(LAST_QUERY.timeDimensions);
    expect(r.query.limit).toBe(1000);
    expect(r.action).toBe('auto');
    expect(r.clarifications).toEqual([]);
    expect(r.warnings.join(' ')).toContain('additive merge');
  });

  it('is idempotent — re-adding an existing measure does not duplicate', () => {
    const r = resultWith({
      metric: { value: 'etl_game_detail.matches', confidence: 1 },
    });
    applyAdditiveMerge(r, LAST_QUERY, 'Matches per day');
    expect(r.query.measures).toEqual(['etl_game_detail.matches']);
    expect(r.action).toBe('auto');
  });

  it('cross-cube measure stays standalone with an explanatory warning', () => {
    const r = resultWith({
      metric: { value: 'recharge.revenue_vnd', confidence: 1 },
    });
    r.query = { measures: ['recharge.revenue_vnd'] };
    r.action = 'auto';
    applyAdditiveMerge(r, LAST_QUERY, 'Matches per day');
    // Standalone query untouched; merge declined loudly.
    expect(r.query.measures).toEqual(['recharge.revenue_vnd']);
    expect(r.warnings.join(' ')).toContain('emitted standalone query');
  });
});

describe('applyAdditiveMerge — filter additive', () => {
  it('appends a same-cube filter and inherits the previous metric', () => {
    const r = resultWith({
      filters: [
        {
          member: 'etl_game_detail.map_label',
          operator: 'equals',
          values: ['Desert'],
          confidence: 0.9,
        },
      ],
    });
    applyAdditiveMerge(r, LAST_QUERY, 'Matches per day');
    expect(r.query.filters).toEqual([
      { member: 'etl_game_detail.game_mode_label', operator: 'equals', values: ['ranked'] },
      { member: 'etl_game_detail.map_label', operator: 'equals', values: ['Desert'] },
    ]);
    expect(r.query.measures).toEqual(['etl_game_detail.matches']);
    expect(r.slots.metric.value).toBe('etl_game_detail.matches');
    expect(r.action).toBe('auto');
  });

  it('dedupes an already-applied filter', () => {
    const r = resultWith({
      filters: [
        {
          member: 'etl_game_detail.game_mode_label',
          operator: 'equals',
          values: ['ranked'],
          confidence: 0.9,
        },
      ],
    });
    applyAdditiveMerge(r, LAST_QUERY, 'Matches per day');
    expect(r.query.filters).toHaveLength(1);
    expect(r.action).toBe('auto');
  });

  it('cross-cube filters do not merge (clarify path keeps ownership)', () => {
    const r = resultWith({
      filters: [
        { member: 'recharge.channel', operator: 'equals', values: ['ios'], confidence: 0.9 },
      ],
    });
    applyAdditiveMerge(r, LAST_QUERY, 'Matches per day');
    expect(r.action).toBe('clarify');
    expect(r.query.filters).toBeUndefined();
  });
});

describe('applyAdditiveMerge — no-op', () => {
  it('nothing resolved → untouched result, clarify path owns it', () => {
    const r = resultWith({});
    applyAdditiveMerge(r, LAST_QUERY, 'Matches per day');
    expect(r.action).toBe('clarify');
    expect(r.clarifications).toHaveLength(1);
    expect(r.warnings).toEqual([]);
  });
});
