# Code Review — CDP Projection Verify Slice (mf_users)

**Date:** 2026-05-17
**Reviewer:** code-reviewer (Opus 4.7 1M)
**Plan:** `plans/260517-1715-cdp-projection-verify-mf-users/plan.md`
**Verdict:** PASS

## Scope Verified

- 12 new source/middleware files + 2 modified (`detail-panel.tsx`, `use-catalog-meta.ts`, `vite.config.ts`) read end-to-end.
- 6 phase acceptance criteria spot-checked against actual code, not plan claims.
- Full suite re-run: **295/295 green, 27 files** (matches plan claim).
- `npx vite build` clean.
- Edge cases scouted: concurrent verify (runIdRef), null-vs-empty filter, dimension dedup/sort, legacy non-mf_users markup parity, double-cast type safety, validatePostBody required-field gate, drift-guard agg coverage.

## Acceptance Criteria — Verified Against Code

| AC | Verdict | Evidence |
|---|---|---|
| (1) ProjectionResult union, all agg branches | ✓ | `project-measure.ts:25-57` + 16 tests cover count/sum/count_distinct/count_distinct_approx/filters/missing-meta/view/calculated/unsupported-agg |
| (2) Mock /cdp/v1 + MM-01 envelope + round-trip drift guard | ✓ | `cdp-mock-handlers.ts:37-51` envelope; `cdp-mock-middleware.test.ts:164-211` exercises all 5 matching variants |
| (3) `meta.game_id`/`cdp_source` via client mapping | ✓ | `use-catalog-meta.ts:43-49` `mergeCdpMapping`; 3 tests in `use-catalog-meta.test.ts` |
| (4) MeasureRow click/Enter/Space/Escape + `expandable=false` legacy markup | ✓ | `measure-row.tsx:94-104` + 11 tests; legacy DOM matches original (extra `data-*` attrs only) |
| (5) 7 field rows + Verify hidden (not just disabled) on Not Projectable | ✓ | `cdp-projection-card.tsx:125-136` returns different subtree; test line 87 `queryByRole(..., /verify/i)` returns null |
| (6) Smoke green | ✓ | `smoke.test.tsx` runs catalog→cube→measure→verify→Available |
| (7) 295 tests / build clean | ✓ | Reproduced locally |

## Critical Walkthroughs

**`runIdRef` concurrency** — Two-call race in `use-cdp-verify.ts:21-44`:
- Call A: `myRunA=++runIdRef.current→1`, setState(checking), awaits getMetric
- Call B: fires while A in-flight → `myRunB→2`, setState(checking), awaits
- A resolves: `myRunA(1) !== runIdRef.current(2)` → silent return, no state write ✓
- B resolves: matches → applies result ✓
Test at `use-cdp-verify.test.ts:77-100` reverse-orders resolves and confirms second wins. Correct.

**`diffEquality`** — `diff-equality.ts:14-58`:
- `COMPARED_FIELDS` excludes materialize/schedule/created_at/updated_at ✓
- `normalizeExpression` trim+collapse-whitespace ✓
- `normalizeFilter`: `null==undefined` → `''` ✓
- `normalizeDimensions` sorts before pair-equality ✓

**Not Projectable hides Verify** — `cdp-projection-card.tsx:126-133` is a hard branch returning `<Card $disabled>` w/ only Label + Reason. No `<VerifyBtn>`. Button is **absent**, not merely disabled — `useCdpVerify` is never even called for this branch. ✓

**`validatePostBody`** — `cdp-mock-handlers.ts:80-106` iterates required fields; missing `metric_name` → `typeof undefined !== 'string'` → returns `{ok:false, missing:'metric_name'}` → 400 INVALID_REQUEST. ✓

**Double cast at `detail-panel.tsx:172-173`** — `cube as unknown as ProjectableCube` runtime-safe: `CatalogCube` is a structural superset for all read fields (name/measures/dimensions/type/meta); `CatalogMeasure` lacks `sql`/`filters`/`public` but those are optional in `ProjectableMeasure` and read as `undefined` → falls through to `unsupported-agg-type` for unknown shapes. No runtime hazard.

## Concerns (Non-Blocking)

1. **`detail-panel.tsx` is 225 LOC** — over project's 200-line ceiling. The original was already 216, and the slice added 9 lines (state + projection mapping). Modularization candidate (extract `<MeasuresSection>`) but not a regression. Severity: Medium.

2. **`cdp-projection-card.tsx` exactly 200 lines** — touches the ceiling. Any future addition trips the modularization rule. Consider extracting `<StatusBadge>`/`<DiffList>` to a sibling now. Severity: Low.

3. **`use-cdp-verify.ts:44` deps include `payload` object** — together with `payload.game_id` and `payload.metric_name`, the `payload` dep alone is sufficient; the two primitives are redundant. Inverted: if parent passes a fresh object literal each render, `check` is recreated unnecessarily. Cosmetic — closure always reads current payload. Severity: Low.

4. **React `act()` warning in `cdp-projection-card.test.tsx` "verify button disabled while checking"** — the `resolve(...)` call at line 104 fires outside an `act()` wrapper, emitting a console warning during test run. Test still passes; warning visible in vitest output. Wrap final resolve in `await act(async () => { resolve(...); })` to silence. Severity: Low (cosmetic).

5. **`api.ts:53-57` surfaces `body.error?.message` to UI** — in dev w/ mock middleware this is fine, but in production the badge `Error: {state.message}` would render whatever the upstream CDP returns. If CDP error bodies ever leak stack traces / internal hostnames, they would surface as a colored badge. Mitigation: clamp to a generic "Error" when `status >= 500`, log full message. Not yet in scope for this slice but worth a follow-up for the proxy phase. Severity: Medium (future).

6. **`metric_name` is NOT in `COMPARED_FIELDS`** — `diff-equality.ts:14`. If a future server bug returned a different `metric_name` than was requested, `diffEquality` would say "no diff" because that field is never compared. In practice the URL determines `metric_name` so this can't currently misalign, but it's an implicit trust boundary. Severity: Low.

7. **`useCatalogMeta` re-runs `mergeCdpMapping` on every successful fetch** — fine for current scope (10s of cubes), but if `CUBE_TO_CDP_MAPPING` grows and `setCubes` is called repeatedly (e.g. /meta refetched), it's O(N) per fetch. Cache via `useMemo` if mapping grows. Severity: Low / observational.

8. **Drift guard test `cdp-mock-middleware.test.ts:164-211` does not iterate `cube.dimensions.length` independently** — it asserts `[...seedDims].sort() === [...projDims].sort()` but the cube fixture lists exactly the dims the seed expects. If someone adds a new visible dimension to the fixture but not to the seed (or vice versa), the assertion catches the count mismatch — but doesn't prove the projection's `projectDimensions()` filtering logic matches the seed semantically. Belt-and-suspenders: add a literal `expect(projection.payload.dimensions).toEqual(['country', 'signup_source'])`. Severity: Low.

## Behavioral Checklist

- [x] **Concurrency:** `runIdRef` correctly drops stale resolves. Mock middleware uses a per-plugin in-memory store; tests inject fresh Maps.
- [x] **Error boundaries:** `api.ts` returns discriminated union, no throws escape. Middleware wraps with try/catch + `internalError`.
- [x] **API contracts:** `CatalogCube.meta` is `?` optional — backwards compatible. `useCatalogMeta` return shape unchanged.
- [x] **Backwards compatibility:** Non-mf_users measure row markup matches original (verified by literal diff vs `git show HEAD:detail-panel.tsx`). Only additions: `data-testid`, `data-measure-name`, `data-cube` attributes.
- [x] **Input validation:** `validatePostBody` checks 5 required string fields + non-empty. Dimensions defaults to `[]` if non-array.
- [x] **Auth/authz:** Explicitly locked out of scope per Validation Session 1 — no 401 path. Acknowledged in code comments.
- [x] **N+1 / query efficiency:** No DB; mock store is `Map` w/ O(N) game scan acceptable for dev seed.
- [x] **Data leaks:** No PII; flagged Concern #5 for future proxy phase.
- [x] **No `console.log`, `TODO`, `FIXME`, `dangerouslySetInnerHTML`** in new code (grep-verified across `cdp-projection/`, `measure-row.tsx`, vite-plugins/cdp-mock-*).

## Positive Observations

- Discriminated unions follow `NewMetric/api.ts` style precisely (verified pattern usage).
- `runIdRef` pattern mirrors `use-live-preview.ts` exactly.
- Middleware shape matches `schema-write-middleware.ts`: `apply: 'serve'` + dev-only registration in vite.config.
- Pure functions (`projectMeasure`, `diffEquality`, handler validators) are dependency-free and trivially testable.
- Drift-guard test directly couples the seed JSON to `projectMeasure` output — no silent regression vector.
- Loose-cast at `detail-panel.tsx:172` is annotated and structurally safe.
- Test coverage of negative paths (missing meta, view-type, unsupported agg, calculated measure) is thorough.

## Unresolved Questions

None — slice is internally consistent and matches plan claims under code inspection.

**Verdict: PASS**
