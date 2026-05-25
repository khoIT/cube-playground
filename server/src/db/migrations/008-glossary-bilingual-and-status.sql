-- Bilingual glossary + Draft/Official status + seed-vs-user-edit discriminator.
-- Adds Vietnamese fields (label_vi, description_vi, aliases_vi), a publication
-- status used by the chat agent to filter terms it trusts, a source flag so
-- the seed re-loader can safely purge stale seed rows without touching
-- user-authored entries, and an editor_name freetext for lightweight attribution.

ALTER TABLE glossary_terms ADD COLUMN label_vi TEXT;
ALTER TABLE glossary_terms ADD COLUMN description_vi TEXT;
ALTER TABLE glossary_terms ADD COLUMN aliases_vi TEXT;
ALTER TABLE glossary_terms ADD COLUMN status TEXT NOT NULL DEFAULT 'draft'
  CHECK (status IN ('draft','official'));
ALTER TABLE glossary_terms ADD COLUMN source TEXT NOT NULL DEFAULT 'user'
  CHECK (source IN ('seed','user'));
ALTER TABLE glossary_terms ADD COLUMN editor_name TEXT;

-- Existing rows were created by the seed loader (before this migration).
-- Backfill them so the source-aware purge in glossary-migrate.ts treats them
-- as managed-by-seed and the chat agent can read them as Official immediately.
UPDATE glossary_terms SET source = 'seed', status = 'official' WHERE source = 'user';

CREATE INDEX IF NOT EXISTS idx_glossary_terms_status
  ON glossary_terms(status, label COLLATE NOCASE);
