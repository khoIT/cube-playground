# Phase 01 — Server-side model-graph digest + injection

## Overview
Priority: P1. Status: ☐. Give the agent a compact, per-game map of the data
model so it stops guessing where metrics live and stops over-fetching `/meta`.

## Key insights
- The graph the user drew (USER HUB + clusters + isolated lints) is already
  computed by `build-join-graph.ts` — pure TS, FE-only today. Reuse it server-side.
- The agent's `get_cube_meta` degrades to a name index on big games and is
  pull-based — the agent often never sees joins. A pushed digest fixes triage.
- Token budget matters: digest must be ~15–30 lines, not the full /meta.

## Requirements
- Functional: build `ModelGraphDigest` from cached /meta; serialize to a terse
  text block; inject into the agent system prompt for the active game.
- Non-functional: digest cached per game, invalidated with the meta cache;
  injection adds < ~400 tokens; behind `agentModelDigestEnabled`.

## Architecture
- `chat-service/src/core/model-graph-digest.ts`:
  - `buildDigest(metaCubes): ModelGraphDigest` — call shared `build-join-graph`.
  - `renderDigest(digest): string` — terse lines:
    `Hub: mf_users (pk user_id). N:1 → user_recharge_daily, retention, user_devices…`
    `Isolated (no user join): game_key_metrics, marketing_cost.`
    `Clusters: recharge {…}, activity {…}, identity {…}.`
  - Memoize on the meta-cache key (game+workspace); recompute on meta refresh.
- `mode-prompts.ts` `compose()` gains an optional `modelDigest` part (after master
  body, before language). Only included when flag on and digest non-empty.
- `turn.ts` resolves the digest for the active game and passes it to `compose()`.

## Related code files
- Read: `shared/cube-model-graph/build-join-graph.ts`, `chat-service/src/core/cube-meta-cache.ts`.
- Create: `chat-service/src/core/model-graph-digest.ts` + test.
- Modify: `chat-service/src/core/mode-prompts.ts` (compose part), `chat-service/src/api/turn.ts` (resolve+pass).

## Implementation steps
1. `buildDigest` over cached meta; unit-test hub detection, N:1 cardinality, isolated lints
   against a cfm_vn-shaped fixture.
2. `renderDigest` → stable terse text; snapshot test.
3. Wire into `compose()` behind flag; snapshot the injected section.
4. Resolve digest in `turn.ts` from meta cache; memoize; invalidate on refresh.
5. Manual: enable flag, run a "which cube has revenue" style turn, confirm fewer `get_cube_meta` calls.

## Todo
- [x] `buildDigest` + unit tests (hub/cardinality/isolated) — `model-graph-digest.ts` + `test/core/model-graph-digest.test.ts`
- [x] `renderDigest` + snapshot
- [x] `compose()` injection in the cacheable prefix behind `agentModelDigestEnabled` + placement test
- [x] `turn.ts` resolve + memoize (keyed on meta-version, recomputes on schema change) + never-throws-into-turn
- [ ] Manual smoke: meta-fetch count drops (deferred — needs the flag on against a live cube; gated by P6 eval)

## Done (2026-06-17)
`getModelDigestText(game, workspace)` memoises rendered text on the meta-version
hash (recomputes only on schema change), returns '' on any error (never blocks a
turn), and is awaited in `turn.ts` ONLY when `agentModelDigestEnabled` is on. The
digest is placed right after the `## Active game` line (stable per game → lands in
the prompt-cached prefix). buildDigest output is fully sorted (deterministic; PK
fallback uses the most-common hub join column, order-independent). All flags off =
byte-identical prompt (verified by the existing mode-prompts snapshot suite staying
green). Code review: no Critical/Major.

## Success criteria
- Digest reflects the real join topology for cfm_vn/jus_vn/ballistar; injected block < 400 tokens;
  agent answers "where does metric X live" without a `get_cube_meta` round-trip.

## Risks
- Big-game digest still too large → cap to hub + clusters + isolated, drop per-edge keys.
- Stale digest after model change → tie strictly to meta-cache invalidation, never cache longer.

## Decisions
- Q-A SETTLED: inject EVERY turn. Digest is stable per game so it lands in the prompt-cached
  prefix → ~0 marginal cost within a game; rebuilds cache once on game switch. No injection-state
  tracking needed. Keep the digest in the cacheable prefix (before any per-turn-variable content).
