-- Advisor cohort proposal — the bridge from a game-scope investigation to a real
-- segment. When the agent investigates a whole game it can't scaffold an experiment
-- draft (drafting is segment-scoped), so instead it proposes a COHORT: a named,
-- predicate-tree definition the manager can one-click turn into a Segment, after
-- which the scoped flow (scaffold → review → monitor) takes over.
--
-- Keyed by session_id: a game-scope investigation has no segment to key on yet.
-- One row per session (latest proposal wins) — re-proposing in the same session
-- replaces the prior one.
--
-- PII-free: holds only a predicate definition + display name + rationale. The
-- actual membership is materialized later by the Segments engine on create.

CREATE TABLE IF NOT EXISTS advisor_cohort_proposal (
  session_id      TEXT    NOT NULL PRIMARY KEY,
  game_id         TEXT    NOT NULL,
  -- Human-facing segment name the manager will see on the create button.
  name            TEXT    NOT NULL,
  -- Primary cube the predicate is rooted in (Segment.cube on create).
  primary_cube    TEXT    NOT NULL,
  -- The cohort definition: a PredicateNode tree, serialized JSON. Validated to
  -- compile (predicateToSql) before persistence; typed by predicate-tree.ts.
  predicate_json  TEXT    NOT NULL,
  -- One or two sentences: why this cohort (shown under the create button).
  rationale       TEXT    NOT NULL,
  -- Optional agent estimate of addressable size (illustrative; the real count
  -- comes from materialization).
  addressable_n   INTEGER NULL,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_advisor_cohort_proposal_game
  ON advisor_cohort_proposal (game_id);
