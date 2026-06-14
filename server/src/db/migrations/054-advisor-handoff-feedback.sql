-- Advisor hand-off drafts + opportunity feedback.
--
-- STUB NOTICE: advisor_handoff_draft is a temporary home for scaffolded
-- experiment drafts UNTIL the Experiment Command Center registry ships. The
-- Advisor never launches an experiment — it only scaffolds an editable draft
-- (status is always 'draft'). When the command-center registry lands, drafts
-- migrate there and this table is retired; the scaffolder is the seam to swap.
--
-- A draft holds NO contact PII — only user_id-keyed cohort references and
-- numeric experiment parameters (arms, split, window, power). CS resolves
-- contact details in their own tooling.
--
-- Idempotency: draft_id is deterministic = '<segment_id>::<candidate_id>' so
-- re-scaffolding the same recommendation updates the same row rather than
-- spawning duplicates.

CREATE TABLE IF NOT EXISTS advisor_handoff_draft (
  draft_id        TEXT    NOT NULL PRIMARY KEY,
  segment_id      TEXT    NOT NULL,
  game_id         TEXT    NOT NULL,
  candidate_id    TEXT    NOT NULL,
  -- Full scaffolded draft payload (arms, split, window, power, CS queue, safety)
  -- serialized as JSON. Kept opaque here; typed by handoff-scaffolder.ts.
  draft_json      TEXT    NOT NULL,
  -- Always 'draft' in the stub — the command-center owns the launch lifecycle.
  status          TEXT    NOT NULL DEFAULT 'draft' CHECK (status IN ('draft')),
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_advisor_draft_segment
  ON advisor_handoff_draft (segment_id);

-- Opportunity feedback — the human half of the Treatment-Effect Library.
-- Append-only: dismiss/pin an opportunity with a reason so future diagnoses
-- can suppress or boost it. Keyed by (segment, factor, lever) shape, never by
-- individual member. PII-free.
--
-- action: 'dismiss' = not worth running (with reason) | 'pin' = prioritise.
-- reason: 'structural' | 'known' | 'not-now' | free text.

CREATE TABLE IF NOT EXISTS advisor_feedback (
  id              TEXT    NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  segment_id      TEXT    NOT NULL,
  game_id         TEXT    NOT NULL,
  factor          TEXT    NOT NULL,
  lever_family    TEXT    NULL,
  action          TEXT    NOT NULL CHECK (action IN ('dismiss', 'pin')),
  reason          TEXT    NOT NULL,
  created_by      TEXT    NULL,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_advisor_feedback_segment
  ON advisor_feedback (segment_id, factor);
