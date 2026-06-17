# Turn-ending choice chips

Agent-driven, pre-crafted answer options that render as clickable chips when a
turn ends asking the user to choose. Chips take precedence over the generic
followup suggestions; clicking one auto-sends a self-contained instruction as
the next turn.

## Why

Today each turn ends with heuristic followup chips (`followup-suggester.ts` —
rules + fallback pool, not turn-aware). When the agent asks a clarifying
question with discrete answers (e.g. "Which metric should I rank VIP players
by?" → Revenue / LTV / ARPU / …), it does so in **prose** and emits no
structured options, so the user gets generic followups instead of the actual
choices. A structured disambig path already exists end-to-end but only fires
from the deterministic `disambiguate_query` engine for 3 fixed slots.

## Locked decisions

- **Mechanism:** agent-driven tool `offer_choices` (generalizes the existing
  `disambig_options` SSE path). Not a client-side markdown heuristic.
- **Click:** auto-send the option's `pinText` as the next turn (matches current
  disambig-chip behavior).
- **Precedence:** when choices are present, the generic followup row is hidden.
- **pinText contract:** each option's `pinText` is a self-contained next-turn
  instruction that fully resolves the uncertainty (chosen value + intent), not
  an echo of the label — this is what gives the next turn maximal clarity.

## Reuse (do NOT rebuild)

- SSE event `disambig_options` + FE store field `disambigOptions` +
  `DisambigChips` + `onDisambigPick` (already sends pinText as next turn).
- Generalize rather than parallel-plumb: widen `slot` to accept a free `choice`
  value; add the new tool that emits the same event.

## Phases

| Phase | File | Status |
|-------|------|--------|
| 01 | [Backend `offer_choices` tool + SSE](phase-01-backend-offer-choices-tool.md) | done |
| 02 | [Agent prompt wiring + pinText contract](phase-02-agent-prompt-wiring.md) | done |
| 03 | [FE: widen slot, render, precedence](phase-03-frontend-precedence-and-rendering.md) | done |
| 04 | [Tests](phase-04-tests.md) | done (unit/integration + visual); live agent smoke pending |

## Resolved decisions (this session)

- **Action chip style:** brand-soft fill + `--brand` border + `--brand-hover` ink at
  rest → solid `--brand` / `--text-on-brand` on hover/focus (scoped `.disambig-choice-chip`
  injected style). Marker `▸`, pill radius. Engine slots keep the neutral pill.
- **Glossary pill recolor scope:** chat-only. `ConceptChip` gained `tone?: 'default'|'brand'`;
  chat passes `tone="brand"` (soft brand fill + `--brand` border/ink). Catalog/builder
  stay blue (`--info-*`) — the type vocabulary is untouched elsewhere.
- **Verification:** tsc clean both packages; backend tool+snapshot tests, FE concept-chip +
  precedence/click tests all green; visual proof at `visuals/chip-color-{light,dark}.png`.
  Code review: DONE_WITH_CONCERNS (3 Low; L1 fixed, L2 dark-contrast confirmed by screenshot,
  L3 re-clickable picked chips left as-is per existing engine-disambig behavior).
- **Remaining:** live OAuth+Cube smoke on ballistar — confirm the agent actually calls
  `offer_choices` on a clarifying turn. Non-deterministic; under-calling falls back to
  followups (no dead-end).

## Key files

- `chat-service/src/tools/disambiguate-query.ts` (emission pattern to mirror)
- `chat-service/src/tools/registry.ts` (tool registration)
- `chat-service/src/core/mode-prompts.ts` + `chat-service/.claude/skills/*` (agent instructions)
- `src/api/chat-sse-client.ts` (`SseDisambigOptions`, `slot` union)
- `src/stores/chat-stream-store-actions.ts` (`DisambigOptionsPayload`)
- `src/pages/Chat/components/assistant-message.tsx` (render + precedence, lines 553-566)
- `src/pages/Chat/components/disambig-chips.tsx` (chip row)

## Out of scope

- Client-side markdown parsing fallback (rejected — pinText would be label-only).
- Changing the deterministic `disambiguate_query` engine behavior.
- Multi-select chips (single pick → single next turn).

## Open questions

- Should the choices chip row get a slightly more prominent "action" styling
  than today's disambig pills (user said "highlighted action")? Default: reuse
  current pill style; optional polish in Phase 03.
