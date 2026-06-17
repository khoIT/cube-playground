# Persist & rehydrate choice chips — implementation report

Date: 2026-06-17 (GMT+7). Scope: fix the two issues reported against the
turn-ending choice-chip feature.

## Findings (both verified before fixing)
- **F1 — chips were live-only.** `disambig_options` is an ephemeral SSE event;
  the persisted turn row had no field for it and reload
  (`sessionTurnsToMessages`) never rebuilt it. On reload chips vanished, the
  prose that referenced them dangled, and the generic followup row reappeared
  (the `!disambigOptions` suppression gate flipped). Sessions `fb656043` /
  `8368fb34`.
- **F2 — agent narrated recovery choices in prose.** Session `a431592a` turn 3:
  unresolvable metric → prose "switch to Revenue or LTV?" with empty
  `tool_calls_json`. Guidance only illustrated the affirmative case, not the
  recovery (unresolvable → pick a verified alternative) case.

## Changes
Backend (chat-service):
- `db/migrate.ts` — idempotent `ALTER TABLE chat_turns ADD COLUMN disambig_json`.
- `types.ts` — `ChatTurnRow.disambig_json`; new exported `DisambigOptionsData`.
- `db/chat-store.ts` — `AppendTurnParams.disambigJson` + INSERT bind.
- `api/turn.ts` — capture last `disambig_options` frame → persist on the row.
- `api/sessions.ts` — `rowToTurn` serves `disambig`; `TurnDto.disambig`.
- `core/mode-prompts.ts` — `OFFER_CHOICES_GUIDANCE` now covers the recovery case
  and requires each recovery pinText to re-issue the FULL original request with
  only the unresolved value substituted.

Frontend:
- `hooks/use-chat-session.ts` — `ChatTurn.disambig`.
- `chat-thread-page.tsx` — `sessionTurnsToMessages` restores `disambigOptions`
  and infers `disambigSelectedPinText` by matching the next user turn's text to
  an option's pinText (no extra storage). Exported for unit test.
- `components/chat-message-list.tsx` / `assistant-message.tsx` — thread
  `disambigSelectedPinText` to `DisambigChips`.
- `components/disambig-chips.tsx` — selected chip renders filled (`--selected`
  class for choice slot, brand-tint for engine slots) + ✓, `aria-pressed`, and
  stays clickable (re-pick = like-live, per user decision).

## Tests — 74 green
- chat-store: disambig_json round-trip + NULL-when-absent.
- session-turns-disambig-rehydrate: restore + selected-pin match + negatives.
- chip-suppression: selected-highlight + re-clickable.
- mode-prompts snapshot regenerated; offer-choices, turn-flow, session-manager pass.

## Live verification (ballistar, session 6e1a6749)
- Live 4 chips → reload 4 chips persist (slot=choice, 0 followup rows).
- Pick + reload → 1 ✓-highlighted chip = picked label, others soft, all clickable.
- Unresolvable-metric prompt → 4 choice chips (was prose). slot=choice.
- Screenshots in plan dir: reload-chips-persist / reload-selected-highlight /
  recovery-metric-chips.

## Unresolved questions
- Old sessions (pre-change) have NULL disambig_json and cannot be backfilled —
  only post-change turns carry chips on reload. Acceptable? (No data exists to
  reconstruct.)
- Recovery-choice reliability (F2) rests on prompt guidance, not a deterministic
  gate. Live ran 1/1 here; a multi-run check could confirm reliability like the
  earlier offer_choices smoke. Worth it?
