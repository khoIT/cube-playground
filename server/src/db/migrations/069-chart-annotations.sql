-- Chart annotations: manual event markers overlaid on trend charts.
-- game IS NULL means global (shown across all games).
-- type controls visual appearance and filter chips.
CREATE TABLE IF NOT EXISTS chart_annotations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  game       TEXT    NULL,
  type       TEXT    NOT NULL CHECK (type IN ('patch', 'event', 'campaign', 'incident')),
  title      TEXT    NOT NULL,
  starts_at  TEXT    NOT NULL, -- ISO date YYYY-MM-DD
  ends_at    TEXT    NULL,     -- ISO date YYYY-MM-DD, NULL for point events
  url        TEXT    NULL,
  created_by TEXT    NULL,
  created_at INTEGER NOT NULL  -- unix epoch millis
);

CREATE INDEX IF NOT EXISTS idx_chart_annotations_game_starts
  ON chart_annotations (game, starts_at);
