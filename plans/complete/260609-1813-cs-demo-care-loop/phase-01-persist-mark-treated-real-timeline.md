# Phase 01 — Persist Mark-treated + real care timeline (A1)

## Context links
- Brainstorm: `plans/reports/brainstorm-260609-1813-cs-demo-artifact-care-loop-report.md` (§A1)
- Plan overview: `plan.md`

## Overview
- **Priority:** P1 (the payoff slice — converts the central mock into a real persisted loop)
- **Status:** pending
- **Description:** Drive the Member-360 recommended-action rail from the VIP's real highest-priority open case, render the timeline from real ledger cases (sample only when 0 cases), and make "Mark treated" an inline form (channel / action / note) that PATCHes the case and refetches. **Frontend only — server already supports the PATCH.**

## Key insights
- `PATCH /api/care/cases/:id` already accepts `status/channel_used/action_taken/notes` and `patchCase()` stamps `treated_at` on `→treated` (`server/src/care/care-case-store.ts:176-181`). No server work.
- `useVipCaseHistory(gameId, uid)` returns all cases for a UID (`src/pages/Dashboards/cs/use-care-cases.ts:291`); the view already calls it to derive `openCount` (`cs-member360-view.tsx:56`).
- Current treat path is a pure client stub: `treated` boolean → prepends `SAMPLE_RECOMMENDED_ACTION` to `SAMPLE_CARE_TIMELINE` (`cs-member360-view.tsx:62-81`); `onMarkTreated` is visual only (`cs-recommended-action-rail.tsx:48,127`).
- Open queue (`by-vip`) excludes resolved/dismissed (`care-cases.ts:138-140`); treated stays open → treated case must remain visible in queue but show "treated" state. That is already true server-side; FE just needs to stop faking it.
- `CareCase` shape exported from `use-care-cases.ts` (used in tests, `__tests__/use-care-cases.test.ts:14`). Playbook meta (`playbook_name`, `playbook_priority`) is attached by the `vip/:uid` route (`care-cases.ts:208-212`).

## Data flow
```
useVipCaseHistory(game, uid) ──► cases[] (real, w/ playbook_name/priority)
   │
   ├─ openCases = cases.filter(status ∉ {resolved,dismissed})
   ├─ topOpen = highest-priority open case (priorityRank on playbook_priority, then opened_at)
   │     └─► RecommendedAction derived from topOpen + playbook guidance (generic talk-track/offer/SLA)
   └─ timeline = cases.map(→ CareTimelineEvent)   (sample only when cases.length === 0)

Treat form submit ──► patchCareCase(topOpen.id, {status:'treated', channel_used, action_taken, notes})
   └─► await → refetch useVipCaseHistory → case now shows treated; topOpen recomputes to next open (or none)
```

## Requirements
**Functional**
1. Recommended-action rail targets the VIP's real highest-priority **open** case, not `SAMPLE_RECOMMENDED_ACTION`. Talk-track / offer / SLA are playbook-derived generic guidance (kept non-fictional per VIP).
2. Timeline renders real `cases` as events (opened/treated/resolved/dismissed). When VIP has 0 cases, fall back to the labelled sample (graceful).
3. "Mark treated" expands an inline form: channel select (`call/zalo_zns/in_game/email`), action-taken text, optional note → submit PATCHes `{status:'treated', channel_used, action_taken, notes}` → on success refetch; the case turns green and shows in real history; rail advances to next open case (or empty state).
4. Write controls gated on `canWrite` (editor/admin) — unchanged pattern from `cs-member360-view.tsx:53`.
5. Submit shows pending/disabled + surfaces PATCH errors inline (no silent failure).

**Non-functional**
- Tokens only (`var(--*)`), page-header pattern unchanged. No new bespoke spacing.
- No regression in existing care suites.

## Architecture
- New mapper `care-case → CareTimelineEvent` and `topOpenCase → RecommendedAction`. Put pure transforms in a new file `cs-member360-derive.ts` so they're unit-testable without React.
- Keep `cs-member360-mock.ts` types (`CareTimelineEvent`, `RecommendedAction`, `CareChannel`, etc.) — reuse them; sample data stays only as the 0-case fallback.
- Rail gains an inline form state; `onMarkTreated` becomes `onSubmitTreatment(payload)` returning a promise. View owns the PATCH + refetch (lift state up); rail stays presentational.

## Related code files
**Create**
- `src/pages/Dashboards/cs/member360/cs-member360-derive.ts` — pure transforms: `casesToTimeline(cases)`, `pickTopOpenCase(cases)`, `caseToRecommendedAction(case, playbookGuidance)`.
- `src/pages/Dashboards/cs/__tests__/cs-member360-derive.test.ts` — unit tests for the transforms.

**Modify**
- `src/pages/Dashboards/cs/member360/cs-member360-view.tsx` — drive rail+timeline from real cases; own PATCH+refetch; 0-case sample fallback.
- `src/pages/Dashboards/cs/member360/cs-recommended-action-rail.tsx` — inline treat form (channel/action/note), pending/error states; presentational submit callback.
- `src/pages/Dashboards/cs/member360/cs-care-history-timeline.tsx` — accept a `live` flag so the "sample" tag only renders on the 0-case fallback.
- `src/pages/Dashboards/cs/__tests__/cs-member360-care.test.tsx` — extend (see TDD).
- `src/pages/Dashboards/cs/use-care-cases.ts` — add a `refetch()` to `useVipCaseHistory` return (currently no manual refetch). Small, additive.

**Delete** — none (sample retained as fallback).

## Implementation steps
1. **TDD-first** — extend `cs-member360-care.test.tsx`: (a) lock current behavior (renders sample when no cases — should still pass after change); (b) NEW: given real cases, timeline renders real playbook names not sample; (c) NEW: clicking Mark-treated + filling form calls `patchCareCase` with `{status:'treated', channel_used, action_taken, notes}` and triggers refetch (mock fetch). Add `cs-member360-derive.test.ts` for pure transforms.
2. Add `refetch` to `useVipCaseHistory` (extract the `load()` into a `useCallback`, expose it).
3. Write `cs-member360-derive.ts` transforms (timeline mapping + top-open pick + recommended-action derivation). Keep playbook guidance generic.
4. Refactor `cs-recommended-action-rail.tsx` → inline form + `onSubmitTreatment` promise callback + pending/error UI.
5. Wire `cs-member360-view.tsx`: compute timeline + topOpen from real `cases`; on submit call `patchCareCase` then `refetch`; sample fallback only when `cases.length === 0`.
6. Pass `live` flag to timeline so "sample" tag hides on real data.
7. `npm run build` (tsc) + run FE care suite green.

## Todo
- [ ] Extend `cs-member360-care.test.tsx` (lock sample + assert real timeline + assert PATCH payload/refetch)
- [ ] Add `cs-member360-derive.test.ts`
- [ ] Add `refetch` to `useVipCaseHistory`
- [ ] Implement `cs-member360-derive.ts`
- [ ] Inline treat form in `cs-recommended-action-rail.tsx`
- [ ] Wire real data + PATCH + refetch in `cs-member360-view.tsx`
- [ ] `live` flag on timeline (hide sample tag)
- [ ] tsc build + FE care suite green

## Success criteria
- Marking a VIP treated persists: case shows `treated` after refetch, appears in real history, and survives reload (PATCH hit the ledger).
- Timeline shows real cases; sample only when VIP has 0 cases.
- Viewer role cannot submit (button disabled); editor/admin can.
- All existing care tests green; new tests assert the real PATCH contract.

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Refetch race / stale `topOpen` after treat | M×M | `await patchCareCase` then `await refetch`; derive `topOpen` from refetched cases, not local state |
| `useVipCaseHistory` lacks refetch → stale UI | H×M | Add `refetch` (step 2) — small additive change, covered by hook test |
| Sample fallback leaks into live (0 vs loading) | M×L | Fallback only when `status==='success' && cases.length===0`; loading shows skeleton, not sample |
| Playbook guidance reads as per-VIP fiction | L×M | Keep talk-track/offer/SLA generic + playbook-derived (per locked decision) |

## Security
- Write gated by existing `/api/care` editor/admin rule + FE `canWrite`. No new endpoint. No PII added to timeline beyond what the ledger already stores.

## Next steps
- Unblocks Phase 02 (claim/dismiss reuse the same patch+refetch pattern), Phase 03 (close control sits on treated cases), Phase 04 & 05.
