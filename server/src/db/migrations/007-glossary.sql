-- Phase-03: Concept Glossary canonical terms.
-- Each row maps a business term → primary catalog id (+ secondary refs +
-- aliases for the chat assistant's term linker). Seed JSON is loaded by
-- the boot-time `migrateGlossarySeed` step (server/src/db/glossary-migrate.ts).
CREATE TABLE IF NOT EXISTS glossary_terms (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT NOT NULL,
  primary_catalog_id TEXT,
  secondary_catalog_ids TEXT,
  aliases TEXT,
  category TEXT,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_glossary_terms_category
  ON glossary_terms(category);
