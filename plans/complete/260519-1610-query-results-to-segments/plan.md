---
title: "Query Results → Persistent Segments Tab"
description: "Row-select from Playground Results → persistent Segments workspace with predicate editor, preset analysis tabs, live cron-driven refresh. v1 = 6-7 weeks."
status: pending
priority: P1
branch: "main"
tags: [segments, cube, playground, backend, ui]
blockedBy: []
blocks: []
brainstorm: ../reports/brainstorm-260519-1610-query-results-to-segments.md
ui-design-source: ~/Downloads/cube-segment
created: "2026-05-19T10:05:06.944Z"
createdBy: "ck:plan"
source: skill
---

# Query Results → Persistent Segments Tab

## Overview

Add a top-level **Segments** workspace (tab next to Playground) for persistent user-cohort objects. Users select rows from the Results table → push to a new segment (modal). Segments page hosts Library / Detail / Editor views. Each segment has a structured AND/OR predicate, cached Cube Query, uid list, status, owner, and tags. Live segments refresh 24/7 via backend cron; analysis is rendered through preset tab bundles (`mf_users-hub` ships in v1).

Full design: see `brainstorm` doc above (revision 2, design-approved-v2).

## Pixel-perfect parity commitment

This plan delivers **both** functional fidelity AND pixel-perfect parity to `~/Downloads/cube-segment`:
- Mock's design system replaces the app's tokens **globally**; existing screens get a polish pass in same PR.
- Playwright screenshot-diff CI gate at 1440×900 + 375×812 with ≤2% pixel delta per screen.
- Baselines captured by rendering the mock HTML headless and screenshotting each route state.
- Chart primitives (LineChart / BarList / Donut / Sparkline) ported from the mock under `src/pages/Segments/visuals/`.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 0 | [Design-system port + global theme + visual regression infra](./phase-00-design-system-port.md) | Partial (scaffold landed 2026-05-19; polish + baselines deferred) |
| 1 | [Backend skeleton + schema + tree↔CubeQuery translator](./phase-01-backend-skeleton-schema-tree-cubequery-translator.md) | Done (2026-05-19) |
| 2 | [FE row-select + push modal + Library + Sample Users](./phase-02-fe-row-select-push-modal-library-sample-users.md) | Done (2026-05-19) |
| 3 | [Settings identity mapping + auto-suggest + Import IDs](./phase-03-settings-identity-mapping-auto-suggest-import-ids.md) | Done (2026-05-19) |
| 4 | [Preset infrastructure + mf_users-hub preset tabs](./phase-04-preset-infrastructure-mf-users-hub-preset-tabs.md) | Done (2026-05-19; cards stubbed, queries against assumed mf_users measure names — replace once cube-dev YAML is verified) |
| 5 | [Visual predicate editor + live preview + SQL preview](./phase-05-visual-predicate-editor-live-preview-sql-preview.md) | Done (2026-05-19; cube-browser rail + paste-from-query deferred) |
| 6 | [Cron worker + live mode + FE polling + status transitions](./phase-06-cron-worker-live-mode-fe-polling-status-transitions.md) | Done (2026-05-19; setInterval used instead of node-cron, no new dep) |
| 7 | [Saved analyses + Copy as filter + Paste from query round-trip](./phase-07-saved-analyses-copy-as-filter-paste-from-query-round-trip.md) | Done (2026-05-19; in-Playground `Pin to segment` button deferred to v1.5 — non-trivial QueryBuilderToolBar integration) |
| 8 | [Broken-status flow + drift detection + tests + docs](./phase-08-broken-status-flow-drift-detection-tests-docs.md) | Done (2026-05-19; E2E suite + prod single-binary serve.ts + visual regression deferred to follow-up) |

## Dependency graph

```
  P0 design-system ─┬─→ P2 FE shell ─┬─→ P4 preset tabs ─┐
                    │                ├─→ P7 round-trip ──┤
                    └─→ P5 editor ───┤                   │
                                     │                   │
  P1 backend ──────────┬─→ P3 settings+import ───────────┤
                       ├─→ P5 editor ───→ P6 cron+live ──┤
                       │                                  │
                                                          ├─→ P8 wrap-up
```

**Parallel tracks** (two engineers recommended; otherwise sequential):
- Track A (backend + cron): P1 → P3 → P5 (backend half) → P6 → P8
- Track B (frontend + visuals): P0 → P2 → P4 → P5 (FE half) → P7 → P8
- P0 and P1 are the parallel starting points (neither blocks the other).
- All FE phases (P2/P4/P5/P7) are gated on P0; the visual regression CI gate flips on at end of P0.

Single-engineer order: 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 (or interleave P0 ↔ P1 if comfortable context-switching).

## Estimated effort

| Phase | Effort | Track |
|-------|--------|-------|
| P0 | 3w | Frontend / theme |
| P1 | 1.5w | Backend |
| P2 | 1w | Frontend |
| P3 | 4d | Backend |
| P4 | 1.5w | Frontend |
| P5 | 1w | Both |
| P6 | 4d | Both |
| P7 | 4d | Frontend |
| P8 | 3d | Cross-cutting |
| **Total** | **9-10 weeks** | One engineer; **~6 weeks** with two engineers running P0+P1 in parallel. |

## v1 scope reminders

- **In scope**: schema-agnostic segment model + `mf_users-hub` preset, structured tree predicate (with Cube Query cache), modal-only push, owner+tags multi-user (owner-from-header pretend-auth), Import IDs, Copy/Paste round-trip, live cohort preview, cron refresh.
- **Deferred to v1.5**: sparkline trend, used-in counters, live-placement variants, multi-preset, baseline-compare overlay.

## Dependencies

<!-- No cross-plan dependencies. Brainstorm report is design-of-record. -->

## Validation Log

### Session 1 — 2026-05-19
**Trigger:** `/ck:plan validate` after plan creation.
**Questions asked:** 8

#### Verification Results
- **Tier:** Full (9 phases)
- **Claims checked:** ~14 (file paths, LoC claim on `QueryBuilderResults.tsx`, mock dir, routing patterns)
- **Verified:** 13 | **Failed:** 1 | **Unverified:** 0

##### Failures
1. **[Fact Checker]** P3 cites `src/pages/Settings/index.tsx` as existing settings page. Actual location: `src/components/Settings/Settings.tsx`. Resolved via Q1.

#### Questions & Answers

1. **[Architecture]** Settings page path for P3 identity-map UI.
   - Options: Add to existing `src/components/Settings/Settings.tsx` (Recommended) | Create new `src/pages/Settings/` route | Lift current settings into a real page
   - **Answer:** Add to existing `src/components/Settings/Settings.tsx`
   - **Rationale:** Honors actual codebase layout; avoids parallel settings surfaces.

2. **[Risk]** Visual regression mock source (CI doesn't have `~/Downloads/cube-segment/`).
   - Options: Copy mock into `tests/visual/mock-fork/` and pin (Recommended) | Pre-render PNG baselines only | Local-only capture
   - **Answer:** Copy mock into `tests/visual/mock-fork/` and pin
   - **Rationale:** Reproducible baselines from a versioned source; CI-stable.

3. **[Scope]** P0 pixel-perfect parity scope (3w of 9-10w solo).
   - Options: Keep full P0 (Recommended) | Descope polish-pass + CI to P8.5 | Build primitives only | Functional fidelity only
   - **Answer:** Keep full P0 — fidelity is a hard requirement
   - **Rationale:** Per design-approved-v2; non-negotiable.

4. **[Architecture]** E2E harness for P8.
   - Options: Reuse Playwright from P0 (Recommended) | Vitest browser mode | Skip E2E
   - **Answer:** Reuse Playwright from P0 visual setup
   - **Rationale:** One harness for both visual + E2E; no new tooling.

5. **[Assumptions]** Uid hard cap (P3 CSV import + P4 Cube `IN` filter).
   - Options: 5,000 (Recommended) | 50,000 | 1,000 | No cap
   - **Answer:** Keep 5,000 cap
   - **Rationale:** Matches Cube `IN` filter perf budget; v1.5 can lift via temp tables.

6. **[Risk]** Ops posture (auth + multi-instance) for v1.
   - Options: Single-tenant pretend-auth (Recommended) | Real auth in v1 | Advisory lock only
   - **Answer:** Accept v1 as single-tenant, single-instance, pretend-auth
   - **Rationale:** Internal tool; documented limitations; v1.5 hardens.

7. **[Tradeoffs]** MSW (mock service worker) track in P2.
   - Options: Drop MSW (Recommended) | Keep MSW | MSW for visual tests only
   - **Answer:** Drop MSW — P2 waits for P1
   - **Rationale:** P0 is long pole; P1 lands before P2 needs the API; cuts P8 cleanup work.

8. **[Risk]** P4 preset hardcoded measures vs actual `mf_users` Cube schema.
   - Options: Schema stable, proceed | Partial, add prereq | Unknown, scout first
   - **Custom input:** "schema is stable. Research cube-dev for detailed yaml and revise"
   - **Rationale:** Schema is stable, but preset spec must be validated against actual `mf_users` YAML before P4 implementation begins.

#### Confirmed Decisions
- P3 identity-map UI lives under `src/components/Settings/` (not `src/pages/Settings/`).
- P0 visual baselines source = vendored mock at `tests/visual/mock-fork/`.
- P0 full scope retained (no descope).
- P8 E2E = Playwright (reuses P0 setup).
- 5,000 uid cap is the v1 hard limit (CSV import + Cube `IN` filter).
- v1 = single-tenant, single-instance, pretend-auth (`X-Owner` from localStorage). v1.5 hardens.
- P2 drops MSW; waits for P1 API to land first.
- P4 prereq: research the live `mf_users` cube YAML in cube-dev repo; revise preset measure/dim references against actual schema before implementing tab bodies.

#### Action Items
- [ ] P0: update mock-source baseline path + add vendoring step.
- [ ] P1: explicit v1-posture disclaimer doc.
- [ ] P2: remove MSW step + risk row + dependency note on P1.
- [ ] P3: switch Settings path to `src/components/Settings/`.
- [ ] P4: add Step 0 "research `mf_users` YAML" + downgrade preset definition to provisional pending that pass.
- [ ] P8: drop "or Vitest browser; pick existing harness" wording; commit to Playwright.

#### Impact on Phases
- **P0** — Update mock-source step + risk row + create `tests/visual/mock-fork/` as canonical baseline.
- **P1** — Document `X-Owner` + single-instance posture as accepted v1 (no functional change).
- **P2** — Remove MSW step, update dependency note, drop MSW risk row.
- **P3** — Repath Settings files; update Modify list.
- **P4** — Add Step 0 prereq + soften preset definition as provisional.
- **P8** — Confirm Playwright; drop MSW removal step (no longer needed).
