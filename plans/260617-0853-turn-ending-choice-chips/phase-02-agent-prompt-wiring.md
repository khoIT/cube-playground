# Phase 02 — Agent prompt wiring + pinText contract

## Overview
- Priority: P0 (the feature is only as reliable as the agent calling the tool)
- Status: pending
- Instruct the agent to call `offer_choices` as its final action whenever it
  ends a turn asking the user to choose, with a strict pinText contract.

## Key insight
The whole value ("pre-generated to help the agent gain the best understanding")
lives in the prompt: each option's pinText must encode the RESOLUTION, not the
label. Label `Revenue` → pinText `Rank the top VIP players by Revenue (total
recharge/spend over the last 7 days)`. When clicked + auto-sent, the next turn's
`disambiguate_query` resolves cleanly with no re-clarification.

## Requirements
- Find where tool-usage guidance is composed: `chat-service/src/core/mode-prompts.ts`
  and the loaded skill bodies under `chat-service/.claude/skills/*/SKILL.md`
  (skill-loader.ts). Add the instruction in the most-global place so it applies
  to all modes.
- Instruction content (concise):
  - WHEN: your reply ends by asking the user to choose among 2–6 discrete,
    enumerable answers (a clarifying question), OR you presented a numbered list
    of candidate options and need the user to pick one.
  - DO: call `offer_choices` as the FINAL action of the turn. Do NOT also list
    the same options as prose chips expectations — the UI renders them.
  - pinText rule: self-contained, imperative, includes the chosen value AND the
    intent it resolves; safe to run as a standalone next message.
  - Don't call it for open-ended questions with no enumerable answer set.
- Verify the snapshot tests (`test/mode-prompts*.snapshot.test.ts`) — update
  snapshots intentionally.

## Files
- Modify: `chat-service/src/core/mode-prompts.ts` (or the global skill body)
- Possibly modify: a `chat-service/.claude/skills/*/SKILL.md`
- Update: `chat-service/test/__snapshots__/mode-prompts*.snap` (intentional)

## Steps
1. Read `mode-prompts.ts` + skill-loader.ts to find the global instruction seam.
2. Add the `offer_choices` usage block + one few-shot pinText example.
3. Re-run + update prompt snapshots; confirm diff is only the new block.

## Success criteria
- Prompt snapshots updated and reviewed.
- Manual smoke (Phase 04 live note): a clarifying turn ("which metric to rank
  by?") ends with an `offer_choices` call whose pinText fully resolves.

## Risk
- Agent over-calls (offers choices on open-ended turns) → tighten WHEN wording;
  the 2–6 enumerable constraint + zod min(2) guards the degenerate cases.
- Agent under-calls (forgets) → acceptable: falls back to generic followups.
  Client fallback was explicitly out of scope.
