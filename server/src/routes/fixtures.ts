/**
 * Dev-only fixture seed endpoint for visual regression tests.
 *
 * Registered conditionally — only when NODE_ENV !== 'production'.
 * Resets the in-memory state of `segments` (and related tables) to a
 * deterministic seed matching tests/visual/fixtures/test-segments.ts.
 *
 * SECURITY: do NOT register in prod. The index.ts bootstrap checks
 * NODE_ENV before registering this plugin.
 */

import type { FastifyPluginAsync } from 'fastify';
import { getDb } from '../db/sqlite.js';

const FIXTURE_PREDICATE_TREE = {
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
};

const FIXTURE_CUBE_QUERY = {
  filters: [
    { member: 'mf_users.total_spend_usd', operator: 'gte', values: ['100'] },
    { member: 'mf_users.last_seen_at', operator: 'inDateRange', values: ['last 30 days'] },
  ],
};

const fixturesRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/__fixtures__/segments', async (_request, reply) => {
    const db = getDb();
    db.exec(`
      DELETE FROM segment_tags;
      DELETE FROM segment_analyses;
      DELETE FROM segments;
    `);

    const insert = db.prepare(`
      INSERT INTO segments (
        id, name, type, owner, status, cube,
        predicate_tree_json, cube_query_json,
        uid_count, uid_list_json,
        refresh_cadence_min, last_refreshed_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `);

    insert.run(
      'seg_fixture',
      'High-value retained players (last 30d)',
      'predicate',
      'fixture@local',
      'fresh',
      'mf_users',
      JSON.stringify(FIXTURE_PREDICATE_TREE),
      JSON.stringify(FIXTURE_CUBE_QUERY),
      12_843,
      '[]',
      60,
      '2026-05-19T08:00:00Z'
    );

    insert.run(
      'seg_manual_fixture',
      'Churn-risk cohort (manual upload)',
      'manual',
      'fixture@local',
      'fresh',
      null,
      null,
      null,
      421,
      '[]',
      null,
      null
    );

    const insertTag = db.prepare('INSERT INTO segment_tags (segment_id, tag) VALUES (?, ?)');
    for (const tag of ['monetization', 'retention']) insertTag.run('seg_fixture', tag);
    for (const tag of ['churn', 'csv']) insertTag.run('seg_manual_fixture', tag);

    reply.code(204);
    return null;
  });
};

export default fixturesRoutes;
