-- Portfolio percentile bands per metric: the internal half of a benchmark.
-- One row per tracked metric_key holding the p25/p50/p75/p90 of that metric's
-- value across all live games (nightly recomputed). Aggregate-only — no user
-- rows, no PII. Read by the knowledge benchmark resolver.

CREATE TABLE IF NOT EXISTS metric_percentile_snapshot (
  metric_key  TEXT PRIMARY KEY,
  p25         REAL NOT NULL,
  p50         REAL NOT NULL,
  p75         REAL NOT NULL,
  p90         REAL NOT NULL,
  sample_n    INTEGER NOT NULL,
  computed_at TEXT NOT NULL
);
