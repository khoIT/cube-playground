/**
 * SQLite-backed store for pre-rendered preset card rows.
 *
 * upsertCardCache compares each new entry's queryHash + rows_json against
 * the existing row and only writes when something actually changed. That
 * means git diffs on the snapshot file stay quiet when Cube returns the
 * same numbers — important for keeping the demo snapshot stable.
 *
 * Last-good preservation: a failed refresh (status='error', empty rows) must
 * NOT wipe a value that was previously computed successfully. A transient Cube
 * timeout or a not-yet-built pre-aggregation would otherwise destroy the cohort's
 * last-good cards, leaving the UI to fall back to a doomed live query. So when an
 * incoming error would overwrite an existing 'ok' entry, we keep the prior rows
 * and their fetched_at (the data's real age), keep status='ok' so the card still
 * renders its last-good value, and only stamp the latest failure into `error` for
 * diagnostics. The good value survives until a fresh success replaces it.
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
    'SELECT query_hash, rows_json, fetched_at, status, error FROM segment_card_cache WHERE segment_id = ? AND card_id = ?',
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
      const incomingStatus = entry.status ?? 'ok';
      const incomingError = entry.error ?? null;
      const existing = select.get(segmentId, entry.cardId) as
        | { query_hash: string; rows_json: string; fetched_at: string; status: string; error: string | null }
        | undefined;

      // Preserve last-good rows when a failed refresh would clobber a prior
      // success: keep the existing rows + query_hash + fetched_at, hold
      // status at 'ok' so the card still renders, and record only the latest
      // failure message. Otherwise write the incoming entry as-is (a success
      // always lands with a fresh fetched_at; an error with no prior good
      // value persists as the error entry it is).
      const preserveGood =
        incomingStatus === 'error' && existing != null && existing.status === 'ok';

      const toWrite = preserveGood
        ? {
            queryHash: existing!.query_hash,
            rowsJson: existing!.rows_json,
            fetchedAt: existing!.fetched_at,
            status: 'ok',
            error: incomingError,
          }
        : {
            queryHash: entry.queryHash,
            rowsJson: JSON.stringify(entry.rows),
            fetchedAt: now,
            status: incomingStatus,
            error: incomingError,
          };

      if (existing) {
        const existingHash = hashRows(JSON.parse(existing.rows_json));
        const toWriteHash = hashRows(JSON.parse(toWrite.rowsJson));
        // Skip the write only when EVERYTHING is unchanged — including status,
        // so a card flipping ok↔error (or its message) always lands.
        if (
          existing.query_hash === toWrite.queryHash &&
          existingHash === toWriteHash &&
          existing.status === toWrite.status &&
          (existing.error ?? null) === toWrite.error
        ) {
          continue; // no-op — nothing to write
        }
      }
      upsert.run(
        segmentId,
        entry.cardId,
        toWrite.queryHash,
        toWrite.rowsJson,
        toWrite.fetchedAt,
        toWrite.status,
        toWrite.error,
      );
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
