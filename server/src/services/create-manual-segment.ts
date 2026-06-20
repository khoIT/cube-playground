/**
 * Insert a MANUAL segment (an explicit uid upload) and return its new id.
 *
 * Manual segments carry their cohort inline: `uid_list_json` IS the membership,
 * `uid_count` is its length, status is 'fresh', and there is no predicate, cube
 * query, or refresh cadence. This is the narrow manual case factored out so the
 * "save an overlap region as a segment" path lands rows in exactly the column
 * shape the segments CRUD route writes, without re-implementing that route's
 * predicate / percentile / refresh branches.
 */

import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/sqlite.js';
import { SEGMENT_DEFAULT_VISIBILITY } from './trust-mapping.js';

export interface CreateManualSegmentInput {
  name: string;
  gameId: string;
  cube: string | null;
  uidList: string[];
  workspace: string;
  owner: string;
  ownerLabel: string;
  visibility?: string;
  tags?: string[];
}

export function createManualSegment(input: CreateManualSegmentInput): string {
  const db = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();
  const visibility = input.visibility ?? SEGMENT_DEFAULT_VISIBILITY;

  db.prepare(
    `INSERT INTO segments
       (id, name, type, owner, owner_label, status, cube, predicate_tree_json, cube_query_json,
        uid_count, uid_list_json, refresh_cadence_min, created_at, updated_at, game_id, funnel_json, workspace, visibility)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    input.name,
    'manual',
    input.owner,
    input.ownerLabel,
    'fresh',
    input.cube,
    null,
    null,
    input.uidList.length,
    JSON.stringify(input.uidList),
    null,
    now,
    now,
    input.gameId,
    null,
    input.workspace,
    visibility,
  );

  if (input.tags?.length) {
    const insertTag = db.prepare('INSERT OR IGNORE INTO segment_tags (segment_id, tag) VALUES (?,?)');
    for (const tag of input.tags) insertTag.run(id, tag);
  }

  return id;
}
