---
phase: 8
title: "Success page + flag flip to v2 default + v1 dialog removal (RR5)"
status: pending
priority: P2
effort: "0.5d"
dependencies: [7]
---

# Phase 8: Success page flag flip v1 removal

## Overview

Ship post-submit full-page success view, flip `?v=2` flag to default, delete v1 `NewMetricDialog.tsx` tree. Final cutover.

**Red-team-applied:**
- **#1: RR5 syntax** for success route (`<Route path="/metrics/new/success" component={NewMetricSuccess} />` — no `element=`).
- **#3: `/playground` → `/build`**; `/data-model` → `/schema` in route table.
- **#6: KEEP** `components/tag-combo.tsx` + `hooks/use-existing-tags.ts` (reused by P6).
- **#10: Path** — new tree lives at `src/QueryBuilderV2/NewMetric/full-page/`; v1 deletion is in-place under same parent dir.
- **#22: Grep-first deletion order** — typecheck between batches; explicit dependency graph.

## Requirements

**Functional:**
- Route `/metrics/new/success` (RR5 `component=`) renders polished full-page success view inside same Shell (or stripped variant):
  - Big green check icon (56 px) inside emerald soft circle.
  - Heading: "Metric submitted" (Geist, 22 px, bold).
  - Subhead: `<metric-name>` (mono) added to `<schema>.<source-cube>` (mono).
  - Optional info card listing: metric name, target cube, timestamp.
  - Two CTAs: **View in Playground** (outline) → `history.push('/build?cube=<sourceCube>')` (RR5; pre-existing `?cube=` reader at `src/QueryBuilderV2/QueryBuilder.tsx:109-125` selects cube — does NOT pre-seed measure; document this limitation); **Start another metric** (primary orange) → clear tab-scoped localStorage draft + `history.push('/metrics/new')`.
- Success route reads metric name + cube from `history.state` first; falls back to URL query (`?name=...&cubeName=...&schema=...`) if state missing (handles hard reload).
- Header `New metric` button: drop `?v=2` guard — every click goes straight to `/metrics/new`.
- Delete v1 entrypoint: remove `<DialogTrigger>` + `<NewMetricDialog>` mounting from `NewMetricButton.tsx`; button becomes pure RR5 `<Link to="/metrics/new">`.
- Delete v1 wizard files (see Related Code Files).
- Full regression sweep on actual routes: `/build`, `/schema`, `/schema/:cube`, `/catalog`, `/metrics/new`, `/metrics/new/success`.

**Non-functional:**
- Success page < 200 LOC.
- No console errors on regression sweep.
- All v1 NewMetric tests removed cleanly.

## Architecture

```
src/QueryBuilderV2/NewMetric/full-page/steps/success/
├── index.tsx                                success route component
├── success-body.tsx                         icon + heading + info card + CTAs
└── __tests__/
    └── success-body.test.tsx
```

Routes updated in `src/index.tsx` (RR5):
```tsx
<Route path="/metrics/new"        component={NewMetricPage} />
<Route path="/metrics/new/success" component={NewMetricSuccess} />
```

## Related Code Files

- **Create:** `src/QueryBuilderV2/NewMetric/full-page/steps/success/index.tsx`, `success-body.tsx`, `__tests__/success-body.test.tsx`
- **Modify:** `src/index.tsx` — add success route (RR5 syntax)
- **Modify:** `src/QueryBuilderV2/NewMetric/NewMetricButton.tsx` — drop `?v=2` guard, drop `DialogTrigger`, pure `<Link to="/metrics/new">`
- **Delete:** `src/QueryBuilderV2/NewMetric/NewMetricDialog.tsx`
- **Delete:** `src/QueryBuilderV2/NewMetric/steps/step-define.tsx`
- **Delete:** `src/QueryBuilderV2/NewMetric/steps/step-identify.tsx`
- **Delete:** `src/QueryBuilderV2/NewMetric/steps/step-preview.tsx`
- **Delete:** `src/QueryBuilderV2/NewMetric/components/stepper.tsx`
- **Delete:** `src/QueryBuilderV2/NewMetric/components/wizard-footer.tsx`
- **Delete:** `src/QueryBuilderV2/NewMetric/components/find-similar-warning.tsx`
- **Delete:** `src/QueryBuilderV2/NewMetric/preview/yaml-preview.tsx` (replaced by `full-page/steps/step-5-identity/yaml-preview-rail.tsx`)
- **Delete:** `src/QueryBuilderV2/NewMetric/sections/source-section.tsx`, `operation-section.tsx`, `of-section.tsx`, `filter-section.tsx`, `identity-section.tsx`
- **Delete (verify unused first via grep):** `hooks/use-wizard-navigation.ts`, `use-live-preview.ts`, `use-dry-run-sql.ts`, `use-find-similar.ts`
- **Keep:** `src/QueryBuilderV2/NewMetric/api.ts` (postSchemaWrite + deleteSchemaWrite — still used by P7)
- **Keep:** `src/QueryBuilderV2/NewMetric/hooks/use-new-metric-draft.ts` (extended in P1)
- **Keep:** `src/QueryBuilderV2/NewMetric/hooks/use-new-metric-meta.ts` (created in P1)
- **Keep:** `src/QueryBuilderV2/NewMetric/hooks/use-reachable-members.ts` (still used)
- **Keep:** `src/QueryBuilderV2/NewMetric/hooks/use-existing-tags.ts` (reused by P6)
- **Keep:** `src/QueryBuilderV2/NewMetric/yaml/generate-measure-yaml.ts` (extended in P1)
- **Keep:** `src/QueryBuilderV2/NewMetric/types.ts` (extended in P1 + P3)
- **Keep:** `src/QueryBuilderV2/NewMetric/components/tag-combo.tsx` (reused by P6)

## Implementation Steps (TDD)

1. **Write tests first:**
   - `success-body.test.tsx` — renders metric name + cube; click "View in Playground" navigates to `/build?cube=<src>` via `useHistory().push`; click "Start another metric" clears tab-scoped localStorage + navigates to `/metrics/new`. Reload-resilience: when `history.state` missing, reads from URL query.
2. **Implement `success-body.tsx`** — match mockup minus PR/reviewer/Slack rows.
3. **Wire success route** in `src/index.tsx` with RR5 `component=` syntax.
4. **Update P7 submit handler** — on success, `history.push('/metrics/new/success', { name, cubeName, schema })` AND include URL query fallback (`?name=...&cubeName=...&schema=...`) for reload resilience.
5. **Strip `?v=2` guard** in `NewMetricButton.tsx`; convert to pure RR5 `<Link to="/metrics/new">`.
6. **Grep-first deletion sweep** (red-team #22 dependency order):
   a. `grep -r "use-find-similar"` → if any non-v1 hits, fix before deleting hook.
   b. `grep -r "use-live-preview\|use-dry-run-sql\|use-wizard-navigation"` → confirm only v1 step files consume.
   c. Delete v1 step files FIRST: `step-define.tsx`, `step-identify.tsx`, `step-preview.tsx`.
   d. `npm run typecheck` — should be green.
   e. Delete section files: `sections/*.tsx`.
   f. `npm run typecheck` — green.
   g. Delete components: `components/stepper.tsx`, `wizard-footer.tsx`, `find-similar-warning.tsx`.
   h. `npm run typecheck` — green.
   i. Delete `preview/yaml-preview.tsx`.
   j. Delete now-orphan hooks: `use-wizard-navigation.ts`, `use-live-preview.ts`, `use-dry-run-sql.ts`, `use-find-similar.ts`.
   k. `npm run typecheck` — green.
   l. Delete `NewMetricDialog.tsx` itself.
   m. Final `npm run typecheck` + `npm run test`.
7. **Verify deletions** — `grep -r "NewMetricDialog\|step-define\|step-identify\|step-preview\|find-similar-warning" src/` returns zero matches.
8. **Full regression sweep on actual routes** — `#/`, `#/build`, `#/schema`, `#/schema/<cube>`, `#/catalog`, `#/metrics/new`, `#/metrics/new/success`. Confirm no console errors, no broken links.
9. **Bundle size check** — `npm run build`; verify net change reasonable (< +500 KB after v1 deletion). If +500 KB+, lazy-load `NewMetricPage` via `React.lazy` + `<Suspense>`.
10. **Update `README.md` Routes table** — add `/metrics/new` + `/metrics/new/success` rows.
11. Typecheck + tests + build + commit.

## Success Criteria

- [ ] `#/metrics/new/success` renders success view w/ check icon + metric name + cube + 2 CTAs.
- [ ] "View in Playground" navigates to `#/build?cube=<source-cube>` via RR5 `history.push`.
- [ ] "Start another metric" clears tab-scoped localStorage + navigates to `#/metrics/new`.
- [ ] Success route survives hard reload via URL query fallback.
- [ ] Header `New metric` button → straight to `#/metrics/new` (no `?v=2` opt-in).
- [ ] `NewMetricDialog.tsx` + all v1 step/section files + v1-only hooks/components deleted.
- [ ] `grep` for `NewMetricDialog`, `step-define`, `step-identify`, `step-preview` returns zero source-code matches.
- [ ] `components/tag-combo.tsx`, `hooks/use-existing-tags.ts`, `hooks/use-reachable-members.ts`, `api.ts`, `yaml/generate-measure-yaml.ts`, `types.ts`, `hooks/use-new-metric-draft.ts`, `hooks/use-new-metric-meta.ts` all remain.
- [ ] No `useNavigate`, `useSearchParams`, `<Routes>`, `element=` anywhere (grep clean).
- [ ] `npm run typecheck` + `npm run test` + `npm run build` all green.
- [ ] No console errors on manual sweep of `/build`, `/schema`, `/catalog`, `/metrics/new`, `/metrics/new/success`.
- [ ] `README.md` Routes table updated.

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Deleted v1 file still imported somewhere unforeseen | Step 6 typecheck between every batch; Step 7 grep verification. |
| Success route hard-reload loses navigation state | URL query fallback (`?name=...&cubeName=...&schema=...`) — implemented in Step 1 test + Step 4 wiring. |
| `?cube=` deep-link doesn't pre-seed measure (only cube) | Documented limitation. P7 of old superseded plan had a measure pre-seed plan; not in scope here. User selects measure manually after deep-link. |
| Stale `useFindSimilar` removal kills find-similar warning users liked | Grep verifies usage before deletion. If users still want it, re-implement as small inline warning in P3 or P5 (out of scope for P8 cleanup). |
| Bundle size grows from new tree | One-off audit during Step 9; if regression > 500 KB, lazy-load via `React.lazy`. |
| Final regression sweep misses an edge route | Manual sweep listed in Step 8; consider a Playwright smoke test in a future plan. |
