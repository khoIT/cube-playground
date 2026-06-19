# Phase 05 — Outcome Loop (DESCOPED — rail ends at cited strategy)

## Context links
- Overview: [plan.md](plan.md)
- Recommend (kept): `chat-service/src/tools/recommend-actions.ts`, `recommendation-citation.ts`, `recommendation-trust-guard.ts`
- Design exploration (kept, in-scope write path): segment proposal — `chat-service/src/tools/propose-segment.ts`, FE `src/pages/Chat/components/segment-proposal-card.tsx`
- Mockup explored before descope: `visuals/action-proposal-artifact.html` (+ `.png`)

## Overview
- **Priority**: P1
- **Status**: descoped (decision 2026-06-19)
- **Decision**: The playground stays a **data-exploration tool**. The diagnose→conclude→recommend rail ends at **proposing cited strategy framed on segments/cohorts**; the user figures out and confirms any real-world action (care, experiment, sweep) themselves, in their own tools. No confirm-gated write artifact, no care-console / experiment wiring.
- **Blocked by**: n/a (cancelled).

## Why descoped
- User scope call: "stop actions at propose some strategy to do on some segments — let users figure out and confirm themselves. Cube playground should stick to the scope of data exploration."
- A confirm-gated `action_proposal` card implies the playground actuates care cases / experiments. That crosses out of data-exploration scope and into operational write surfaces the playground should not own.
- Recommendation value is preserved: `recommend_actions` already returns trust-guarded, fully-cited candidates. Presenting those as cited strategy (framed on the cohort/segment) is the deliverable; the actuation is the user's.

## What was reverted (vs the original confirm-gated design)
- **Removed** `chat-service/src/tools/propose-action.ts` + `chat-service/test/tool-propose-action.test.ts`.
- **Removed** the `action_proposal` SSE event type (`chat-service/src/types.ts`) and its live forward in `chat-service/src/api/turn.ts`.
- **Removed** `propose_action` registration (`chat-service/src/tools/registry.ts`).
- **Skills** (`diagnose`, `advise`): dropped `propose_action` from `allowed_tools`; recommend step reframed from "confirm-gated write" → "cited strategy framed on segments; the user acts on it themselves." `care_queue` clarified as read-only reference (which CS playbooks exist), not an actuation path.
- **Not built**: FE `action-proposal-card(-parts).tsx`, `src/api/action-proposal.ts`, SSE-client/store/assistant-message wiring, scorecard read seam. None were started, so nothing to remove on the FE.

## What stays (in scope)
- `recommend_actions` (cited candidate strategies) + `recommendation-citation` + `recommendation-trust-guard`.
- `decompose_metric`, `get_metric_benchmark` (diagnosis + benchmarks).
- `care_queue` as read-only reference.
- The existing **segment** proposal flow remains the one in-scope "propose → user confirms" write path (segments are a data-exploration artifact).

## Success criteria (revised)
- The rail produces a benchmark-aware conclusion and then cited strategy recommendations framed on the targeted cohort/segment.
- No chat tool emits an action/confirm-write artifact for care/experiment/sweep; none calls a write endpoint.
- Genre/blind-spot/trust guardrails intact (uncited candidates dropped; blind spots never presented as strategy).

## Next steps
- P6 (tests + docs + lessons) updates to reflect the descope; remove action-loop assertions from the phase scope.
