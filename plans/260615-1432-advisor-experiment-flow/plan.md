---
title: "Advisor → Experiment Flow (linear: review → approve cohort → split → live monitoring)"
description: "Turn the AI Drive proposal into a real experiment via a linear flow. Reframe away from the Command Center, kill the segment-pick dead-end, bridge proposal→segment, and wire real treatment/hold-out outcomes (illustrative behind a URL flag)."
status: in-progress
priority: P1
branch: main
created: 2026-06-15
---

# Advisor → Experiment Flow

User intent (verbatim): the AI proposes an experiment → **create the cohort into a
segment (user approves)** → once set, a screen to **review action + split** →
once done, **live monitoring where treatment & hold-out are tracked separately**.
No Command Center framing. No CS work queue yet (per-experiment customizable later).

## Locked decisions (from user, 2026-06-15)
1. **Cohort→Segment:** HYBRID — create-from-proposal when the agent emits a usable
   predicate; otherwise fall back to picking an existing segment. Either path then
   auto-scaffolds the draft and advances (no blank-panel dead-end).
2. **Monitoring surface:** REUSE the existing treatment-vs-hold-out board + lifecycle
   from `command-center.tsx`, reframed as the last step of a LINEAR flow; strip the
   Command Center chrome + the CS-queue delivery toggle.
3. **Monitoring data:** WIRE REAL treatment-vs-hold-out outcome queries; a URL flag
   (`?illustrative=1`) forces the hardcoded demo bars for no-Cube hosts / demos.

## Already shipped this iteration
- **Markdown rendering** of the Drive narration + run-replay transcript
  (`advisor-markdown.tsx`; replaces raw `pre-wrap`). 3 tests green. ✅

## Diagnosis: why "pick a segment after AI drives leads to nothing"
Game-scope Drive emits PROSE only — `scaffold_draft` requires a `segmentId`
(`scaffold-draft-tool.ts` early-returns at game scope). "Pick a segment" does
`history.push('/advisor/:id', {driveBoot, driveSeed})` which re-mounts a FRESH
Drive panel (seed pre-filled, NOT auto-run). The prose proposal is discarded; the
described cohort is never created. Not a crash — a UX dead-end. Fixed in Phase B.

## Reconciliation with the pending Experiment Command Center plan
`plans/260614-0018-experiment-command-center/` (status: pending, ~6d, nothing built)
IS the real-outcome data layer. Its phases 1–3 (cohort/outcome/exposure readers →
assignment registry → routes/scorecard) are the substance of "wire real outcomes."
**Do not duplicate** — Phase C below activates those phases behind the `illustrative`
flag rather than re-deriving readers.

## Phases

| # | Phase | Scope | Depends | Status |
|---|-------|-------|---------|--------|
| A | Linear flow reframe | Frontend only. Strip Command Center chrome + CS-queue; present review→split→monitor linearly. Reuse the arms board (illustrative, labeled). | markdown done | ✅ done |
| B | Cohort→segment bridge + kill dead-end | Agent emits a cohort predicate at game scope (`propose_cohort`, compile-validated); "Approve & create segment" → create → auto-run-scaffold → auto-advance to review. Else fall back to pick-existing, also auto-advancing. | A | ✅ done (deterministic) — live agent smoke pending |
| C | Real outcomes wiring | Cube-first (billing_detail) outcome reader + experiment registry/assignment (SQLite) + routes; monitor board shows real treatment-vs-hold-out; `?illustrative=1` forces demo bars. cfm_vn + jus_vn. | A, B | ✅ done — live-verified on real cube data |

## Phase A — what shipped
- `command-center.tsx` reframed to "📡 Live monitoring", CS-queue delivery toggle removed
  (collapsed to owner-run external/manual), `deliveryMode` state dropped, doc comment + CTA
  labels + leftover user-facing "Command Center" strings updated.

## Phase B — what shipped (deterministic; live agent behavior needs a smoke test)
- Auto-run on re-scope (`drive-panel.tsx` `autoRan` effect) + scaffold-nudging re-scope seed
  (`index.tsx reScopeToSegment`) — picking/creating a segment now flows forward instead of
  landing on a blank panel.
- `propose_cohort` agent tool (compile-validates the predicate before persisting), migration
  059 + `cohort-proposal-store.ts`, `GET /api/advisor/cohort-proposal/:sessionId`, `sessionId`
  threaded into `ToolContext`, game-scope system-prompt nudge.
- Client: `fetchCohortProposal` + "Approve & create '{name}'" create flow in `drive-panel.tsx`
  (falls back to pick-existing when no proposal). Tests: store + tool (valid/invalid/scope).
- **Open:** whether the live agent reliably calls `propose_cohort` with a compilable predicate
  against real cubes is unverified here — needs a live Drive smoke test (OAuth + Cube lane).

## Build order rationale
- **A first** — pure frontend, low risk, delivers the visible "linear flow" win and
  the design the user described, without touching the data layer.
- **B next** — fixes the reported dead-end and makes the proposal actionable; moderate
  backend (predicate emission) with a safe pick-existing fallback.
- **C last** — the heavy lift (= the pending 6-day plan). Gated behind the flag so the
  flow works end-to-end on illustrative data until C lands.

## Open questions
- Phase B feasibility: can the Segments predicate engine express "cut spend in last
  30d" (derived-date/delta)? If not, that cohort falls to pick-existing — verify in B.
- Phase C is large; confirm whether to proceed straight into it after B, or treat
  A+B as the deliverable for this round.
