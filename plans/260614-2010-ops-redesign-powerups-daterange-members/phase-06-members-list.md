---
phase: 6
title: members-list
status: completed
effort: 1.5h
---

# Phase 6: Members list — top payers table (F3)

## Overview

**Priority:** P2 · **Status:** pending · **Independent of P1.** Reuses `useMemberCubeQuery`.

Add a ranked top-N (50) top-payers table ABOVE the existing uid search box in the Members
tab. Row click opens the standalone member360 (same route the search already uses). This is
the one feature that surfaces per-user rows (mild PII) — **user explicitly approved.**

## Requirements / data contract (verified 2026-06-14)

- Query: `topPayersQuery(limit=50)` from P2 — dims `mf_users.user_id` (PK, cfm:35),
  `.ingame_name` (cfm:40), `.payer_tier` (cfm:181), `.last_login_date` (cfm:80),
  `.lifetime_txn_count` (cfm:159); measure `.ltv_total_vnd` (cfm:264); order ltv desc, limit 50.
- Columns: rank, uid, ingame name, payer-tier badge, LTV, lifetime txns, last seen.
- Row click → `/dashboards/cs/members/${encodeURIComponent(uid)}?game=${encodeURIComponent(gameId)}`
  (EXACTLY the existing `members-tab.tsx:30` pattern — vopenid '@' merge already handled in
  cube SQL + decoded route-side). DRY: reuse the same navigation helper.
- Confirm the `user_id` dim ref by reading member360's query builder
  (`src/pages/Segments/member360/use-member-cube-query.ts` + its callers) before finalizing —
  member360 already does per-user mf_users queries, so reuse its `useMemberCubeQuery` hook
  (do NOT hand-roll a fetch).

## Architecture / data flow

```
MembersTab(gameId)
  ├─ MembersTopPayers(gameId)   [NEW, above]
  │    └─ useMemberCubeQuery(gameId, topPayersQuery(50))
  │         → rows → table (rank by ltv desc) → row click → history.push(member360 route)
  └─ existing uid search box     [KEPT, below]
```

## Component split (KISS, <200 LOC each)

- `members-tab.tsx`: keep the search box; render `<MembersTopPayers gameId>` above it; share
  the `open(uid)` navigation helper (lift it or duplicate the 3-line push — prefer a tiny
  shared `openMember360(history, uid, gameId)` util to avoid drift).
- `members-top-payers.tsx` (NEW): the table + loading/empty/error states. Tier badge reuses
  semantic tokens (`--success-soft/-ink` for whale, `--info-soft/-ink` dolphin, `--muted-*`
  minnow/non_payer — pick a consistent mapping; tokens only). Format LTV via `formatVnd`,
  txns via `formatInt` (existing `ops-format.ts`). last seen = `last_login_date` formatted;
  if it's a date string, show YYYY-MM-DD (GMT+7 if a time component exists).

## Privacy boundary

This is the ONLY OpsConsole surface with per-user rows. It is opt-in (Members tab) and
user-approved. Do NOT reuse `topPayersQuery` or its row shape on the Overview tab. Component
header comment states this rows-are-PII rationale (why), NO plan refs.

## Related code files

- Modify: `src/pages/OpsConsole/members-tab.tsx` (mount table above search; shared nav util).
- Create: `src/pages/OpsConsole/members-top-payers.tsx` (table + states, tokens).
- Read: `src/pages/Segments/member360/use-member-cube-query.ts` (reuse hook; confirm dims).
- Read: `src/pages/OpsConsole/ops-overview-queries.ts` (import `topPayersQuery` from P2).

## Implementation Steps

1. Read member360's query builder to confirm `mf_users.user_id` dim ref + how it reads rows.
2. Build `members-top-payers.tsx`: `useMemberCubeQuery(gameId, topPayersQuery(50))`, map rows
   to `{rank, uid, name, tier, ltv, txns, lastSeen}`, render a token-styled table.
3. Row click → shared `openMember360(history, uid, gameId)` (encode uid).
4. Tier badge: semantic-token mapping; LTV/txns via ops-format helpers.
5. Loading skeleton + empty ("no payers") + error states (mirror Overview's failure banner tone).
6. Mount above the kept search box in `members-tab.tsx`; extract the nav helper to dedupe.
7. tsc + build.

## Todo

- [ ] members-top-payers.tsx built (table, rank, tier badge, LTV/txns/last-seen)
- [ ] uses topPayersQuery(50) via useMemberCubeQuery (reuse, not hand-roll)
- [ ] row click opens member360 with encoded uid (shared nav util, DRY)
- [ ] search box kept below; loading/empty/error states
- [ ] tokens + font compliant; per-user rows isolated to this tab (header rationale)
- [ ] tsc + build clean

## Success Criteria

- Members tab shows top 50 payers ranked by LTV desc, then the kept search box.
- Clicking a row opens the correct member360 (numeric uid AND vopenid).
- Tier badges + money/int formatting consistent with the rest of the console.
- No per-user query/row leaks onto Overview.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| vopenid uid breaks the route | MED | Dead link | Reuse existing encode pattern (members-tab.tsx:30); member360 decodes. |
| PII row shape reused on Overview | LOW | Privacy regression | Query isolated to this component; P7/P2 assert Overview is aggregate-only. |
| last_login_date format unexpected (date vs ts) | LOW | Ugly cell | Inspect a sample row; format defensively (slice/parse), GMT+7 if time present. |
| nav helper duplicated → drift | LOW | Inconsistent links | Extract shared `openMember360` util. |

## Next Steps

P7 validates; consider a light render test for the table (optional).
