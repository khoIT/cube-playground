-- Enrich the advisor run-audit tables so a stalled/timed-out investigation is
-- debuggable at a glance, without re-reading raw tool output digests.
--
-- Three additions, each motivated by a real blind spot seen in a timed-out run:
--   1. Auth lane / token source on the run — the agent runs only on the Claude
--      subscription OAuth lane, where cost is always $0 (flat-rate). Recording
--      the lane makes a $0.00 run read as "subscription", not "free".
--   2. Token usage on run (cumulative) and turn (per-turn) — since cost is $0 on
--      the subscription lane, tokens are the only real spend/optimization signal.
--   3. Embedded-error flag on tool calls — a tool can return state='ok' while its
--      payload carries a Cube/HTTP error (e.g. a 400 inside a diagnose lens). The
--      flag surfaces that semantic failure that the ok/failed state alone hides.

-- ── advisor_agent_run: auth lane + cumulative token usage ───────────────────
ALTER TABLE advisor_agent_run ADD COLUMN auth_lane             TEXT;     -- 'subscription' (only lane today)
ALTER TABLE advisor_agent_run ADD COLUMN auth_source           TEXT;     -- env var that carried the token
ALTER TABLE advisor_agent_run ADD COLUMN input_tokens          INTEGER;  -- cumulative across turns
ALTER TABLE advisor_agent_run ADD COLUMN output_tokens         INTEGER;
ALTER TABLE advisor_agent_run ADD COLUMN cache_read_tokens     INTEGER;
ALTER TABLE advisor_agent_run ADD COLUMN cache_creation_tokens INTEGER;

-- ── advisor_agent_turn: per-turn token usage ────────────────────────────────
ALTER TABLE advisor_agent_turn ADD COLUMN input_tokens          INTEGER;
ALTER TABLE advisor_agent_turn ADD COLUMN output_tokens         INTEGER;
ALTER TABLE advisor_agent_turn ADD COLUMN cache_read_tokens     INTEGER;
ALTER TABLE advisor_agent_turn ADD COLUMN cache_creation_tokens INTEGER;

-- ── advisor_tool_call: semantic (embedded) error masked by an ok state ──────
ALTER TABLE advisor_tool_call ADD COLUMN embedded_error         INTEGER NOT NULL DEFAULT 0; -- 0/1
ALTER TABLE advisor_tool_call ADD COLUMN embedded_error_message TEXT;
