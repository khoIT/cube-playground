# Investigation: prod-workspace chat never produces artifacts

**Date:** 2026-06-01 · **Trigger:** browser smoke test (prod ws) produced disambiguation loop + empty preview, 0 artifacts.
**Scope:** chat NL→artifact flow on the `prod` Cube workspace. NOT related to the just-merged `turn.ts` refactor (verified: refactor is workspace-agnostic; `local` ws produces artifacts on refactored code).

## Symptom

Chat on `prod` workspace (the SPA default) never renders a query-builder artifact. Historical rate: `local` **64/100** assistant turns with artifacts vs `prod` **0/9**. Reproduces identically via API on refactored code → pre-existing, workspace-bound.

## Root cause #1 — meta not scoped to the active game on the prefix workspace (PRIMARY)

`prod` uses the **prefix** game model (`workspaces.config.json`: `gameModel: "prefix"`, `gamePrefixMap: {cfm_vn→cfm, ballistar→ballistar, …}`). Each game is a distinct set of prefixed cubes (`ballistar_recharge`, `cfm_recharge`, `jus_recharge`, …).

`GET /cube-api/v1/meta` with `X-Cube-Game: ballistar` on prod returns **133 cubes across ALL games**, not just `ballistar_*`. Evidence:
- `ballistar_recharge.revenue_vnd`, `cfm_recharge.revenue_vnd`, `jus_recharge.revenue_vnd` all present in one meta response.
- `server/src/routes/cube-proxy.ts` has **no** game/prefix filtering — it forwards verbatim.
- `chat-service/src/core/cube-meta-cache.ts:47-65` sends `X-Cube-Game` but nothing downstream filters by it; `stripViews` only drops views.

Consequence: the chat agent + `disambiguate_query` see `revenue_vnd` in 5+ cubes → cannot resolve which → emits `disambig_options` with 3+ identically-labeled "Revenue Vnd" choices → loop, never reaches a query. On `local` (game_id model) there is ONE `recharge` cube (game scoped at query-time via `gameId` filter), so `revenue_vnd` is unambiguous → artifact builds.

**Why local works, prod doesn't:** ambiguity is a function of the meta the agent sees. Local meta = 1 revenue cube; prod meta = N prefixed revenue cubes, unfiltered.

## Root cause #2 — prod query latency / cold pre-aggs (CONTRIBUTING)

Direct `/load` of `ballistar_recharge.revenue_vnd` by `recharge_date` (last 7 days) on prod returned Cube **"Continue wait"** for 12s+ (4 polls). Even when the agent picks the right measure+time-dim, the preview tool likely times out → "empty result" (as the browser agent observed) → no data-backed artifact. May be cold pre-agg warmup; needs a warm re-test to confirm steady-state.

## Secondary (UI, separate)

Suggestion chip "Show daily revenue for the last 7 days" fills the input but does not submit (no user turn created). Frontend-only; untouched by recent work.

## Recommended fix (primary) — has precedent in-repo

Scope the `/meta` cubes to the active game's prefix on `prefix` workspaces, at the **gateway** (`server/src/routes/cube-proxy.ts`), so every meta consumer (chat AND Playground) benefits.

**Precedent already exists:** `server/src/services/workspace-readiness.ts:96-108` does exactly this filter to count a game's cubes — `prefix = workspace.gamePrefixMap?.[gameId]; cubes.filter(c => c.name.startsWith(`${prefix}_`))`. Its `:87` comment even notes prefix workspaces "share one (gameless) ctx because /meta is [not game-scoped]". The chat meta path just never applies that filter. Reuse the same rule in the meta proxy:
- When `req.workspace.gameModel === 'prefix'` AND `X-Cube-Game` present → filter `meta.cubes` to `name.startsWith(`${gamePrefixMap[game]}_`)`. Leave `game_id` (local) untouched.
- Re-test: prod ballistar "show daily revenue last 7 days" → single `ballistar_recharge.revenue_vnd` → no disambiguation → artifact.

Then separately validate #2 (warm pre-aggs / preview timeout budget).

## Resolution (implemented + verified live)

Fixed root cause #1 at the gateway. New `server/src/services/prefix-meta-filter.ts` (pure, 8 unit tests) + wired into `cube-proxy.ts` `GET /cube-api/v1/meta`: on `gameModel==='prefix'` with an `x-cube-game` header, narrow `meta.cubes` to `${gamePrefixMap[game]}_`. No-op on `game_id` (local) and when no game header.

Verified live (prod ws):
- prod `/meta` ballistar: **133 → 11 cubes** (all `ballistar_*`); local unaffected (13).
- Confirmed **zero** shared/cross-game cubes exist (all 133 carry a game prefix), so the filter hides nothing legitimate.
- Chat turn that previously looped: cross-game ambiguity gone; after one within-game clarification it produced **"Daily Revenue VND — Last 7 Days"** (`ballistar_recharge.revenue_vnd` by `recharge_date`) — prod's **first-ever** artifact. 546 server tests + 8 new green; no errors logged.

**Remaining (out of scope, lower priority):**
- Within-game disambiguation still asks once (ballistar has `recharge.revenue_vnd` vs `user_recharge_daily.revenue_vnd_total`) — legitimate, 1-click, resolves to an artifact. A ranking tweak in `disambiguate_query` could auto-pick the transactional measure; separate UX refinement.
- Root cause #2 (Cube "Continue wait" / chart-data latency on prod) still to validate now that turns reach a query.

## Open questions

1. ~~Gateway vs chat-service for the filter?~~ → **Gateway** (`cube-proxy`), reusing the `workspace-readiness.ts` prefix rule; benefits Playground + chat with one change.
2. Any intentional cross-game / shared cubes (e.g. `game_integration` federated) that must survive the prefix filter? Need the allowed-shared-cube rule before filtering (else we'd hide legit cross-game cubes). **This is the one design input needed before coding.**
3. Is prod "Continue wait" cold-start or steady-state? Determines whether #2 needs a preview-timeout bump or pre-agg warming. (Re-test after #1, since most prod chat turns never reach a query today.)
4. ~~Does the SPA prefix-filter client-side?~~ → readiness service already prefix-filters server-side; mirror that, don't rely on FE.
</content>
