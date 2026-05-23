/**
 * Snapshot of the segments workspace as a single JSON file checked into git.
 *
 * Workflow:
 *   1. dev seeds segments + refreshes them → DB is populated
 *   2. `npm run snapshot` dumps DB → server/data/seed/segments-snapshot.json
 *   3. dev commits the JSON
 *   4. another machine clones, starts the server with an empty DB
 *   5. boot hydrate sees segments table empty → loads JSON → rows ready instantly
 *
 * Scope: segments + segment_tags + segment_card_cache + cube_identity_map.
 * (segment_analyses is excluded for v1 — demo doesn't need pinned analyses.)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from './sqlite.js';
import { loadGamesConfig } from '../services/games-config-loader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = join(__dirname, '..', '..', 'data', 'seed', 'segments-snapshot.json');

interface SegmentRow {
  [key: string]: unknown;
}

interface Snapshot {
  version: 1;
  segments: SegmentRow[];
  segment_tags: Array<{ segment_id: string; tag: string }>;
  segment_card_cache: Array<{
    segment_id: string;
    card_id: string;
    query_hash: string;
    rows_json: string;
    fetched_at: string;
  }>;
  cube_identity_map: Array<{
    cube: string;
    identity_field: string;
    source: string;
    confidence: number | null;
    updated_at: string;
  }>;
}

// A segment caught mid-refresh would land in the snapshot with status
// 'refreshing' — an in-flight value that's meaningless to persist and that
// otherwise drifts byte-by-byte every snapshot run while the cron worker is
// active. Coerce to 'stale' so hydrate produces stable output and Windows
// re-refreshes the segment on the first cron tick after pull.
function stabilizeSegmentRow(row: SegmentRow): SegmentRow {
  if (row.status === 'refreshing') return { ...row, status: 'stale' };
  return row;
}

export function writeSnapshot(): string {
  const db = getDb();
  const snap: Snapshot = {
    version: 1,
    segments: (db.prepare('SELECT * FROM segments ORDER BY id').all() as SegmentRow[]).map(
      stabilizeSegmentRow,
    ),
    segment_tags: db
      .prepare('SELECT segment_id, tag FROM segment_tags ORDER BY segment_id, tag')
      .all() as Snapshot['segment_tags'],
    segment_card_cache: db
      .prepare(
        'SELECT segment_id, card_id, query_hash, rows_json, fetched_at FROM segment_card_cache ORDER BY segment_id, card_id',
      )
      .all() as Snapshot['segment_card_cache'],
    cube_identity_map: db
      .prepare(
        'SELECT cube, identity_field, source, confidence, updated_at FROM cube_identity_map ORDER BY cube',
      )
      .all() as Snapshot['cube_identity_map'],
  };

  mkdirSync(dirname(SNAPSHOT_PATH), { recursive: true });
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(snap, null, 2) + '\n', 'utf8');
  return SNAPSHOT_PATH;
}

export function hydrateFromSnapshot(): { hydrated: boolean; counts: Record<string, number> } {
  if (!existsSync(SNAPSHOT_PATH)) return { hydrated: false, counts: {} };

  const db = getDb();

  const snap: Snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));

  // Idempotent backfill: every insert is `OR IGNORE` keyed by the row's
  // primary key, so re-hydrating a partially-populated DB only fills the gaps
  // and never clobbers local edits. Lets `git pull` + restart fix Windows
  // checkouts that have a stale segments.db with only a handful of rows.
  //
  // Snapshot rows may pre-date the game_id migration; rows that lack the
  // field fall back to the playground's configured default game.
  const insertSegment = db.prepare(`
    INSERT OR IGNORE INTO segments
      (id, name, type, owner, status, cube, predicate_tree_json, cube_query_json, sql_preview,
       uid_count, uid_list_json, refresh_cadence_min, last_refreshed_at, broken_reason,
       created_at, updated_at, predicate_meta_version, game_id, activations_json)
    VALUES (@id, @name, @type, @owner, @status, @cube, @predicate_tree_json, @cube_query_json,
            @sql_preview, @uid_count, @uid_list_json, @refresh_cadence_min, @last_refreshed_at,
            @broken_reason, @created_at, @updated_at, @predicate_meta_version, @game_id,
            @activations_json)
  `);
  const insertTag = db.prepare('INSERT OR IGNORE INTO segment_tags (segment_id, tag) VALUES (?, ?)');
  const insertCard = db.prepare(`
    INSERT OR IGNORE INTO segment_card_cache (segment_id, card_id, query_hash, rows_json, fetched_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertIdentity = db.prepare(`
    INSERT OR IGNORE INTO cube_identity_map (cube, identity_field, source, confidence, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const defaultGameId = loadGamesConfig().defaultGameId;
  let segmentsInserted = 0;
  let tagsInserted = 0;
  let cardsInserted = 0;
  let identityInserted = 0;
  const tx = db.transaction(() => {
    for (const s of snap.segments) {
      const r = insertSegment.run({ game_id: defaultGameId, activations_json: '[]', ...s });
      segmentsInserted += r.changes;
    }
    for (const t of snap.segment_tags) {
      tagsInserted += insertTag.run(t.segment_id, t.tag).changes;
    }
    for (const c of snap.segment_card_cache) {
      cardsInserted += insertCard.run(c.segment_id, c.card_id, c.query_hash, c.rows_json, c.fetched_at).changes;
    }
    for (const im of snap.cube_identity_map) {
      identityInserted += insertIdentity.run(im.cube, im.identity_field, im.source, im.confidence, im.updated_at).changes;
    }
  });
  tx();

  const totalInserted = segmentsInserted + tagsInserted + cardsInserted + identityInserted;
  return {
    hydrated: totalInserted > 0,
    counts: {
      segments: segmentsInserted,
      tags: tagsInserted,
      cards: cardsInserted,
      identity_map: identityInserted,
    },
  };
}
