# Phase 02 — Resolved-context injection + continuity enforcement

## Overview
Priority: P1 (parallel with P01). Status: ☐. Show the agent what's already
been resolved this session (entity/identity, metric, time) so it stops
re-asking, and enforce that those only change on a genuine rephrase.

## Key insights
- Slot memory + the rephrase gate ALREADY exist (`disambiguate-memory-merge.ts`:
  entity persists at 0.95; `blockTopicFill = hasSubstantialUnresolvedText` flips
  topic slots only on substantial new text). The agent path just never reads it.
- The flagged convo re-asked "rank by which entity?" after "top VIP players"
  already implied user grain — pure continuity miss.

## Requirements
- Functional: at turn start, read locked slots from memory → render a
  "Resolved so far" block into the agent prompt; instruct: do not re-ask these
  unless the user rephrases.
- Non-functional: behind `agentResolvedContextEnabled`; no write-path change
  (reuse existing memory writes).

## Architecture
- `chat-service/src/core/resolved-context.ts`:
  - `readResolvedContext(db, sessionId, now): ResolvedContext` (reuse `getResolutions`).
  - `renderResolvedContext(ctx): string` →
    `Resolved so far (do not re-ask unless the user rephrases): entity = user (mf_users.user_id); metric = revenue; window = last 30 days.`
- `compose()` gains a `resolvedContext` part (after model digest).
- Continuity enforcement: confirm the agent-path turn writes resolved slots to
  memory even when resolution came from `offer_choices` pinText (today only the
  deterministic `disambiguate_query` writes). If not, route the resolved values
  back through `writeMemoryFromResult` so the next turn's injected block is correct.

## Related code files
- Read: `chat-service/src/tools/disambiguate-memory-merge.ts`, `chat-service/src/cache/disambig-memory-adapter.ts`,
  `chat-service/src/api/turn.ts`.
- Create: `chat-service/src/core/resolved-context.ts` + test.
- Modify: `mode-prompts.ts` (compose part), `turn.ts` (read+pass; ensure write-back).

## Implementation steps
1. `readResolvedContext` over memory; unit-test empty / partial / full.
2. `renderResolvedContext` terse text; snapshot.
3. Inject into `compose()` behind flag; snapshot.
4. Audit the agent path: does a chip-driven turn persist entity/metric to memory?
   If gap, write resolved slots after a successful agent turn (reuse write path).
5. Test: locked entity not re-asked next turn; rephrase (`hasSubstantialUnresolvedText`) clears it.

## Todo
- [ ] `readResolvedContext` + tests
- [ ] `renderResolvedContext` + snapshot
- [ ] compose injection behind flag
- [ ] Close agent-path write-back gap (if present)
- [ ] Continuity tests: keep-until-rephrase

## Success criteria
- Within a session, entity/metric/time resolved once are never re-asked unless the user rephrases;
  injected block matches memory state.

## Risks
- Injecting a stale lock the user already moved past → rely on the SAME rephrase gate the engine uses; don't invent a second policy.
- Double source of truth (agent vs engine memory) → single store, single write path.

## Open questions
- Should the injected block also list what is NOT yet resolved (to steer the one question worth asking)? Lean yes — cheap.
