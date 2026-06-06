---
phase: 6
title: "Sidebar shared pill + share UI (FE)"
status: pending
priority: P1
effort: "1d"
dependencies: [5]
---

# Phase 6: Sidebar shared pill + share UI (FE)

## Overview
Surface teammates' shared segments inline in the left-nav Segments section with a "Shared"
pill (user mock, Image #2 pattern), add a share toggle to the segment detail header, and
restyle chat's separate "SHARED WITH TEAM" section into the same inline-pill pattern.

## Requirements
- Functional: shared segments (visibility shared/org, owner ≠ me) listed in nav Segments
  section under own recents, each with a "Shared" pill + owner tooltip; click → full detail
  page exactly as owner sees it; share/unshare toggle in detail header (owner-only); Delete
  hidden for non-owners; chat nav: shared sessions merged inline with same pill, separate
  section heading removed.
- Non-functional: one shared "Shared" pill component reused by both sections; design tokens
  only; nav fetch must not add per-item requests.

## Architecture
- **Pill**: `src/shell/sidebar/shared-pill.tsx` — tiny chip rendered via `SidebarItem`'s
  existing `trailing` prop (always visible, NOT `trailingShowOnHover`); tokens
  `--info-soft`/`--info-ink`, radius `--radius-sm`-equivalent from scale, 10px uppercase.
  Tooltip (title attr) = "Shared by {owner_label}".
- **Segments nav** (`sidebar.tsx:189-211`): the sidebar's list fetch exists but **red-team C2:
  `useSegmentIds` discards every field except id** (`src/pages/Segments/use-segment-ids.ts:28`,
  `cache = new Set(list.map(s => s.id))`, returns `Set<string>`). Required restructure: extend
  the hook to retain full rows (keep a derived id-Set for the existing pruning consumer at
  `sidebar.tsx:207`, update `__resetSegmentIdsCache` + `invalidateSegmentIds` event consumers
  and tests) — or add a sibling `use-segment-rows.ts` sharing one fetch/cache. Then:
  `shared = rows.filter(r => (r.visibility === 'shared' || r.visibility === 'org') &&
  !r.is_owner)`, cap at same VISIBLE count, render after own `RecentItems` with pill. Still
  ONE network request (same fetch, more retained fields); `is_owner`/`owner_label` come from
  Phase 5's serialization.
- **Chat nav restyle** (`sidebar-chat-recents.tsx`): drop `SharedSectionHeading` (line 24/111);
  append shared sessions to the main list with `<SharedPill />` trailing + owner in tooltip
  (label stays `s.title`; "· by X" suffix moves into tooltip to keep rows compact). Own
  sessions keep kebab menus; shared rows keep none. Dedupe guard: a session can't be both
  (own list is owner-only) — assert in test.
- **Detail header** (`detail-view.tsx:154-219` actions row): owner/admin sees Share/Unshare
  toggle (icon + label, mirrors chat's affordance); non-owner sees "Shared by {owner_label}"
  static chip instead. Owner-gated controls (match Phase 5 destructive set): Delete button +
  predicate-edit entry points hidden/disabled for non-owners (tooltip "Owner-only"). Refresh,
  rename, cadence, analyses, export, brief remain open per locked decision rev. 2.

## Related Code Files
- Create: `src/shell/sidebar/shared-pill.tsx`
- Modify: `src/pages/Segments/use-segment-ids.ts` (retain full rows; see step 2)
- Modify: `src/shell/sidebar/sidebar.tsx`, `src/shell/sidebar/sidebar-chat-recents.tsx`
- Modify: `src/pages/Segments/detail/detail-view.tsx` (header actions)
- Modify: `src/api/segments-client.ts` consumers as needed; i18n locales (`nav.sharedPill`,
  `segments.detail.share.*`)

## Implementation Steps
1. Build `shared-pill.tsx`; snapshot-check against design tokens.
2. Restructure `useSegmentIds` → full-row retention (or sibling hook on shared cache);
   migrate id-Set consumers; update hook tests.
3. Segments nav: filter + render shared rows with pill; verify no extra fetch (network assert
   in test); cap + "See all" goes to `/segments` (list page already shows shared rows).
4. Chat nav: merge shared into main list, remove section heading component, pill + tooltip;
   keep VISIBLE cap across combined list (own first, then shared).
5. Detail header: share toggle (calls `segmentsClient.share/unshare`, optimistic update,
   error toast), shared-by chip, Delete gating via `is_owner`.
6. i18n EN/VI; visual cross-check vs mock (Image #2) + adjacent pages.
7. FE tests: pill render conditions, nav filtering (own/shared/org, owner ≠ me), chat merge
   order + no heading, share toggle states, delete gating.

## Success Criteria
- [ ] Teammate's shared segment appears in my nav with pill; opens with full functionality
- [ ] My own shared segment shows in my recents WITHOUT pill (pill = shared *with* me)
- [ ] Chat nav has no "SHARED WITH TEAM" heading; shared chats inline with pill
- [ ] Non-owner sees no Delete, no share toggle; owner sees both
- [ ] No additional network requests in sidebar render path

## Risk Assessment
- **Nav clutter** when team shares many segments: same VISIBLE cap as recents (3) + see-all.
- **`RecentItems` is localStorage-recents**, shared list is server state — they coexist as
  separate row groups; do not merge data sources (keeps recents semantics intact).
- **Chat regression**: existing sidebar-chat-recents tests must be updated deliberately, not
  deleted — merged-list behavior asserted.
