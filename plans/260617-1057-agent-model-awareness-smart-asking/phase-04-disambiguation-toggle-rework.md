# Phase 04 — Make the disambiguation toggle govern the agent

## Overview
Priority: P2 (after P03). Status: ☐. The "Aggressive / Targeted Ask" toggle
currently only drives the deterministic engine gate; the agent never sees it.
Make it govern the agent's asking posture — or retire it if it can't carry weight.

## Key insights (verified)
- FE toggle → `body.mode` → `turn.ts:404` `ctx.disambiguationMode` → consumed
  ONLY in `disambiguate-query.ts:106` → `mode-gate.ts`. `mode-prompts.ts` has no
  mode reference. So on free-form agent turns the toggle is a no-op.
- After P03 there's a real posture to bind it to: aggressive = default-and-proceed;
  targeted = ask one focused question even when a default exists.

## Requirements
- Functional: inject the posture into the agent prompt; `aggressive` → P03
  default+state+correct; `targeted` → ask one focused clarifying question first.
- Decision: keep + relabel the toggle to its real effect, or retire it. Default
  recommendation: KEEP, relabel, make it gate BOTH engine + agent posture.
- Non-functional: behind `agentModeGovernsPosture`; default mode unchanged for
  existing users unless user decides otherwise.

## Architecture
- `mode-prompts.ts` `compose()` gains a `posture` part keyed on `disambiguationMode`:
  - aggressive: "Prefer answering with sensible defaults; state assumptions + offer correction. Ask only on high-impact ambiguity."
  - targeted: "When any slot is ambiguous, ask exactly one focused question (via offer_choices) before answering."
- `turn.ts` passes `disambiguationMode` into `compose()` (today it only reaches the engine).
- FE: relabel in `i18n` + `chat-mode-popover` / `chat-preferences-section` to describe
  the real effect ("Auto-answer with assumptions" vs "Confirm before answering").
- Telemetry: log mode per turn + whether a clarification was asked, to prove the
  toggle now changes behavior (feeds P06).

## Related code files
- Read: `src/pages/Settings/use-chat-disambiguation-mode.ts`, `src/shell/chat-overlay/chat-mode-popover.tsx`,
  `src/i18n/locales/{en,vi}.json`, `chat-service/src/nl-to-query/mode-gate.ts`.
- Modify: `mode-prompts.ts`, `turn.ts`, FE popover + settings + i18n.

## Implementation steps
1. Add posture text to `compose()` behind flag; snapshot both modes.
2. Pass `disambiguationMode` from `turn.ts` to `compose()`.
3. Relabel FE strings (pending user decision Q-B); keep keys stable.
4. Add per-turn telemetry: mode + askedClarification(bool).
5. Test: same ambiguous prompt → aggressive answers w/ assumption, targeted asks.

## Todo
- [x] Posture injection (both modes) behind `agentModeGovernsPosture` + tests
- [x] turn.ts passes `body.mode` (default aggressive when flag on) to compose
- [x] FE relabel + i18n (en/vi): "Auto-answer with assumptions" / "Confirm before answering"; storage key stable
- [x] Per-turn mode telemetry (profiling-gated log: mode + askedClarification + which flags on)
- [x] Differential behavior test (`mode-prompts-posture-defaults.test.ts`: aggressive vs targeted block)

## Done (2026-06-17)
Posture is now in the agent prompt (was engine-only). FE default flipped to **Aggressive**
(`use-chat-disambiguation-mode.ts`) per Q-B — storage key unchanged so existing users keep
their pick; only first-time users get the new default. This default flip is the one change
NOT behind a server flag (it's a FE pref); called out in P07 rollout. No test asserted the old
default, so the flip is safe.

## Success criteria
- Toggling Aggressive↔Targeted produces measurably different asking behavior on the same prompt (logged in P06).

## Risks
- Relabel churns muscle memory → only relabel if user confirms (Q-B); behavior wiring is the real win regardless.

## Decisions
- Q-B SETTLED: KEEP + relabel + wire to agent posture; default = **Aggressive** (auto-answer with
  assumptions). Relabel FE strings to the real effect ("Auto-answer with assumptions" vs "Confirm
  before answering"); keep storage keys stable so existing prefs don't break. Changing the default
  to aggressive is a behavior change for existing users → call out in P07 rollout + telemetry.
