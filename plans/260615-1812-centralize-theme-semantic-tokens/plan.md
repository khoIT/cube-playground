---
title: Centralize theme onto a single semantic-token layer
description: >-
  Collapse three parallel color systems (--hermes-* via T.*, raw --neutral-*,
  161 files of inline hex) onto one semantic-token contract. UI must stay
  pixel-intact at every step; add lint+CI to stop future drift.
status: pending
priority: P2
branch: main
tags:
  - theme
  - refactor
  - design-system
  - tech-debt
blockedBy: []
blocks: []
created: '2026-06-15T11:18:23.944Z'
createdBy: 'ck:plan'
source: skill
---

# Centralize theme onto a single semantic-token layer

## Overview

The UI runs **three parallel color systems**, which is why surfaces drift apart and dark mode is fragile:

1. **`--hermes-*` raw scale** (34 tokens) consumed via the typed `T.*` proxy in **66 `src/shell/*` files**.
2. **`--neutral-*` raw scale** (12 tokens) referenced directly in **20 files** — and re-used as the *definition* of semantic text/border tokens, so one raw token carries two meanings across themes (the footgun: `--neutral-50` = cream surface in light, primary text in dark).
3. **Inline hex** in **161 files** that bypass tokens entirely.

The intended **semantic layer** (`--bg-card`, `--border-card`, `--text-primary`, status `--*-soft/--*-ink`, `--radius-*`, `--shadow-*`, `--font-*` — 51 tokens) already exists but is under-used and is itself wired through the raw scales.

**Goal:** one coherent semantic-token contract that every component reads, single-meaning primitives feeding it, the parallel raw scales removed, and an automated guard so drift can't return. **Hard constraint: the current UI must stay visually intact (light + dark) at every phase boundary.**

**Strategy — visual gate first, then safety-first ordering:** build a full-app visual-regression gate (light + dark) and capture pre-refactor baselines **before any token change** (Phase 0). Then repoint the raw scales to *alias* the semantic layer (zero visual change as a net), migrate components onto semantic tokens area-by-area, and delete the now-dead raw scales. Every phase boundary must pass the Phase 0 visual gate in both themes.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 0 | [Visual-Regression Harness (gate, built first)](./phase-00-visual-regression-harness.md) | Completed |
| 1 | [Token Contract & Safe Aliasing](./phase-01-token-contract-safe-aliasing.md) | Pending |
| 2 | [Migrate Shell (T.* + raw neutral)](./phase-02-migrate-shell-t-raw-neutral.md) | Pending |
| 3 | [Inline-Hex Sweep](./phase-03-inline-hex-sweep.md) | Pending |
| 4 | [Enforcement & Cleanup](./phase-04-enforcement-cleanup.md) | Pending |

## Key Decisions (user-confirmed)

- **Pixel-intact guarantee:** **full visual-regression first** — Phase 0 extends the existing (mock-only) playwright harness to the live app across major routes × light+dark, captures baselines on `main`, and gates every later phase. The Phase 1 aliasing invariant (raw scales resolve to byte-identical hex) is the secondary, provable guard.
- **T.\* proxy:** "do what's best, UI must stay intact" → repoint `T.*` to resolve to semantic tokens first (zero visual change), migrate shell files onto semantic vars, then retire the color half of `T` (keep `cx`/`Icon`/font helpers).
- **Inline hex:** migrate **all 161 files** this round; when a hex has no exact-matching token, **add a new semantic token** (never snap to nearest — preserves the exact pixel).
- **Chart palette:** promote all **8** `CHART` colors in `theme.tsx` to `--chart-1..8` tokens (only `--chart-1..5` exist today); `CHART` reads from them.
- **Enforcement:** add a **lint rule + pre-push git hook** (husky/simple-git-hooks) — there is **no in-repo CI** today and deploy happens via pushing the `second` remote, so a pre-push gate catches drift before it ships.

## Dependencies

- **Coordination risk — `src/shell/*`:** unfinished plans `260615-1456-revamp-left-nav-bar` and `260615-1458-revamp-left-nav-bar-impl` edit the same shell files Phase 2 migrates. If either is in-flight, land it first or sequence Phase 2 after it to avoid churn/conflicts on shared files. Not a hard code dependency (this plan repaints; nav plans restructure), but same-file overlap — confirm status before starting Phase 2.
- Concurrent-session rule: parallel Claude sessions edit this repo. Stage only this plan's own files; never `git add -A`; never `git stash`.

## Success Criteria (whole plan)

- [ ] Phase 0 visual gate (light + dark, major routes) passes against committed baselines and bites on a deliberate color change.
- [ ] Zero `T.*` color references and zero raw `var(--neutral-*)` / `var(--hermes-*)` in component files (`src/**` excluding `src/theme/tokens.css`).
- [ ] Zero inline hex in `src/**/*.{ts,tsx}` outside the allowlist; `--chart-1..8` defined and `CHART` reads from them.
- [ ] `--hermes-*` scale removed; `--neutral-*` retained only as private primitives feeding the semantic layer (or removed if folded).
- [ ] App is pixel-intact in light + dark vs. pre-refactor on Dashboards, Segments, Ops, Chat, Catalog, Advisor, shell chrome (proven by the Phase 0 gate).
- [ ] `npm run lint` exists, passes, and fails on a newly introduced raw-token/inline-hex reference; enforced via a pre-push git hook.

## Validation Log

### Session 1 — 2026-06-15

**Verification (Standard tier — Fact Checker + Contract Verifier):**
- VERIFIED: 66 files import `src/shell/theme` (`T.*`); 20 files reference raw `var(--neutral-*)`; 161 files contain inline hex; `--hermes-*` = 34, `--neutral-*` = 12, semantic = 51 tokens.
- VERIFIED: `--surface-{shell,sidebar,topbar,panel}` semantic tokens do NOT exist yet (Phase 1 adds them); `--chart-1..5` exist but `CHART` array in `theme.tsx` has 8 colors.
- VERIFIED: test runner = vitest; `typecheck = tsc --noEmit`.
- **FAILED (corrected):** original plan risk note claimed "no automated visual-regression tooling yet." Wrong — `@playwright/test` + scripts `test:visual` / `test:visual:update` / `visual:capture-baselines` exist. BUT harness is mock-only (`tests/visual/mock-fork/Cube Segment.html`), 0 committed baselines, no dark-mode path → not a ready gate. Resolution: new **Phase 0** extends it.
- **FAILED (corrected):** original Phase 4 assumed a `.gitlab-ci.yml` to hook lint into. No in-repo CI config found (`.gitlab-ci.yml` / `.github/workflows` absent). Resolution: enforce via **pre-push git hook** instead.

**Interview decisions:**
1. Pixel-intact strategy → **Full visual-regression first** (new Phase 0; gate every phase, both themes).
2. Lint enforcement hook → **pre-push git hook + `npm run lint`** (no in-repo CI).
3. Chart palette → **promote all 8 to `--chart-1..8` tokens**.
4. Non-matching hex in sweep → **add a new semantic token** (never snap to nearest).

**Propagation:** Phase 0 created; Phases 1–4 dependencies updated to require Phase 0; Phase 1 adds `--chart-6..8`; Phase 2/3 verification reworded to "pass Phase 0 visual gate" instead of ad-hoc manual checks; Phase 3 locks add-a-token default; Phase 4 switches CI→pre-push hook.
