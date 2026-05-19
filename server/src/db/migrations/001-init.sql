-- Segments: persistent named user cohorts defined by predicate tree or manual uid list
CREATE TABLE IF NOT EXISTS segments (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  type                 TEXT NOT NULL CHECK (type IN ('manual', 'predicate')),
  owner                TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'fresh'
                         CHECK (status IN ('fresh', 'refreshing', 'broken', 'stale')),
  cube                 TEXT,
  predicate_tree_json  TEXT,
  cube_query_json      TEXT,
  sql_preview          TEXT,
  uid_count            INTEGER NOT NULL DEFAULT 0,
  uid_list_json        TEXT NOT NULL DEFAULT '[]',
  refresh_cadence_min  INTEGER,
  last_refreshed_at    DATETIME,
  broken_reason        TEXT,
  created_at           DATETIME NOT NULL DEFAULT (datetime('now')),
  updated_at           DATETIME NOT NULL DEFAULT (datetime('now'))
);

-- Tags for filtering/grouping segments
CREATE TABLE IF NOT EXISTS segment_tags (
  segment_id  TEXT NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  tag         TEXT NOT NULL,
  PRIMARY KEY (segment_id, tag)
);

-- Saved Cube queries pinned inside a segment's analyses tab
CREATE TABLE IF NOT EXISTS segment_analyses (
  id           TEXT PRIMARY KEY,
  segment_id   TEXT NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  owner        TEXT NOT NULL,
  query_json   TEXT,
  layout_json  TEXT,
  created_at   DATETIME NOT NULL DEFAULT (datetime('now')),
  updated_at   DATETIME NOT NULL DEFAULT (datetime('now'))
);

-- Per-cube identity field mapping (which dimension holds the user id)
CREATE TABLE IF NOT EXISTS cube_identity_map (
  cube            TEXT PRIMARY KEY,
  identity_field  TEXT NOT NULL,
  source          TEXT NOT NULL DEFAULT 'manual'
                    CHECK (source IN ('manual', 'auto')),
  confidence      REAL,
  updated_at      DATETIME NOT NULL DEFAULT (datetime('now'))
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_segments_owner  ON segments(owner);
CREATE INDEX IF NOT EXISTS idx_segments_type   ON segments(type);
CREATE INDEX IF NOT EXISTS idx_segments_status ON segments(status);
CREATE INDEX IF NOT EXISTS idx_analyses_segment ON segment_analyses(segment_id);
