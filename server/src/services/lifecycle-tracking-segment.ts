/**
 * System "all-users" tracking segments — the coverage backbone for the LiveOps
 * lifecycle + tier transition matrices.
 *
 * The transition reader self-joins per-uid state in `segment_member_state_daily`,
 * which is only populated for uids that belong to a snapshotted predicate
 * segment. To make the flows approach FULL-POPULATION coverage (not just whatever
 * user-defined segments happen to be tracked), we maintain one hidden system
 * segment per lakehouse-mapped game: a predicate segment on `mf_users` with an
 * empty filter set, so its membership = every user. The daily snapshot job then
 * lands every uid's lifecycle/tier state once a day.
 *
 * Design:
 *   - id is deterministic (`sys-lifecycle-all-users-<game>`) so ensure is idempotent.
 *   - owner is a constant SYSTEM id + visibility 'personal', so it's hidden from
 *     every user's segment list (the list route excludes this owner explicitly).
 *   - cube_query_json = {"filters":[]} → the membership writer overrides
 *     dimensions:[identity], measures:[] → an identity-only projection of all
 *     mf_users rows (see segment-snapshot-writer.buildSegmentMembershipSql).
 *   - snapshot_cadence / track_cadence default to 'daily' (column defaults).
 *
 * Cost note: this lands all-user state daily per game (mf_users is per-user,
 * millions of rows — same scale as a large user-defined segment, not the
 * billion-row event tables). It only runs where SEGMENT_SNAPSHOT_ENABLED is on.
 */

import { getDb } from '../db/sqlite.js';
import { loadGamesConfig } from './games-config-loader.js';
import { lakehouseSchemaForGame } from '../lakehouse/lakehouse-trino-connector.js';

/** Constant owner for system tracking segments — never a real principal sub. */
export const LIFECYCLE_TRACKING_OWNER = 'system:lifecycle-tracking';

const ID_PREFIX = 'sys-lifecycle-all-users-';

/** Empty-filter query → identity-only projection of ALL mf_users rows. */
const ALL_USERS_QUERY_JSON = JSON.stringify({ filters: [] });

export function lifecycleTrackingSegmentId(gameId: string): string {
  return `${ID_PREFIX}${gameId}`;
}

/** True for any system lifecycle-tracking segment id (used to hide them). */
export function isLifecycleTrackingSegmentId(id: string): boolean {
  return id.startsWith(ID_PREFIX);
}

/** Workspace the tracking segments are created under — must match where the
 *  snapshot job runs (drives prefix resolution in the member-state writer).
 *  Defaults to 'local'; override per environment via env. */
function trackingWorkspace(): string {
  return process.env.LIFECYCLE_TRACKING_WORKSPACE ?? 'local';
}

export interface EnsureResult {
  created: string[];
  existing: string[];
  /** Games skipped because they have no lakehouse schema mapping. */
  skipped: string[];
}

/**
 * Idempotently ensure a hidden all-users tracking segment exists for every
 * lakehouse-mapped game. Creating the rows is cheap and harmless on its own —
 * actual snapshot work only happens when SEGMENT_SNAPSHOT_ENABLED is set.
 */
export function ensureLifecycleTrackingSegments(): EnsureResult {
  const db = getDb();
  const workspace = trackingWorkspace();
  const result: EnsureResult = { created: [], existing: [], skipped: [] };

  const exists = db.prepare('SELECT 1 FROM segments WHERE id = ? LIMIT 1');
  // Column set mirrors the proven predicate-segment insert in routes/segments.ts;
  // snapshot_cadence / track_cadence are omitted so their 'daily' column defaults
  // apply. owner_label + visibility keep it labelled and hidden.
  const insert = db.prepare(`
    INSERT INTO segments
      (id, name, type, owner, owner_label, status, cube, predicate_tree_json, cube_query_json,
       uid_count, uid_list_json, refresh_cadence_min, created_at, updated_at, game_id, workspace, visibility)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'),?,?,?)
  `);

  for (const game of loadGamesConfig().games) {
    if (!lakehouseSchemaForGame(game.id)) {
      result.skipped.push(game.id);
      continue;
    }
    const id = lifecycleTrackingSegmentId(game.id);
    if (exists.get(id)) {
      result.existing.push(id);
      continue;
    }
    insert.run(
      id,
      `All users · lifecycle tracking (${game.id})`,
      'predicate',
      LIFECYCLE_TRACKING_OWNER,
      'System',
      'fresh',
      'mf_users',
      null,
      ALL_USERS_QUERY_JSON,
      0,
      '[]',
      null,
      game.id,
      workspace,
      'personal',
    );
    result.created.push(id);
  }

  return result;
}
