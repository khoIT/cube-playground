# PM Report — Segment Detail UI Redesign (260607-1331)

## Status: COMPLETED (all 6 phases)

| Phase | Outcome |
|---|---|
| 1 Design variants | 3 huashu HTML variants + width toggle; user picked **mix: B command bar + C KPI tiles** (`design/variants.html`) |
| 2 Header/action row | New `detail-header-actions.tsx` (command bar Share/Refresh/Open in Playground + primary Edit predicate + ⋯ Delete via antd4 Dropdown overlay); "Copy as filter"→"Open in Playground" (en+vi, old key removed); buttons normalized 28px |
| 3 Number formatting | `formatCompact` w/ B tier unified in `format-value.ts` (+`formatValueExact` tooltips); `formatCount` removed; KPI strip→responsive tile grid |
| 4 Datetime axes | New `src/utils/format-chart-datetime-label.ts` (regex ISO parse, no Date() TZ shift; "Apr 7"/"Apr 7 14:00"/year-boundary "Apr 7, 2026"); wired: segments LineChart (dashboards inherit), chat assistant-chart-section 7×XAxis+1×YAxis+tooltips+pieLabel |
| 5 Card headers | CardShell: icon chip + title + pure-unit chip ([users]/[VND]/[%], hidden when redundant); subtitle removed; new `resolve-card-icon.tsx` + `resolve-card-unit.ts`; 5 card callers updated |
| 6 Tests/review | 28 new unit tests; 393/393 pass (Segments/Chat/Dashboards); tsc 0 new errors; code-reviewer verdict DONE, all criteria PASS |

## Verification
- Live screenshots: `design/after-segment-detail.png`, `design/after-installs-zoom.png` (axis "Apr 7…Jun 6", [users] chips, ₫10.29B compact)
- Review LOW notes (non-blocking): tick-formatter double-scan readability; pre-existing vi.json `convertToLive` gap (defaultValue covers)

## Not committed yet — awaiting user decision.

## Unresolved questions
- Optional follow-up: Catalog `metric-sparkline.tsx` + member360 `mini-bar-chart.tsx` still render raw x labels (out of pinned scope: segment/dashboard/chat).
