/**
 * Observability migration — `llm_calls`, `tool_invocations`, `sdk_events` tables.
 *
 * Idempotent (CREATE TABLE IF NOT EXISTS). Owned by the observability phase;
 * called from `migrate.ts` in fixed order per decision C1.
 *
 * All three tables FK to chat_turns(id) ON DELETE CASCADE.
 */

import type Database from 'better-sqlite3';

export function migrateObservability(db: Database.Database): void {
  db.exec(`
    -- Per-LLM-call record: one row per assistant SDK message within a turn.
    -- UNIQUE(turn_id, step_index) enables idempotent upserts from the recorder.
    CREATE TABLE IF NOT EXISTS llm_calls (
      id TEXT PRIMARY KEY,
      turn_id TEXT NOT NULL REFERENCES chat_turns(id) ON DELETE CASCADE,
      step_index INTEGER NOT NULL,
      model TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cache_creation_tokens INTEGER,
      cache_read_tokens INTEGER,
      cost_usd REAL,
      latency_ms INTEGER,
      started_at INTEGER,
      ended_at INTEGER,
      content_json TEXT,
      stop_reason TEXT,
      UNIQUE(turn_id, step_index)
    );

    -- Per-tool-invocation record: one row per tool_use/tool_result pair.
    -- UNIQUE(turn_id, tool_use_id) — tool_use_id is unique per SDK invocation.
    CREATE TABLE IF NOT EXISTS tool_invocations (
      id TEXT PRIMARY KEY,
      turn_id TEXT NOT NULL REFERENCES chat_turns(id) ON DELETE CASCADE,
      tool_use_id TEXT NOT NULL,
      name TEXT NOT NULL,
      args_json TEXT,
      result_summary TEXT,
      ok INTEGER NOT NULL DEFAULT 1,
      latency_ms INTEGER,
      started_at INTEGER,
      ended_at INTEGER,
      UNIQUE(turn_id, tool_use_id)
    );

    -- Raw SDK event firehose: ordered by seq within a turn.
    CREATE TABLE IF NOT EXISTS sdk_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      turn_id TEXT NOT NULL REFERENCES chat_turns(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      payload_json TEXT,
      at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_llm_calls_turn_id
      ON llm_calls(turn_id);

    CREATE INDEX IF NOT EXISTS idx_tool_invocations_turn_id
      ON tool_invocations(turn_id);

    CREATE INDEX IF NOT EXISTS idx_sdk_events_turn_seq
      ON sdk_events(turn_id, seq);
  `);
}
