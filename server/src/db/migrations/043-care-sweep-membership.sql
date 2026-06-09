-- Per-uid cohort membership for one sweep run — which VIPs matched which playbook
-- at sweep time. This is what powers the "entered / left" set-diff between two
-- runs (SQL EXCEPT) and the drill-to-VIPs list in the comparison view.
--
-- This overlaps partially with care_cases.opened_at / condition_lapsed (entered/
-- left is partly derivable from case timestamps), but the explicit point-in-time
-- membership snapshot is intentional: it captures the exact cohort each run saw,
-- including already-open VIPs that wouldn't show a fresh opened_at.
--
-- Highest-volume table (≈ cohort_size summed across playbooks, per run). Bounded
-- by a short retention prune (membership ages out faster than the count rows).
--
-- Additive + forward-only (runner keys off PRAGMA user_version = file count).

CREATE TABLE IF NOT EXISTS care_sweep_membership (
  run_id       TEXT NOT NULL,
  playbook_id  TEXT NOT NULL,
  uid          TEXT NOT NULL,
  PRIMARY KEY (run_id, playbook_id, uid),
  FOREIGN KEY (run_id) REFERENCES care_sweep_runs (run_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS care_sweep_membership_run_idx
  ON care_sweep_membership (run_id, playbook_id);
