-- Explicit serving lifecycle for segments.
--
-- Separates EXPLORATION segments (scratch analysis, disposable) from SERVED
-- segments (a published contract a downstream LiveOps/CS app pulls by id). Today
-- "served" is an accident of refresh cadence; this makes it an owned, observable
-- state with an audit trail of who published it and when.
--
--   draft       — default; scratch/exploration, never advertised downstream.
--   served      — published contract; the public pull path serves it (see the
--                 lifecycle gate in public-export.ts loadScopedSegment).
--   deprecated  — demoted-with-consumers; kept readable/distinct in the library
--                 and BLOCKED at the pull path (a real kill-switch, not advisory).
--
-- CHECK pins the vocabulary at the schema layer because these three states are
-- load-bearing for the pull-path gate — an unexpected value must fail loudly, not
-- silently serve. served_at/served_by record the publish action for the contract
-- banner. Existing rows default to 'draft', so no segment becomes pullable at
-- deploy that wasn't already.

ALTER TABLE segments ADD COLUMN lifecycle TEXT NOT NULL DEFAULT 'draft'
  CHECK (lifecycle IN ('draft', 'served', 'deprecated'));
ALTER TABLE segments ADD COLUMN served_at TEXT;
ALTER TABLE segments ADD COLUMN served_by TEXT;

-- Library lane split + the pull-path gate both filter by lifecycle.
CREATE INDEX IF NOT EXISTS idx_segments_lifecycle ON segments (lifecycle);
