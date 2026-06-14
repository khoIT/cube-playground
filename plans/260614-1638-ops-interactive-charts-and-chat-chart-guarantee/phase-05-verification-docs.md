---
phase: 5
title: Verification + docs
status: completed
effort: ''
---

# Phase 5: Verification + docs

## Overview

End-to-end verification across both surfaces + doc/memory updates. No new features.

## Implementation Steps

1. **Frontend:** `tsc --noEmit` (no NEW errors vs the known pre-existing ones in `rollup-designer/`,
   `smart-search/`, `CubeMenuProps`); `vitest run` for ops + chat chart tests; `vite build`.
2. **chat-service:** its own `tsc`/lint/`vitest` (or jest) suite green, incl. new derive-chart-spec +
   fallback integration tests and unchanged preview-cube-query tests.
3. **Live `/ops` check (headless or app):** boot on cfm_vn + jus_vn → all three charts render, type
   switch + table + CSV + Open-in-Playground all work, zero console errors. (Local billing_detail reads
   lower than prod — expected workspace data difference, not a bug.)
4. **Live chat fallback check:** drive a turn that emits a query artifact without a chart → confirm a
   chart now appears (server fallback). Use the subscription-auth lane for any batch LLM calls.
5. **code-reviewer** subagent over the full diff (both surfaces): acceptance criteria, no chat
   regression, no broken public contracts (the new `headerAction` prop is additive; `loadCubeRows`
   refactor preserves `preview-cube-query` behavior).
6. **docs/memory:** update `docs/lessons-learned.md` if a new bug-shape emerged; refresh the
   `ops-console-and-jus-revenue-measure-gap` memory or add a new memory for the reusable chart-artifact
   pattern; note the chart-guarantee fallback in chat-service docs if one exists.

## Success Criteria

- [ ] FE + chat-service test suites green; builds pass.
- [ ] `/ops` charts fully interactive on both games; deeplinks open the right query.
- [ ] Chat query artifacts always carry a chart (fallback verified live).
- [ ] code-reviewer: no regressions, contracts intact.
- [ ] Docs/memory updated.

## Risk Assessment

- `second` remote auto-deploys on push → commit locally; push only on explicit user go-ahead.
- Concurrent sessions edit this repo → commit only this plan's files; verify pre-existing test
  failures via `git show`, never `git stash`.
