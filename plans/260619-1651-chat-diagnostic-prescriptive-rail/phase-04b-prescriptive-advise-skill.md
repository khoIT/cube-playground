# Phase 04b — Prescriptive Door: the `advise` Skill + Router Entry

## Context links
- Overview: [plan.md](plan.md)
- Rail: [phase-04-rail-and-trust-layer.md](phase-04-rail-and-trust-layer.md) (the shared flow this skill enters)
- Router: `chat-service/src/core/intent-router.ts` (deterministic keyword scorer, length-weighted)
- Sibling skill: `chat-service/.claude/skills/diagnose/SKILL.md` (the diagnostic door — unchanged)

## Overview
- **Priority**: P1
- **Status**: done (code); live manual eval pending (needs the running stack)

> Implemented: new `advise/SKILL.md` (prescriptive door — 4-step auto-chaining body that reuses the rail + all P4 guardrails, with an open-ended game-level lever-scan default) and an `advise` keyword block + `/advise` slash alias in `intent-router.ts`. Multi-word action phrases dominate the length-weighted scorer, so prescriptive prompts route to `advise` while "why" stays on `diagnose` and "show" stays on `explore`. `compose()` auto-discovers the skill from the loader (no allowlist) and gates tools by its `allowed_tools` — `recommend_actions` is reachable. Live end-to-end eval still to run against the stack.
- **Description**: Give the diagnose→recommend rail a **second entry door** for prescriptive-first phrasing. Today the router triggers `diagnose` only on diagnostic words (why/drop/spike/anomaly); a prescriptive question ("what should I do to grow revenue?", "how do I improve D7?", "what should I focus on this week?") falls back to `explore` (confidence 0) — which does NOT declare the recommend tools, so the rail is unreachable. LiveOps managers and execs phrase prescriptively, so without this they miss the rail entirely. Add a dedicated `advise` skill that routes those intents straight into the rail and auto-chains to recommendations.
- **Blocked by**: P2 (`decompose_metric`), P3 (`recommend_actions`, `care_queue`, citation builder), P4 (trust guard).

## Key insights
- **Verified gap** (`intent-router.ts`): routing is deterministic substring keyword scoring; no LLM classification; on no match → `explore` fallback. Tool allowlist is **hard-enforced per skill** — explore cannot call `recommend_actions`, so a misrouted prescriptive turn structurally cannot recommend.
- **diagnose vs advise behavior differs at the exit, not the engine:** diagnose ends at the conclusion and *offers* to recommend (user asked "why"); advise *auto-chains* to recommend (user asked "what to do"). Same tools, same trust guard, same data-gates.
- **Keep diagnose unchanged** — clean semantic split, each skill body and keyword set tuned independently.
- **Open-ended prescriptive** ("what should I focus on this week?", "how's the game doing — what matters?") has no single metric → advise defaults to a game-level health scan (a small fixed lever sweep) before recommending. Pure descriptive exec-summary (no action) remains the follow-on exec cut, out of scope here.

## Requirements
**Functional**
- New skill `chat-service/.claude/skills/advise/SKILL.md`:
  - `trigger_keywords`: what should i, how should i, how do i improve, what to do, recommend, recommendation, suggest, suggestion, next step, next steps, focus on, should we focus, should we prioritize, priority, grow, boost, increase, mitigate, fix — plus VI: nên làm gì, làm sao để, làm thế nào để, đề xuất, gợi ý, ưu tiên, tập trung vào, cải thiện.
  - `allowed_tools`: `decompose_metric`, `recommend_actions`, `care_queue`, `get_cube_meta`, `get_topic_knowledge`, `list_business_metrics`, `get_business_metric`, `list_segments`, `get_segment`, `preview_cube_query`, `emit_query_artifact`, `emit_chart`, `offer_choices`.
  - `enable_research_mode: true`, `enable_web_search: false`.
  - Body steps: (1) intake target+scope — if a concrete metric/lever, decompose it; if open-ended, run a fixed game-level lever scan; (2) call `decompose_metric` (sync lenses 1-4) for the *why* behind the chosen lever; (3) call `recommend_actions` (cited, library-gated); (4) render top cited actions with the confirm affordance (card is P5). Auto-chain — do not stop at diagnosis.
  - Reuses every guardrail from P4: each action cites engine+signal+benchmark; blind spots flagged (cfm cheating); withheld levers stated with missing-cube reason; jus never recommends clan/gacha (data-gate).
- Router change in `intent-router.ts`: add an `advise` keyword block to the `KEYWORDS` map so prescriptive phrasings score and `autoRoute` to advise.

**Non-functional**
- No new runtime code — a SKILL.md + a router keyword block + skill registration. No plan-artifact references in comments.
- Keyword set favors multiword/action-intent phrases (long → win the length-weighted scorer cleanly) to avoid colliding with explore's descriptive words.

## Architecture
Two doors, one room: `diagnose` (why → conclude → *offer*) and `advise` (what-to-do → *auto* recommend) both enter the shared rail (`decompose_metric` → `recommend_actions` → trust guard → cited render). The router picks the door by phrasing; the rail and its guardrails are identical downstream.

## Related code files
**Create**
- `chat-service/.claude/skills/advise/SKILL.md`
**Modify**
- `chat-service/src/core/intent-router.ts` (add `advise` to the keyword map; register skill if a skill list exists)

## Implementation steps
1. Author `advise/SKILL.md` (frontmatter triggers + allowed_tools + the 4-step auto-chaining body that reuses the rail and all P4 guardrails).
2. Add the `advise` keyword block to `intent-router.ts`; confirm `routeIntent()` returns `{skill:'advise', autoRoute:true}` for prescriptive prompts and still returns `diagnose` for "why" prompts and `explore` for "show" prompts.
3. Verify the tool allowlist resolves advise's tools through the existing compose path (no tool-bleed; recommend_actions reachable).
4. Manual eval: "what should I do to grow cfm_vn revenue?" auto-chains to cited actions; "how do I improve jus_vn retention?" yields server/VIP levers only (no clan/gacha); "why did revenue drop?" still routes to diagnose (offer, not auto).

## Todo
- [x] `advise/SKILL.md` (triggers, tools, auto-chaining rail body, guardrails)
- [x] `intent-router.ts` advise keyword block + `/advise` slash alias
- [x] tool allowlist resolves (compose auto-discovers advise; recommend_actions reachable)
- [x] routing tests: prescriptive→advise, diagnostic→diagnose, descriptive→explore (9 tests)
- [ ] live manual eval cfm_vn + jus_vn (needs running chat-service + Cube + LLM under Node 22)

## Success criteria
- Prescriptive prompts ("what should I do…", "how do I improve…", "recommendations", "what to focus on") route to `advise` and auto-chain to **cited** recommendations in one turn.
- "Why did X drop?" still routes to `diagnose` (offer-recommend exit preserved). "Show revenue by platform" still routes to `explore`.
- advise honors every P4 trust/data-gate invariant (citations, blind spots, jus no-clan/gacha).

## Risks
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Keyword collision (e.g. "grow"/"increase" vs explore's "growth"/"tăng trưởng") misroutes | M×M | Favor multiword action phrases (score higher); router ties → autoRoute=false (LLM not forced); eval set covers ambiguous prompts. |
| advise + diagnose double-trigger on "why should I…" | L×M | Length-weighted scorer + tie→non-autoRoute; eval the overlap phrasings. |
| Open-ended "what to focus on" with no metric stalls | M×M | Body step 1 defines a fixed game-level lever scan as the default scope. |

## Security
- Read-only (reads + recommend preview). Writes remain confined to P5's confirm-gated proposers.

## Next steps
- P5 confirm-card proposer renders for advise outputs identically to diagnose outputs (same `recommend_actions` payload).
- P6 must add routing/trigger tests: prescriptive→advise, diagnostic→diagnose, descriptive→explore, plus the ambiguous-overlap eval set.
