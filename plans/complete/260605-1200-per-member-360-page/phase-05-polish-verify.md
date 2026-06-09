---
phase: 5
title: "Polish + Verify"
status: pending
priority: P2
effort: "1d"
dependencies: [4]
---

# Phase 5: Polish + Verify

## Overview
Design-token polish to match the mockup/adjacent pages, then end-to-end verification: panel data reconciles against the cfm-user360 dashboard + direct Trino, guardrail enforced, no members-tab regression. Update docs.

## Requirements
- Functional: page matches the approved mockup; values reconcile; all panels render or show correct empty-states for a real cfm member.
- Non-functional: zero new lint/type/build errors; design drift cross-check passes; tests green.

## Architecture
Verification mirrors the porting plan's E2E approach: pick a high-activity cfm `user_id` via the Trino harness, open its 360, reconcile 2–3 measures (e.g. `ltv_vnd`, role count, a recent recharge sum) against direct Trino and against the live cfm-user360 dashboard. Confirm the Behavior guardrail (no unbounded scan) and members-tab integrity.

## Related Code Files
- Modify: member360 components (token/spacing/responsive polish)
- Read: `plans/260604-2317-cfm-vn-cube-model-full-port/scripts/trino_q.py` (fixture user + value reconcile)
- Update: `docs/codebase-summary.md`, `docs/project-changelog.md`; add a `docs/lessons-learned.md` entry if a bug-shape surfaces

## Implementation Steps
1. Cross-check page vs `visuals/member-360-mockup.html` + an adjacent page (typography/padding/radius/color); fix drift.
2. Responsive pass (narrow viewport: KPI strip + tables reflow).
3. Pick fixture cfm user via Trino; reconcile `ltv_vnd`, role count, recent recharge sum across page ↔ Trino ↔ dashboard.
4. Guardrail check: confirm Behavior never sends an unbounded/>31d query.
5. Regression check: members tab search/export/sort + segment DetailView tabs unaffected; run existing resolver tests (`src/lib/__tests__/cube-member-resolver.test.ts`).
6. `code-reviewer` pass (acceptance criteria, touchpoint regressions, contracts, patterns, lint/type/build).
7. Update docs.

## Success Criteria
- [ ] Page matches mockup + adjacent pages (no drift).
- [ ] 2–3 measures reconcile: page == Trino == dashboard.
- [ ] Behavior guardrail holds (no unbounded query); event panels respect ≤31d.
- [ ] No members-tab / DetailView regression; resolver + new unit tests green; no new lint/type/build errors.
- [ ] Docs updated (codebase-summary, changelog; lessons-learned if applicable).

## Risk Assessment
- Silent join drift (renders but wrong numbers): reconcile against Trino, not just "non-empty".
- Token drift creeping in during build: explicit side-by-side cross-check step before sign-off.
- Shared-file merge risk with snapshot plan: re-confirm `sample-users-tab.tsx` change is still the minimal cell→link diff at review time.
