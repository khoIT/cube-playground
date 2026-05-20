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
}

function hashRows(rows: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 16);
}

/** Insert or update each entry. Skips writes when rows + queryHash unchanged. */
export function upsertCardCache(
  segmentId: string,
  entries: CardCacheEntry[],
): void {
  const db = getDb();
  const now = new Date().toISOString();

  const select = db.prepare(
    'SELECT query_hash, rows_json FROM segment_card_cache WHERE segment_id = ? AND card_id = ?',
  );
  const upsert = db.prepare(`
    INSERT INTO segment_card_cache (segment_id, card_id, query_hash, rows_json, fetched_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(segment_id, card_id) DO UPDATE SET
      query_hash = excluded.query_hash,
      rows_json  = excluded.rows_json,
      fetched_at = excluded.fetched_at
  `);

  const tx = db.transaction((rows: CardCacheEntry[]) => {
    for (const entry of rows) {
      const rowsJson = JSON.stringify(entry.rows);
      const rowsHash = hashRows(entry.rows);
      const existing = select.get(segmentId, entry.cardId) as
        | { query_hash: string; rows_json: string }
        | undefined;
      if (existing) {
        const existingHash = hashRows(JSON.parse(existing.rows_json));
        if (existing.query_hash === entry.queryHash && existingHash === rowsHash) {
          continue; // no-op — nothing to write
        }
      }
      upsert.run(segmentId, entry.cardId, entry.queryHash, rowsJson, now);
    }
  });

  tx(entries);
}

/** Load all cache rows for a segment as a {cardId: {rows, fetched_at}} map. */
export function getCardCache(segmentId: string): Record<string, { rows: unknown[]; fetched_at: string }> {
  const db = getDb();
  const rows = db
    .prepare('SELECT card_id, rows_json, fetched_at FROM segment_card_cache WHERE segment_id = ?')
    .all(segmentId) as CachedCardRow[];

  const out: Record<string, { rows: unknown[]; fetched_at: string }> = {};
  for (const r of rows) {
    out[r.card_id] = { rows: JSON.parse(r.rows_json), fetched_at: r.fetched_at };
  }
  return out;
}
