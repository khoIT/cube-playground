# Persist & rehydrate choice chips + fix prose-instead-of-tool gap

## Problem (2 verified findings)

**F1 — Choice chips are live-only; reload loses them.** `offer_choices` /
`disambiguate_query` emit `disambig_options` over SSE only. The persisted turn row
(`chat-store.ts` `AppendTurnParams`) has no field for it, and reload
(`sessionTurnsToMessages`, `chat-thread-page.tsx:57-91`) never reconstructs it. On
reload `disambigOptions` is undefined → (a) brand chips vanish, (b) the
`!hasExplicitOptions` gate flips so generic followup chips reappear, (c) the
persisted prose ("the four chips above…") dangles. Verified: session
`fb656043` / `8368fb34` screenshots.

**F2 — Agent narrates recovery choices in prose instead of calling the tool.**
Session `a431592a` turn 3: metric unresolvable → assistant wrote *"switching to
Revenue or LTV — pick a different metric?"* with **empty `tool_calls_json`**. The
resolver already returns structured `alternatives` (`metric-resolver.ts`), but
`OFFER_CHOICES_GUIDANCE` only illustrates the affirmative "which metric to rank by"
case, not the **recovery** ("X unresolvable → pick a verified alternative") case.

## Decisions (user-confirmed)
- Reloaded choice set: **highlight the picked option + keep all chips re-clickable**
  (like-live). Picked option detected by matching the next user turn's text to an
  option's `pinText` — no extra column needed.
- F2 fix = tighten guidance (KISS); resolver already hands alternatives to the agent.

## Phases
- **P1 — Persist** (BE): `disambig_json` column (idempotent ALTER + schema.sql);
  `AppendTurnParams.disambigJson`; INSERT bind; capture `lastDisambig` in `turn.ts`
  SSE handler → pass to both `appendTurn` calls (635, 788).
- **P2 — Serve** (BE): `rowToTurn` (`sessions.ts`) emits `disambig`; `TurnDto` +
  FE `ChatTurn` (`use-chat-session.ts`) gain `disambig?`.
- **P3 — Rehydrate + highlight** (FE): `sessionTurnsToMessages` sets
  `disambigOptions` from `t.disambig` + computes `selectedPinText` from next user
  turn; `disambig-chips.tsx` renders selected chip solid/checked but clickable;
  thread `selectedPinText` through `assistant-message.tsx` / `chat-message-list.tsx`.
- **P4 — Guidance** (BE prompt): extend `OFFER_CHOICES_GUIDANCE` with the recovery
  case + "pinText re-issues the FULL original request with the substituted value";
  update mode-prompts snapshot.
- **P5 — Tests + live verify**: chat-store roundtrip; rehydrate+selected unit;
  chip selected styling; live reload smoke (chips persist, no dangling prose, no
  generic followups) + unresolvable-metric turn now renders chips.

## Status — DONE (live-verified 2026-06-17)
- [x] P1 Persist  - [x] P2 Serve  - [x] P3 Rehydrate+highlight  - [x] P4 Guidance  - [x] P5 Tests+verify

Live smoke (ballistar, session 6e1a6749): live 4 chips → reload 4 chips persist
(slot=choice, 0 followup rows) → pick+reload = 1 ✓-highlighted chip, rest soft,
all re-clickable → unresolvable-metric prompt now renders 4 choice chips (was
prose). Screenshots: reload-chips-persist.png / reload-selected-highlight.png /
recovery-metric-chips.png. 74 unit tests green.

NOTE: sessions persisted before this change (the screenshots you flagged) have
NULL disambig_json — they can't be backfilled; only turns created after the
change carry chips on reload.
