-- Unify the two per-segment cadence knobs into one operator-facing
-- `track_cadence`. Historically a segment carried two independent schedules:
--   * refresh_cadence_min — how often the live member list is recomputed (SQLite)
--   * snapshot_cadence    — how often a state+KPI snapshot is captured (Iceberg)
-- They re-read the same predicate on unrelated clocks, so the live list and the
-- history could drift, and the operator faced two confusing knobs. `track_cadence`
-- becomes the single source of truth; the backend derives the two legacy columns
-- from it (see snapshot-cadence.ts converters) so both existing schedulers stay
-- slaved to one value. The legacy columns are retained — other readers (header
-- pill, refresh queue, retention) still use them — and are dual-written on edit.
--
-- The vocabulary (Off|15m|30m|1h|3h|6h|12h|daily) is enforced at the application
-- layer (snapshot-cadence.ts + the PATCH validator), not a column CHECK, so it
-- can evolve without a schema migration — matching the 063 precedent.

ALTER TABLE segments ADD COLUMN track_cadence TEXT NOT NULL DEFAULT 'daily';

-- Backfill is COST-SAFE and ADDITIVE: it sets only the new display column and
-- never touches refresh_cadence_min / snapshot_cadence, so NO segment's recompute
-- or capture behaviour changes at deploy. Unification takes effect per-segment the
-- next time the operator sets the knob (PATCH dual-writes the legacy columns).
--
--   * snapshot-"eligible" (predicate + game) → capture cadence wins. This keeps the
--     heavy lakehouse-write frequency exactly where it is (no Trino cost spike).
--     NOTE: this is a BROADER, display-only proxy for the snapshot job's true
--     eligibility (which also requires cube_query_json + a known lakehouse schema).
--     Harmless here — only the display column is set — but don't treat it as exact.
--   * otherwise → derive from the recompute interval, choosing the finest cadence
--     whose bucket is >= that interval (never fires more often than before), capped
--     at daily; a NULL interval → 'Off' (on-demand only). Mirrors refreshMinutesToTrack.
UPDATE segments SET track_cadence = CASE
  WHEN type = 'predicate' AND game_id IS NOT NULL AND game_id <> '' THEN snapshot_cadence
  WHEN refresh_cadence_min IS NULL          THEN 'Off'
  WHEN refresh_cadence_min <= 15            THEN '15m'
  WHEN refresh_cadence_min <= 30            THEN '30m'
  WHEN refresh_cadence_min <= 60            THEN '1h'
  WHEN refresh_cadence_min <= 180           THEN '3h'
  WHEN refresh_cadence_min <= 360           THEN '6h'
  WHEN refresh_cadence_min <= 720           THEN '12h'
  ELSE 'daily'
END;
