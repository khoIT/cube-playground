-- Unified trust/visibility ladder on glossary terms.
-- Additive + nullable: reads DERIVE unified `trust`/`visibility` from the legacy
-- `status` + `trust_tier` columns via the trust-mapping layer, so these columns
-- stay NULL until a later, flag-gated populate step persists them. Keeping them
-- nullable means a code rollback needs no DB down-migration (the runner is
-- forward-only). Legacy columns are untouched and remain the source of truth.
--
--   trust      ∈ {draft, certified, deprecated}   (matches business-metric trust)
--   visibility ∈ {personal, shared, org}

ALTER TABLE glossary_terms ADD COLUMN trust TEXT;
ALTER TABLE glossary_terms ADD COLUMN visibility TEXT;
