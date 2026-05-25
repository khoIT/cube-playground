/**
 * Unified key-value cache migration — `kv_cache` table.
 *
 * Idempotent (CREATE TABLE IF NOT EXISTS). Called from migrate.ts.
 * Backs lightweight per-kind caches (cube /load rows, turn-detail audit
 * aggregates, etc.) under one schema. Each row is identified by the
 * composite key (kind, key); different kinds may share key bytes without
 * collision.
 *
 * Columns kept nullable when not all kinds populate them:
 *   - owner_id / game_id     — populated by surfaces that scope per-owner
 *   - meta_hash              — populated by surfaces invalidating on schema change
 *   - model                  — populated by surfaces that depend on the LLM model
 *   - input/output_tokens    — populated only when the cached value represents an LLM result
 *   - cost_usd               — same as above
 *   - expires_at             — populated by surfaces with TTL; NULL = never expires
 */

import type Database from 'better-sqlite3';

export function migrateKvCache(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS kv_cache (
      kind            TEXT    NOT NULL,
      key             TEXT    NOT NULL,
      value_json      TEXT    NOT NULL,
      owner_id        TEXT,
      game_id         TEXT,
      meta_hash       TEXT,
      model           TEXT,
      input_tokens    INTEGER,
      output_tokens   INTEGER,
      cost_usd        REAL,
      hit_count       INTEGER NOT NULL DEFAULT 0,
      created_at      INTEGER NOT NULL,
      last_hit_at     INTEGER,
      expires_at      INTEGER,
      PRIMARY KEY (kind, key)
    );

    CREATE INDEX IF NOT EXISTS idx_kv_cache_kind_expires
      ON kv_cache(kind, expires_at);

    CREATE INDEX IF NOT EXISTS idx_kv_cache_owner
      ON kv_cache(owner_id) WHERE owner_id IS NOT NULL;
  `);
}
