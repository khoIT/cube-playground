-- Activation registry per segment. Embedded JSON keeps backend changes minimal
-- and matches the cardinality (≤10 activations per segment in practice).
ALTER TABLE segments ADD COLUMN activations_json TEXT NOT NULL DEFAULT '[]';
