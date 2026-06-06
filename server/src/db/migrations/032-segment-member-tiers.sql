-- LTV-tiered member sampling: top/middle/bottom-50 subgroups computed at
-- segment refresh time, stored with per-uid LTV values so the Members tab
-- renders tiers without extra Cube queries.
--
-- Shape: { computed_at, ltv_measure, tiers: { top|middle|bottom|all: [{uid, ltv}] } }
-- ~150 rows ≈ a few KB — inline JSON column, not a child table.
-- NULL = no tiers (manual segment, preset without an LTV measure, or never
-- refreshed since this feature shipped) → FE falls back to the random sample.
--
-- Additive + nullable so a rollback needs no down-migration (forward-only runner).

ALTER TABLE segments ADD COLUMN member_tiers_json TEXT;
