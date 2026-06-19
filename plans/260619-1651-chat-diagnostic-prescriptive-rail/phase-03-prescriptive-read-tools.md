# Phase 03 — Prescriptive Read Tools (`recommend_actions` + `care_queue`)

## Context links
- Overview: [plan.md](plan.md)
- Engine: `server/src/advisor/recommend.ts:97` (`recommend`), `RecommendParams:33` (addressableN, reachablePct, windowDays, baselineRate, valuePerUnitVnd, phrase, phraseTopN)
- Route: `server/src/routes/advisor.ts:111` (POST /api/advisor/recommend)
- Care reads: `server/src/routes/care-playbooks.ts` (GET /api/care/playbooks), `server/src/routes/care-cases.ts` (GET /api/care/cases)
- Library: Phase-1 `GET /api/knowledge/levers`
- Seam: `chat-service/src/services/server-client.ts`

## Overview
- **Priority**: P1
- **Status**: done

> Implemented: `recommend_actions` (wraps `/api/advisor/recommend`; requires `addressableN` for whole-game scope — never invents a cohort size; 60s client timeout → `engine-unavailable`; 403 → `advisor-disabled`), `care_queue` (wraps `/api/care/playbooks` + optional `/api/care/cases`; 403 → `care-forbidden`), and the shared `recommendation-citation.ts`. The ranker/library family taxonomies differ, so the citation join is best-effort (mapped playbook id, then exact family) and falls back to a complete engine-sourced citation with a write default inferred from the lever actuator (cs → case, system → experiment) — never uncited. Withheld levers + blind spots surfaced. Both tools added to the diagnose skill `allowed_tools`; the rail chaining stays in P4.
- **Description**: Add two READ chat tools. `recommend_actions` wraps `/api/advisor/recommend` and enriches each candidate with the Phase-1 genre lever (signal + cubes + dual benchmark + action + defaultWrite + blind spots). `care_queue` wraps `/api/care/playbooks` + `/api/care/cases` to list available playbooks and open cases for a game. Every output is cited (engine + signal + benchmark). Graceful 403/latency handling.
- **Blocked by**: P1, P2.

## Key insights
- `recommend` is deterministic ranking (feasibility×power×expectedEffect×money×score) and may include optional LLM-phrased hypotheses — REUSE as-is. The chat tool adds the genre-lever citation layer on top.
- `recommend` requires `params{addressableN,...}`. The tool must derive sensible defaults (e.g. addressableN from the diagnosed opportunity's cohort estimate; reachablePct default 0.75 per `RecommendParams:36`) and let the model override.
- `care_queue` is two public GETs — no write. Playbook `availability` already gates by data; surface availability honestly.
- Citation contract (consumed by Phase-4 trust layer): each recommended action carries `{ sourceEngine:'advisor/recommend'|'care/playbooks', triggeringSignal, benchmark:{internal,external}, leverFamily, blindSpot? }`.

## Requirements
**Functional**
- `recommend_actions` tool: input `{ game_id, scope, goal, params?:{addressableN?,reachablePct?,windowDays?,baselineRate?,valuePerUnitVnd?,phrase?,phraseTopN?} }`. Calls diagnose+recommend (the route does both). For each candidate, joins the Phase-1 lever (by factor/leverFamily) to attach signal+cubes+dual benchmark+defaultWrite. Withholds + surfaces blind spots when required cubes absent. Returns cited candidates.
- `care_queue` tool: input `{ game_id, playbook?, status? }`. Calls GET playbooks (+ optional GET cases). Returns `{ playbooks:[{id,name,priority,availability,kpi,sla}], cases?:[...] }`, each annotated with library lever where mapped.
- Both: 403 → `{ok:false, reason:'advisor-disabled'|'care-forbidden'}`; 5xx/timeout → `{ok:false, reason:'engine-unavailable'}` (model explains). Mirror propose-segment `ok:false` guard.
- Latency: recommend can be heavier; tool sets a client timeout and on timeout returns `ok:false` with reason so the turn never hangs.

**Non-functional**
- Files <200 LOC: `recommend-actions.ts`, `care-queue.ts`. Shared citation builder `recommendation-citation.ts` (<100 LOC) — DRY across P3/P4.

## Architecture
`recommend_actions`: chat → POST `/api/advisor/recommend` (diagnose+rank) → for each candidate fetch/join Phase-1 lever (GET `/api/knowledge/levers?game=` cached per turn) → attach citation + defaultWrite → return. `care_queue`: chat → GET playbooks (+cases) → annotate with lever → return.

## Related code files
**Create**
- `chat-service/src/tools/recommend-actions.ts`
- `chat-service/src/tools/care-queue.ts`
- `chat-service/src/tools/recommendation-citation.ts` (shared citation/lever-join helper)
**Modify**
- `chat-service/src/tools/registry.ts`
- `chat-service/.claude/skills/diagnose/SKILL.md` (allowed_tools += recommend_actions, care_queue)
**Reuse**
- `chat-service/src/services/server-client.ts`, Phase-1 route

## Implementation steps
1. Write `recommendation-citation.ts`: given a candidate factor/leverFamily + game, fetch library (cached), return citation object; flag blind spots & withheld levers.
2. Write `recommend-actions.ts`: schema, derive `params` defaults, POST recommend, join citations, handle 403/5xx/timeout.
3. Write `care-queue.ts`: schema, GET playbooks(+cases), annotate, handle errors.
4. Register both in registry; add to skill allowed_tools.
5. Boot-guard passes.

## Todo
- [x] recommendation-citation shared helper (fetch-once library + best-effort join + engine fallback)
- [x] recommend_actions tool (addressableN guard, citation join, withheld/blind-spots, 403/timeout handling)
- [x] care_queue tool (playbooks + optional cases, lever annotation by mapped playbook id)
- [x] register + skill allowed_tools
- [x] boot-guard passes
- [x] tests: citation builder (match/fallback/null-library) + both tools (11 tests)

## Success criteria
- `recommend_actions` for cfm_vn returns ranked candidates, each citing source engine + triggering signal + internal&external benchmark + lever family; infeasible/blind-spot factors surfaced not dropped.
- `care_queue` lists playbooks with availability; jus_vn shows no guild/gacha playbook as available.
- Feature-off / role-forbidden / timeout → graceful `ok:false`, model explains.

## Risks
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Library fetched per candidate (N calls) | M×L | Fetch once per turn, cache; join in memory. |
| recommend latency stalls turn | M×M | Client timeout → ok:false reason. |
| Citation join misses (factor↔lever mismatch) | M×M | Fall back to engine's own lever-map verdict; never emit uncited action. |

## Security
- Read-only. Write endpoints NOT called here (Phase 5).

## Next steps
- Unblocks P4 (rail chains decompose→recommend) and P5 (defaultWrite drives confirm proposers).
