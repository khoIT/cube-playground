/**
 * Idempotent starter-pack seeder.
 *
 * Given an owner, game, and the loaded starter dashboards, install any that:
 *   1. Match the game's available cubes (`applies_when.required_cubes`).
 *   2. Don't already exist for (owner, game) — the unique constraint guards
 *      against duplicate seeds.
 *
 * Returns the seeded slugs so callers can log + surface in UI.
 */

import { getDb } from '../db/sqlite.js';
import { loadStarterPack, type StarterDashboard } from './dashboard-starter-pack-loader.js';

export interface SeedInput {
  owner: string;
  /** Active workspace id — required so the seed stamps the right row. */
  workspace: string;
  game: string;
  /** Set of cube names available for this game (derived from /meta). */
  availableCubes: Set<string>;
}

export interface SeedResult {
  inserted: string[];
  skipped: Array<{ slug: string; reason: string }>;
}

function isApplicable(dashboard: StarterDashboard, availableCubes: Set<string>): boolean {
  for (const cube of dashboard.applies_when.required_cubes) {
    if (!availableCubes.has(cube)) return false;
  }
  return true;
}

export function seedStarterPack(input: SeedInput): SeedResult {
  const db = getDb();
  const pack = loadStarterPack();
  const now = new Date().toISOString();

  const inserted: string[] = [];
  const skipped: SeedResult['skipped'] = [];

  const tx = db.transaction(() => {
    for (const dashboard of pack) {
      if (!isApplicable(dashboard, input.availableCubes)) {
        skipped.push({ slug: dashboard.slug, reason: 'required_cubes_missing' });
        continue;
      }
      const existing = db
        .prepare(
          `SELECT id FROM dashboards
           WHERE owner = ? AND game = ? AND slug = ? AND workspace = ?`,
        )
        .get(input.owner, input.game, dashboard.slug, input.workspace) as
        | { id: number }
        | undefined;
      if (existing) {
        skipped.push({ slug: dashboard.slug, reason: 'already_exists' });
        continue;
      }

      const res = db
        .prepare(
          `INSERT INTO dashboards (owner, game, slug, title, created_at, updated_at, workspace)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.owner,
          input.game,
          dashboard.slug,
          dashboard.title,
          now,
          now,
          input.workspace,
        );
      const dashboardId = Number(res.lastInsertRowid);

      const addTileStmt = db.prepare(
        `INSERT INTO dashboard_tiles
           (dashboard_id, title, query_json, viz_type, position_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const tile of dashboard.tiles) {
        addTileStmt.run(
          dashboardId,
          tile.title,
          JSON.stringify(tile.query),
          tile.viz_type,
          JSON.stringify(tile.position),
          now,
          now,
        );
      }
      inserted.push(dashboard.slug);
    }
  });

  tx();
  return { inserted, skipped };
}
