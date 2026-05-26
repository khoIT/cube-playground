-- Phase 02a — Glossary concept tier.
-- Additive nullable columns on `glossary_terms` so a term can act as a concept:
-- it carries (entity, default_measure, default_filter, ranking) hints that the
-- chat-service resolver uses to short-circuit clarification on phrases like
-- "top spenders this week" (entity=players, measure=recharge.revenue_vnd).
-- Existing rows leave the new columns NULL; existing CRUD round-trips them
-- without behavioural change until the chat-service v2 flag flips on.

ALTER TABLE glossary_terms ADD COLUMN entity_cube TEXT;
ALTER TABLE glossary_terms ADD COLUMN entity_pk TEXT;
ALTER TABLE glossary_terms ADD COLUMN default_measure_ref TEXT;
ALTER TABLE glossary_terms ADD COLUMN default_filter_json TEXT;
ALTER TABLE glossary_terms ADD COLUMN ranking_json TEXT;
ALTER TABLE glossary_terms ADD COLUMN trust_tier TEXT;
