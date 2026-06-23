# Phase 02 — Segment-without-metric → deterministic default metric

**Priority:** high (11 of 33 cases: 9 personas + 2 segment-mom).
**Status:** not started. **Scope:** chat-service NL resolver. No cube change.
**Games:** applies to all 8 — verified (2026-06-23) `payer_tier` (whale/dolphin/
minnow) exists in all 8 (mf_users + active_daily) and `revenue_vnd` exists in all 8.
So both the persona→filter binding and the money-cue Revenue default resolve on
every game. `smart-defaults.ts` already resolves the default metric per game from
that game's glossary — keep it glossary-driven, never hardcode cfm's `revenue_vnd_real`.

## Problem
A question that is **segment + time with no metric** ("show Minnow last 7 days",
"Whale this month", "compare Dolphin month over month", "compare Dormant user mom",
"compare Spender mom") binds the segment filter correctly
(`mf_users.payer_tier = minnow` via `classifyTerm`→'filter' + `defaultFilter`,
slot-extractor.ts:115) but leaves the **metric slot empty**. query-composer can't
emit a measure, so the agent clarifies ("Which metric should I show for Minnow
players?") → no artifact.

The Revenue default in `smart-defaults.ts:59` is **agent-prompt text only**, not
composer logic — so it doesn't reliably fire when a segment is present.

## Approach
Make the default deterministic in the composer: when slots have a **filter
and/or time range but no resolved metric**, fill the metric from a default
rather than emitting an empty-metric clarify.

Default choice (LOCKED, user 2026-06-23):
- bare segment+time → **active-user count** (population).
- switch to **Revenue** only when the message carries a money cue
  (spend / revenue / ARPU / paid / VND …).
- Implement as: detect money cue in the message; pick Revenue member if present,
  else active-user-count member. Both resolved from smart-defaults, not prompt text.

Keep the agent-prompt default as a backstop, but the composer default is what the
eval and tests assert against.

## Files
- `src/nl-to-query/query-composer.ts` — when `!slots.metric` but `slots.filter`
  or `slots.timeRange` present, apply default metric (resolve via smart-defaults
  member, not prompt text).
- `src/core/smart-defaults.ts` — expose the resolved default-metric **member**
  (Revenue ref / active-user ref) for the composer, not just prompt copy.
- `src/nl-to-query/term-classifier.ts` — re-confirm persona category normalises
  to 'filter' (the `/s$/` strip at line ~16); add a test so a 'segment'/'segments'
  category mismatch can't silently re-leak into the metric slot.
- (verify) `src/nl-to-query/clarification-builder.ts` — don't clarify "which
  metric" once a default applies.

## Steps
1. Reproduce: replay "show Minnow last 7 days" + "compare Spender mom"; confirm
   filter binds, metric empty, clarify fires.
2. Expose default-metric member from smart-defaults (active-user count + Revenue).
3. Composer: insert default-metric when metric empty AND (filter or time) present.
4. Guard: only default when a segment/filter or time anchors intent — never turn
   a truly empty/garbage message into a defaulted query.
5. Tests: each of the 11 phrases → composed query with default measure + segment
   filter (+ mom granularity for the compare cases).

## Success criteria
- The 9 persona + 2 segment-mom cases emit an artifact with the segment filter
  applied and a sensible default measure.
- "compare … month over month" cases also carry month granularity + prior-period
  comparison (these are the mom paths that DO work for ARPPU/ARPU/DAU — match that
  behavior).
- No regression: a metric-bearing question is unaffected; a contentless message
  still clarifies.

## Risks
- Over-defaulting: applying a metric to a message that genuinely needs clarify.
  Gate strictly on "segment/filter or explicit time present".
- Default-metric choice is a product call — wrong default answers the wrong
  question (money vs population). Resolve open-question 1 first.

## Todo
- [ ] confirm persona→filter classification + add mismatch test
- [ ] expose default-metric member from smart-defaults
- [ ] composer default-metric injection (gated)
- [ ] tests for 11 phrases (incl. mom granularity)
- [ ] live re-run of the 11 cases → artifacts emitted
