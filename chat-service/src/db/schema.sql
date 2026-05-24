-- chat_sessions: one row per conversation thread, pinned to a single game
CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  title TEXT,
  created_at INTEGER NOT NULL,
  last_turn_at INTEGER,
  turn_count INTEGER NOT NULL DEFAULT 0,
  total_input_tokens INTEGER NOT NULL DEFAULT 0,
  total_output_tokens INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  parent_session_id TEXT,
  compacted_into TEXT
);

-- Index for listing sessions by owner+game ordered by recency
CREATE INDEX IF NOT EXISTS idx_sessions_owner_game
  ON chat_sessions(owner_id, game_id, last_turn_at DESC);

-- chat_turns: one row per user or assistant turn within a session
CREATE TABLE IF NOT EXISTS chat_turns (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  turn_index INTEGER NOT NULL,
  role TEXT NOT NULL,
  user_text TEXT,
  assistant_text TEXT,
  reasoning_json TEXT,
  tool_calls_json TEXT,
  artifacts_json TEXT,
  charts_json TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd REAL,
  skill TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER
);

-- Index for loading all turns in a session in order
CREATE INDEX IF NOT EXISTS idx_turns_session_index
  ON chat_turns(session_id, turn_index);

-- chat_audit: append-only event log for llm calls, tool calls, errors
CREATE TABLE IF NOT EXISTS chat_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  turn_id TEXT,
  kind TEXT NOT NULL,
  detail_json TEXT,
  at INTEGER NOT NULL
);

-- chat_tombstones: deleted session ids, propagated through chat-snapshot.json so
-- a delete on one machine reconciles to other dev machines on the next hydrate.
CREATE TABLE IF NOT EXISTS chat_tombstones (
  session_id TEXT PRIMARY KEY,
  deleted_at INTEGER NOT NULL
);
