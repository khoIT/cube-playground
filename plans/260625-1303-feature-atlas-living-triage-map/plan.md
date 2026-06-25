---
title: "Feature Atlas — living triage & ideation map"
description: "Loop-engineering Memory/State spine for cube-playground: a committed atlas.yaml (Surface→Feature→Direction) kept fresh by an on-demand /atlas reconcile ritual, rendered as a custom interactive in-app graph for human triage + ideation, dual-use as agent context."
status: pending
priority: P2
branch: "main"
tags: [internal-tooling, dev-experience, loop-engineering, atlas]
blockedBy: []
blocks: []
created: "2026-06-25T06:13:31.536Z"
createdBy: "ck:plan"
source: skill
---

# Feature Atlas — living triage & ideation map

## Overview

Single living map of every cube-playground feature for fast **triage** ("X is off → its deps, known drawbacks, related plan/code in <30s") and **ideation** ("see the map → spot gaps/adjacencies"). Replaces the rotted `docs/development-roadmap.md` pattern.

Loop-engineering mapping: this is the article's **Memory/State spine** pointed at a *human* (not an autonomous loop). Scheduling/automation explicitly **out of scope**. Freshness via an **on-demand reconcile ritual** (their "L1 report-only"), no cron.

Core architecture = 3 parts, all driven by ONE committed file:
1. **Spine** — `src/feature-atlas/atlas.yaml` (source of truth; dual-use: human view + agent-readable context). A `docs/feature-atlas/README.md` pointer keeps it discoverable from docs.
2. **Ritual** — `/atlas reconcile` skill diffs git + plans/ + MEMORY.md since last run, auto-drafts node updates (incl. directions/drawbacks), user curates.
3. **View** — pure-renderer in-app page `/admin/dev/atlas` (custom interactive viz, NOT raw Mermaid).

**Invariant:** the page is a *pure renderer*. All state/intelligence lives in `atlas.yaml`. Never hand-edit the view to encode feature state.

Authoritative design source: `plans/reports/brainstorm-summary-260625-1303-feature-atlas-living-triage-map-report.md`.

## Locked decisions (user, 2026-06-25)

1. **In-app interactive page** (reuse `src/pages/Catalog/cube-graph/` reactflow + concept-detail drawer) — not a doc.
2. **On-demand `/atlas reconcile`** ritual; NO automation/scheduling.
3. **Surface → Feature → Direction** 3-level node model.
4. **Whole-app scope** (~60 nodes); first reconcile run IS the seed harvest.
5. **NOT raw Mermaid** — custom interactive viz; design via **huashu-design** hi-fi HTML variants → pick/mix → React.
6. **Reconcile auto-drafts** directions/drawbacks from plan/memory text; user curates.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Spine + reconcile skill](./phase-01-spine-reconcile-skill.md) | Pending |
| 2 | [Visualization design (huashu)](./phase-02-visualization-design-huashu.md) | Pending |
| 3 | [In-app atlas page](./phase-03-in-app-atlas-page.md) | Pending |
| 4 | [Auto git-derivation (optional)](./phase-04-auto-git-derivation-optional.md) | Pending |

Build sequence delivers value before the expensive surface: **P1 produces a usable + greppable spine (zero app-build risk); P2 yields an already-interactive HTML prototype; P3 ports it in-app; P4 is optional polish.** Whole-app scope is honored at P1 (the seed harvest); the build is sequenced, not the scope.

## Success metrics

- Triage: feature → deps + drawbacks + plan/code links in < 30s.
- Freshness: a single `/atlas reconcile` run bounds drift; `reconciledAt` stays < ~2 weeks old in practice.
- Ideation: each shipped feature carries ≥1 curated direction; ≥1 cross-surface adjacency made obvious by the map.
- Dual-use: spine consumed as agent context in ≥1 later session.

## Dependencies

No blocking cross-plan deps. Adjacent-but-distinct surfaces (do NOT merge): `WhatsNew` inbox (user-facing release cards), Catalog Concept Map (cube schema graph). This atlas is internal/dev, admin-gated, separate route.

## Validation Log

### Session 1 — 2026-06-25 (verification + interview)

**Verification (Standard tier — Fact Checker + Contract Verifier):**
- Claims checked: ~10. Verified: `reactflow` import, `concept-detail` drawer, `js-yaml@4.1.0`, WhatsNew `import.meta.glob('?raw')` precedent, admin gate `authUser?.role==='admin'`, MEMORY.md path exists.
- FAILED → corrected: route registration is via `src/index.tsx` + `src/shell/tab-shell.tsx` (the `/admin/dev` DevAudit section, `src/pages/DevAudit/`), **NOT `src/App.tsx`**. Propagated to Phase 3.
- FAILED → resolved by decision: Vite `import.meta.glob` only ever reads inside `src/` today; reaching `docs/` is risky → canonical file relocated under `src/`.

**Decisions confirmed (user):**
1. **Atlas file home:** canonical `src/feature-atlas/atlas.yaml` (Vite `?raw`+js-yaml works directly); `docs/feature-atlas/README.md` is a pointer only. One source of truth, no build copy.
2. **Surface taxonomy (6):** LiveOps · Segments · Chat · Catalog/Data-Model · Advisor/Optimization · Ops & CS. Curatable later in `atlas.yaml`.
3. **Source format:** YAML.
4. **Reconcile draft depth:** Conservative — draft only high-confidence directions (plan §Upcoming/§Next-steps) + drawbacks (explicit memory caveats / known-issues); user adds the rest by hand.

### Whole-Plan Consistency Sweep
- Replaced all `docs/feature-atlas/atlas.yaml` refs with `src/feature-atlas/atlas.yaml` across plan.md + phases 1-4.
- Corrected route mount (App.tsx → index.tsx/tab-shell DevAudit) in Phase 3.
- Phase 1 surface taxonomy fixed to the confirmed 6; reconcile draft rule set to conservative.
- No remaining contradictions. Verification failures: 0 unresolved (both corrected). Plan eligible for implementation.
