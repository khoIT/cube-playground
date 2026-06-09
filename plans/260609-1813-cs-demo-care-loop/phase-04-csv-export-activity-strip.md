# Phase 04 — CSV export + 24h activity strip (B5 + B6)

## Context links
- Brainstorm: `plans/reports/brainstorm-260609-1813-cs-demo-artifact-care-loop-report.md` (§B5, §B6, Open Q2)
- Plan overview: `plan.md` · Depends on Phase 01 (parallelizable with 02/03/05)

## Overview
- **Priority:** P3
- **Status:** pending
- **Description:** B5 — client-side CSV export of the queue (fetch full un-paginated set). B6 — "N treated · M dismissed (24h)" activity strip. Recommend a small server aggregate for B6 (cheap SQLite) over pulling all cases client-side.

## Key insights
- Pagination is **opt-in**: omitting `page`/`pageSize` returns the full list (`care-cases.ts:66-73,194-200`). So export can request the full set by calling `by-vip` (or `cases`) without paging params — already supported, no server change for B5.
- `MAX_PAGE_SIZE=200` only caps when paging is requested; un-paginated full fetch bypasses it.
- B6 needs counts over a 24h window keyed on `treated_at` / `closed_at`. Client-derive would require fetching every case + computing — wasteful and the Monitor already fetches full case list for portfolio stats (`use-care-playbooks.ts`). A tiny server aggregate is cleaner + bounded.
- Timezone is GMT+7 — "24h" = rolling 24h from `now` (UTC instant); display times in GMT+7 (per memory). Rolling window avoids calendar-day TZ ambiguity.

## Data flow
```
B5 export:  GET /api/care/cases/by-vip?game=<g>   (no page params → full set)
            └─► client maps rows → CSV (uid, name, LTV, tier, topPlaybook, openCaseCount, lastContact, status)
            └─► Blob download

B6 strip:   GET /api/care/activity?game=<g>        (NEW small aggregate)
            └─► { treated24h, dismissed24h, resolved24h, recent:[{uid, kind, playbookId, at}] }
            └─► render strip on Monitor / queue header
```

## Requirements
**Functional**
1. **B5:** Export button on By-VIP / By-Playbook lenses → fetches the **full** set (no page params) → CSV download. Columns: uid, name, LTV (VND), tier, top playbook, open-case count, last contact, status. Client-side Blob; filename `care-queue-<game>-<YYYYMMDD-HHmm>.csv` (GMT+7).
2. **B6:** Activity strip "N treated · M dismissed · K resolved (last 24h)" + a few recent events. Source = new `GET /api/care/activity?game` (viewer-ok read).
3. Activity counts use a rolling 24h window on the relevant timestamp (`treated`→`treated_at`, `resolved`/`dismissed`→`closed_at`); display in GMT+7.

**Non-functional:** tokens only; CSV safe-escaping (quotes/commas/newlines); no regression.

## Architecture
- **B5:** pure util `care-queue-csv.ts` (`toCsv(rows)` + `downloadCsv(name, text)`); fetch via existing `useVipQueue`/`apiFetch` un-paginated path. Button in `case-ledger.tsx`.
- **B6 (CONFIRMED — server aggregate):** new route `GET /api/care/activity?game` in a small new `care-activity.ts` route file (keep `care-cases.ts` lean). Reads `care_cases` with `WHERE game_id=? AND <ts> >= now-24h`. New FE hook `useCareActivity(game)` + `cs-activity-strip.tsx`. Client-derive rejected (couples to pagination/fetch).

## Related code files
**Create**
- `src/pages/Dashboards/cs/care-queue-csv.ts` — CSV builder + download.
- `src/pages/Dashboards/cs/__tests__/care-queue-csv.test.ts` — escaping + column order.
- `src/pages/Dashboards/cs/cs-activity-strip.tsx` — 24h strip.
- `server/src/routes/care-activity.ts` — `GET /api/care/activity?game` aggregate (or add handler in `care-cases.ts`).
- `server/test/care-activity-route.test.ts` — counts within/outside 24h window + game-scope validation.

**Modify**
- `src/pages/Dashboards/cs/case-ledger.tsx` — Export button (both lenses).
- `src/pages/Dashboards/cs/use-care-cases.ts` — `useCareActivity(game)` hook + full-set export fetch helper.
- `src/pages/Dashboards/cs/index.tsx` — mount activity strip on the Monitor (or queue header).
- `server/src/index.ts` (or route registrar) — register `care-activity` route if a new file.

## Implementation steps
1. **TDD-first (B5):** `care-queue-csv.test.ts` — column order, header row, escaping of names with commas/quotes/newlines, empty-set → header only.
2. Implement `care-queue-csv.ts` + Export button + un-paginated fetch.
3. **TDD-first (B6):** `care-activity-route.test.ts` — seed cases with `treated_at`/`closed_at` inside & outside 24h; assert counts; assert `game` validation (400 on invalid, like sibling routes `care-cases.ts:135`).
5. Implement `GET /api/care/activity?game` aggregate (rolling 24h, indexed scan on `game_id`).
6. `useCareActivity` hook + `cs-activity-strip.tsx`; mount on Monitor. Display GMT+7.
7. tsc + FE + server suites green.

## Todo
- [ ] `care-queue-csv.test.ts`
- [ ] `care-queue-csv.ts` + Export button + un-paginated fetch
- [ ] `care-activity-route.test.ts` (24h window + game-scope)
- [ ] `GET /api/care/activity?game` aggregate
- [ ] `useCareActivity` + `cs-activity-strip.tsx` on Monitor (GMT+7)
- [ ] tsc + suites green

## Success criteria
- Export downloads a well-formed CSV of the FULL queue (not just current page).
- Activity strip shows correct 24h treated/dismissed/resolved counts; recent events listed; times in GMT+7.
- Existing suites green; new route validates `game`.

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Export only grabs current page | M×H | Omit page params → full set (`care-cases.ts:68`); test asserts full count |
| CSV injection / broken rows | M×M | Quote-escape fields; test names with `,"` and newlines |
| 24h window TZ off-by-hours | M×M | Rolling 24h on UTC instant; display GMT+7; test boundary rows |
| New route bloats `care-cases.ts` (>file-size norm) | L×L | New `care-activity.ts` route file |

## Security
- Activity GET is viewer-ok (read-only), consistent with monitor/ledger reads. `game` validated against workspace allow-list (reuse `requireGame`, `care-cases.ts:52`). Export is client-side over already-authorized reads.

## Open questions
None — Q2 resolved (new `GET /api/care/activity?game` aggregate, `care-activity.ts` route file).

## Next steps
- Independent of 02/03/05; can land in parallel after Phase 01.
