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
  generated_at: string;
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

export function writeSnapshot(): string {
  const db = getDb();
  const snap: Snapshot = {
    version: 1,
    generated_at: new Date().toISOString(),
    segments: db.prepare('SELECT * FROM segments ORDER BY id').all() as SegmentRow[],
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
  const existing = (db.prepare('SELECT COUNT(*) AS c FROM segments').get() as { c: number }).c;
  if (existing > 0) return { hydrated: false, counts: {} };

  const snap: Snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));

  // Snapshot rows may pre-date the game_id migration; rows that lack the field
  // fall back to the playground's configured default game (gds.config.json).
  const insertSegment = db.prepare(`
    INSERT INTO segments
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
    INSERT INTO segment_card_cache (segment_id, card_id, query_hash, rows_json, fetched_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertIdentity = db.prepare(`
    INSERT OR REPLACE INTO cube_identity_map (cube, identity_field, source, confidence, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const defaultGameId = loadGamesConfig().defaultGameId;
  const tx = db.transaction(() => {
    for (const s of snap.segments) insertSegment.run({ game_id: defaultGameId, activations_json: '[]', ...s });
    for (const t of snap.segment_tags) insertTag.run(t.segment_id, t.tag);
    for (const c of snap.segment_card_cache) {
      insertCard.run(c.segment_id, c.card_id, c.query_hash, c.rows_json, c.fetched_at);
    }
    for (const im of snap.cube_identity_map) {
      insertIdentity.run(im.cube, im.identity_field, im.source, im.confidence, im.updated_at);
    }
  });
  tx();

  return {
    hydrated: true,
    counts: {
      segments: snap.segments.length,
      tags: snap.segment_tags.length,
      cards: snap.segment_card_cache.length,
      identity_map: snap.cube_identity_map.length,
    },
  };
}
