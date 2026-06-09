# Phase 1 — Case Ledger Queue Pagination (BE + FE)

## Context links
- Route: `server/src/routes/care-cases.ts` (GET `/api/care/cases`, `/api/care/cases/by-vip`)
- Store: `server/src/care/care-case-store.ts` (`listCases`)
- Hook: `src/pages/Dashboards/cs/use-care-cases.ts` (`useCareCases`, `useVipQueue`)
- UI: `src/pages/Dashboards/cs/case-ledger.tsx` (LensToggle By-Playbook / By-VIP)
- Pagination precedent: `server/src/routes/segments.ts` (limit/offset, `total_count`/`returned_count`/`page` envelope)
- Design: `docs/design-guidelines.md`

## Overview
- **Priority:** P1 (unblocks ~7,793-row slow load immediately)
- **Status:** pending
- Add server-side + client pagination, 50 VIPs/page, to BOTH lenses of the Case Ledger. No schema change.

## Key insights
- by-vip and by-playbook handlers **sort + enrich in-memory after the SQL read** (`care-cases.ts:67-107`). So pagination = slice the post-sort array → priority order preserved, urgent (`cao`) cases stay on page 1. Do NOT push pagination into SQL or sort changes — slice after the existing in-route sort.
- `listCases` SQL is `ORDER BY opened_at DESC`; the route re-sorts by priority. Enrichment (profiles) currently fetched for the FULL list — must move to fetch profiles only for the **page slice** to avoid enriching 7,793 rows per request.
- Envelope shape per user decision: `{ vips|cases, total, page, pageSize }`.

## Requirements
- Functional: `?page=1&pageSize=50` on both GET endpoints. Default page=1, pageSize=50. Clamp pageSize to [1,200]. `total` = full pre-slice count. Sort unchanged (priority → caseCount → uid for by-vip; opened_at DESC + filters for by-playbook).
- Non-functional: profile enrichment only for the returned page slice. Backward compatible — if no page param, still return page 1 (50). Response stays JSON object (clients already read `.vips` / `.cases`).

## Architecture
Data flow (by-vip): SQL `listCases` (open filter) → `groupCasesByVip` → priority sort (in-route) → **slice [start, start+pageSize)** → enrich slice w/ `getVipProfiles(pageUids)` → `{ vips, total, page, pageSize }`. Same for by-playbook: `listCases(filter)` → slice → enrich slice.
FE: hooks accept `page`, expose `total`/`pageSize`; `case-ledger.tsx` adds a pager (Prev/Next + "page X of N", token-styled) under each lens; changing lens/game resets to page 1.

## Related code files
- **Modify:** `server/src/routes/care-cases.ts` (GET cases + by-vip: parse page/pageSize, slice post-sort, enrich slice, new envelope).
- **Modify:** `src/pages/Dashboards/cs/use-care-cases.ts` (useCareCases/useVipQueue accept page, return total/pageSize; thread page into query string).
- **Modify:** `src/pages/Dashboards/cs/case-ledger.tsx` (pager control; reset page on lens/game change; keep sweep button behavior).
- **Create (if pager >40 LOC or ledger >200 LOC):** `src/pages/Dashboards/cs/queue-pager.tsx` (token-styled Prev/Next + count).
- **Delete:** none.

## Implementation steps
1. In `care-cases.ts` GET `/api/care/cases/by-vip`: parse `page`/`pageSize` (clamp), compute `total = enriched.length`, slice `[(page-1)*pageSize, ...]`, fetch `getVipProfiles` for slice uids only, return `{ vips: slice, total, page, pageSize }`.
2. Same for GET `/api/care/cases` (by-playbook): slice the post-sort `cases`, enrich slice, return `{ cases, total, page, pageSize }`.
3. Confirm urgent ordering: assert page 1 first row is highest priority when mixed priorities present (test).
4. FE hook: add `page` arg + `total`/`pageSize` in state; append `&page=&pageSize=50` to fetch URLs; keep AbortController pattern.
5. FE ledger: render `queue-pager` under each lens; `useState(page)`; reset to 1 on lens toggle, game switch, or post-sweep reload. Disable Next on last page.
6. Style pager with tokens (`var(--text-secondary)`, `var(--border-card)`, `var(--radius-md)`, spacing scale); mirror existing ledger controls.
7. `npm run -w server build` + client typecheck; verify no >200 LOC regressions (modularize ledger if needed).

## Todo
- [ ] BE by-vip pagination + slice-only enrichment
- [ ] BE by-playbook pagination + slice-only enrichment
- [ ] FE hooks: page arg + total/pageSize
- [ ] FE pager component (token-styled) + page reset logic
- [ ] Tests (BE envelope + urgent-on-page-1; FE pager render)
- [ ] Typecheck/build clean

## Success criteria
- Both lenses return ≤50 rows/page with correct `total`; page N navigable.
- Page 1 row 1 is highest-priority VIP for cfm_vn (no urgent dropped).
- Profile enrichment query count bounded to ≤ pageSize uids/request (verify via test or log).
- No design drift vs `case-ledger.tsx`.

## Risk + mitigation
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Enriching full list still slow (if step1 missed) | M×H | Explicit test asserts profile fetch receives ≤pageSize uids |
| Sort pushed to SQL accidentally → priority lost | L×H | Keep in-route sort; slice after; test page-1 priority |
| Stale page index after sweep adds/removes cases | M×M | Reset to page 1 on opened>0 reload (matches current full-reload) |
| Client reads old `.vips`/`.cases` field, ignores envelope | L×L | Keep field names; only add total/page/pageSize |

## Security
- GET stays viewer-ok (no gating change). page/pageSize validated + clamped (no unbounded slice / negative offset). No new mutation.

## Next steps
- Independent; ships first. No dependency on snapshot phases. Pager component reused by Phase 4 drill-to-VIPs list.
