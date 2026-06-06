-- Segment sharing labels (chat parity): `owner_label` is the human-readable
-- "shared by …" name stamped at create time (username/email, falling back to
-- the owner sub); `shared_at` records when the row was last published via the
-- share endpoint (NULL = never shared / unshared).
--
-- NULL-safe by design: legacy rows keep owner_label NULL and the FE falls
-- back to rendering the owner sub. No backfill script.
--
-- Additive + nullable so a rollback needs no down-migration (forward-only runner).

ALTER TABLE segments ADD COLUMN owner_label TEXT;
ALTER TABLE segments ADD COLUMN shared_at TEXT;
