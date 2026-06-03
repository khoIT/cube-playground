-- Add opt-in visibility column to segments.
-- Distinct from the refresh-lifecycle `status` column (fresh/refreshing/stale/broken).
--
-- visibility ∈ {personal, shared, org}
--   personal (default/NULL) — only the owner sees it outside workspace-shared list routes
--   shared   — all workspace members can see and reuse
--   org      — visible org-wide (future; no access guard change needed yet)
--
-- NULL maps to 'personal' on read (see trust-mapping.ts SEGMENT_DEFAULT_VISIBILITY).
-- Additive + nullable so a rollback needs no down-migration (forward-only runner).

ALTER TABLE segments ADD COLUMN visibility TEXT;
