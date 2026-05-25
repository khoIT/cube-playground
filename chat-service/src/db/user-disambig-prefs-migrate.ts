/**
 * Cross-session disambiguation preferences — `user_disambig_prefs` table.
 *
 * Layer 3 of the disambiguation memory stack (session-memory in kv_cache is
 * Layer 2; this table is durable, per-owner+game state). Each row pairs a
 * slot resolution with the user's original phrase so the read path can
 * re-resolve relative time ("this month") against the current clock.
 *
 * Composite PK (owner_id, game_id, slot). Index on (owner_id, last_used_at)
 * gives a cheap "what does this user usually mean" probe for the Settings UI.
 */

import type Database from 'better-sqlite3';

export function migrateUserDisambigPrefs(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_disambig_prefs (
      owner_id      TEXT    NOT NULL,
      game_id       TEXT    NOT NULL,
      slot          TEXT    NOT NULL,
      value_json    TEXT    NOT NULL,
      hit_count     INTEGER NOT NULL DEFAULT 0,
      last_used_at  INTEGER NOT NULL,
      created_at    INTEGER NOT NULL,
      PRIMARY KEY (owner_id, game_id, slot)
    );

    CREATE INDEX IF NOT EXISTS idx_udp_owner_lru
      ON user_disambig_prefs(owner_id, last_used_at DESC);
  `);
}
