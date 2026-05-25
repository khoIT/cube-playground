-- Migration 011: add funnel_json column to segments table
-- Stores serialised FunnelDefinition when segment was created via the funnel builder.
-- Segments with a non-null funnel_json render the funnel view instead of the predicate view.
-- Down: ALTER TABLE segments DROP COLUMN funnel_json (SQLite 3.35+: supported)
ALTER TABLE segments ADD COLUMN funnel_json TEXT NULL;
