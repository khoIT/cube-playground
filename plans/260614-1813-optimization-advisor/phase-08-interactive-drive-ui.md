# Phase 08 — Interactive Drive UI

## Context links
- Built surface to reuse: `src/pages/Advisor/` — `index.tsx`, `use-advisor-investigation.ts` (`useAdvisorInvestigation()` at :94, currently uses `simulateInvestigation` — the STUB this phase replaces with the live agent stream), `advisor-stage-config.ts` (`STAGES`: opportunity → target → cause → lever → proof → …), `blueprint.tsx`, `stage-panel.tsx`, `aspect-card.tsx`, `provenance-drawer.tsx`, `recommendations.tsx`, `decide-screen.tsx`, `command-center.tsx`, `step-nav.tsx`.
- Client API: `src/api/advisor.ts` (add the SSE turn call).
- SSE endpoint: `POST /api/advisor/agent/turn` (Phase 6).
- Design system MANDATORY: `docs/design-guidelines.md` — design tokens only (`var(--text-primary)`, `var(--border-card)`, `var(--brand)`, `var(--radius-md)`, `var(--font-sans)`, semantic status tokens), page-header pattern, **antd v4** (NOT v5), React Router v5.

## Overview
- **Priority:** P1. **Status:** ✅ DONE (2026-06-15). **Depends on:** 7.
- **Built:** `src/api/advisor.ts` `streamAgentTurn()` SSE client (shares extracted `buildRequestHeaders` from api-client), `investigation-reducer.ts` (event→Drive state + tool→stage map), `use-drive-session.ts` (multi-turn steering via sessionId), `number-badge.tsx` (exploratory/validated), `drive-panel.tsx` (live narration + stage rail lighting + evidence feed + cost + error/retry), wired into `index.tsx` as an ADDITIVE "Drive with AI" posture beside the Explore builder (rollback = remove the toggle; simulator path untouched). Design-token compliant, antd v4. tsc clean (new files), `vite build` clean, reducer unit test (7) + api tests (28) green. **DEFERRED:** full per-aspect stage-card fill (the agent's tool_result events don't carry a stage; the rail-lighting map is the pragmatic v1) + Playwright stage-fill assertion → both need a token-bearing host (live OAuth smoke, Phase 9).
- Wire the agent into the existing Experiment-Builder: the agent fills the causal-chain stages **live** (streaming), the user **steers / kicks back to Explore**, the blueprint assembles from agent + tool outputs, and numbers are badged **"exploratory" vs "validated."** Reuse the built components; no new page.

## Key insights
- The hook `useAdvisorInvestigation()` already models stages, aspects, triage, and a `handlers` object (`onResubmit`, `onProvideInfo`, `onAdd`, `onAssert`). Today it calls `simulateInvestigation()`. **This phase swaps the simulator for an SSE-driven agent stream** — the component API stays stable, minimizing UI churn (DRY + KISS).
- Stream → state mapping: `assistant_delta` → narration into the active stage's reasoning; `tool_call` → a "computing…" affordance on the relevant aspect; `tool_result` (carries `provenanceId`) → a VALIDATED number/finding fills the stage + provenance link; `done`/`error` → settle/error the stage.
- The HYBRID rule renders visually: any number from `assistant_delta` (not yet tool-backed) shows an **"exploratory — not validated"** badge; any number with a `provenanceId` shows a **"validated"** badge + opens `provenance-drawer.tsx`. This is the user-facing half of the Phase-7 gate.
- Steering = the existing Explore↔Drive spectrum: user edits an aspect / kicks a stage back to Explore → sends a follow-up turn (same `sessionId`) → agent re-reasons. No dead ends.

## Requirements
**Functional**
1. `src/api/advisor.ts`: `streamAgentTurn({sessionId?, message, scope, goal}, onEvent)` — `fetch` + `ReadableStream` SSE parser → typed runtime events; returns `sessionId` + an `abort()`.
2. `use-advisor-investigation.ts`: replace `simulateInvestigation` path with the agent stream; keep the `handlers` surface. New internal reducer maps runtime events → stage/aspect state; persists `sessionId` for multi-turn steering.
3. Stage fill: as `tool_result` events arrive, populate the matching stage (opportunity/target/cause/lever/proof) with the validated finding + `provenanceId`.
4. Number badges: a small `<NumberBadge variant="exploratory|validated">` (design tokens) on every numeric finding; validated badge click → `provenance-drawer.tsx`.
5. Steering controls (reuse existing handlers): kick-back-to-Explore on a stage, edit/refine an aspect, add a manual hypothesis, assert a finding → each dispatches a follow-up agent turn on the same session.
6. Blueprint (`blueprint.tsx`): assembles from the agent-filled stages; a draft is only "ready to hand off" when its numbers are validated (gate surfaced — disabled hand-off button with reason while any required number is exploratory).
7. Hand-off path unchanged: accept → existing `scaffoldDraft` flow → `command-center.tsx` draft (status='draft', never auto-launch). The agent's draft must pass `validateDraftNumbers` (Phase 7) before the hand-off button enables.
8. Loading/stream UX: per-stage "thinking" state during `assistant_delta`/`tool_call`; cost/turn indicator (subtle); graceful `error` event rendering.

**Non-functional:** design-token compliant (cross-check against Dashboards/Cohort/Segments per guidelines); antd v4 components; files <200 LOC (split the SSE client, the reducer, the badge); kebab-case; no plan-artifact strings.

## Architecture — data flow
```
user opens Advisor (scope+goal) → useAdvisorInvestigation starts a turn
  → streamAgentTurn() POST /api/advisor/agent/turn (SSE)
  → onEvent(runtimeEvent) → reducer:
       assistant_delta → stage narration (+ exploratory number badges)
       tool_call       → aspect "computing…"
       tool_result     → stage filled w/ validated finding + provenanceId
       cost/done/error → settle
  → blueprint recomputes from stages
  → user steers (kick-back / edit / assert) → follow-up turn (same sessionId)
  → accept → scaffoldDraft → validateDraftNumbers → command-center draft (status='draft')
```

## Related code files
**Modify:**
- `src/api/advisor.ts` — add `streamAgentTurn`.
- `src/pages/Advisor/use-advisor-investigation.ts` — swap simulator → agent stream; add reducer + sessionId.
- `src/pages/Advisor/stage-panel.tsx`, `aspect-card.tsx` — render thinking state + number badges.
- `src/pages/Advisor/blueprint.tsx` — gate hand-off button on validated numbers.
- `src/pages/Advisor/decide-screen.tsx` / `command-center.tsx` — enforce validated-draft precondition.
**Create:**
- `src/pages/Advisor/agent-stream-client.ts` — SSE fetch/parse (kept out of the hook for size).
- `src/pages/Advisor/investigation-reducer.ts` — runtime-event → state reducer.
- `src/pages/Advisor/number-badge.tsx` — exploratory/validated badge (design tokens).

## Implementation steps
1. `agent-stream-client.ts`: SSE parse over `fetch`/`ReadableStream`; emit typed events; expose `abort()`.
2. `investigation-reducer.ts`: pure reducer mapping events → stage/aspect state + sessionId.
3. Rewire `use-advisor-investigation.ts` to the stream (keep `handlers` shape).
4. `number-badge.tsx` + wire into `stage-panel`/`aspect-card`; validated → provenance drawer.
5. Steering: route existing handlers to follow-up turns.
6. `blueprint.tsx`: disable hand-off until `validateDraftNumbers` clean; show reason.
7. Design cross-check vs Dashboards/Cohort/Segments (tokens, header, spacing, radius).
8. `npm run build` (frontend) clean.

## Todo
- [ ] agent-stream-client SSE parser + abort
- [ ] investigation-reducer (event→state) + sessionId persistence
- [ ] swap simulateInvestigation → agent stream in the hook
- [ ] number-badge (exploratory/validated) + provenance-drawer wiring
- [ ] stage thinking states (assistant_delta / tool_call)
- [ ] steering → follow-up turns (kick-back / edit / assert / add)
- [ ] blueprint hand-off gated on validated numbers
- [ ] design cross-check + frontend build clean

## Success criteria (measurable)
- Playwright: opening Advisor with a scope+goal streams stage fills with `pageerror==0`; at least opportunity/cause/lever stages populate from `tool_result` events.
- Every numeric finding shows a badge; an exploratory (non-provenanced) number shows "exploratory" and the hand-off button is DISABLED while any required number is exploratory; a validated number opens the provenance drawer.
- Steering: kicking a stage back to Explore and editing it dispatches a follow-up turn on the same `sessionId` (assert session reuse) and the stage re-fills.
- Hand-off produces a `status='draft'` Command Center draft only after `validateDraftNumbers` passes (never auto-launch).
- Design cross-check passes: tokens only, `var(--font-sans)`, antd v4, header pattern matches an adjacent page.

## Risk assessment
| Risk | L×I | Mitigation |
|---|---|---|
| Swapping the simulator breaks the built UI flow | M×H | keep `handlers`/state shape stable; reducer is the only new seam; Playwright on the 3 screens |
| Streaming jank / partial-delta flicker | M×M | buffer deltas per stage; render settled findings on `tool_result`, not on every delta |
| User publishes an exploratory number | L×H | hand-off button gated on `validateDraftNumbers`; badge makes status obvious |
| Design drift on the new badge/thinking states | M×M | tokens only + mandatory cross-check vs Dashboards/Cohort/Segments |
| SSE disconnect mid-stream leaves stage stuck | M×M | client `abort()` + error event renders a retry; stage marked errored not "thinking" forever |

## Backwards compatibility / rollback
- The Explore posture (manual toggles / provenance / ad-hoc queries) stays — Drive is additive. Rollback = restore the `simulateInvestigation` path (keep it behind a flag during rollout).
- No URL/route change; reuses the existing Advisor page + React Router v5 wiring.

## Security
- No token in the client; SSE carries no PII (server redacts in Phase 7).
- Validated-only hand-off enforced both server-side (gate) and UI (disabled button) — defense in depth.

## Open questions
- Q-A5: should the agent auto-start on page open, or wait for an explicit "Drive" action? Default: explicit Drive button (respects the Explore-first posture); auto-start behind a setting.
- Q-A6: cost/turn indicator prominence — subtle by default; surface fully in an admin/debug view.

## Next steps
Phase 9 adds the enforcement/eval tests (hybrid gate, glass-box, no-PII, runaway/injection), the experiment-quality eval harness, live OAuth smoke, and docs.
