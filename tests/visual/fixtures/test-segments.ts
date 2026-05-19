/**
 * Deterministic seed for visual-regression test fixtures.
 *
 * The dev-only `GET /api/__fixtures__/segments` route (under
 * server/src/routes/__fixtures__.ts) reads this seed and resets the in-memory
 * state before each Playwright screen test. Mirrors the SEGMENTS array shape
 * from tests/visual/mock-fork/data.jsx.
 */

export const FIXTURE_SEGMENTS = [
  {
    id: 'seg_fixture',
    name: 'High-value retained players (last 30d)',
    type: 'predicate',
    owner: 'fixture@local',
    status: 'fresh',
    cube: 'mf_users',
    tags: ['monetization', 'retention'],
    uid_count: 12_843,
    refresh_cadence_min: 60,
    last_refreshed_at: '2026-05-19T08:00:00Z',
    predicate_tree_json: {
      id: 'root',
      op: 'AND',
      children: [
        {
          id: 'leaf1',
          member: 'mf_users.total_spend_usd',
          type: 'number',
          op: '>=',
          values: [100],
        },
        {
          id: 'leaf2',
          member: 'mf_users.last_seen_at',
          type: 'time',
          op: 'inDateRange',
          values: ['last 30 days'],
        },
      ],
    },
  },
  {
    id: 'seg_manual_fixture',
    name: 'Churn-risk cohort (manual upload)',
    type: 'manual',
    owner: 'fixture@local',
    status: 'fresh',
    tags: ['churn', 'csv'],
    uid_count: 421,
    last_refreshed_at: null,
  },
] as const;

export type FixtureSegment = (typeof FIXTURE_SEGMENTS)[number];
