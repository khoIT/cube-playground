---
title: "Top-bar redesign: brand + middle pills (Playground/New Metric/Catalog) + user menu + dark-light + i18n"
description: "Restructure app header to match Image #3: branded BrandBlock with logo, three middle nav pills (Playground/New Metric/Catalog), right cluster with search/help/notification/user-avatar. Settings moves into user-avatar dropdown alongside dark-light and VN-EN toggles. Models becomes a tab inside Catalog (legacy /schema migrates). Playground sidebar Settings dropdown + NewMetric CTA removed (now header-level)."
status: completed
priority: P2
branch: "multi_metric"
tags: ["ui", "navigation", "theming", "i18n"]
blockedBy: []
blocks: []
created: "2026-05-17T09:07:07.687Z"
createdBy: "ck:plan"
source: skill
---

# Top-bar redesign: brand + middle pills + user menu + dark-light + i18n

## Overview

Redesign the global app header to match Image #3 reference. Adds dark/light theming, VN/EN i18n, notification stub, and consolidates settings under user-avatar dropdown. Models page collapses into a tab inside Catalog.

**User decisions (locked):**
- Middle pills: Playground + New Metric + Catalog (3 pills). Models → tab inside Catalog.
- i18n: full react-i18next, translate header + main nav strings (EN + VN).
- Notifications: visual stub, hardcoded unread dot, empty popover.
- Settings home: user-avatar dropdown (security context + add rollup + legacy modal + theme + lang).
- Playground sidebar Settings + NewMetric CTA removed.

**Out of scope:** translating deep wizard / catalog body strings (header + main nav only this round). Real notification source. Catalog metric body restyling. Cross-app shadow DOM refactors.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Theme tokens dark-light](./phase-01-theme-tokens-dark-light.md) | Completed |
| 2 | [i18n react-i18next setup](./phase-02-i18n-react-i18next-setup.md) | Completed |
| 3 | [Logo assets + BrandBlock](./phase-03-logo-assets-brandblock.md) | Completed |
| 4 | [Header middle pills + mobile dropdown](./phase-04-header-middle-pills-mobile-dropdown.md) | Completed |
| 5 | [Header right cluster (search/help/bell/avatar) + user dropdown](./phase-05-header-right-cluster-search-help-bell-avatar-user-dropdown.md) | Completed |
| 6 | [Catalog Models tab + schema route migration](./phase-06-catalog-models-tab-schema-route-migration.md) | Completed |
| 7 | [Playground sidebar cleanup](./phase-07-playground-sidebar-cleanup.md) | Completed |
| 8 | [Tests + verification](./phase-08-tests-verification.md) | Completed |

## Dependencies

Phases 1 + 2 unblock phase 5 (user dropdown needs theme + lang contexts).
Phase 3 unblocks phase 4 (BrandBlock used by Header).
Phases 4 + 5 unblock phase 7 (sidebar cleanup happens after header has the relocated pieces).
Phase 6 is independent of 1-5 except via shared Header (phase 4) — safe to start after phase 4 lands.
Phase 8 is the final gate.

## Validation Log

### Session 1 — 2026-05-17

**Verification Results**
- Tier: Full (8 phases)
- Roles run: Fact Checker, Contract Verifier, Scope Auditor, Flow Tracer
- Claims checked: 18 (file paths, symbols, version-sensitive APIs, provider scopes, event listeners, route shape)
- Verified: 16 | Failed: 1 | Unverified: 1
  - **FAILED (Fact Checker)** — `phase-01` cited antd `ConfigProvider` `darkAlgorithm` swap. `package.json` shows `antd: 4.16.13`; `algorithm` is antd v5 only. Confirmed via dependency inspection. Surfaced as Q1.
  - **UNVERIFIED (Scope Auditor)** — Hoisting `RollupDesignerContext` to App root: provider exists in `QueryBuilderContainer.tsx`; consumers are 5 files all inside the rollup-designer module + PreAggregationStatus. Lifetime escalation risk: rollup-designer JS becomes part of every page load. Surfaced as Q2.

**Interview decisions**
1. **Dark mode delivery**: CSS-var-only — drop antd `algorithm` swap; lean on `tokens.css` `:root[data-theme="dark"]` block + per-selector dark overrides in `antd-overrides.css`. Propagated to: `phase-01` (Architecture, Implementation Steps, Risk Assessment).
2. **Rollup-modal access**: window-event pattern `OPEN_ROLLUP_DESIGNER_EVENT` mirroring `LEGACY_NEW_METRIC_EVENT`. `RollupDesignerContext` stays in `QueryBuilderContainer`. User-menu Add-Rollup item gated by `useLocation().pathname.startsWith('/build')`. Propagated to: `phase-05` (Architecture, Related Code Files, Implementation Steps, Risk Assessment).
3. **SchemaPage embedding**: refactor SchemaPage to drop its outer antd `Layout` + `Sider` + `Content` wrappers; replace with plain flex-div layout so it embeds cleanly inside the catalog tab body. Propagated to: `phase-06` (Architecture, Related Code Files, Implementation Steps).
4. **VN strings**: ship Claude-drafted VN strings (no hidden flag). Iterate post-merge. Propagated to: `phase-02` (no change — already aligned).

### Whole-Plan Consistency Sweep
- Files reread: plan.md, phase-01 … phase-08
- Decision deltas checked: 4 (antd algorithm, rollup access pattern, SchemaPage refactor, VN strings)
- Reconciled stale references: 3
  - `phase-01` Implementation Steps + Risk Assessment + Architecture now agree on CSS-var-only.
  - `phase-05` Architecture, Related Code Files, Implementation Steps, Risk Assessment all describe the event pattern; no remaining mention of `RollupDesignerContext` hoist.
  - `phase-06` Architecture + Related Code Files + Implementation Steps all list the SchemaPage refactor as a required step (added as step 1).
- Unresolved contradictions: 0

**Recommendation:** proceed to `/ck:cook plans/260517-2030-topbar-redesign-i18n-theme/plan.md`.

## Key context links

- Reference image: user-attached Image #3
- Logo assets: `C:\Users\CPU12830-local\Downloads\Cube Logo\{dark,light} logo.png`
- Current header: `src/components/Header/Header.tsx`, `brand-block.tsx`, `nav-pill.tsx`
- Current playground sidebar with Settings + NewMetricButton: `src/components/PlaygroundQueryBuilder/QueryBuilderContainer.tsx`
- Routes file: `src/index.tsx`
- Catalog: `src/pages/Catalog/catalog-page.tsx`
- Schema page (to nest under Catalog): `src/pages/Schema/SchemaPage.tsx`
- Tokens: `src/theme/tokens.css`, `src/theme/antd-overrides.css`, `src/theme/ui-kit-theme.ts`
