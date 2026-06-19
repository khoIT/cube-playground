# Phase 02 — Diagnostic Uplift (`decompose_metric` + benchmark-aware conclusion)

## Context links
- Overview: [plan.md](plan.md)
- Skill to uplift: `chat-service/.claude/skills/diagnose/SKILL.md` (manual ≤4-hypothesis breadth-walk; no decomposition tool, no mandatory narrative)
- Engine: `server/src/advisor/diagnosis-engine.ts:56` (`diagnose`), lenses 1-4 sync / 5-9 lazy (`:40-43`)
- Route: `server/src/routes/advisor.ts:92` (POST /api/advisor/diagnose, feature-gated `:89`)
- Seam: `chat-service/src/services/server-client.ts` (postJson, ServerClientError)
- Registry: `chat-service/src/tools/registry.ts:185` (flag-gated push pattern)

## Overview
- **Priority**: P1
- **Status**: pending
- **Description**: Add `decompose_metric` chat tool wrapping `/api/advisor/diagnose` (math-tree + dimension waterfall). Uplift the diagnose skill so its conclusion is a MANDATORY benchmark-aware narrative: cites the contributing factor, its gap vs internal percentile AND external norm (from Phase 1 library), and confidence/agreeing-lenses.
- **Blocked by**: P1.

## Key insights
- The engine is deterministic and already returns `{goalTrees, opportunities:[{factor,gapPct,gapValue,confidence,agreeingLenses,weak}], lens evidence w/ Cube provenance}`. The tool is a thin wrapper — do NOT reimplement decomposition in chat-service.
- Default to sync lenses 1-4 (~3-5s, fits a chat turn). Expose `lenses?:number[]` for the optional "deeper" follow-up but NEVER auto-run 5-9 (latency decision, see plan Q2).
- The current skill's "plain-English conclusion sentence is mandatory" rule (`SKILL.md:57`) is the hook to extend into a benchmark-aware narrative.
- Provenance from the engine (Cube member names per lens) is the citation substrate for Phase 4's trust layer — pass it through unaltered.

## Requirements
**Functional**
- `decompose_metric` tool: input `{ game_id, scope:{kind,segmentId?}, goal:'revenue'|'engagement'|'both', asOf?, deeper?:boolean }`; calls `postJson('/api/advisor/diagnose', ...)`; on `deeper:true` passes `lenses:[5..9]`. Returns structured `{ goalTrees, opportunities, lensEvidence, provenance }` for the model to narrate.
- Tool handles 403 (advisor feature off) → returns `{ ok:false, reason:'advisor-disabled' }` so the model explains, never crashes (mirror propose-segment `ok:false` guard pattern).
- Skill update: conclusion MUST state, for the top opportunity: factor, magnitude (gapPct/gapValue), internal percentile band + external norm (fetched via Phase-1 library benchmark for the metric), confidence + agreeingLenses count. If a benchmark is unavailable, say so explicitly (no fabrication).
- Add `decompose_metric` to skill `allowed_tools` and to registry (flag-gated like `:185` if a rollout flag is desired, else unconditional).

**Non-functional**
- Tool file <200 LOC. kebab-case `decompose-metric.ts`.

## Architecture
Chat turn → skill triggers `decompose_metric` → server-client POST diagnose (sync 1-4) → engine returns opportunities+provenance → model composes narrative, calling Phase-1 benchmark (via `recommend_actions`/library read or a small benchmark fetch) for the cited metric → mandatory narrative conclusion before any artifact.

## Related code files
**Create**
- `chat-service/src/tools/decompose-metric.ts`
**Modify**
- `chat-service/src/tools/registry.ts` (register)
- `chat-service/.claude/skills/diagnose/SKILL.md` (allowed_tools + mandatory benchmark-aware conclusion steps/guardrails)
**Reuse**
- `chat-service/src/services/server-client.ts`

## Implementation steps
1. Write `decompose-metric.ts`: Zod schema, handler calls `postJson('/api/advisor/diagnose')`, maps response, catches `ServerClientError` (403→advisor-disabled, 5xx→engine-unavailable).
2. Register in `registry.ts`.
3. Update `SKILL.md`: add `decompose_metric` to allowed_tools; rewrite Steps/Guard rails so the conclusion narrative is benchmark-aware and cites factor+gap+internal band+external norm+confidence. Keep "never invent member names".
4. Verify boot-guard (registry validates skill allowed_tools) passes with the new tool.

## Todo
- [ ] decompose-metric tool (wrap diagnose, 403/5xx handling)
- [ ] register in registry
- [ ] SKILL.md: allowed_tools + mandatory benchmark-aware conclusion
- [ ] boot-guard passes

## Success criteria
- Asking "why did revenue drop for cfm_vn" runs `decompose_metric`, returns engine opportunities, and the chat conclusion names the top factor with gap%, internal percentile band, external norm, and confidence — within one turn (~3-5s).
- Advisor-disabled workspace → graceful explanation, no crash.

## Risks
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Lenses 5-9 auto-run blow turn budget | M×M | Default sync 1-4; `deeper` opt-in only. |
| Model narrates without benchmark (drifts to raw metric) | M×H | Skill makes benchmark citation mandatory; Phase-4 guardrail enforces. |
| Benchmark missing for a metric → fabrication | L×H | Skill must say "no benchmark available" explicitly. |

## Security
- Read-only. Scope implicit in authenticated request (workspace/game).

## Next steps
- Unblocks P3 (recommend builds on the same diagnose call) and P4 (rail chains this conclusion into recommend).
