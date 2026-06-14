-- Treatment-Effect Library: stores expected-effect priors keyed by
-- (game, segment_shape, lever_family).
--
-- Purpose: seed game-ops defaults so the ranker has a starting prior on day 1,
-- then accumulate empirically-measured results as command-center experiments
-- complete (the flywheel). Every row carries a confidence label so downstream
-- consumers can distinguish "assumption" from "measured" without inspecting the
-- source string.
--
-- Keyed by (game_id, segment_shape, lever_family) — NOT by individual member uid.
-- segment_shape is a normalised string describing the cohort type
-- (e.g. "churn-risk", "spend-drop", "low-session"), not a segment id.
-- This keeps the library PII-free and reusable across different segment instances
-- of the same shape.
--
-- confidence: 'measured' | 'benchmark' | 'assumption'
--   measured   = completed own experiment; write-back hook populates this row.
--   benchmark  = cross-segment or cross-game result we observed.
--   assumption = game-ops default / industry prior — lowest trust.
--
-- effect_value: absolute effect as a fraction (0.06 = +6 pp).
-- source: free-text provenance string for display in the Advisor UI cards.
-- recorded_at: ISO-8601 timestamp when this row was written.
-- experiment_id: opaque reference to a command-center experiment (nullable for seeds).

CREATE TABLE IF NOT EXISTS treatment_effect_library (
  id              TEXT    NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  game_id         TEXT    NOT NULL,
  segment_shape   TEXT    NOT NULL,
  lever_family    TEXT    NOT NULL,
  effect_value    REAL    NOT NULL,
  confidence      TEXT    NOT NULL CHECK (confidence IN ('measured', 'benchmark', 'assumption')),
  source          TEXT    NOT NULL,
  experiment_id   TEXT    NULL,
  recorded_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Fast lookup by the primary key tuple used at query time
CREATE UNIQUE INDEX IF NOT EXISTS idx_tel_game_shape_lever
  ON treatment_effect_library (game_id, segment_shape, lever_family);

-- Allow scanning all priors for a game (e.g. export, analytics)
CREATE INDEX IF NOT EXISTS idx_tel_game_id
  ON treatment_effect_library (game_id);

-- Seed: game-ops defaults for cfm_vn.
-- All labeled 'assumption' — the win-back +6 pp prior comes from the VIP Care
-- playbook design doc; other values are conservative game-ops starting estimates.
-- These are overwritten (via UPSERT) when real experiments complete.

INSERT OR IGNORE INTO treatment_effect_library
  (game_id, segment_shape, lever_family, effect_value, confidence, source)
VALUES
  -- Win-back: lapsing VIPs re-activated within 7d after CS reach-out
  ('cfm_vn', 'churn-risk',    'win-back',               0.06, 'assumption',
   'game-ops default: VIP Care playbook design doc win-back prior +6 pp'),

  -- Session recovery: session-drop cohort restores activity after re-engagement
  ('cfm_vn', 'low-session',   'session-recovery',       0.05, 'assumption',
   'game-ops default: conservative session-recovery prior +5 pp'),

  -- Spend-drop recovery: lapsing spenders return to ≥60% baseline spend
  ('cfm_vn', 'spend-drop',    'spend-drop-recovery',    0.08, 'assumption',
   'game-ops default: spend-drop recovery prior +8 pp (targeted retention offer)'),

  -- First-deposit follow-up: second deposit within 7d
  ('cfm_vn', 'new-payer',     'first-deposit-followup', 0.10, 'assumption',
   'game-ops default: new-payer second-deposit conversion prior +10 pp'),

  -- Tier advancement: sustained ARPU90d after tier congratulation
  ('cfm_vn', 'tier-crosser',  'tier-advancement',       0.04, 'assumption',
   'game-ops default: tier-advancement ARPU sustain prior +4 pp'),

  -- Morale boost: rank recovery after slump outreach
  ('cfm_vn', 'rank-slump',    'morale-boost',           0.07, 'assumption',
   'game-ops default: rank-slump morale-boost recovery prior +7 pp'),

  -- Social reconnect: guild-leavers stay active after reconnect
  ('cfm_vn', 'guild-leaver',  'social-reconnect',       0.05, 'assumption',
   'game-ops default: social-reconnect retention prior +5 pp'),

  -- Gacha goodwill: continued play after pity compensation
  ('cfm_vn', 'gacha-bad-luck','gacha-goodwill',         0.09, 'assumption',
   'game-ops default: gacha-goodwill continued-play prior +9 pp'),

  -- jus_vn seeds (conservative cross-game benchmarks)
  ('jus_vn',  'churn-risk',   'win-back',               0.05, 'benchmark',
   'cross-game benchmark from cfm_vn win-back prior (adjusted -1 pp for game diff)'),

  ('jus_vn',  'spend-drop',   'spend-drop-recovery',    0.06, 'benchmark',
   'cross-game benchmark from cfm_vn spend-drop recovery prior (adjusted -2 pp)');
