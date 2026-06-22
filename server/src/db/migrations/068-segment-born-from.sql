-- Segment lineage: where a cohort came from.
--
-- A segment created by crystallizing an explored chat query (the "Build segment
-- from this" bridge) records the origin of the exploration so the cohort can
-- answer "why does this exist?" months later — critical for shared workspaces
-- and audit. Stores a small JSON blob: { artifact_id?, question?, cube_query? }.
--
-- Nullable with NO backfill: pre-existing segments and any created outside the
-- explore→segment flow simply carry NULL. Purely additive — no reader changes
-- behaviour when the column is absent/NULL, so deploy is cost-safe.

ALTER TABLE segments ADD COLUMN born_from TEXT;
