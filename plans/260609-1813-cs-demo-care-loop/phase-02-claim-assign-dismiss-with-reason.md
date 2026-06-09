# Phase 02 — Claim/assign + Dismiss-with-reason (A2 + A3)

## Context links
- Brainstorm: `plans/reports/brainstorm-260609-1813-cs-demo-artifact-care-loop-report.md` (§A2, §A3)
- Plan overview: `plan.md` · Depends on Phase 01 (shared patch+refetch pattern)

## Overview
- **Priority:** P2
- **Status:** pending
- **Description:** Add "Claim · assign to me" (A2) and "Dismiss with reason" (A3) controls to the Member-360 rail and the queue rows. Both are `patchCareCase` calls. **Frontend only.**

## Key insights
- `patchSchema` already accepts `assignee` (nullable) and `status:'dismissed'` + `notes` (`care-cases.ts:40-49`). `patchCase` stamps `closed_at` on `→dismissed` (`care-case-store.ts:179`).
- Dismissed cases leave the open queue automatically (`by-vip` filter `care-cases.ts:138-140`) and remain in the per-VIP history (`vip/:uid` returns all, `care-cases.ts:208`).
- Identity: `useAuthUser()` → `user.username`/`user.email`; `canWrite = role∈{editor,admin}` (`cs-member360-view.tsx:52-53`). In AUTH_DISABLED dev, user is `khoitn@vng.com.vn` admin.
- Queue UI rows live in `case-ledger.tsx`; `canWrite` already computed there (`case-ledger.tsx:769`). Row click navigates to 360 — new action buttons must `stopPropagation` (pattern at `case-ledger.tsx:109,135,314`).

## Data flow
```
Claim:    patchCareCase(id, {assignee: user.username ?? user.email}) → refetch
Unclaim:  patchCareCase(id, {assignee: null}) → refetch          (assignee is nullable)
Dismiss:  reason select → patchCareCase(id, {status:'dismissed', notes:`reason:${code}`}) → refetch
          → case leaves open queue, shows "Dismissed · <reason>" in history
```

## Requirements
**Functional**
1. **Claim (A2):** rail + queue-row "Claim" → `patch{assignee:<me>}`; chip "owned by X" — own = brand tint, other = muted. Re-claim/unclaim allowed (assignee nullable).
2. **Dismiss (A3):** "False positive / Not now" control with reason select (small fixed enum, e.g. `false_positive`, `not_now`, `already_handled`, `ineligible`) → `patch{status:'dismissed', notes:'reason:<code>'}`. Leaves queue; history shows Dismissed + reason.
3. Both gated on `canWrite`; pending/disabled + inline error on failure.
4. Reason encoding lives in one helper so history rendering can decode it (`notes` starts with `reason:`).

**Non-functional**: tokens only; reuse Phase-01 patch+refetch; no regression.

## Architecture
- New `cs-case-actions.ts` helper: `claimCase(id, me)`, `unclaimCase(id)`, `dismissCase(id, reasonCode)`, `parseDismissReason(notes)` + `DISMISS_REASONS` enum/labels. Thin wrappers over `patchCareCase` — DRY across rail + queue.
- Owner chip component `cs-owner-chip.tsx` (own vs other tint) reused in rail + queue rows.
- Queue rows (`case-ledger.tsx`) and rail (`cs-recommended-action-rail.tsx`) both call the helper + their own refetch (`useVipQueue`/`useVipCaseHistory` refetch).

## Related code files
**Create**
- `src/pages/Dashboards/cs/cs-case-actions.ts` — claim/unclaim/dismiss wrappers + reason enum + parser.
- `src/pages/Dashboards/cs/member360/cs-owner-chip.tsx` — owner badge.
- `src/pages/Dashboards/cs/__tests__/cs-case-actions.test.ts` — assert PATCH payloads + reason encode/decode.

**Modify**
- `src/pages/Dashboards/cs/member360/cs-recommended-action-rail.tsx` — claim + dismiss controls.
- `src/pages/Dashboards/cs/member360/cs-member360-view.tsx` — wire claim/dismiss + refetch; render owner chip; decode dismiss reason in timeline events.
- `src/pages/Dashboards/cs/case-ledger.tsx` — per-row Claim + owner chip (By-VIP & By-Playbook); `stopPropagation` on action clicks.
- `src/pages/Dashboards/cs/use-care-cases.ts` — ensure `useVipQueue` exposes `refetch` (verify; add if missing).
- `src/pages/Dashboards/cs/__tests__/use-care-cases.test.ts` — extend for assignee mapping if shape changes (likely none).

## Implementation steps
1. **TDD-first** — `cs-case-actions.test.ts`: claim → `{assignee:me}`; unclaim → `{assignee:null}`; dismiss → `{status:'dismissed', notes:'reason:false_positive'}`; `parseDismissReason('reason:not_now')==='not_now'`. Extend `cs-member360-care.test.tsx` for owner chip + dismiss-from-rail.
2. Implement `cs-case-actions.ts` + `cs-owner-chip.tsx`.
3. Add claim/dismiss to the rail (Phase-01 form coexists; dismiss is a secondary action).
4. Add per-row Claim + owner chip to `case-ledger.tsx` rows.
5. Decode dismiss reason in the 360 timeline (Phase-01 derive maps `notes` → reason label for dismissed events).
6. Verify `useVipQueue` refetch; tsc + suites green.

## Todo
- [ ] `cs-case-actions.test.ts` (claim/unclaim/dismiss payloads + reason parse)
- [ ] Extend `cs-member360-care.test.tsx` (owner chip + dismiss)
- [ ] `cs-case-actions.ts` + `cs-owner-chip.tsx`
- [ ] Rail claim + dismiss controls
- [ ] Queue-row Claim + owner chip (stopPropagation)
- [ ] Decode dismiss reason in timeline
- [ ] Verify/add `useVipQueue` refetch; tsc + suites green

## Success criteria
- Claiming stamps `assignee`; chip shows owner; persists across reload.
- Dismissing with a reason removes case from open queue, keeps it in history with the reason visible.
- Viewer cannot claim/dismiss; editor/admin can. Existing suites green.

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Reason free-text drift breaks history decode | M×M | Fixed enum + `reason:<code>` convention parsed by one helper; tested both directions |
| Row action click navigates instead of acting | M×M | `stopPropagation` (existing pattern `case-ledger.tsx:109`) |
| `me` identity null in some auth state | L×M | Fallback `username ?? email ?? 'me'`; disable when no user |
| Queue refetch missing → stale after claim | M×M | Verify `useVipQueue` refetch; add if absent (additive) |

## Security
- Existing `/api/care` editor/admin gate covers PATCH. No ownership-based write boundary (workspace-shared artifacts, per `enforce-write-roles.ts:8-11`) — any editor may claim/reassign; intended.

## Next steps
- Unblocks Phase 03 (close control acts on treated/claimed cases). Independent of 04/05.
