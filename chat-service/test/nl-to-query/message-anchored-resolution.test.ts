import { describe, it, expect } from 'vitest';
import {
  knownCubeNames,
  firstNamedCube,
  anchorCubeMeasureOptions,
  findAnchorDimensionInMessage,
  extractSuggestedFieldRefs,
  lastSuggestedCube,
} from '../../src/nl-to-query/message-anchored-resolution.js';

// Member names are fully-qualified `cube.member` refs (matches /meta convention).
const META = {
  cubes: [
    {
      name: 'etl_money_flow',
      measures: [
        { name: 'etl_money_flow.events' },
        { name: 'etl_money_flow.distinct_players' },
        { name: 'etl_money_flow.total_in', shortTitle: 'Total In' },
        { name: 'etl_money_flow.total_out', shortTitle: 'Total Out' },
        { name: 'etl_money_flow.total_delta' },
        { name: 'etl_money_flow.in_events' },
        { name: 'etl_money_flow.out_events' },
      ],
      dimensions: [
        { name: 'etl_money_flow.money_type', type: 'string' },
        { name: 'etl_money_flow.direction', type: 'string' },
        { name: 'etl_money_flow.log_date', type: 'time' },
      ],
    },
    {
      name: 'etl_lottery_shoot',
      measures: [{ name: 'etl_lottery_shoot.draws' }],
      dimensions: [{ name: 'etl_lottery_shoot.lottery_id', type: 'string' }],
    },
  ],
};

describe('message-anchored-resolution', () => {
  it('knownCubeNames lists cubes longest-first', () => {
    expect(knownCubeNames(META)).toEqual(['etl_lottery_shoot', 'etl_money_flow']);
  });

  describe('firstNamedCube', () => {
    const names = knownCubeNames(META);
    it('matches a bare cube name typed in the message', () => {
      expect(firstNamedCube('Show inflow vs outflow using etl_money_flow now', names)).toBe('etl_money_flow');
    });
    it('matches the space-normalised cube name', () => {
      expect(firstNamedCube('chart the etl money flow this week', names)).toBe('etl_money_flow');
    });
    it('does not loosely match a partial phrase', () => {
      // "money flow" alone (no "etl") must not match the cube.
      expect(firstNamedCube('show money flow trends', names)).toBeNull();
    });
    it('returns null when no cube is named', () => {
      expect(firstNamedCube('show diamond spend by reason', names)).toBeNull();
    });
  });

  describe('findAnchorDimensionInMessage', () => {
    it('binds a dimension the message names verbatim', () => {
      const dim = findAnchorDimensionInMessage('inflow vs outflow by money type', 'etl_money_flow', META);
      expect(dim?.member).toBe('etl_money_flow.money_type');
      expect(dim?.kind).toBe('dimension');
    });
    it('returns null when no dimension on the cube is named', () => {
      expect(findAnchorDimensionInMessage('inflow vs outflow by region', 'etl_money_flow', META)).toBeNull();
    });
  });

  describe('anchorCubeMeasureOptions', () => {
    it('surfaces the cube in/out measures for an in-vs-out phrase', () => {
      const opts = anchorCubeMeasureOptions(META, 'etl_money_flow', 'diamond inflow vs outflow by money type');
      const members = opts.map((o) => o.member);
      expect(members).toContain('etl_money_flow.total_in');
      expect(members).toContain('etl_money_flow.total_out');
    });
    it('falls back to listing the cube measures when nothing scores', () => {
      const opts = anchorCubeMeasureOptions(META, 'etl_money_flow', 'qzx nonsense phrase');
      expect(opts.length).toBeGreaterThan(0);
      expect(opts.every((o) => o.cube === 'etl_money_flow')).toBe(true);
    });
  });

  describe('extractSuggestedFieldRefs / lastSuggestedCube', () => {
    it('extracts {{field:}} refs and the last cube', () => {
      const text = 'Try {{field:etl_money_flow.total_out}} or {{field:recharge.revenue_vnd}} next.';
      expect(extractSuggestedFieldRefs(text)).toEqual([
        'etl_money_flow.total_out',
        'recharge.revenue_vnd',
      ]);
      expect(lastSuggestedCube(text)).toBe('recharge');
    });
    it('returns empty / null when no field token present', () => {
      expect(extractSuggestedFieldRefs('no fields here')).toEqual([]);
      expect(lastSuggestedCube('no fields here')).toBeNull();
    });
  });
});
