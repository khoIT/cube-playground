/**
 * Annotation store — CRUD over chart_annotations in segments.db.
 *
 * Global annotations (game IS NULL) are always included alongside game-scoped
 * ones so a single call to list() returns everything relevant to a given chart.
 */

import { getDb } from '../db/sqlite.js';

export type AnnotationType = 'patch' | 'event' | 'campaign' | 'incident';

export interface AnnotationRow {
  id: number;
  game: string | null;
  type: AnnotationType;
  title: string;
  starts_at: string;
  ends_at: string | null;
  url: string | null;
  created_by: string | null;
  created_at: number;
}

export interface ListAnnotationsFilter {
  game: string;
  from?: string; // YYYY-MM-DD inclusive
  to?: string;   // YYYY-MM-DD inclusive
}

export interface InsertAnnotationInput {
  game?: string | null;
  type: AnnotationType;
  title: string;
  starts_at: string;
  ends_at?: string | null;
  url?: string | null;
  created_by?: string | null;
}

export interface UpdateAnnotationInput {
  type?: AnnotationType;
  title?: string;
  starts_at?: string;
  ends_at?: string | null;
  url?: string | null;
}

/**
 * Returns annotations for the requested game + all global (game IS NULL) ones.
 * Optionally bounded by a date range on starts_at.
 */
export function listAnnotations(filter: ListAnnotationsFilter): AnnotationRow[] {
  const db = getDb();

  // Build dynamic WHERE clauses — range filter on starts_at when provided.
  const conditions: string[] = ['(game = ? OR game IS NULL)'];
  const params: (string | number)[] = [filter.game];

  if (filter.from) {
    conditions.push('starts_at >= ?');
    params.push(filter.from);
  }
  if (filter.to) {
    conditions.push('starts_at <= ?');
    params.push(filter.to);
  }

  const sql = `
    SELECT * FROM chart_annotations
    WHERE ${conditions.join(' AND ')}
    ORDER BY starts_at ASC
  `;
  return db.prepare(sql).all(...params) as AnnotationRow[];
}

export function insertAnnotation(input: InsertAnnotationInput): AnnotationRow {
  const db = getDb();
  const now = Date.now();

  const result = db.prepare(`
    INSERT INTO chart_annotations (game, type, title, starts_at, ends_at, url, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.game ?? null,
    input.type,
    input.title,
    input.starts_at,
    input.ends_at ?? null,
    input.url ?? null,
    input.created_by ?? null,
    now,
  );

  return db.prepare('SELECT * FROM chart_annotations WHERE id = ?')
    .get(result.lastInsertRowid) as AnnotationRow;
}

export function updateAnnotation(id: number, input: UpdateAnnotationInput): AnnotationRow | null {
  const db = getDb();

  const sets: string[] = [];
  const params: (string | number | null)[] = [];

  if (input.type !== undefined) { sets.push('type = ?'); params.push(input.type); }
  if (input.title !== undefined) { sets.push('title = ?'); params.push(input.title); }
  if (input.starts_at !== undefined) { sets.push('starts_at = ?'); params.push(input.starts_at); }
  if ('ends_at' in input) { sets.push('ends_at = ?'); params.push(input.ends_at ?? null); }
  if ('url' in input) { sets.push('url = ?'); params.push(input.url ?? null); }

  if (sets.length === 0) {
    return db.prepare('SELECT * FROM chart_annotations WHERE id = ?').get(id) as AnnotationRow | null;
  }

  params.push(id);
  db.prepare(`UPDATE chart_annotations SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return db.prepare('SELECT * FROM chart_annotations WHERE id = ?').get(id) as AnnotationRow | null;
}

export function deleteAnnotation(id: number): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM chart_annotations WHERE id = ?').run(id);
  return result.changes > 0;
}
