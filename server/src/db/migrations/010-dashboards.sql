-- Saved dashboards: per-owner, per-game dashboard with up to 8 pinned tiles.
-- Dashboard delete cascades all tiles via FK ON DELETE CASCADE.
CREATE TABLE IF NOT EXISTS dashboards (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  owner      TEXT    NOT NULL,
  game       TEXT    NOT NULL,
  slug       TEXT    NOT NULL,
  title      TEXT    NOT NULL,
  created_at TEXT    NOT NULL,
  updated_at TEXT    NOT NULL,
  UNIQUE(owner, game, slug)
);

CREATE TABLE IF NOT EXISTS dashboard_tiles (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  dashboard_id   INTEGER NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
  title          TEXT    NOT NULL,
  query_json     TEXT    NOT NULL,
  viz_type       TEXT    NOT NULL,
  position_json  TEXT    NOT NULL,
  created_at     TEXT    NOT NULL,
  updated_at     TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS dashboard_tiles_dashboard_id
  ON dashboard_tiles(dashboard_id);
