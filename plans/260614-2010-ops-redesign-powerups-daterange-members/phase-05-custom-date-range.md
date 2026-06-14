---
phase: 5
title: custom-date-range
status: completed
effort: 1.5h
---

# Phase 5: Custom date range (F2)

## Overview

**Priority:** P2 · **Status:** pending · **Independent of P1.** Coupled with P3 via the
window signature contract (see P3). This phase LANDS the `OpsWindow` type + `useOpsOverview`
signature change; P3 consumes it.

Add a date-range picker beside the existing 7d/30d/MTD `OpsWindowToggle`. Cap span ≤31 days
(billing_detail scan guard). Δ-vs-prior stays 7d-only (custom = no Δ, like 30d/MTD).

## Window model change (verified current state)

`ops-window.ts` today: `type OpsWindow = '7d' | '30d' | 'mtd'`; `opsWindowRanges(window,
today)` returns `{current, prior}`. The enum alone can't carry start/end → custom needs a
separate range state.

**Locked design:**
- `type OpsWindow = '7d' | '30d' | 'mtd' | 'custom'`.
- Keep `opsWindowRanges` PURE and ONLY for the 3 preset windows (unit-tested). For
  `'custom'`, the caller passes the explicit `OpsRange` separately — do NOT overload
  `opsWindowRanges` with a custom branch (keeps it pure + trivially testable). Add a small
  pure helper `clampRangeTo31Days(start, end): OpsRange` (or `isRangeWithinCap`) in
  `ops-window.ts`, unit-tested in P7.
- Custom → `prior: null` (no Δ), handled in the hook (P3 contract).

## Component: `OpsDateRangePicker` (NEW)

- File: `src/pages/OpsConsole/ops-date-range-picker.tsx`.
- Two date inputs (start, end) + an "Apply" affordance, OR a compact range control. KISS:
  native `<input type="date">` styled with tokens is acceptable and dependency-free — match
  `OpsWindowToggle`/members search input styling (tokens, `var(--font-sans)`, radius-md).
- **Validation (enforced in the component AND re-asserted by the pure helper):**
  - end ≥ start.
  - span ≤ 31 days inclusive → show inline hint + disable Apply if violated (do NOT silently
    clamp without telling the user; surfacing the cap is clearer).
  - both required before Apply.
- On Apply: call `onApply({start, end})` → parent sets `window='custom'` + `customRange`.
- Dates are inclusive YYYY-MM-DD (Cube `dateRange` convention, matches `OpsRange`).
- **GMT+7:** "today" / default range bounds shown to the user should reflect GMT+7, not UTC.
  Use a GMT+7-aware default (e.g. last 7 days ending today in Asia/Saigon). Keep the stored
  range as plain YYYY-MM-DD strings (Cube treats them as calendar dates).

## index.tsx wiring (verified current state)

`index.tsx:54` `const [window, setWindow] = useState<OpsWindow>('30d')`; line 154 renders
`<OpsWindowToggle value={window} onChange={setWindow} />` only on the overview tab.

Changes:
- Add `const [customRange, setCustomRange] = useState<OpsRange | null>(null)`.
- Render `OpsDateRangePicker` next to `OpsWindowToggle` (overview tab only). When a custom
  range is applied: `setWindow('custom'); setCustomRange(range)`. When a preset toggle is
  picked: `setWindow(preset)` (leave customRange as-is or clear it — clearing is cleaner).
- Pass to `<OverviewTab gameId={gameId} window={window} customRange={customRange ?? undefined} />`.
- `OverviewTab` forwards `customRange` to `useOpsOverview(gameId, window, customRange)`.

`OpsWindowToggle` (`ops-window-toggle.tsx`): read-only here — confirm its value/onChange
types accept the widened enum (it should pass `'custom'` through harmlessly, or keep custom
out of the toggle's button set and let the picker own the 'custom' state). Prefer: toggle
shows only the 3 presets; the picker is the 4th selector; `window==='custom'` highlights the
picker, de-highlights all toggle buttons.

## Related code files

- Modify: `src/pages/OpsConsole/ops-window.ts` (widen enum, add clamp helper; keep pure).
- Create: `src/pages/OpsConsole/ops-date-range-picker.tsx` (<150 LOC, tokens, GMT+7 default).
- Modify: `src/pages/OpsConsole/index.tsx` (customRange state + picker wiring).
- Modify: `src/pages/OpsConsole/overview-tab.tsx` (accept + forward `customRange`).
- Read: `src/pages/OpsConsole/ops-window-toggle.tsx` (confirm enum compat).

## Implementation Steps

1. Widen `OpsWindow`; add `clampRangeTo31Days`/`isRangeWithinCap` pure helper. Do NOT add a
   custom branch to `opsWindowRanges`.
2. Build `OpsDateRangePicker` with the validation rules above; tokens + GMT+7 default.
3. Wire `customRange` state + picker in `index.tsx`; forward through `OverviewTab` to the hook
   (P3 signature: `useOpsOverview(gameId, window, customRange?)`).
4. Ensure custom → no Δ (hook sets prior=null; deltaNote in overview-tab already shows
   "no Δ on this window" for non-7d — extend that condition to treat 'custom' like 30d/MTD).
5. tsc + build.

## Todo

- [ ] OpsWindow widened to include 'custom'; opsWindowRanges stays pure (3 presets only)
- [ ] clamp/within-31d pure helper added (P7 tests it)
- [ ] OpsDateRangePicker built (≤31d cap surfaced, end≥start, tokens, GMT+7 default)
- [ ] index.tsx customRange state + picker wired; forwarded to hook
- [ ] custom window shows no Δ (deltaNote + hook prior=null)
- [ ] tsc + build clean

## Success Criteria

- Picker sits beside the toggle on the overview tab; selecting a range refetches Overview for
  that exact range.
- Spans >31 days are blocked with a clear inline message (never silently scan).
- Custom shows no Δ; presets unchanged.
- Visual parity with the toggle (tokens, font, spacing scale).

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| >31d range slips through → heavy billing scan | MED | Slow/expensive query | Pure cap helper + component guard; P7 unit-tests the cap (incl. 31 vs 32 boundary). |
| signature drift breaks P3/OverviewTab | MED | Build break | Land enum+signature here first (P3 contract); tsc catches mismatches. |
| GMT+7 vs UTC default off-by-one day | LOW | Wrong default range | Compute default in Asia/Saigon; store plain calendar dates. |
| custom leaks a bogus prior → fake Δ | LOW | Misleading +∞% | Hook forces prior=null for custom (mirrors 30d/MTD rationale in ops-window.ts header). |

## Next Steps

Independent of P4; P7 unit-tests the cap + window math.
