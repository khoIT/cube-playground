# Phase 03 — FE: widen slot, render, precedence

## Overview
- Priority: P0
- Status: pending
- Let the FE accept the generalized `choice` slot and make choices suppress the
  generic followup row.

## Key insight
FE already captures `disambig_options` into `disambigOptions` and renders
`DisambigChips`; `onDisambigPick` already auto-sends pinText as the next turn
(verify in chat-thread-page.tsx). Only two real changes: widen the `slot` type,
and add precedence.

## Requirements
1. Widen `slot` from `'metric'|'dimension'|'timeRange'` to include `'choice'`
   (a string union add — keep the existing three for the engine path):
   - `src/api/chat-sse-client.ts` `SseDisambigOptions.data.slot` (line ~140)
   - `src/pages/Chat/components/disambig-chips.tsx` `Props.slot`
   - `DisambigOptionsPayload` derives automatically (chat-stream-store-actions.ts:17).
2. Precedence: in `assistant-message.tsx` (lines 553-566), when
   `disambigOptions?.options.length > 0`, do NOT render `FollowupChips`.
   - Implement as: compute `hasChoices` and gate the followup block on
     `!hasChoices`.
3. Optional polish (open question in plan.md): if user wants more "highlighted
   action" styling for `slot==='choice'`, branch DisambigChips styling on slot
   using design tokens (`--brand-soft`/`--brand` border) — keep token-only, no
   raw hex. Default: leave as-is.

## Files
- `src/api/chat-sse-client.ts`
- `src/pages/Chat/components/disambig-chips.tsx`
- `src/pages/Chat/components/assistant-message.tsx` (precedence)
- Verify only: `src/pages/Chat/chat-thread-page.tsx` (`onDisambigPick` →
  sends pinText as next turn), `src/shell/chat-overlay/chat-panel.tsx`.

## Steps
1. Widen the slot union in the SSE client; let store/types flow.
2. Widen DisambigChips `Props.slot`.
3. Add `hasChoices` precedence gate in assistant-message.
4. `tsc` clean (root tsconfig) for touched files.

## Success criteria
- A `disambig_options` frame with `slot:'choice'` renders chips.
- When choices present, the generic followup row is hidden.
- Clicking a chip auto-sends its pinText as the next turn (unchanged behavior).
- Existing engine disambig (metric/dimension/timeRange) still renders + works.

## Security / safety
- pinText is rendered as button text + sent as user message — no HTML injection
  (React escapes; chips use text content only).
