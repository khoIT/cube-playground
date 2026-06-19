# Phase 04 — The Chained Rail + Trust/Citation Layer

## Context links
- Overview: [plan.md](plan.md)
- Skill: `chat-service/.claude/skills/diagnose/SKILL.md` (now has decompose_metric, recommend_actions, care_queue from P2/P3)
- Tools: P2 `decompose-metric.ts`, P3 `recommend-actions.ts` + `recommendation-citation.ts`

## Overview
- **Priority**: P1
- **Status**: pending
- **Description**: Wire the flagship rail as ONE flow inside the diagnose skill: **diagnose → conclude (benchmark-aware narrative) → offer recommend → surface cited actions**. Add the trust/citation guardrails: every recommendation names source engine + triggering signal + benchmark; blind spots are flagged, never fabricated; withheld levers stated with the missing-cube reason.
- **Blocked by**: P2, P3.

## Key insights
- This phase is mostly SKILL.md orchestration + guardrail prose, not new code — the tools already exist. The net-new code is a small guardrail validator the skill output must satisfy (defence-in-depth so an action without a citation is blocked).
- The rail is one unit: the skill must not stop at diagnosis. After the mandatory conclusion it offers recommend; on user assent (or single-turn auto when goal is prescriptive) it calls `recommend_actions` and renders cited actions.
- Trust contract: an action is renderable only if it carries `{sourceEngine, triggeringSignal, benchmark}`. Blind spots (e.g. FPS cheating) render as "we cannot assess this — no data" not as a recommendation.

## Requirements
**Functional**
- Skill rail steps: (1) diagnose via `decompose_metric`; (2) mandatory benchmark-aware conclusion; (3) offer to recommend ("want actions for the top driver?"); (4) on assent call `recommend_actions`, render top cited candidates with confirm affordance (the confirm card itself is Phase 5).
- Trust guardrail: a tiny validator `recommendation-trust-guard.ts` that, given a recommendation payload, asserts presence of sourceEngine+signal+benchmark and that blind-spot items are not phrased as actions. Used by recommend_actions output assembly (shared with P3's citation builder).
- Blind-spot + withheld surfacing is mandatory in the narrative when present.
- No fabrication: if benchmark/lever missing, the rail says so.

**Non-functional**
- Guard file <150 LOC, kebab-case. No plan-artifact refs in code comments — explain the *why* (trust invariant), not the origin.

## Architecture
One-turn rail: user symptom → skill → decompose_metric (sync lenses 1-4) → narrative conclusion (cites benchmark) → recommend_actions (cited candidates) → trust-guard validates each → render cited recommendation list + per-item confirm affordance. Blind spots/withheld levers appended as honest caveats.

## Related code files
**Create**
- `chat-service/src/tools/recommendation-trust-guard.ts`
**Modify**
- `chat-service/.claude/skills/diagnose/SKILL.md` (rail orchestration steps + trust/blind-spot guardrails)
- `chat-service/src/tools/recommend-actions.ts` (run output through trust-guard before returning)

## Implementation steps
1. Write `recommendation-trust-guard.ts`: validate `{sourceEngine,triggeringSignal,benchmark}` present; reject/relabel blind-spot-as-action; return validated payload + caveats.
2. Wire `recommend_actions` to pass its assembled candidates through the guard.
3. Rewrite `SKILL.md` into the explicit rail (diagnose→conclude→offer→recommend) with mandatory citation + blind-spot + withheld rules.
4. Manual eval: run the rail on a cfm_vn revenue-drop and a jus_vn engagement-drop prompt; confirm cited end-to-end and jus shows no clan/gacha action.

## Todo
- [ ] recommendation-trust-guard (citation + blind-spot invariants)
- [ ] recommend_actions runs output through guard
- [ ] SKILL.md rail orchestration + guardrails
- [ ] manual eval cfm_vn + jus_vn

## Success criteria
- A single symptom prompt yields: diagnosis → benchmark-aware conclusion → cited recommended actions, in one coherent flow.
- Every rendered action cites engine + signal + benchmark. No uncited action can be rendered (guard rejects).
- FPS cheating surfaces as an explicit blind spot, never a recommendation. jus_vn never recommends clan/gacha.

## Risks
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Skill stops at diagnosis (half-feature) | M×H | Rail step 3-4 mandatory; eval asserts recommend reached. |
| Model fabricates a citation to pass guard | L×H | Guard cross-checks benchmark/signal against tool payload, not model prose. |
| Rail too chatty / two-turn friction | M×M | Offer-then-recommend is one assent; prescriptive intents may auto-chain. |

## Security
- Read-only through this phase. No writes yet.

## Next steps
- Unblocks P5 — confirm affordance becomes a real write-gated proposer card.
