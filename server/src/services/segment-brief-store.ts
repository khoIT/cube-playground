/**
 * SQLite store + in-process single-flight for the AI segment brief cache.
 *
 * One row per (segment, lang). `definition_hash` ties the row to the cohort
 * definition it was generated from — a mismatch means the brief is stale and
 * the route regenerates. Single-flight is per-process (same documented
 * single-instance posture as cron-runner.ts): concurrent opens of one segment
 * share a single in-flight generation instead of stampeding the LLM gateway.
 */

import { getDb } from '../db/sqlite.js';

export interface BriefCacheRow {
  segment_id: string;
  lang: string;
  definition_hash: string;
  brief_json: string | null;
  status: 'ok' | 'error';
  error: string | null;
  generated_at: string;
}

export function getBriefCache(segmentId: string, lang: string): BriefCacheRow | null {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM segment_brief_cache WHERE segment_id = ? AND lang = ?')
    .get(segmentId, lang) as BriefCacheRow | undefined;
  return row ?? null;
}

export function upsertBriefCache(row: {
  segmentId: string;
  lang: string;
  definitionHash: string;
  briefJson: string | null;
  status: 'ok' | 'error';
  error?: string | null;
}): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO segment_brief_cache (segment_id, lang, definition_hash, brief_json, status, error, generated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(segment_id, lang) DO UPDATE SET
      definition_hash = excluded.definition_hash,
      brief_json      = excluded.brief_json,
      status          = excluded.status,
      error           = excluded.error,
      generated_at    = excluded.generated_at
  `).run(
    row.segmentId,
    row.lang,
    row.definitionHash,
    row.briefJson,
    row.status,
    row.error ?? null,
    new Date().toISOString(),
  );
}

// ---------------------------------------------------------------------------
// Single-flight: concurrent requests for the same (segment, lang) await one
// shared generation promise. The entry clears on settle so a failed run can
// be retried by the next request.
// ---------------------------------------------------------------------------

const inFlight = new Map<string, Promise<unknown>>();

export function singleFlightBrief<T>(
  segmentId: string,
  lang: string,
  generate: () => Promise<T>,
): Promise<T> {
  const key = `${segmentId}:${lang}`;
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;
  const p = generate().finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, p);
  return p;
}

/** Test hook — clears in-flight ledger between cases. */
export function __resetBriefSingleFlight(): void {
  inFlight.clear();
}
