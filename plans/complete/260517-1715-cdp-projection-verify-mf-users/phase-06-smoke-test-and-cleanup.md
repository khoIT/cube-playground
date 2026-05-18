---
phase: 6
title: "Smoke test and cleanup"
status: complete
priority: P2
effort: "0.25d"
dependencies: [1, 2, 3, 4, 5]
---

# Phase 6: Smoke test and cleanup

## Overview

End-to-end integration smoke test, doc updates, lint/typecheck/test/build sweep, and final cleanup. Closes the slice. No new features.

## Requirements

### Functional

- One integration smoke test that exercises the full vertical:
  - Mount `<CatalogPage>` w/ mocked extended `/meta` (includes `mf_users` w/ `meta.cdp_source`)
  - Mocked `/cdp/v1/metrics/bal_vn/user_count` returns matching seed
  - Render â†’ click cube card â†’ DetailPanel opens â†’ click `user_count` row â†’ row expands â†’ click Verify â†’ wait â†’ assert `Available` badge
- Manual smoke checklist documented for handoff.

### Non-functional

- `npm run typecheck` clean
- `npm run test` clean (all phases' tests green together)
- `npm run build` clean
- All new files â‰¤ 200 lines

### Docs

- Update `docs/codebase-summary.md` (if exists) w/ a brief note on the CDP projection module â€” what it is, where it lives, mock-only status.
- Add a short header comment to `vite-plugins/cdp-mock-middleware.ts` documenting: "mock only; replace w/ real proxy when MM-01 dev tier is reachable" + the seed-fixture contract.

## Architecture

```
src/pages/Catalog/cdp-projection/
  __tests__/
    smoke.test.tsx   â—„â”€â”€ new (integration)
docs/
  codebase-summary.md â—„â”€â”€ modify (optional â€” only if exists)
```

## Related Code Files

- **Create:**
  - `src/pages/Catalog/cdp-projection/__tests__/smoke.test.tsx`
- **Modify:**
  - `vite-plugins/cdp-mock-middleware.ts` â€” add header comment
  - `docs/codebase-summary.md` â€” if exists, add CDP projection paragraph
- **Read:**
  - All P1-P5 outputs
- **Delete:** none

## Implementation Steps (TDD)

1. **Test first** â€” `smoke.test.tsx`:
   - Mock `fetch` to return:
     - `/cubejs-api/v1/meta?extended=true` â†’ minimal extended-meta fixture w/ `mf_users` + `user_count` measure + `meta.cdp_source`
     - `/cdp/v1/metrics/bal_vn/user_count` â†’ seeded matching record
   - Render `<MemoryRouter><CatalogPage /></MemoryRouter>` (or actual `<HashRouter>` w/ `createMemoryHistory`)
   - Wait for catalog grid â†’ click `mf_users` cube card
   - Wait for DetailPanel â†’ click `user_count` row
   - Assert card visible
   - Click Verify button
   - Wait for `Available` badge
2. Run â†’ red.
3. Adjust glue code if needed (mostly: ensure `useCatalogMeta` actually fetches once mounted).
4. Run typecheck + test + build:
   ```bash
   npm run typecheck && npm run test && npm run build
   ```
5. Manual smoke run on `npm run dev`:
   - `/catalog` â†’ mf_users â†’ expand `user_count` â†’ verify â†’ Available
   - Same for `paying_user_count` â†’ Available
   - Expand `lifetime_recharge_amount_vnd` (seeded w/ mismatched expression) â†’ Mismatch + diff visible
   - Any unseeded measure â†’ Missing
   - `arpu_vnd` â†’ Not projectable
6. Add doc paragraph + middleware header comment.
7. `wc -l` sweep on every new/modified file â€” confirm â‰¤ 200.
8. Final cleanup pass:
   - Dead imports?
   - Console.logs in new code?
   - Any TODO/FIXME left behind?
9. Open the plan and tick all phase status boxes via `ck plan check`.

## Success Criteria

- [ ] Smoke test green
- [ ] `npm run typecheck` clean
- [ ] `npm run test` clean
- [ ] `npm run build` clean
- [ ] All 5 manual scenarios pass (Available Ã— 2, Mismatch, Missing, Not projectable)
- [ ] Header comment on mock middleware documents mock-only status + seed contract
- [ ] `docs/codebase-summary.md` updated if exists
- [ ] No file > 200 lines
- [ ] No console.log / TODO / FIXME left in new code
- [ ] All 6 phases marked complete via `ck plan check`

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Smoke test brittle to async timing | Use `findBy*` / `waitFor` from testing-library; no `setTimeout` |
| Mocked fetch shape diverges from real | Mock fixtures live in `__fixtures__/` and are also used by P1/P2/P5 unit tests â€” single source |
| `HashRouter` test setup non-trivial | Smoke uses `MemoryRouter` from `react-router-dom` (RR5 compat); App.tsx uses `withRouter` so wrapper compatibility holds |
| `npm run build` flags an issue not caught by typecheck | Run build separately; fix before claiming done |
| Doc file `codebase-summary.md` may not exist | Treat update as best-effort: skip silently if file absent |

## Handoff

- Plan status: complete via `ck plan check 6`
- Journal: `/ck:journal` to write a session entry summarizing what shipped + open questions remaining
- Future plans this enables:
  - Real MM-01 proxy + JWT plumbing (replace mock middleware)
  - Wire `POST /cdp/v1/metrics` from wizard submit (slice 2 of pipeline)
  - Extend `meta.cdp_source` to other cubes (`active_daily`, `user_recharge_daily`, `recharge`)
