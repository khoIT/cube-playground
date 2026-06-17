# Phase 04 — Tests

## Overview
- Priority: P0
- Status: pending
- Cover the deterministic seams; note the one non-deterministic gap (agent
  actually calling the tool) as a manual smoke.

## Backend (chat-service, vitest)
- `offer-choices` tool unit test:
  - valid payload (3 options) → emits one `disambig_options` frame via a fake
    `sseEmitter`; `slot==='choice'`; pinText preserved; returns `{emitted:true,count:3}`.
  - `options.length < 2` and `> 6` → zod rejects.
  - no `sseEmitter` (cache replay) → `{emitted:false}`, no throw.
- Registry test: `offer_choices` present in the registry snapshot/list.
- Prompt snapshot tests updated for the Phase 02 instruction block.

## Frontend (vitest + RTL)
- assistant-message precedence test:
  - `disambigOptions` with `slot:'choice'`, 3 options + `showFollowups=true`
    → `disambig-chips` present, `FollowupChips` NOT rendered.
  - no `disambigOptions` + `showFollowups` → followups render (unchanged).
- DisambigChips slot test: `slot:'choice'` renders pills; clicking calls
  `onPick(pinText)` (extend existing disambig-chips test if present).

## Verification gate (the user's "make sure it works")
The reliable agent emission is non-deterministic (LLM). Unit tests prove the
plumbing; reliability is verified by a **manual live smoke** on the OAuth+Cube
lane (NOT CI):
1. Ask ballistar: "Give me a prioritized list of top VIP players …" (the
   screenshot prompt) — the turn that asks "which metric to rank by?".
2. Expect: choice chips (Revenue / LTV / ARPU / ARPDAU / First purchase rate),
   NO generic followups.
3. Click "Revenue" → next turn auto-sends the resolving pinText → leaderboard
   artifact emitted (no re-clarification).
Record outcome in the plan; add a prompt-eval entry if the agent under/over-calls.

## Success criteria
- All new + existing unit tests green (backend + FE).
- `tsc` clean both packages.
- Manual smoke: chips appear, followups suppressed, click resolves cleanly.

## Open questions
- Should we add a lightweight prompt-eval (like the advisor experiment-quality
  eval) asserting `offer_choices` fires on a fixed clarify prompt? Deferred
  unless reliability proves flaky in the manual smoke.
