---
phase: 8
title: "Broken-status flow + drift detection + tests + docs"
status: pending
priority: P1
effort: "3d"
dependencies: [0, 1, 2, 3, 4, 5, 6, 7]
---

# Phase 8: Broken-status flow + drift detection + tests + docs

## Overview

Cross-cutting wrap-up. Harden meta-version drift detection on cron + analysis cards, add an end-to-end test pass, drop MSW mocks from P2, write release docs, and prove the prod single-binary build serves the FE + API on the same origin.

## Requirements

**Functional**
- Drift detection on cron tick:
  - Compare `segment.predicate_meta_version` vs current `/api/meta/version` before calling Cube `/load`.
  - On drift, attempt translator rehydrate (re-translate stored tree to fresh `cube_query_json` against new `/meta`).
  - If rehydrate succeeds: update `cube_query_json` + `predicate_meta_version`; proceed with refresh.
  - If rehydrate fails (member-not-found, type mismatch): set `status='broken'` with descriptive `last_error`.
- Same drift check on saved analyses on detail-view render — surfaces broken state per analysis card.
- E2E test pass:
  - Push from Results → segment created.
  - Live segment refreshes via cron tick (use jest-fake-timers + cube-client mock).
  - Schema drift → segment marked broken.
  - Pin from Playground → saved analysis renders in Detail.
  - Copy as filter → deeplink opens Playground with uid filter.
- Final visual regression pass:
  - `npm run test:visual` (set up in P0) runs against the full v1 build with fixture data.
  - All baselines from P0 pass ≤2% threshold.
  - `playground-polish.spec.ts` continues to pass for existing screens.
- Production build:
  - `npm run build` produces `dist/` (Vite) and `server/dist/` (tsc).
  - `npm run start` launches the server which also serves static `dist/` from the same origin.
  - No CORS issues; `/api/*` and `/cubejs-api/*` co-resident.
- Docs:
  - Update `README.md` with Segments overview + how to run.
  - `docs/codebase-summary.md` — add Segments section.
  - `docs/system-architecture.md` — add the architecture diagram from the brainstorm.
  - `server/README.md` — endpoint reference + single-tenant disclaimer + multi-instance limitation.
  - `plans/reports/brainstorm-260519-1610-query-results-to-segments.md` — append `## Implementation notes` section referencing this plan + the actual file paths shipped.

**Non-functional**
- All tests in `npm run test` pass (FE + server).
- Typecheck passes (`npm run typecheck`).
- Lint passes if configured.
- MSW handlers removed; no remnants in bundle.

## Architecture

```
server/src/
  services/
    drift-resolver.ts             (compares meta-versions + attempts rehydrate)
  jobs/
    refresh-segment.ts            (extended: invokes drift-resolver before /load)

src/pages/Segments/
  detail/tabs/saved-analyses-tab.tsx  (extended: broken-status per card)
  components/
    broken-segment-banner.tsx     (created P6, refined here for drift wording)

server/
  dist/                           (build output)
  serve.ts                        (prod entry: serves dist/ + /api routes)
```

## Related Code Files

**Create**
- `server/src/services/drift-resolver.ts`
- `server/src/serve.ts` (prod entry)
- `server/test/drift-resolver.test.ts`
- `tests/e2e/segments-flow.test.ts` (Playwright — reuses P0 setup)

**Modify**
- `server/src/jobs/refresh-segment.ts` — call drift-resolver before Cube `/load`
- `src/pages/Segments/detail/tabs/saved-analyses-tab.tsx` — surface broken state
- `src/pages/Segments/detail/components/broken-segment-banner.tsx` — drift-aware copy
- `README.md`, `docs/codebase-summary.md`, `docs/system-architecture.md`, `server/README.md`
<!-- Updated: Validation Session 1 - MSW removed from P2; no cleanup needed here -->
- `plans/reports/brainstorm-260519-1610-query-results-to-segments.md` — append implementation notes
- `package.json` — `build`, `start`, `test` scripts wire FE + server together

## Implementation Steps

1. Implement `drift-resolver.ts`:
   - Input: `{ segment, currentMetaVersion }`.
   - If `segment.predicate_meta_version === currentMetaVersion`: return `{ drifted: false }`.
   - Else: translate `segment.predicate_tree_json` → new `cube_query_json` against current `/meta`; check every referenced member still exists.
   - Return `{ drifted: true, rehydrated: true, newCubeQuery, newMetaVersion }` or `{ drifted: true, rehydrated: false, missingMembers: [...] }`.
2. Extend `refresh-segment.ts`:
   - Call drift-resolver before Cube `/load`.
   - If `rehydrated`: persist new `cube_query_json` + `predicate_meta_version`; proceed.
   - If not: `setSegmentStatus('broken', 'Schema drift: <missingMembers>')`; skip `/load`.
3. Add `drift-resolver.test.ts` — happy path (no drift), drift+rehydrate, drift+broken-member.
4. Extend `saved-analyses-tab.tsx`:
   - For each analysis, compare `query_meta_version` against current `/api/meta/version`.
   - On drift: render disabled card with "Edit in Playground to fix" CTA.
5. Refine `broken-segment-banner.tsx` wording to differentiate "Cube query failed" vs "Schema drift — refresh blocked".
6. Configure prod build:
   - Server entry `serve.ts` serves `dist/` static + `/api/*` routes via Fastify static plugin.
   - `package.json`:
     ```json
     "scripts": {
       "build": "vite build && tsc -p server",
       "start": "node server/dist/serve.js",
       "dev:all": "concurrently \"vite\" \"tsx watch server/src/index.ts\"",
       "test": "vitest && cd server && vitest"
     }
     ```
7. Write E2E `segments-flow.test.ts`:
   - Spin up server with fixture Cube mock; drive FE via Playwright (reuses P0 setup).
   - Coverage: row-select → push → live tick → drift → broken → analyses pin → deeplink.
8. Doc updates:
   - `README.md` — add Segments section + run instructions.
   - `docs/codebase-summary.md` — describe `/server`, presets, predicate model.
   - `docs/system-architecture.md` — paste the architecture diagram + cron flow.
   - `server/README.md` — endpoint table + single-tenant disclaimer + ops notes.
9. Append `## Implementation notes` to the brainstorm report with file paths actually shipped (mostly mirrors the plan, but should reflect any reality drift).
10. Final QA pass — run through the 8 validation criteria in the brainstorm report manually.

## Success Criteria

- [ ] Renaming a dim referenced by a live segment → next cron tick marks it `broken` with a drift error message.
- [ ] Renaming a dim referenced only in a saved analysis → analysis card surfaces broken state on Detail render.
- [ ] `npm run build` succeeds end-to-end (FE + server).
- [ ] `npm run start` serves the app on a single port with `/api/*` reachable.
- [ ] `npm run test` passes including the new drift-resolver + E2E suite.
- [ ] No MSW or mock-only artifacts in the production bundle (size diff baseline + grep) — P2 never introduced MSW per validation decision.
- [ ] Docs updated; brainstorm report has implementation notes appended.
- [ ] All 8 brainstorm validation criteria pass in manual QA.
- [ ] Final visual regression suite green: all 9+ Segments screen baselines + all existing-screen polish baselines pass at both viewports.
- [ ] Mock-fidelity sign-off doc added to brainstorm implementation notes (which screens hit which delta).

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Drift detection false positive (meta hash changes for cosmetic reason) | Hash only the substructure relevant to translator (cubes + dims + measures), not the full `/meta` payload. |
| Rehydrate succeeds but underlying semantics changed (column renamed but kept same type) | Document as known limitation; rehydrate validates structure only — semantic verification is user's job. Mention in broken-banner copy. |
| E2E test flake from cube-client mock timing | Use `vi.useFakeTimers()` + advance ticks deterministically. |
| Prod single-binary serve has path conflicts (e.g. `/api` vs `/cubejs-api`) | Both prefixed cleanly; Fastify static serves only after route match. Add precedence test. |
| Docs drift from code as plan evolves | Doc updates are a P8 acceptance criterion; reviewer checks docs in PR. |
| FE-only dev without backend running | Document `npm run dev:all` as the canonical dev command; FE-only `npm run dev` shows a clear "API unreachable" toast (no MSW fallback — that path was dropped at validation time). |
