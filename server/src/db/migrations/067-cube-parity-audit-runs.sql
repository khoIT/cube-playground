-- Durable record of cross-game Cube model parity audit runs.
--
-- The read-only harness (cube-dev/scripts/audit-cube-parity.mjs) compares every
-- per-game dev Cube YAML against its prod-clone oracle + canonical rules and
-- emits findings. This persists each run's header, its findings, and a
-- content-addressed snapshot of every YAML it inspected, so the Model Audit UI
-- can show current state, trend over time, and diffs even when git is offline.
--
-- YAML blobs are deduped by sha256 content hash: a run that re-inspects 171
-- mostly-unchanged files stores only the blobs whose content actually changed.
--
-- Timestamps are epoch-ms INTEGERs to match the runtime's Date.now() usage.
-- No player PII is ever written — only model structure + git metadata.

CREATE TABLE IF NOT EXISTS cube_parity_run (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at        INTEGER NOT NULL,
  finished_at       INTEGER,
  status            TEXT NOT NULL DEFAULT 'running',  -- 'running' | 'ok' | 'error'
  dev_git_sha       TEXT,                              -- HEAD of cube-playground (dev models)
  prod_clone_sha    TEXT,                              -- HEAD of the local cube-prod clone
  prod_upstream_sha TEXT,                              -- kraken/cube upstream HEAD (null if not fetched)
  games             TEXT NOT NULL DEFAULT '[]',        -- JSON array of audited game keys
  count_correctness INTEGER NOT NULL DEFAULT 0,
  count_parity      INTEGER NOT NULL DEFAULT 0,
  count_cosmetic    INTEGER NOT NULL DEFAULT 0,
  parse_error_count INTEGER NOT NULL DEFAULT 0,
  error_message     TEXT
);

CREATE INDEX IF NOT EXISTS idx_cube_parity_run_started ON cube_parity_run (started_at);

CREATE TABLE IF NOT EXISTS cube_parity_finding (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id         INTEGER NOT NULL REFERENCES cube_parity_run (id) ON DELETE CASCADE,
  game           TEXT NOT NULL,
  cube           TEXT NOT NULL,                        -- logical entity name (prefix-stripped)
  dimension      TEXT NOT NULL,                        -- pk | join | measure | rollup | ratio | identity | structure
  severity       TEXT NOT NULL,                        -- correctness | parity | cosmetic
  dev_value      TEXT,
  oracle_value   TEXT,
  detail         TEXT,
  file           TEXT,
  line           INTEGER,
  verdict        TEXT,                                 -- null until triaged: real_bug | intentional | oracle_ahead | dev_ahead | na | wontfix
  root_cause_key TEXT NOT NULL                         -- game-free dedupe key, groups one canonical bug across games
);

CREATE INDEX IF NOT EXISTS idx_cube_parity_finding_run      ON cube_parity_finding (run_id);
CREATE INDEX IF NOT EXISTS idx_cube_parity_finding_game     ON cube_parity_finding (game);
CREATE INDEX IF NOT EXISTS idx_cube_parity_finding_severity ON cube_parity_finding (severity);
CREATE INDEX IF NOT EXISTS idx_cube_parity_finding_rootkey  ON cube_parity_finding (root_cause_key);

-- Content-addressed YAML blob store. One row per distinct file content ever
-- seen; unchanged files across runs reuse the same row.
CREATE TABLE IF NOT EXISTS cube_yaml_snapshot (
  content_hash      TEXT PRIMARY KEY,                  -- sha256 of the file text
  content           TEXT NOT NULL,
  byte_length       INTEGER NOT NULL,
  -- A content-addressed blob outlives any single run (later runs that see the
  -- same bytes reuse it), so SET NULL — not CASCADE — when its first-seeing run
  -- is pruned, or run-deletion would orphan blobs still referenced elsewhere.
  first_seen_run_id INTEGER REFERENCES cube_parity_run (id) ON DELETE SET NULL
);

-- Maps each run's inspected files to a deduped blob.
CREATE TABLE IF NOT EXISTS cube_yaml_snapshot_ref (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id       INTEGER NOT NULL REFERENCES cube_parity_run (id) ON DELETE CASCADE,
  side         TEXT NOT NULL,                          -- 'dev' | 'prod'
  game         TEXT NOT NULL,
  cube         TEXT NOT NULL,
  path         TEXT NOT NULL,                          -- repo-relative path
  content_hash TEXT NOT NULL REFERENCES cube_yaml_snapshot (content_hash)
);

CREATE INDEX IF NOT EXISTS idx_cube_yaml_ref_run  ON cube_yaml_snapshot_ref (run_id);
CREATE INDEX IF NOT EXISTS idx_cube_yaml_ref_hash ON cube_yaml_snapshot_ref (content_hash);
