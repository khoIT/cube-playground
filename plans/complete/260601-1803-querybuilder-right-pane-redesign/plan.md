# QueryBuilder Right-Pane Redesign

Reorganize the QueryBuilderV2 right pane from a chart-only panel into a tabbed
**Chart · Analysis · Compare** surface. Center keeps the data + output-format
tabs (Results / SQL / SQL API / REST / GraphQL). Spec = `visuals/query-builder-right-pane.html`
+ `visuals/qb-0{1,2,3}-*.png`.

## User decisions (locked)
- **Compare = right-pane only.** Remove Δ/Δ% delta columns from the center Results table; compare lives exclusively in the right-pane Compare tab.
- **Analysis moves to the right pane.** Remove the center `Analysis` tab; host `AnalysisPanel` in the right-pane Analysis tab.

## Key facts (verified)
- Layout owner: `src/QueryBuilderV2/QueryBuilderInternals.tsx` — 3 cols (sidebar 315 | center | chart pane 420px). Compare state lives here; `CompareContext.Provider` wraps only the center (`QueryBuilderInternals.tsx:185`).
- Right pane = `components/ChartSidePane.tsx` (collapsible; header "Chart" + chart-type toggle + body=`QueryBuilderChart`).
- `AnalysisPanel` (`analysis/analysis-panel.tsx`) + `CompareToggle` (`compare/compare-toggle.tsx`) already exist and are reusable.
- Compare data: `useCompareResults` → `compareState.mergedRows` (rows with `<m>`, `<m>__cmp`, `<m>__delta`, `<m>__deltaPct`) + `compLabel` + `unavailableMeasures`. Hook + merge stay; only the table rendering is removed.
- Reusable `Tabs/Tab` component at `components/Tabs/Tabs.tsx`. Tokens in `src/theme/tokens.css`.
- `compare-wiring.test.tsx` covers CompareToggle/context/URL only — not table deltas.

## Phases
- [x] **phase-01** — Layout: widen pane → 460px, lift `CompareContext.Provider` over both columns, add `onCompareChange` to context, drop center Compare toggle + center Analysis tab.
- [x] **phase-02** — Right-pane tabbed shell: `ChartSidePane` hosts Chart / Analysis / Compare tab strip + collapse; Chart view keeps chart-type toggle + pivot/code triggers. New `right-pane-tabs.tsx`.
- [x] **phase-03** — `ComparePane`: seg toggle (Off / Prev period / Other game + vs-game picker) + grouped-bar viz + N/A note; restyled `CompareToggle` to the seg pattern.
- [x] **phase-04** — Removed Δ/Δ% delta columns from `QueryBuilderResults.tsx` (cells + headers + memo deps + imports). Deleted orphaned `compare/format-delta.ts` + test.
- [x] **phase-05** — Tests + verification: updated `compare-wiring.test.tsx` + `compare-toggle.test.tsx`, added `compare-pane.test.tsx`; full vitest green (1,452 pass), no new tsc errors in touched files.

## Status: implementation complete, code-review in progress

## Dependencies
01 → 02 → 03 (02 mounts ComparePane built in 03; build 03 component first or stub). 04 independent of 02/03. 05 last.
