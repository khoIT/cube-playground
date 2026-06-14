-- Durable audit trail for the in-process Optimization Advisor agent.
--
-- Today advisor runs are logger-only (agent-audit-log.ts) and sessions are
-- in-memory, so when a run times out (e.g. cold Trino) there is no record of
-- which tool call failed, how long it ran, or the error. These four tables
-- persist every run/turn/tool-call plus an append-only SSE event log for replay
-- in the admin audit console.
--
-- Privacy: only the existing aggregate + identity allowlist is ever written.
-- Tool inputs are the agent's own query specs; tool outputs are stored
-- post-redaction (the redaction guard runs in the tool layer). No member
-- contact PII is persisted.
--
-- Timestamps are epoch-ms INTEGERs to match the runtime's Date.now() usage.

CREATE TABLE IF NOT EXISTS advisor_agent_run (
  session_id        TEXT PRIMARY KEY,
  game_id           TEXT NOT NULL,
  segment_id        TEXT,
  scope_kind        TEXT NOT NULL,           -- 'segment' | 'game'
  goal              TEXT NOT NULL,
  mode              TEXT NOT NULL,           -- mode of the first turn
  owner             TEXT,                    -- operator email; PII of the actor, not a player
  model             TEXT,
  turn_count        INTEGER NOT NULL DEFAULT 0,
  total_cost_usd    REAL NOT NULL DEFAULT 0,
  final_stop_reason TEXT,
  had_error         INTEGER NOT NULL DEFAULT 0,  -- 0/1
  created_at        INTEGER NOT NULL,
  last_active_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_advisor_run_created ON advisor_agent_run (created_at);
CREATE INDEX IF NOT EXISTS idx_advisor_run_owner   ON advisor_agent_run (owner);
CREATE INDEX IF NOT EXISTS idx_advisor_run_game    ON advisor_agent_run (game_id);

CREATE TABLE IF NOT EXISTS advisor_agent_turn (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id      TEXT NOT NULL,
  turn_index      INTEGER NOT NULL,
  mode            TEXT NOT NULL,
  message         TEXT,                      -- operator prompt for this turn
  narration       TEXT,                      -- accumulated assistant text
  tool_call_count INTEGER NOT NULL DEFAULT 0,
  stop_reason     TEXT NOT NULL,
  abort_cause     TEXT,
  cost_usd        REAL NOT NULL DEFAULT 0,   -- cumulative session cost after this turn
  started_at      INTEGER NOT NULL,
  ended_at        INTEGER NOT NULL,
  duration_ms     INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES advisor_agent_run (session_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_advisor_turn_session ON advisor_agent_turn (session_id);

CREATE TABLE IF NOT EXISTS advisor_tool_call (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    TEXT NOT NULL,
  turn_id       INTEGER NOT NULL,
  call_id       TEXT,
  tool          TEXT NOT NULL,
  seq           INTEGER NOT NULL,
  input_json    TEXT,                        -- agent-issued query spec (aggregate, PII-free)
  output_digest TEXT,                        -- post-redaction result summary
  state         TEXT NOT NULL,               -- 'ok' | 'failed' | 'denied'
  error_message TEXT,
  started_at    INTEGER,
  ended_at      INTEGER,
  duration_ms   INTEGER,
  FOREIGN KEY (turn_id) REFERENCES advisor_agent_turn (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_advisor_toolcall_session ON advisor_tool_call (session_id);
CREATE INDEX IF NOT EXISTS idx_advisor_toolcall_turn    ON advisor_tool_call (turn_id);
CREATE INDEX IF NOT EXISTS idx_advisor_toolcall_tool    ON advisor_tool_call (tool);

CREATE TABLE IF NOT EXISTS advisor_event_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL,
  turn_index  INTEGER NOT NULL,
  event_index INTEGER NOT NULL,
  event_type  TEXT NOT NULL,
  event_json  TEXT NOT NULL,
  ts          INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES advisor_agent_run (session_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_advisor_event_session ON advisor_event_log (session_id, id);
