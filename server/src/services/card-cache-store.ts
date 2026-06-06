/**
 * SQLite-backed store for pre-rendered preset card rows.
 *
 * upsertCardCache compares each new entry's queryHash + rows_json against
 * the existing row and only writes when something actually changed. That
 * means git diffs on the snapshot file stay quiet when Cube returns the
 * same numbers — important for keeping the demo snapshot stable.
 */

import { createHash } from 'node:crypto';
import { getDb } from '../db/sqlite.js';
import type { CardCacheEntry } from './card-runner.js';

export interface CachedCardRow {
  card_id: string;
  rows_json: string;
  fetched_at: string;
  status: string;
  error: string | null;
}

/** Shape returned to API consumers for each cached card. */
export interface CardCacheView {
  rows: unknown[];
  fetched_at: string;
  status: 'ok' | 'error';
  error?: string;
}

function hashRows(rows: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 16);
}

/** Insert or update each entry. Skips writes when rows + queryHash unchanged.
 *  Cards no longer in the preset (renamed/removed spec ids) are pruned — a
 *  full refresh pass always supplies the complete entry set, so anything
 *  absent from it is a ghost row that would otherwise linger forever (and
 *  keep surfacing a stale error/ok state for a card the FE no longer renders). */
export function upsertCardCache(
  segmentId: string,
  entries: CardCacheEntry[],
): void {
  const db = getDb();
  const now = new Date().toISOString();

  const select = db.prepare(
    'SELECT query_hash, rows_json, status, error FROM segment_card_cache WHERE segment_id = ? AND card_id = ?',
  );
  const upsert = db.prepare(`
    INSERT INTO segment_card_cache (segment_id, card_id, query_hash, rows_json, fetched_at, status, error)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(segment_id, card_id) DO UPDATE SET
      query_hash = excluded.query_hash,
      rows_json  = excluded.rows_json,
      fetched_at = excluded.fetched_at,
      status     = excluded.status,
      error      = excluded.error
  `);

  const tx = db.transaction((rows: CardCacheEntry[]) => {
    // Prune ghost rows for card ids the current preset no longer declares.
    if (rows.length > 0) {
      const keep = new Set(rows.map((r) => r.cardId));
      const existingIds = db
        .prepare('SELECT card_id FROM segment_card_cache WHERE segment_id = ?')
        .all(segmentId) as Array<{ card_id: string }>;
      const del = db.prepare(
        'DELETE FROM segment_card_cache WHERE segment_id = ? AND card_id = ?',
      );
      for (const { card_id } of existingIds) {
        if (!keep.has(card_id)) del.run(segmentId, card_id);
      }
    }
    for (const entry of rows) {
      const rowsJson = JSON.stringify(entry.rows);
      const rowsHash = hashRows(entry.rows);
      const status = entry.status ?? 'ok';
      const error = entry.error ?? null;
      const existing = select.get(segmentId, entry.cardId) as
        | { query_hash: string; rows_json: string; status: string; error: string | null }
        | undefined;
      if (existing) {
        const existingHash = hashRows(JSON.parse(existing.rows_json));
        // Skip the write only when EVERYTHING is unchanged — including status,
        // so a card flipping ok↔error (or its message) always lands.
        if (
          existing.query_hash === entry.queryHash &&
          existingHash === rowsHash &&
          existing.status === status &&
          (existing.error ?? null) === error
        ) {
          continue; // no-op — nothing to write
        }
      }
      upsert.run(segmentId, entry.cardId, entry.queryHash, rowsJson, now, status, error);
    }
  });

  tx(entries);
}

/** Load all cache rows for a segment as a {cardId: CardCacheView} map. */
export function getCardCache(segmentId: string): Record<string, CardCacheView> {
  const db = getDb();
  const rows = db
    .prepare('SELECT card_id, rows_json, fetched_at, status, error FROM segment_card_cache WHERE segment_id = ?')
    .all(segmentId) as CachedCardRow[];

  const out: Record<string, CardCacheView> = {};
  for (const r of rows) {
    const status: 'ok' | 'error' = r.status === 'error' ? 'error' : 'ok';
    out[r.card_id] = {
      rows: JSON.parse(r.rows_json),
      fetched_at: r.fetched_at,
      status,
      ...(r.error ? { error: r.error } : {}),
    };
  }
  return out;
}
