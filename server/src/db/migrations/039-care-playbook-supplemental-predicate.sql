-- Supplemental AND/OR predicate for a care playbook override.
--
-- The playbook's primary condition is a structured ThresholdRule
-- (condition_json). A CS author can layer an OPTIONAL extra filter built with
-- the Segments predicate builder; it is ANDed onto the compiled threshold
-- predicate at merge time so the cohort sweep applies both. Stored as a
-- serialized PredicateNode tree (same shape segments uses), NULL when unused.
--
-- Additive + forward-only (runner keys off PRAGMA user_version = file count).

ALTER TABLE care_playbooks ADD COLUMN supplemental_predicate_json TEXT;
