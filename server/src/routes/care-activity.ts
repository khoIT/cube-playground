/**
 * GET /api/care/activity?game — rolling 24-hour activity aggregate for the
 * CS Monitor strip.
 *
 * Returns counts of cases that moved into each terminal/contact state within
 * the last 24 hours, keyed on the relevant timestamp column:
 *   treated   → treated_at  >= now-24h
 *   resolved  → closed_at   >= now-24h  AND status = 'resolved'
 *   dismissed → closed_at   >= now-24h  AND status = 'dismissed'
 *
 * Also returns a short list of the most-recent individual events (uid + kind +
 * playbookId + UTC instant) so the strip can render a live-feed row.
 *
 * Auth: viewer-ok (read-only). game validated against workspace allow-list via
 * the shared requireGame helper (same pattern as other care routes).
 */

import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/sqlite.js';
import { resolveGameScope } from '../care/game-scope.js';
import type { WorkspaceDef } from '../services/workspaces-config-loader.js';

/** Maximum recent-events rows returned (keeps the payload small). */
const RECENT_LIMIT = 10;

/** Validate `?game=` against the workspace allow-list; null = invalid. */
function requireGame(workspace: WorkspaceDef, query: unknown): string | null {
  const scope = resolveGameScope(workspace, (query as { game?: string })?.game);
  return scope.ok ? (query as { game: string }).game.trim() : null;
}

export interface ActivityEvent {
  uid: string;
  kind: 'treated' | 'resolved' | 'dismissed';
  playbookId: string;
  at: string;
}

export interface ActivityAggregate {
  treated24h: number;
  dismissed24h: number;
  resolved24h: number;
  recent: ActivityEvent[];
}

export default async function careActivityRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/care/activity', async (req, reply) => {
    const game = requireGame(req.workspace, req.query);
    if (!game) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'game required' } });
    }

    // Rolling 24-hour cutoff computed fresh per request (UTC instant).
    // Using ISO string comparison works because SQLite stores timestamps as
    // ISO-8601 text and lexicographic order matches chronological order.
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const db = getDb();

    // ── Aggregate counts ──────────────────────────────────────────────────────

    const treated24h = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM care_cases
           WHERE game_id = ? AND treated_at >= ?`,
        )
        .get(game, cutoff) as { n: number }
    ).n;

    const dismissed24h = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM care_cases
           WHERE game_id = ? AND status = 'dismissed' AND closed_at >= ?`,
        )
        .get(game, cutoff) as { n: number }
    ).n;

    const resolved24h = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM care_cases
           WHERE game_id = ? AND status = 'resolved' AND closed_at >= ?`,
        )
        .get(game, cutoff) as { n: number }
    ).n;

    // ── Recent events (newest-first) ──────────────────────────────────────────
    // Union treated + closed events, then sort by timestamp descending.
    // Each row carries the relevant timestamp as `at` for display in GMT+7.
    const recentRows = db
      .prepare(
        `SELECT uid, 'treated' AS kind, playbook_id AS playbookId, treated_at AS at
           FROM care_cases
           WHERE game_id = ? AND treated_at >= ?
         UNION ALL
         SELECT uid, status AS kind, playbook_id AS playbookId, closed_at AS at
           FROM care_cases
           WHERE game_id = ? AND status IN ('resolved','dismissed') AND closed_at >= ?
         ORDER BY at DESC
         LIMIT ?`,
      )
      .all(game, cutoff, game, cutoff, RECENT_LIMIT) as ActivityEvent[];

    const result: ActivityAggregate = {
      treated24h,
      dismissed24h,
      resolved24h,
      recent: recentRows,
    };

    return result;
  });
}
