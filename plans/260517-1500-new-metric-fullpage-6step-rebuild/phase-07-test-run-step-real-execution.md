---
phase: 7
title: "Step 6 Test run — write-then-load-then-discard + real stats + submit"
status: completed
priority: P2
effort: "1.5d"
dependencies: [6]
---

# Phase 7: Test run step real execution

## Overview

Step 6 — compile + run the metric against Cube using **write-then-load-then-discard** (resolves red-team finding #23). Three states: **idle** (Ready to run hero), **running** (spinner + 5-line progress list), **complete** (hero stats + multi-series trend + dimension breakdown table + compiled SQL block). Time-range segmented control: `Yesterday / Last 7 d / Last 30 d / Custom`. **Custom uses antd `DatePicker.RangePicker` directly** (no reusable playground RangePicker exists). Submit checklist in right rail. Submit fires a second `postSchemaWrite` (the persistent one); on success → P8 success page via RR5 `history.push`.

**Red-team-applied:**
- **#23: Test-run strategy is write-then-load-then-discard.** Mirrors `src/QueryBuilderV2/NewMetric/hooks/use-live-preview.ts`. Hero/trend/breakdown queries run against the real committed measure, then auto-discard via `deleteSchemaWrite`. Submit is a second, persistent commit. No fictional "inline measure SQL" — Cube doesn't support that.
- **#1: RR5 idioms** — `useHistory()` + `history.push(...)`; no `useNavigate`/`navigate(...)`.
- **#4: Concurrency via `runIdRef`** — Cube SDK doesn't accept AbortSignal.
- **#7: `cubejsApi.sql()` shape fix** — `const sqlQuery = await cubeApi.sql(query); const q = Array.isArray(sqlQuery) ? sqlQuery[0] : sqlQuery; const sql = q.sql();` (per `QueryBuilderGeneratedSQL.tsx:47-48`).
- **#8: antd `DatePicker.RangePicker`** directly (no reusable playground RangePicker).
- **#9 + #17: Surface `result.warning === 'meta-not-acknowledged'`** — server returns 200 + warning on poll timeout (NOT 504). Drop dead 504 branch. On warning, auto-fire `deleteSchemaWrite` to restore `.bak` + show amber notification "Cube hot-reload timed out; changes rolled back".

## Requirements

**Functional:**
- Step entry: idle state w/ big play icon + "Ready when you are" + `Run test on real data` primary button.
- Run test action: set `state.testRun.status = 'running'`; fire the **write-then-load-then-discard** sequence:
  1. `postSchemaWrite({ cubeName, measureName: `__wizard_preview_${tabId}`, yamlPatch })` — commit a temp measure under a tab-scoped name (collision-safe across tabs).
  2. `refreshMeta()` + wait for the preview measure to appear (existing meta-poll pattern from `use-live-preview.ts`).
  3. Fire three queries against the committed preview measure: hero value (selected range), daily-granularity trend, dimension breakdown (auto-pick first non-time dim).
  4. Fetch compiled SQL via `cubeApi.sql(query)` (correct shape).
  5. `deleteSchemaWrite({ cubeName, measureName: preview-name })` — restore `.bak`.
  6. Transition `state.testRun.status = 'complete'` with all results.
  - If any step errs: surface antd notification; auto-discard preview if commit succeeded.
  - If commit returns `warning === 'meta-not-acknowledged'`: auto-discard, surface "Cube hot-reload timed out; rolled back", stay in idle/error state.
- Progress list animates: YAML parsed → SQL compiled → Scanning N partitions → Validate shape → DQ checks (visual sequencing — ticks at real query milestones where possible, fixed intervals otherwise; label honestly as "compiling…/scanning…").
- On complete: render hero stats grid (Metric value · Rows aggregated · Compile time — pulled from response meta), trend SVG chart (single line + optional 2 dimension series — from trend query), dimension breakdown table, compiled SQL block.
- Time range seg switch fires re-run (full write-then-load-then-discard cycle again w/ new range).
- Re-run button in StepHeader.
- Custom range option opens antd `DatePicker.RangePicker`; on accept, sets `state.testRun.customRange` and re-runs.
- Right-rail **Submit checklist** — 5 items: YAML parses cleanly · SQL compiles on Snowflake · No name collision in cube · Within team budget (84 MB / 5 GB est) · No PII in result columns. Items tick green on successful complete state; on error, tick amber w/ inline reason.
- Footer: when status `complete`, Continue becomes **Submit metric request** primary button. On submit: call `postSchemaWrite` with the REAL measure name (not the `__wizard_preview` one); on success navigate via RR5 `history.push('/metrics/new/success', { name, cubeName, schema })`; surface `result.warning === 'meta-not-acknowledged'` if present.
- LeftRail Step 6 row summary: status ("Ready to run" / "Running…" / "✓ 412 ms · 5 rows"); validation card row 4 "Test run passed" ticks green on complete.
- **`BroadcastChannel('new-metric')`-based multi-tab guard:** disable Submit if another tab broadcasts `editing` since the last meta refresh.

**Non-functional:**
- All Cube queries use `runIdRef` stale-token guard (no AbortController).
- Trend SVG inline (no recharts).
- All files < 200 LOC.
- No `dangerouslySetInnerHTML`.

## Architecture

```
src/QueryBuilderV2/NewMetric/full-page/
├── steps/step-6-test-run/
│   ├── index.tsx
│   ├── test-run-body.tsx                    state router
│   ├── test-run-idle.tsx
│   ├── test-run-running.tsx
│   ├── test-run-progress-line.tsx
│   ├── test-run-results.tsx                 hero stats + trend + breakdown + SQL
│   ├── test-run-hero-stat-card.tsx
│   ├── test-run-trend-chart.tsx             inline SVG
│   ├── test-run-breakdown-table.tsx
│   ├── compiled-sql-block.tsx               uses cubejsApi.sql() correct shape
│   ├── time-range-seg.tsx                   yesterday / 7d / 30d / custom (antd RangePicker)
│   ├── submit-checklist-rail.tsx
│   └── __tests__/
│       └── test-run-body.test.tsx
└── hooks/
    ├── use-test-run.ts                      write-then-load-then-discard state machine + runIdRef
    └── __tests__/
        └── use-test-run.test.ts
```

## Related Code Files

- **Create:** all files above
- **Modify:** `src/QueryBuilderV2/NewMetric/full-page/NewMetricPage.tsx` — render step-6 when `currentStep === 6`
- **Reuse:** `cubejsApi.sql()` + `cubejsApi.load()`; `postSchemaWrite` + `deleteSchemaWrite` (existing in `api.ts`); `refreshMeta` + meta-poll pattern from `use-live-preview.ts`; antd `DatePicker.RangePicker` (already in stack)
- **Reference for SQL shape:** `src/QueryBuilderV2/QueryBuilderGeneratedSQL.tsx:47-48`
- **Reference for write-then-load-then-discard:** `src/QueryBuilderV2/NewMetric/hooks/use-live-preview.ts:75-156`

## Implementation Steps (TDD)

1. **Probe** — confirm `deleteSchemaWrite` API exists in `api.ts` (it does — used by v1 live-preview); confirm meta-poll utility importable (`meta-poll.ts`).
2. **Re-verify** `cubeApi.sql()` returns array-or-single shape via `QueryBuilderGeneratedSQL.tsx:47-48`.
3. **Write tests first:**
   - `use-test-run.test.ts` — initial `status: 'idle'`; `runTest()` transitions to `running` → calls `postSchemaWrite` w/ tab-scoped preview name → waits for meta refresh → fires 3 `cubeApi.load` calls + 1 `cubeApi.sql` → calls `deleteSchemaWrite` → transitions to `complete` w/ mock responses. **Stale-token:** changing time range mid-run skips prior `setState`. Commit returning `warning === 'meta-not-acknowledged'` → auto-fires `deleteSchemaWrite` → transitions to `error` state w/ "rolled back" reason.
   - `test-run-body.test.tsx` — renders idle by default; clicking Run test transitions UI; complete state shows hero + trend + breakdown + SQL.
4. **Implement `use-test-run`** — orchestrates write-then-load-then-discard via runIdRef; returns `{ status, hero, trend, breakdown, sql, error }`. Tab-scoped preview name uses `sessionStorage` tabId (from P1).
5. **Implement `test-run-idle.tsx`** — match mockup w/ big play icon + estimated scan size text.
6. **Implement `test-run-running.tsx` + `test-run-progress-line.tsx`** — progress sequenced against real milestones (commit done → "YAML parsed"; meta refresh done → "SQL compiled"; load fired → "Scanning…"; load resolved → "Validate shape"; complete → "DQ checks"). When ticks outrun real milestones, fall back to fixed interval w/ honest "compiling…" label.
7. **Implement `test-run-results.tsx`** — grid: 3 hero stats, trend chart panel, breakdown table panel, compiled SQL panel.
8. **Implement `test-run-trend-chart.tsx`** — inline SVG, single brand-orange line + optional dashed comparison if breakdown has top 2 series.
9. **Implement `test-run-breakdown-table.tsx`** — total row at bottom; share-bar mini-vis per row.
10. **Implement `compiled-sql-block.tsx`** — correct shape:
    ```ts
    const sqlQuery = await cubeApi.sql(query);
    const q = Array.isArray(sqlQuery) ? sqlQuery[0] : sqlQuery;
    const sql = q.sql();
    ```
    Token-coloured via React text nodes (no innerHTML).
11. **Implement `time-range-seg.tsx`** — 4-option seg control; Custom opens antd `DatePicker.RangePicker` overlay (already in stack via antd 4.16.13).
12. **Implement `submit-checklist-rail.tsx`** — 5 dashed → green ticks on complete; amber w/ inline reason on error.
13. **Wire submit** — `useHistory()` (RR5); on success `history.push('/metrics/new/success', { state: { name, cubeName, schema } })`. Handle warning:
    ```ts
    if (result.ok && result.warning === 'meta-not-acknowledged') {
      await deleteSchemaWrite({ cubeName, measureName });
      antd.notification.warning({ message: 'Cube hot-reload timed out; changes rolled back' });
      return;
    }
    if (result.ok) { /* success → navigate */ }
    if (!result.ok && result.status === 409) { /* conflict — show v1-style "file changed externally" */ }
    // No 504 branch — server never returns 504; it returns 200 + warning.
    ```
14. **Manual QA** — full happy path on `mf_users`: pick a measure, hit Run, observe progress → results; switch time range → re-run; switch Custom → antd RangePicker → re-run; click Submit → measure lands in YAML + meta refresh (verify via `#/schema/mf_users`). Force a 504-like scenario (slow Cube) → confirm `meta-not-acknowledged` path → auto-discard + amber toast.
15. Typecheck + tests + commit.

## Success Criteria

- [ ] Step 6 idle state renders w/ Run test button + estimated scan hint.
- [ ] Run test executes write-then-load-then-discard cycle: temp commit → meta refresh wait → 3 load queries + 1 sql query → temp discard.
- [ ] Complete state shows 3 hero stats (Metric value w/ Δ%, Rows aggregated, Compile time), single-series trend SVG, dimension breakdown table w/ totals, compiled SQL block.
- [ ] Time-range seg switches re-run the cycle; Custom opens antd `DatePicker.RangePicker`; selection re-runs.
- [ ] Re-run button forces a fresh fetch.
- [ ] Submit checklist: 5 dashed in idle/running, 5 green in complete, amber on error.
- [ ] Submit (footer) appears in complete state; on click triggers final `postSchemaWrite` w/ real name; success → RR5 `history.push('/metrics/new/success')`.
- [ ] `meta-not-acknowledged` warning auto-discards preview + shows amber notification "rolled back".
- [ ] 409 surfaces v1-style "file changed externally" notification.
- [ ] No 504 branch present (grep returns zero matches in P7 files).
- [ ] LeftRail validation card "Test run passed" ticks green; LeftRail Step 6 summary updates.
- [ ] No `useNavigate` / `navigate(` / `AbortController` / `dangerouslySetInnerHTML` in new files.
- [ ] `cubejsApi.sql` snippet uses correct shape (array unwrap + `q.sql()`).
- [ ] Typecheck + tests green; every new file < 200 LOC.

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Write-then-load-then-discard fails mid-cycle, leaving preview measure on disk | Hook tracks `lastWrittenPreviewName`; on unmount or error, auto-fires `deleteSchemaWrite`. P1 `.bak` first-write-wins guard preserves true original. Mirror `use-live-preview.ts:113-121` pattern. |
| Multiple tabs racing on the same temp preview name | Tab-scoped name `__wizard_preview_${tabId}` avoids collision. Submit (real name) still subject to 409 → user notified. |
| `cubeApi.sql()` shape diverges from `QueryBuilderGeneratedSQL.tsx` | Snippet copy-paste from that file's pattern. Test mocks return shape matching `{ sql: () => 'SELECT ...' }`. |
| Trend dim breakdown picks wrong default dimension | Auto-pick first non-time dim; header segmented control lets user switch (mockup: `tier / age / platform`); for POC, hardcode `tier` if present, else first non-time dim. |
| Long-running queries on huge cubes block UI | Progress fallback timeout — after 8 s, switch label to "Still running — Cube may be cold-starting"; runIdRef discards stale results on time-range change. |
| Custom date range picker missing | Resolved — use antd `DatePicker.RangePicker` directly (already in stack at `antd@4.16.13`). |
| `meta-not-acknowledged` path hides the fact that file was kept | Auto-fires `deleteSchemaWrite` → restores `.bak` → user sees clean state. Notification explains "rolled back". |
| Submit succeeds but navigation state lost on hard reload | Success route reads from URL query fallback: `/metrics/new/success?name=...&cubeName=...` if `history.state` missing. P8 handles this. |
