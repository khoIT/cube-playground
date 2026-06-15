---
phase: 0
title: 'Visual-Regression Harness (gate, built first)'
status: completed
priority: P1
effort: 1.5d
dependencies: []
---

# Phase 0: Visual-Regression Harness (gate, built first)

## Overview

Stand up a real full-app visual-regression gate **before any token work**, covering the major routes in **both light and dark** mode, and capture baselines against the current (pre-refactor) UI. Every later phase must pass this gate at its boundary. This is the enforceable form of the hard constraint "UI stays pixel-intact in both themes."

## Key Insights

- Tooling already exists but is **scaffolding only**: `@playwright/test` is installed; scripts `test:visual`, `test:visual:update`, `visual:capture-baselines` exist; config at `tests/visual/playwright.config.ts`. But it renders **one vendored mock** (`tests/visual/mock-fork/Cube Segment.html`), has **0 committed baselines**, and **no dark-mode** path. It must be extended to the live app + themes.
- Baselines MUST be captured on `main` *before* Phase 1 changes any token, or the gate validates against an already-changed UI (useless).
- Dark mode toggles via `:root[data-theme="dark"]` (see `tokens.css` / ThemeContext). The harness must set that attribute (or drive the in-app theme toggle) and snapshot each route twice.

## Requirements

- Functional: `npm run test:visual` renders an agreed set of major routes at desktop viewport in light + dark and diffs against committed baselines; fails on pixel drift above threshold.
- Non-functional: deterministic renders (stable data/seed, disabled animations, `networkidle`); baselines committed to the repo; runnable locally without VPN where possible (mock/seeded data).

## Architecture

- Extend `tests/visual/` to drive the running dev app (or a seeded static render) across a **route manifest**: shell chrome, Dashboards, Segments (+ member360, care tab), Ops Console (overview + trends + members), Chat (+ a query/chart artifact), Catalog, Advisor, Liveops cohort. Start ~8-10 high-signal routes; expand if cheap.
- Each route captured in a `themes = ['light','dark']` loop: set `data-theme`, wait for paint, snapshot. Naming: `<route>__<theme>.png`.
- Threshold: small non-zero `maxDiffPixelRatio` to absorb font-AA noise; tune so a real color change fails but AA jitter doesn't.
- Determinism: freeze any time/random-driven UI, disable CSS transitions during capture, use seeded/mock data so charts/tables are stable.

## Related Code Files

- Modify/Create: `tests/visual/playwright.config.ts`, `tests/visual/capture-baselines.ts` (extend beyond the single mock), new `tests/visual/routes.manifest.ts`, new spec(s) under `tests/visual/`.
- Create: committed baseline PNGs under `tests/visual/baselines/` (light + dark).
- Modify: `package.json` only if a route-driven script variant is needed (reuse existing `test:visual*` scripts where possible).

## Implementation Steps

1. Decide capture target: live dev server (richest, may need seeded data) vs. seeded static render. Prefer whichever renders the real components deterministically without VPN.
2. Build the route manifest + a `themes` loop; set `data-theme` for dark.
3. Make renders deterministic (seeded data, disabled animation, networkidle, fixed viewport).
4. Capture baselines on current `main` (pre-refactor) via `visual:capture-baselines` / `test:visual:update`; commit them.
5. Sanity-check the gate: hand-tweak one token, confirm `test:visual` fails the right route×theme, revert.
6. Document the gate + "how to update baselines intentionally" in `docs/design-guidelines.md`.

## Success Criteria

- [ ] `npm run test:visual` covers the agreed routes in light + dark and passes against committed baselines on current `main`.
- [ ] A deliberate single-token color change makes the gate FAIL on the expected route×theme (proves it bites); reverted after.
- [ ] Baselines committed; run is deterministic (re-run is green with no diff).
- [ ] Gate procedure documented.

## Risk Assessment

- **Risk:** flaky/non-deterministic renders cause false failures, eroding trust in the gate. **Mitigation:** seeded data, disabled animations, AA-tolerant threshold; iterate until two consecutive clean runs.
- **Risk:** live-app capture needs VPN/back-end data not available in test. **Mitigation:** prefer seeded/mock render path; scope routes to those renderable without live data; note any route the gate cannot cover (manual check fallback).
- **Risk:** over-broad route set makes the suite slow. **Mitigation:** start with ~8-10 high-signal routes; desktop viewport only initially.
