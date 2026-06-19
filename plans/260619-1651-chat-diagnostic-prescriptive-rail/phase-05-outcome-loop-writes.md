# Phase 05 — Outcome Loop (confirm-gated writes)

## Context links
- Overview: [plan.md](plan.md)
- Confirm-card precedent: `chat-service/src/tools/propose-segment.ts` (emits proposal SSE, never writes), FE `src/pages/Chat/components/segment-proposal-card.tsx`, `src/api/segment-proposal.ts`, `src/stores/chat-stream-store-actions.ts`, `src/api/chat-sse-client.ts`
- Write endpoints: POST `/api/care/cases/sweep` + PATCH `/api/care/cases/:id` (`server/src/routes/care-cases.ts`), POST `/api/experiments` + `/api/experiments/:id/assign` (`server/src/experiments/experiment-store.ts:57`), GET `/api/experiments/:id/scorecard`
- Write gating: `server/src/middleware/enforce-write-roles.ts`; sweep mutex per workspace+game, idempotent

## Overview
- **Priority**: P1
- **Status**: pending
- **Description**: Wire the outcome loop. On user-confirmed acceptance of a recommendation, create a care case or an experiment via the WRITE endpoints — but chat only PROPOSES; the FE performs the write on explicit confirm (mirrors propose_segment). Add the scorecard read seam for later measurement.
- **Blocked by**: P3, P4.

## Key insights
- CRITICAL: chat-service tools must NOT call write endpoints directly. They emit an `action_proposal` SSE event (new, modeled on `segment_proposal`); the FE confirm card calls the server write. This keeps the "chat proposes, FE confirms" invariant and avoids the agent silently mutating state.
- `defaultWrite` from the Phase-1 lever decides the proposal kind: `case` (single playbook case), `sweep` (cohort — TWO confirms), `experiment` (draft + assign).
- recommend→sweep = TWO confirms (plan Q5): confirm #1 = accept recommendation → opens/records a care case (durable intent record); confirm #2 = separate explicit "run sweep" action on the case/queue → triggers cohort mutation. Never one-click cohort sweep.
- Experiment path: confirm creates draft (POST /experiments); a second explicit "start" calls assign (freezes split). Scorecard is viewer-ok read.
- All write endpoints are role-gated → FE must handle 403; the proposer tool pre-checks nothing but the card surfaces the permission error gracefully.

## Requirements
**Functional**
- New proposer tool `propose_action`: input `{ game_id, kind:'care_case'|'sweep'|'experiment', leverFamily, playbookId?, recommendation:{citation...}, params }`. Validates against Phase-1 lever (kind must match `defaultWrite` or be an allowed alternative), then emits an `action_proposal` SSE event. NEVER writes. Returns `ok:false` with reason on validation failure (mirror propose-segment guards).
- New SSE event type `action_proposal` (chat-service emit + FE parse).
- FE confirm card `action-proposal-card.tsx`: renders the cited recommendation + the confirm action; on confirm calls the appropriate server write (case create via care, or experiment create+assign). Sweep card uses two-step confirm (accept → then run-sweep). Follows `docs/design-guidelines.md` (tokens, `var(--font-sans)`, page-header/proposal-card pattern) and reuses segment-proposal-card structure.
- FE API client `action-proposal.ts`: write calls to care/experiment endpoints; 403 handled with a clear message.
- Scorecard read seam: FE/tool can fetch `GET /api/experiments/:id/scorecard` to show arms/uplift later (read path only; no measurement automation).

**Non-functional**
- Files <200 LOC; split FE card parts like `segment-proposal-card-parts.tsx` precedent. kebab-case.
- Code comments explain the *why* (confirm-gate invariant), not plan origin.

## Architecture
Rail renders cited action → `propose_action` emits `action_proposal` SSE → FE card shows recommendation + confirm → on confirm #1 FE POSTs care case create (or experiment draft) → durable record. For sweep: card then shows a second "run sweep" affordance → FE POSTs `/api/care/cases/sweep`. For experiment: second affordance POSTs `/assign`. Outcome later read via PATCH case (outcome+kpi_eval_at) / scorecard.

## Related code files
**Create**
- `chat-service/src/tools/propose-action.ts`
- `src/pages/Chat/components/action-proposal-card.tsx`
- `src/pages/Chat/components/action-proposal-card-parts.tsx`
- `src/api/action-proposal.ts`
**Modify**
- `chat-service/src/tools/registry.ts` (register propose_action)
- `chat-service/.claude/skills/diagnose/SKILL.md` (allowed_tools += propose_action; rail step: offer confirm)
- `src/api/chat-sse-client.ts` (+ action_proposal event)
- `src/stores/chat-stream-store-actions.ts` (+ action_proposal handling)
- `src/pages/Chat/components/assistant-message.tsx` (render action-proposal-card)
**Reuse**
- segment-proposal-* (structure template), server-client.ts

## Implementation steps
1. `propose-action.ts`: schema, validate kind vs Phase-1 `defaultWrite`, emit `action_proposal` SSE, never write; ok:false guards.
2. Register + skill allowed_tools + rail offer-confirm step.
3. FE: add `action_proposal` to SSE client + store actions.
4. FE: `action-proposal-card(-parts).tsx` (design-guidelines compliant; two-step for sweep).
5. FE: `action-proposal.ts` write client (care case create, sweep, experiment create+assign; 403 handling).
6. Wire scorecard read into the experiment card (read-only).

## Todo
- [ ] propose_action tool (validate + emit SSE, never write)
- [ ] register + skill rail offer-confirm
- [ ] FE SSE client + store: action_proposal
- [ ] action-proposal-card(-parts) (design tokens, two-step sweep)
- [ ] action-proposal write client (case/sweep/experiment, 403)
- [ ] scorecard read seam

## Success criteria
- Accepting a cfm_vn recommendation creates a care case via FE confirm (no chat-side write); sweep requires a SECOND explicit confirm.
- Accepting an experiment-worthy recommendation creates a draft, then a second confirm assigns (freezes split).
- Role-forbidden user sees a clear permission message, no crash.
- No chat tool ever calls a write endpoint directly (verified by review).

## Risks
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Chat silently triggers sweep | L×H | Tool only emits SSE; two-confirm for sweep; review gate. |
| Double-write / dup case | M×M | Sweep endpoint idempotent + mutex; case create keyed by playbook+cohort. |
| FE card drifts from design system | M×M | Clone segment-proposal-card; cross-check Dashboards/Cohort per design-guidelines. |
| 403 crashes turn | L×M | FE + tool both handle 403 gracefully. |

## Security
- Writes role-gated server-side (`enforce-write-roles.ts`) — unchanged. Chat never bypasses; FE forwards auth.

## Next steps
- Unblocks P6 tests/docs. Forecast-vs-target + measurement automation are follow-on (seam left: scorecard read + case outcome fields).
