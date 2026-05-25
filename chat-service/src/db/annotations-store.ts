/**
 * CRUD helpers for turn_annotations table.
 * One row per turn_id — INSERT OR REPLACE semantics for upsert.
 * All reads are owner-scoped to prevent cross-developer data leakage.
 */

import type Database from 'better-sqlite3';

export interface AnnotationRow {
  turn_id: string;
  owner_id: string;
  starred: number; // 0 | 1 (SQLite has no boolean)
  flag: string | null;
  note: string | null;
  updated_at: number;
}

export interface AnnotationInput {
  starred?: boolean;
  flag?: string | null;
  note?: string | null;
}

const NOTE_MAX_BYTES = 1024;

/**
 * Upsert an annotation for a turn. Merges with existing row when present;
 * inserts fresh row otherwise. updated_at is always set to Date.now().
 *
 * Note is capped at 1 KB server-side per security requirement.
 */
export function upsertAnnotation(
  db: Database.Database,
  turnId: string,
  ownerId: string,
  input: AnnotationInput,
): AnnotationRow {
  const existing = getAnnotation(db, turnId, ownerId);
  const now = Date.now();

  const starred = input.starred !== undefined
    ? (input.starred ? 1 : 0)
    : (existing?.starred ?? 0);

  const flag = 'flag' in input ? (input.flag ?? null) : (existing?.flag ?? null);

  const rawNote = 'note' in input ? (input.note ?? null) : (existing?.note ?? null);
  const note = rawNote ? rawNote.slice(0, NOTE_MAX_BYTES) : null;

  db.prepare(
    `INSERT OR REPLACE INTO turn_annotations (turn_id, owner_id, starred, flag, note, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(turnId, ownerId, starred, flag, note, now);

  return { turn_id: turnId, owner_id: ownerId, starred, flag, note, updated_at: now };
}

/**
 * Remove annotation row for a turn. No-op when row doesn't exist.
 */
export function deleteAnnotation(
  db: Database.Database,
  turnId: string,
  ownerId: string,
): void {
  db.prepare(
    'DELETE FROM turn_annotations WHERE turn_id = ? AND owner_id = ?',
  ).run(turnId, ownerId);
}

/**
 * Fetch a single annotation by turn + owner. Returns null when not found.
 */
export function getAnnotation(
  db: Database.Database,
  turnId: string,
  ownerId: string,
): AnnotationRow | null {
  return (
    db.prepare(
      'SELECT * FROM turn_annotations WHERE turn_id = ? AND owner_id = ?',
    ).get(turnId, ownerId) as AnnotationRow | undefined
  ) ?? null;
}
