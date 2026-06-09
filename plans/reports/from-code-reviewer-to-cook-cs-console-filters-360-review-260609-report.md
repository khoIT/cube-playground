# CS Console: filters + Member-360 redesign — code review

Scope: 8 modified + 7 new files (~486 ins). Review-only. Plan: `plans/260609-1239-cs-console-filters-360-redesign/plan.md`.

## Verdict
All 5 tasks land cleanly. Gates pass: server `tsc` 0 errors; client `tsc` exactly 74 (baseline, none in touched files); server route tests 17/17; client tests 18/18. No plan-artifact refs in code/filenames. No raw hex beyond the established `#fff`-on-brand convention. No regressions found in the four flagged touchpoints.

## Acceptance criteria — all met
- (a) Route fix `/dashboards/cs`: `<Switch>` wraps only the contiguous dashboards family (`src/index.tsx:241-249`); siblings (`/drift-center`…) untouched. Correct & surgical.
- (a) By-Playbook lens: prominent `PlaybookFilterBar` + de-emphasized `StatusChipRow`; URL is source of truth (`?playbook=…&status=…`, `case-ledger.tsx:674-701`); empty playbook = all (`playbook-filter-bar.tsx:89-101`, server drops filter when list empty).
- (a) Column rename: `MatchedPlaybookPill` priority-tinted, links to `?playbook=<id>`, `stopPropagation` so row click isn't hijacked, snapshot moved to `title` tooltip (`case-ledger.tsx:94-118`); "Opened"→"Matched" with `exactTime` tooltip (`:226-231`).
- (a) By-VIP search: 250ms debounce, page reset, `q=` param (`case-ledger.tsx:484-491`, `use-care-cases.ts:244-280`).
- (a) Care-first Member-360: new `member360/` dir; branch only for `segmentLess && sections && gameId` (`member-360-view.tsx:177-193`); sample timeline + rail clearly labelled; "Mark treated" role-gated client-side stub.
- (b) No business-logic regression — see touchpoint audit below.
- (c) API additive only: list rows now also carry `playbook_name`/`playbook_priority` (`care-cases.ts:113-116`); `by-vip` gains optional `q`. Client type widened `playbook_priority?: number | string` (`use-care-cases.ts:43`). Back-compatible.
- (d) Patterns: tokens only, `var(--font-sans)`, page-header pattern preserved, outside-click via `mousedown` + `.closest()` (NOT backdrop, `playbook-filter-bar.tsx:49-56`), kebab-case filenames.
- (e) No new lint/type errors (verified).
- (f) No phase/finding/audit refs in code or filenames (grep-clean).
- (g) Sample clearly labelled: warning-tinted "sample" tag + explanatory tooltip (`cs-care-history-timeline.tsx:125-130`), footer "actions don't persist yet" (`cs-recommended-action-rail.tsx:141-143`), "Logged to timeline (sample)" confirmation. Identity/metrics reuse real `DashboardHero`; only the timeline/rail are sample. Does not masquerade as live.

## Touchpoint regression audit (b)
- CS Monitor full list: pagination still opt-in (`parsePaging` paginate only when `page`/`pageSize` present, `care-cases.ts:64-70`). Monitor omits both → full un-paginated list. No silent cap. PASS.
- Urgent (cao) never dropped: by-vip sorts by `priorityRank` BEFORE slice (`care-cases.ts:148-158`); cao stays on page 1. PASS.
- q-path priority ranking: q-branch filters the already-sorted `ranked` array (`care-cases.ts:163-178`) → relative order preserved. PASS.
- Segments (non-care) 360 unaffected: new branch is gated on `segmentLess`; the Segments stacked layout is the untouched fall-through. PASS.

## Issues

### Minor
1. **Unused import** — `STATUS_ORDER` imported in `case-ledger.tsx:31` but never referenced (only the import line matches). Dead import; remove it. Doesn't fail the build (TS `noUnusedLocals` not tripping in this config) but is lint noise.
2. **Stale doc-comment contradicts behavior** — `ByPlaybookView` prop comment says playbookIds is "guaranteed length ≥ 1" (`case-ledger.tsx:254`), but empty selection = all-playbooks is the actual (and intended) contract everywhere else (`playbook-filter-bar.tsx:29-32`, server). Comment is misleading; fix to "[] = all".

### Nits
3. **q-path ranking not directly asserted** — `by-vip q=` test covers filtering (uid + name) but not that priority order survives the filter. Structurally safe (reuses sorted array), but a 2-VIP differing-priority assertion would lock it.
4. **Status chip count honesty** — counts are page-scoped and labelled "counts on page" (`status-chip-row.tsx:101-103`), and status filter refines client-side on the current page only (`case-ledger.tsx:281-285`). Correct & disclosed, but a user on page 1 selecting "resolved" sees only page-1 resolved rows, not the full ledger's. Acceptable given the label; flag only if product wants server-side status counts later.
5. **Redundant double-clear handler** — `StatusChipRow` "All" button and "Clear (n)" both call `onClear` (`status-chip-row.tsx:75,91`); harmless, intentional.

## Strengths
- `pushInClause` helper (`care-case-store.ts:13-29`) cleanly unifies scalar/array → `= ?` / `IN (…)` with proper placeholder parameterization (no SQL injection; bad-status token rejected with 400 before query).
- Stable comma-string effect keys avoid array-identity re-render thrash (`use-care-cases.ts:175-178`).
- Reference panels reuse Segments section components verbatim — real Cube data, DRY, no fork.
- Comments explain *why* (enrich-whole-set-before-filter rationale, pagination opt-in rationale) without referencing plan artifacts.
- Row `key` correctly switched to `${playbook_id}_${id}` since uids repeat across playbooks in multi-select (`case-ledger.tsx:328`).

## Unresolved questions
- None blocking. Confirm with product whether status-chip counts should eventually be server-side full-ledger aggregates rather than page-scoped (nit #4) — current behavior is disclosed and acceptable for now.

**Status:** DONE_WITH_CONCERNS
**Summary:** All 5 tasks meet acceptance criteria with passing type/test gates and no regressions in the flagged touchpoints; only minor cleanups (one dead import, one stale comment) and disclosed-design nits remain.
