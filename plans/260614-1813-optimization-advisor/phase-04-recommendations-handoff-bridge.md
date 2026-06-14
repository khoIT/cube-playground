# Phase 04 — Recommendations + reversible hand-off to Command Center (the Drive posture)

> Implements **Recommend** + **Drive** and the two bridge mechanics that make the whole UX work:
> **explode** (recommendation → its evidence) and **promote** (exploration → experiment draft). The AI/tool
> never silently commits — the hand-off is always an editable draft.

## Overview
- **Priority:** P0.
- **Status:** ✅ done (2026-06-14, hand-off vs STUB command-center). Backend: `server/src/routes/advisor.ts` (POST `/diagnose` `/recommend` `/handoff` `/feedback` + GET drafts/feedback; registered in `index.ts`); `recommend.ts` (diagnose→rankCandidates orchestration + optional additive LLM phrasing); `handoff-scaffolder.ts` (candidate→editable draft, status ALWAYS 'draft', treatment-share clamped ≤0.85, CS-queue vs external delivery, deterministic idempotent draftId); `command-center-draft-store.ts` + `feedback-store.ts` (SQLite stub stores) + migration `054-advisor-handoff-feedback.sql`. Frontend: `recommendations.tsx` (cards + explode-to-evidence + feedback dismiss/pin), `command-center.tsx` (hand-off screen), live-wired to `src/api/advisor.ts`. Viewer write-gate covers `/api/advisor/handoff` + `/feedback` (read POSTs `/diagnose` `/recommend` stay open). 13 new backend tests; full suite 1549/1549. **DEFERRED: the real Experiment Command Center registry is not built — `/handoff` persists drafts to the STUB store (swap-point documented). Learn-back (`recordResult` write-back on scorecard finalize) deferred with it. STUB stores trust client gameId/segmentId (single default workspace today); the real registry owns multi-tenant scoping.**
- Render the ranked experiment cards (Phase 2 output), wire the Decide actions (tune / portfolio / manual
  hypothesis), and build the reversible hand-off that scaffolds an editable experiment draft into the
  Experiment Command Center (plan `260614-0018`), then closes the loop by writing results back to the Library.

## Key insights — the reversible hand-off (the trust mechanic)
- **Accept → editable draft, never a black-box commit.** Accepting a recommendation scaffolds the experiment
  (cohort = a Segment, arms, split, window, power, CS work queue) as a **draft** in the command-center registry.
  The user inspects/tweaks/launches — or kicks it back to Explore. This is the acceptance criterion that earns analyst trust.
- **Explode:** every card has "show the evidence" → jumps to the Phase 3 lenses + provenance that produced it.
- **Promote:** any exploration state (a refined segment, a peer finding) has "→ test this" → becomes a candidate → a draft.
- **Trust ladder gates the offer:** the "I can set this up for you" affordance appears only when confidence is
  high + a library-backed prior exists; otherwise the card stays at "here's what I see, you decide."
- **Feedback loop:** dismiss/pin an opportunity with a reason (structural / known / not-now) → the human half of
  the Treatment-Effect Library; trains future diagnosis ranking.
- **Portfolio under capacity:** with CS capacity/day + guardrails, pick the *mix* of experiments that maximizes
  ₫ (a knapsack, not a single pick) — the prototype's capacity slider.

## Requirements
Functional:
1. **Recommendation cards** — hypothesis · lever/playbook · expected lift + confidence/source · addressable N · feasibility(actuator) · **power verdict** · expected incremental ₫ · "Launch in Command Center". Each card explodes to its evidence.
2. **Decide actions:** (a) **tune** a candidate (arm split / window / metric / expected-effect) → power+CI+₫ recompute live; (b) **portfolio** knapsack under CS capacity + guardrails; (c) **add manual hypothesis** → Advisor power-checks + estimates it.
3. **Reversible hand-off** — `POST /api/advisor/handoff` scaffolds a command-center experiment **draft** (status=draft) from a candidate: maps the cohort to a Segment (Phase 0 predicates), proposes arms/split/window/power, links the playbook → CS queue. Returns the draft for inspection; user edits + launches in the command center.
4. **Promote / explode** wiring between Explore (Phase 3) and Recommend.
5. **Feedback** — `POST /api/advisor/feedback` (dismiss/pin + reason) → Library human signal.
6. **Learn-back** — when a command-center experiment completes, its measured effect writes to the Treatment-Effect Library (updates the Phase 2 prior). Hook into the scorecard finalize.
7. **Advisor API routes** (gateway, Fastify): `/api/advisor/diagnose`, `/recommend`, `/handoff`, `/feedback` — feeding Phases 1–3.

Non-functional: hand-off draft is never auto-launched; idempotent draft creation; feedback + learn-back are append-only.

## Related code files
Create: `server/src/routes/advisor.ts`; `server/src/advisor/handoff-scaffolder.ts`; `src/pages/Advisor/recommendations.tsx`, `candidate-tuner.tsx`, `portfolio-knapsack.tsx`, `feedback-controls.tsx`.
Modify: command-center registry/assignment service (accept a draft from the Advisor); command-center scorecard finalize (emit learn-back to the Library); `src/index.tsx` route wiring; gateway route registration (`server/src/index.ts`).
Read: command-center plan phases 2–3 + 5 (registry/assignment + scorecard); Phase 2 candidate-ranker + Library.

## Implementation steps
1. `advisor.ts` routes (diagnose/recommend/handoff/feedback) wiring Phases 1–2.
2. `recommendations.tsx` cards + explode-to-evidence.
3. `candidate-tuner.tsx` (live power+CI+₫ recompute) + `portfolio-knapsack.tsx` (capacity slider).
4. `handoff-scaffolder.ts` → command-center draft (status=draft); cohort→Segment via Phase 0 predicates; never auto-launch.
5. `feedback-controls.tsx` + `/feedback` → Library.
6. Learn-back hook on scorecard finalize → Library prior update.
7. Build + Playwright (cards, tune, hand-off draft round-trips and is editable, kick-back-to-explore works).

## Todo
- [ ] `advisor.ts` routes (diagnose/recommend/handoff/feedback)
- [ ] recommendation cards + explode-to-evidence
- [ ] candidate tuner (live recompute) + portfolio knapsack
- [ ] `handoff-scaffolder.ts` → editable command-center draft (no auto-launch)
- [ ] promote (exploration → candidate) wiring
- [ ] feedback controls → Library
- [ ] learn-back on scorecard finalize → Library prior
- [ ] build + Playwright round-trip

## Success criteria
- Accepting the win-back recommendation on `5ee78131…` creates a **draft** experiment in the command center with cohort, arms, power, and CS queue prefilled — editable, not launched.
- "Show evidence" on any card jumps to its lenses + provenance; "→ test this" from a refined segment produces a candidate.
- Dismissing an opportunity with a reason suppresses it next diagnosis and is recorded in the Library.
- A completed command-center experiment updates the matching Library prior (assumption → measured).

## Risks
| Risk | L×I | Mitigation |
|---|---|---|
| Hand-off auto-commits (trust killer) | L×H | draft status only; explicit launch in command center; covered by a test. |
| Cohort→Segment mismatch on hand-off | M×H | reuse Phase 0 predicate compile; assert draft cohort N ≈ diagnosis N. |
| Learn-back double-counts | M×M | append-only, keyed by experiment id; idempotent. |
| Portfolio knapsack overfits to ₫, ignores fatigue | M×M | guardrails (contact-frequency cap) are hard constraints in the knapsack. |

## Security (PII)
Hand-off carries `user_id` + numeric/action data only (same as command-center Phase 1 readers). Drafts hold no contact PII; CS resolves contact in their own tooling.

## Next steps
Phase 5 tests the full Explore→Recommend→Drive→Learn loop end-to-end and documents it.
