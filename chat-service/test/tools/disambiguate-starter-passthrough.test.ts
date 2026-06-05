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
