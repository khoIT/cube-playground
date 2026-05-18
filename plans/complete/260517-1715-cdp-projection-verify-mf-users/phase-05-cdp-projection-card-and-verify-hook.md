---
phase: 5
title: "CDP projection card and verify hook"
status: complete
priority: P2
effort: "0.5d"
dependencies: [1, 2, 4]
---

# Phase 5: CDP projection card and verify hook

## Overview

Plug the projection mapper (P1), mock middleware (P2), and expandable row (P4) together. Adds a typed CDP API client mirroring `NewMetric/api.ts`, a `useCdpVerify` hook driving the state machine (`idle â†’ checking â†’ available | missing | mismatch | error`), and a `<CdpProjectionCard>` rendering the payload preview + Verify button + status badge. TDD: hook test + card test before implementation.

## Requirements

### Functional

- `cdp-projection/api.ts` exports:
  - `getMetric(gameId, metricName): Promise<GetMetricResult>` â€” discriminated union over 200 / 404 / network
  - (POST + list **not** wired in v1 â€” verify path only)
- `useCdpVerify(payload: CdpMetricPayload)` returns `{ state: VerifyState; check(): void }`.
  - `check()` â†’ set `kind: 'checking'` â†’ call `getMetric` â†’ set `available` / `missing` / `mismatch` / `error`.
  - Subsequent `check()` calls cancel-on-stale (use `runIdRef` pattern from `use-live-preview.ts` â€” Cube SDK + project convention).
  - `mismatch` diff = array of `{ field, expected, actual }` for fields that differ. `expected` = the payload we sent; `actual` = what GET returned.
- `<CdpProjectionCard>`:
  - For **projectable** measure (`projectMeasure` returns `ok: true`): renders payload as labeled key/value rows (game_id, metric_name, metric_codename, source, expression, dimensions, filter) + Verify button + status badge.
  - For **not projectable**: renders disabled card w/ `Not projectable â€” <human reason>` + **NO Verify button** (hidden entirely, not disabled â€” locked per Validation Session 1).
  - Badge states: `Not checked` (gray) / `Checkingâ€¦` (spinner) / `Available` (green) / `Missing` (amber) / `Mismatch` (red, click to expand diff list) / `Error` (red, retry button).
  - **Mismatch diff renderer = color-coded two-column list** (locked per Validation Session 1): each differing field renders as a row w/ `field-name | expected (red bg) | actual (green bg)`. CSS classes `.diff-expected` / `.diff-actual` use design-token error/success surface colors. No diff library.
  - No `dangerouslySetInnerHTML`; SQL expressions render as `<code>` w/ text content.

### Non-functional

- Files â‰¤ 200 lines each.
- Hook is React-purely controlled (no side effects on mount; only on `check()`).
- API client: typed discriminated unions, no throws.
- Card mounted inside `<MeasureRow>` children slot.

## Architecture

```
src/pages/Catalog/
  detail-panel.tsx                        â—„â”€â”€ modify (pass <CdpProjectionCard> as expanded child)
  cdp-projection/
    api.ts                                â—„â”€â”€ new
    use-cdp-verify.ts                     â—„â”€â”€ new
    cdp-projection-card.tsx               â—„â”€â”€ new
    diff-equality.ts                      â—„â”€â”€ new (pure: compare payload vs response)
    __tests__/
      use-cdp-verify.test.ts              â—„â”€â”€ new (FIRST)
      cdp-projection-card.test.tsx        â—„â”€â”€ new (FIRST)
      diff-equality.test.ts               â—„â”€â”€ new (FIRST)
```

### `api.ts` shape

```ts
export type GetMetricResult =
  | { ok: true; data: CdpMetricFullRecord }    // 200, full MM-01 Metric
  | { ok: false; status: 404; reason: 'METRIC_NOT_FOUND' | 'GAME_NOT_FOUND' }
  | { ok: false; status: number; reason: string };

export async function getMetric(gameId: string, metricName: string): Promise<GetMetricResult>;
```

### `useCdpVerify` flow

```
state: idle
  â†“ check()
state: checking, runId++
  â†’ api.getMetric(...)
    â†’ ok=true â†’ diffEquality(payload, response)
                 â†’ empty diff â†’ state: available
                 â†’ non-empty â†’ state: mismatch (with diff[])
    â†’ ok=false, 404 â†’ state: missing
    â†’ ok=false, other â†’ state: error (message)
  Stale runId â†’ ignore (no state update)
```

### `diff-equality.ts`

Pure compare of:
- `metric_codename` (string equality)
- `source` (string equality)
- `expression` (string equality, trim both sides)
- `filter` (string equality, treat null/undefined as `""`)
- `dimensions` (sort both arrays, then deep-equal)

Ignored fields: `materialize, schedule, created_at, updated_at`.

Returns `Array<{ field, expected, actual }>` â€” empty when equal.

### Card visual sketch

```
â”Œâ”€ CdpProjectionCard â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  game_id           bal_vn                                â”‚
â”‚  metric_name       user_count                            â”‚
â”‚  metric_codename   user_count                            â”‚
â”‚  source            iceberg.ballistar_vn.mf_users         â”‚
â”‚  expression        COUNT(*)                              â”‚
â”‚  dimensions        user_id, country, â€¦                   â”‚
â”‚  filter            (empty)                               â”‚
â”‚                                                          â”‚
â”‚  [Verify on CDP]   â— Available                           â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

For non-projectable (no Verify button â€” fully hidden):

```
â”Œâ”€ CdpProjectionCard (disabled) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  Not projectable                                         â”‚
â”‚  Reason: references other measures                       â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

Mismatch diff (when expanded):

```
â”Œâ”€ Mismatch â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  Field        Expected (red)        Actual (green)       â”‚
â”‚  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€  â”‚
â”‚  expression   â–ˆâ–ˆâ–ˆSUM(amount_vnd)â–ˆâ–ˆ  â–ˆâ–ˆSUM(amount_usd)â–ˆâ–ˆ  â”‚
â”‚  filter       â–ˆâ–ˆâ–ˆ(empty)â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆ  â–ˆâ–ˆcountry='VN'â–ˆâ–ˆâ–ˆâ–ˆâ–ˆ  â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

## Related Code Files

- **Create:**
  - `src/pages/Catalog/cdp-projection/api.ts`
  - `src/pages/Catalog/cdp-projection/use-cdp-verify.ts`
  - `src/pages/Catalog/cdp-projection/cdp-projection-card.tsx`
  - `src/pages/Catalog/cdp-projection/diff-equality.ts`
  - `src/pages/Catalog/cdp-projection/__tests__/use-cdp-verify.test.ts`
  - `src/pages/Catalog/cdp-projection/__tests__/cdp-projection-card.test.tsx`
  - `src/pages/Catalog/cdp-projection/__tests__/diff-equality.test.ts`
- **Modify:**
  - `src/pages/Catalog/detail-panel.tsx` â€” fill `MeasureRow` children w/ `<CdpProjectionCard measure={m} cube={cube}>`
- **Read (context):**
  - `src/QueryBuilderV2/NewMetric/api.ts` â€” discriminated-union pattern to mirror
  - `src/QueryBuilderV2/NewMetric/hooks/use-live-preview.ts` â€” `runIdRef` stale-token pattern
- **Delete:** none

## Implementation Steps (TDD)

1. **Test first â€” `diff-equality.test.ts`**:
   - Identical payload + response â†’ empty diff
   - Different `expression` â†’ 1-element diff
   - `filter: ""` vs `null` â†’ no diff (normalize)
   - `dimensions: ['a','b']` vs `['b','a']` â†’ no diff (sort)
   - Ignored fields differ (`materialize=true` vs `false`) â†’ no diff
2. **Test first â€” `use-cdp-verify.test.ts`** (with mocked `getMetric`):
   - Initial state `{ kind: 'idle' }`
   - `check()` â†’ state passes through `checking` â†’ `available` on 200 + equal
   - 200 + different `expression` â†’ `mismatch` w/ diff
   - 404 â†’ `missing`
   - 500 â†’ `error`
   - Double `check()` in flight â€” second resolves first â†’ second's result wins (runId guard)
3. **Test first â€” `cdp-projection-card.test.tsx`**:
   - Projectable: renders all 7 fields + Verify button + initial "Not checked" badge
   - Verify click â†’ calls hook's `check()`
   - State `available` â†’ green badge "Available"
   - State `missing` â†’ amber badge "Missing"
   - State `mismatch` â†’ red badge; clicking expands diff list w/ expected/actual rows
   - **Diff row in mismatch state has `.diff-expected` class on expected cell, `.diff-actual` class on actual cell** (assertable via `data-testid` or class selector)
   - State `error` â†’ red badge + Retry button
   - Non-projectable (`ok: false, reason: 'references-other-measures'`): renders disabled card; **`queryByRole('button', { name: /verify/i })` returns null** (button NOT in DOM, not just disabled); reason text visible
4. Run â†’ all red.
5. Write `diff-equality.ts`.
6. Write `api.ts`.
7. Write `use-cdp-verify.ts`.
8. Write `cdp-projection-card.tsx`.
9. Modify `detail-panel.tsx` to wire `<CdpProjectionCard>` as `MeasureRow` children.
10. Manual smoke (P5 acceptance):
    - `/catalog` â†’ mf_users â†’ expand `user_count` â†’ verify â†’ green Available
    - expand `lifetime_recharge_amount_vnd` (seeded with mismatched expression) â†’ verify â†’ red Mismatch w/ diff
    - expand any unseeded measure â†’ verify â†’ amber Missing
    - expand `arpu_vnd` â†’ "Not projectable â€” references other measures", no button

## Success Criteria

- [ ] All 3 test files green (â‰¥ 18 cases total)
- [ ] Manual smoke covers Available / Missing / Mismatch / Not projectable
- [ ] **Verify button absent (queryByRole returns null) on Not Projectable card** (hidden, not disabled)
- [ ] **Mismatch diff cells have `.diff-expected` (red) / `.diff-actual` (green) styling**
- [ ] No `dangerouslySetInnerHTML`
- [ ] All new files â‰¤ 200 lines (split if needed)
- [ ] Verify button disabled while `checking`
- [ ] Stale check ignored (race-safe)
- [ ] `npm run typecheck` clean
- [ ] `npm run test` clean

<!-- Updated: Validation Session 1 â€” verify button hidden (not disabled) on N/P; mismatch diff color-coded -->


## Risk Assessment

| Risk | Mitigation |
|---|---|
| Equality on `expression` too strict (whitespace) | Trim both sides + normalize internal whitespace via `.replace(/\s+/g, ' ')` |
| Hook leaks state across measure rows when row collapses mid-check | Re-instantiate hook per row (key by measure.name); test covers unmount during checking |
| Card overflows narrow DetailPanel (480 px) on long SQL expressions | `<code>` w/ `white-space: pre-wrap` + `word-break: break-word` |
| Diff list grows unbounded for many-field mismatch | Project only the 5 compared fields â†’ max 5 rows |
| Mock 5xx not exercisable from UI | Add a dev-only "Force error" toggle? â€” NO, YAGNI; covered by unit test only |
| `getMetric` URL escape â€” metric_name with special chars | `encodeURIComponent` both path segments |
