# Phase 03 — Smart-default / ask-frugal policy

## Overview
Priority: P2 (after P01+P02). Status: ☐. Codify "default + state + offer
correction": when a slot is unresolved but a sensible default exists, answer
with the default, state the assumption, attach a one-click change chip — instead
of blocking with a question.

## Key insights
- User decision: default + state-assumption + offer correction; block-ask only
  for high-impact ambiguity (grain that changes the answer).
- The deterministic engine already auto-runs in aggressive mode above threshold;
  what's missing is (a) explicit defaults for empty slots, (b) surfacing the
  assumption + correction chip rather than silent resolution.

## Requirements
- Functional: a default policy (metric → game primary monetization measure /
  Revenue; timeRange → last 30 days; entity → inferred from nouns, see P05 grain).
  Agent proceeds with defaults, states them, and emits a correction `offer_choices`
  chip set. High-impact ambiguity (entity grain undetermined) still asks first.
- Non-functional: behind `agentSmartDefaultsEnabled`; defaults are per-game data,
  not hardcoded English strings.

## Architecture
- `chat-service/src/core/smart-defaults.ts`:
  - `resolveDefaults(game, slots, digest): { applied: AppliedDefault[], mustAsk: SlotKey[] }`.
  - `mustAsk` = slots where no safe default exists AND the choice changes the answer
    materially (the "high-impact" gate).
- Guidance in `mode-prompts.ts`: when defaults are applied, the reply must (1) state
  each assumption in one line, (2) end with a correction chip set via `offer_choices`
  whose pinText re-issues the request with the alternative value.
- "High-impact" classifier: entity grain (individual vs group) is high-impact;
  metric/time are low-impact (safe to default). Encode as a small table, not vibes.

## Related code files
- Read: `chat-service/src/nl-to-query/clarification-builder.ts`, `mode-gate.ts`,
  `chat-service/src/core/starter-question-templates.ts` (for per-game primary measure).
- Create: `chat-service/src/core/smart-defaults.ts` + test.
- Modify: `mode-prompts.ts` (guidance), `turn.ts` (pass applied-defaults context).

## Implementation steps
1. Define the default table + high-impact classifier; unit-test per slot.
2. Per-game primary monetization measure lookup (reuse glossary/starter templates).
3. Guidance: state-assumption + correction-chip pattern; snapshot.
4. Wire applied-defaults into the prompt so the agent knows what was defaulted.
5. Test: low-impact slot → defaulted + stated + chip present; high-impact → asked.

## Todo
- [ ] Default table + high-impact classifier + tests
- [ ] Per-game primary measure resolver
- [ ] Guidance (state + correct) + snapshot
- [ ] turn.ts wiring
- [ ] Behavior tests (default vs ask)

## Success criteria
- "Top VIP players" answers with Revenue + last-30d stated as assumptions + a change chip,
  no blocking question; ambiguous-grain prompts still ask once.

## Risks
- Defaulting hides a wrong assumption → always STATE it + always attach correction chip (never silent).
- Per-game primary measure missing → fall back to Revenue; if absent, that slot becomes `mustAsk`.

## Decisions
- Q-C SETTLED: metric default = the game's **Revenue measure resolved via the glossary concept**
  (not a hardcoded member — `revenue_vnd_real` on cfm differs from the jus equivalent). If a game
  has no resolvable revenue measure, that slot becomes `mustAsk` (never silently wrong). No
  "primary monetization" heuristic beyond revenue (YAGNI).
