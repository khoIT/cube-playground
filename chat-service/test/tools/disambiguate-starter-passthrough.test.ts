/**
 * Starter-question pass-through in disambiguate_query: a message matching a
 * frozen seed question returns action='auto' with the pre-validated members
 * pinned (measures/dimensions split, ranking order, bounded time axis) —
 * and falls through to normal resolution when the text or the members
 * don't match this workspace's meta.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StarterSeedHit } from '../../src/db/starter-questions-seed.js';

const seedHolder: { hit: StarterSeedHit | null } = { hit: null };

vi.mock('../../src/db/starter-questions-seed.js', () => ({
  getSeedEntry: vi.fn(() => seedHolder.hit),
}));

import { matchStarterQuestion } from '../../src/tools/disambiguate-starter-passthrough.js';

const META = {
  cubes: [
    {
      name: 'etl_game_detail',
      measures: [
        { name: 'etl_game_detail.matches', type: 'number' },
        { name: 'etl_game_detail.distinct_players', type: 'number' },
      ],
      dimensions: [
        { name: 'etl_game_detail.game_mode_label', type: 'string' },
        { name: 'etl_game_detail.map_label', type: 'string' },
        { name: 'etl_game_detail.log_date', type: 'time' },
      ],
    },
  ],
};

const KNOWN = new Set([
  'etl_game_detail.matches',
  'etl_game_detail.distinct_players',
  'etl_game_detail.game_mode_label',
  'etl_game_detail.map_label',
  'etl_game_detail.log_date',
]);

const QUESTION_TEXT = 'Which game modes and maps drive the most matches and unique players in available data?';

function seedWith(
  targetCatalogIds: string[],
  coverage?: Record<string, string>,
): StarterSeedHit {
  return {
    version: 'v1',
    generatedAt: 1,
    entry: {
      questions: [{
        id: 'game-mode-map-popularity',
        text: QUESTION_TEXT,
        topicTags: ['liveops'],
        categoryTags: ['explore'],
        targetCatalogIds,
      }],
      ...(coverage ? { coverage } : {}),
    },
  };
}

describe('matchStarterQuestion', () => {
  beforeEach(() => {
    seedHolder.hit = seedWith([
      'etl_game_detail.game_mode_label',
      'etl_game_detail.map_label',
      'etl_game_detail.matches',
      'etl_game_detail.distinct_players',
    ]);
  });

  it('builds an auto query from the pinned members (the 24df367b chip)', () => {
    const hit = matchStarterQuestion(QUESTION_TEXT, 'cfm_vn', META, KNOWN)!;
    expect(hit.questionId).toBe('game-mode-map-popularity');
    expect(hit.query.measures).toEqual(['etl_game_detail.matches', 'etl_game_detail.distinct_players']);
    expect(hit.query.dimensions).toEqual(['etl_game_detail.game_mode_label', 'etl_game_detail.map_label']);
    expect(hit.query.order).toEqual({ 'etl_game_detail.matches': 'desc' });
    expect(hit.query.limit).toBe(50);
    // Bounded time axis so ≤31-day guard cubes accept the first preview.
    expect(hit.query.timeDimensions).toEqual([
      { dimension: 'etl_game_detail.log_date', dateRange: 'last 30 days' },
    ]);
  });

  it('anchors the 30-day window to the seed coverage date when present', () => {
    seedHolder.hit = seedWith(
      [
        'etl_game_detail.game_mode_label',
        'etl_game_detail.map_label',
        'etl_game_detail.matches',
        'etl_game_detail.distinct_players',
      ],
      { 'etl_game_detail.log_date': '2026-04-30' },
    );
    const hit = matchStarterQuestion(QUESTION_TEXT, 'cfm_vn', META, KNOWN)!;
    // Pipelines lag behind today — the anchored window guarantees the first
    // preview lands on data instead of an empty "last 30 days".
    expect(hit.query.timeDimensions).toEqual([
      { dimension: 'etl_game_detail.log_date', dateRange: ['2026-04-01', '2026-04-30'] },
    ]);
  });

  it('bounds the PARTITION time dimension when a cube has several time dims', () => {
    // cros-style behavior cube: register_time listed first, but the ≤31-day
    // guard is on log_date — bounding register_time alone still 500s.
    const meta = {
      cubes: [{
        name: 'etl_register',
        measures: [{ name: 'etl_register.registrations', type: 'number' }],
        dimensions: [
          { name: 'etl_register.register_time', type: 'time' },
          { name: 'etl_register.channel', type: 'string' },
          { name: 'etl_register.log_date', type: 'time' },
        ],
      }],
    };
    const known = new Set(['etl_register.registrations', 'etl_register.channel']);
    seedHolder.hit = {
      version: 'v1', generatedAt: 1,
      entry: { questions: [{
        id: 'reg-by-channel', text: 'New registrations by channel',
        topicTags: ['user_acquisition'], categoryTags: ['explore'],
        targetCatalogIds: ['etl_register.registrations', 'etl_register.channel'],
      }] },
    };
    const hit = matchStarterQuestion('New registrations by channel', 'cros', meta, known)!;
    expect(hit.query.timeDimensions).toEqual([
      { dimension: 'etl_register.log_date', dateRange: 'last 30 days' },
    ]);
  });

  it('prefers a date-grain dim over a raw timestamp when no partition column matches', () => {
    // ballistar recharge cube: recharge_time (raw ts) listed first, but the
    // pre-agg partitions on recharge_date — bounding recharge_time 400s.
    const meta = {
      cubes: [{
        name: 'recharge',
        measures: [{ name: 'recharge.revenue_vnd', type: 'number' }],
        dimensions: [
          { name: 'recharge.recharge_time', type: 'time' },
          { name: 'recharge.payment_channel', type: 'string' },
          { name: 'recharge.recharge_date', type: 'time' },
        ],
      }],
    };
    const known = new Set(['recharge.revenue_vnd', 'recharge.payment_channel']);
    seedHolder.hit = {
      version: 'v1', generatedAt: 1,
      entry: { questions: [{
        id: 'arpt-by-channel', text: 'Average revenue per transaction by payment channel',
        topicTags: ['monetization'], categoryTags: ['explore'],
        targetCatalogIds: ['recharge.revenue_vnd', 'recharge.payment_channel'],
      }] },
    };
    const hit = matchStarterQuestion('Average revenue per transaction by payment channel', 'ballistar', meta, known)!;
    expect(hit.query.timeDimensions).toEqual([
      { dimension: 'recharge.recharge_date', dateRange: 'last 30 days' },
    ]);
  });

  it('composes a day-granularity series when a time dimension is among the targets', () => {
    // A time-dim TARGET means the question wants a trend, not just a bounded
    // window — without granularity the chip collapses to one aggregate row.
    seedHolder.hit = seedWith(
      ['etl_game_detail.matches', 'etl_game_detail.log_date'],
      { 'etl_game_detail.log_date': '2026-04-30' },
    );
    const hit = matchStarterQuestion(QUESTION_TEXT, 'cfm_vn', META, KNOWN)!;
    expect(hit.query.timeDimensions).toEqual([
      { dimension: 'etl_game_detail.log_date', dateRange: ['2026-04-01', '2026-04-30'], granularity: 'day' },
    ]);
    // Series order is chronological and the limit must hold 30 days × dim
    // cardinality (measure-desc + 50 would drop random middle days).
    expect(hit.query.order).toEqual({ 'etl_game_detail.log_date': 'asc' });
    expect(hit.query.limit).toBe(1000);
  });

  it('matches case- and whitespace-insensitively', () => {
    const mangled = '  which game modes and maps   drive the most matches and unique players in available data? ';
    expect(matchStarterQuestion(mangled, 'cfm_vn', META, KNOWN)).not.toBeNull();
  });

  it('falls through when the text does not match a seed question', () => {
    expect(matchStarterQuestion('Show me DAU by country', 'cfm_vn', META, KNOWN)).toBeNull();
  });

  it('falls through when any member is missing from this workspace meta (prod prefix layout)', () => {
    const prodKnown = new Set(['cfm_etl_game_detail.matches']); // prefixed names
    expect(matchStarterQuestion(QUESTION_TEXT, 'cfm_vn', META, prodKnown)).toBeNull();
  });

  it('falls through when targets contain no measure', () => {
    seedHolder.hit = seedWith(['etl_game_detail.game_mode_label', 'etl_game_detail.map_label']);
    expect(matchStarterQuestion(QUESTION_TEXT, 'cfm_vn', META, KNOWN)).toBeNull();
  });

  it('falls through when there is no seed for the game', () => {
    seedHolder.hit = null;
    expect(matchStarterQuestion(QUESTION_TEXT, 'cfm_vn', META, KNOWN)).toBeNull();
  });
});
