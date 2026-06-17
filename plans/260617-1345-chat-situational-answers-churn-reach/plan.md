# Plan — Situational chat answers (real numbers + structured tokens) & churn reach

Status: Task 4 DONE; Task 5 step1/step2 VERIFIED; Task 5 step3 (rollup) DEFERRED.
Owner: khoitn. Created 2026-06-17. Last updated 2026-06-17.

## Progress
- **Task 4 — DONE** (explore/SKILL.md orient→measure→suggest branch; mode-prompts.ts
  FIELD_CHIP table-cell rule + negative example; snapshots regenerated). Tests 1199/1199
  green, typecheck clean. Live re-ask smoke pending a chat-service restart (deferred,
  same posture as the smart-asking N-run smoke).
- **Task 5 step 1 — VERIFIED.** `retention.churned_d30` + `retention.cohort_size` resolve
  live on cfm_vn AND jus_vn (dev cube :4000 — the instance chat-service targets). No model
  gap. Note: the 5-day serving instance :17001 is stale (lacks churned_d30) — needs a
  restart to pick up the model; ops action, not a code gap.
- **Task 5 step 2 — VERIFIED (reach).** churn_rate is certified, required_cubes:[retention]
  present on both games → not availability-gated; reachable via list_business_metrics.
  No churn topic in the knowledge bank (topics = liveops/user_acquisition/monetization);
  reach is via list_business_metrics + the new Task-4 measure requirement, not topic-knowledge.
- **Task 5 step 3 — DEFERRED.** Retention pre-agg rollup is a separate high-risk build/verify
  loop (cubestore future-seal/log_date pitfalls). To be authored as a follow-up.

## Origin
Chat answer to "what should I know about churn users situation" returned a **qualitative
metric dictionary** (metric/why-it-matters table + prose "Verified Questions You Can Ask
Now") with zero real numbers, no chart, and metric refs as plain inline-code (not chips).

Tasks 1/2/3a already shipped (commit 4fe02236: rail alignment, live-tick timestamps,
glossary-chip dedup). The previously-scoped FE items (3b clickable verified-questions,
3c clickable metric refs) are **NOT separate FE work** — the FE already renders
`{{field:…}}` chips and `offer_choices`. Both collapse into Task 4 (agent must *emit* the
structure). See findings below.

## Key findings (scouted, file:line)
- Orientation route is the root cause: `chat-service/.claude/skills/explore/SKILL.md:49-51`
  sends "what should I know about X" → `get_topic_knowledge` → knowledge-bank answer that
  stops before querying. That's why no numbers/chart.
- Chart emission already supported: `chat-service/.claude/commands/cube-playground.md:22`
  ("prefer attaching a chart on emit_query_artifact"), `emit-query-artifact.ts:81-225`,
  chart-type rules `explore/SKILL.md:115-141`.
- Field tokens already instructed: `mode-prompts.ts:186-199` (FIELD_CHIP_TOKEN_GUIDANCE) +
  applied in `smart-defaults.ts:59`. FE renders them (assistant-message.tsx / field-chip.tsx).
  → table cells showing raw `active_daily.dau` = adherence gap, not missing mechanism.
- Structured follow-ups already supported: `offer-choices.ts` (label + verbatim pinText),
  rendered as clickable chips. → "Verified Questions" prose should be offer_choices.
- Retention/churn already MODELED: `cube-dev/cube/model/cubes/cfm/retention.yml:49-80`
  (retained_d1..d30, churned_d30), `new_user_retention.yml` (rnru_*), and CERTIFIED
  `server/src/presets/business-metrics/churn_rate.yml` (= retention.churned_d30/cohort_size).
  yml note flags: no pre-aggs, cold ~14s; "refs resolve vs cfm_vn /meta after churned_d30
  added" — needs live verification.

## Coordination — build ON TOP of the smart-asking rework (it's DONE)
`plans/260617-1057-agent-model-awareness-smart-asking/` is a COMPLETED 7-phase agent
rework (all phases ✅ 2026-06-17; only live N-run smoke deferred): model-graph digest
injected every turn, resolved-context continuity, smart defaults, toggle→posture, engine
routing. It is being rolled out / committed, not actively redesigned.

Implication for Task 4 (same files: `mode-prompts.ts`, `offer-choices.ts`,
`smart-defaults.ts`): LAYER ON TOP, don't wait. Reuse its primitives — the `offer_choices`
correction chips (P04) for the clickable next-steps (absorbs 3b), and its glossary-resolved
revenue/metric default for choosing what to chart. Task 4 gets smaller. Still: rebase onto
its committed state and confirm those files aren't mid-commit before editing.

---

## Task 4 — Situational answers: orient → measure → suggest
Goal: orientation/"situation" questions return real headline numbers + a trend chart +
clickable next-steps, with metric refs as field chips. No qualitative-only dead ends.

Steps (all in `chat-service/`, pending coordination):
1. Amend `explore/SKILL.md` situational branch: after `get_topic_knowledge`, REQUIRE 1–2
   `emit_query_artifact` calls for the headline metrics (e.g. trailing WAU/MAU trend,
   D30 churn_rate) WITH a `chart` (time→line). Knowledge orients; numbers answer.
2. Replace prose "Questions you can ask" with a terminal `offer_choices` (2–6 options,
   pinText = the runnable question). Removes the dead-text list; chips already render.
3. Strengthen field-token adherence: explicit rule that metric refs INSIDE tables/lists
   also use `{{field:cube.member}}` (covers 3c). Add a negative example (raw `cube.member`
   in a table cell = wrong).
4. Verify against the live thread shape (re-ask the churn question) — expect: short
   orientation, ≥1 chart with real values, field chips in the table, offer_choices row.

Acceptance: re-running the churn question yields numbers + ≥1 chart + clickable choices +
chipped metric refs; no plain-code metric names; answer is not knowledge-bank-only.
Risk: prompt change can regress other skills — gate with the existing chat smoke tests.

## Task 5 — Churn/retention reach + performance
Goal: agent reliably reaches the existing churn/retention measures, and they're fast.

Steps:
1. VERIFY (cheap, do first): query cfm_vn /meta — confirm `retention.churned_d30`,
   `retention.cohort_size`, and `churn_rate` business-metric refs resolve live. If the
   churned_d30 measure isn't present in the deployed model, that's the one real model gap.
2. Reach: ensure the churn topic-knowledge entry points the agent at `churn_rate` +
   `retention` cube (so Task 4 step 1 has a target). Check availability-gating doesn't hide
   the retention cube for cfm_vn/jus_vn.
3. Performance: retention/churn measures have no pre-aggs (cold ~14s). Author a cohort
   rollup for `retention` (and `new_user_retention`) so churn answers are interactive.
   Follows the cube rollup authoring rules (time-dim must match query; additive only;
   verify by compiled SQL). Ties into carried pre-agg work.

Acceptance: churn_rate resolves on cfm_vn + jus_vn /meta; a churn query served from a
pre-agg (assert usedPreAggregations) under a few seconds; agent picks churn_rate
unprompted for churn questions.
Risk: rollup may not seal (known cubestore future-seal/log_date pitfalls — see
docs/lessons-learned.md); budget a build/verify loop.

---

## Sequencing
Task 5 step 1 (verify) is the cheapest and unblocks Task 4 step 1 (needs a real target).
Then Task 4 (after concurrent chat-service rollout lands) → Task 5 perf rollup last.

## Unresolved questions
1. The smart-asking rework is done — just confirm its `chat-service/` edits are committed
   (not mid-commit) before Task 4 rebases onto them.
2. Is `churned_d30` actually in the deployed cfm_vn model now, or still pending (yml note is
   ambiguous)? Task 5 step 1 settles this.
3. Should the orientation→measure pattern be explore-skill-only, or also diagnose/compare?
