# Phase 06 — Polish, empty states, keyboard, a11y

## Context Links
- Design: `design/hifi-mockup.html`
- All upstream phases (01–05)

## Overview
- **Priority:** P3
- **Status:** completed
- **Description:** Cross-cutting polish — loading skeletons, empty states, keyboard shortcuts (cmd-K), accessibility pass.

## Key Insights
- cmd-K is a globally common shortcut; risk of conflict with extensions/macOS Spotlight is low because Spotlight is system-level (`cmd+space`). cmd-K is widely used (Linear, Vercel, Notion search). Safe.
- a11y is mostly tab+focus order + ARIA roles on tabs and chips — small surface.
- "Empty states" defined per phase; this phase only ensures consistency (same tone, same blank-illustration pattern = a single 1-line italic message in T.n500).

## Requirements
**Functional**
- cmd+k (or ctrl+k on non-mac) → push `/dev/chat-audit/search` with input focused.
- Tab key navigation through top tabs works in expected order.
- ARIA roles: tab bar → `role="tablist"`, each tab → `role="tab"` + `aria-selected`. Tab panels → `role="tabpanel"`.
- Loading skeletons match layout dimensions (no layout shift).
- Empty states use consistent format: italic T.n500 1-liner, 1 small affordance (e.g. "Try removing filters").
- Stale-cache banner: only render at `staleRatio.stale / staleRatio.typed > 0.25`. **(See open question — user may want different threshold.)**

**Non-functional**
- File size cap continues to hold.
- No new global state — cmd-K hook lives in shell.

## Architecture
- Single `useKeyboardShortcuts` hook in shell (`dev-audit-shell.tsx`) wires cmd-K.
- Reusable `EmptyState` component (~40 LOC) used by all tabs.
- Reusable `LoadingSkeleton` component with size variants (`row`, `card`, `text`).
- Stale banner = small bar above Cache dashboard hero, dismissable per-session (sessionStorage).

## Related Code Files
**Create**
- `src/pages/DevAudit/empty-state.tsx` (~40 LOC)
- `src/pages/DevAudit/loading-skeleton.tsx` (~60 LOC)
- `src/pages/DevAudit/use-keyboard-shortcuts.ts` (~40 LOC)
- `src/pages/DevAudit/stale-cache-banner.tsx` (~50 LOC)

**Modify**
- `src/pages/DevAudit/dev-audit-shell.tsx` — wire cmd-K hook + ARIA roles.
- `src/pages/DevAudit/audit-tabs.tsx` — tablist ARIA.
- `src/pages/DevAudit/unified-search-page.tsx` — autofocus on mount, EmptyState on empty query.
- `src/pages/DevAudit/cache-dashboard-page.tsx` — render `<StaleCacheBanner />` above hero.
- `src/pages/DevAudit/session-list.tsx`, `search-result-list.tsx`, `skill-leaderboard-page.tsx` — swap inline "no results" text to `<EmptyState />`.

## Implementation Steps
1. `empty-state.tsx`: accepts `message`, optional `action` (label + onClick). Default style: centered, T.n500, italic, 24px padding.
2. `loading-skeleton.tsx`: 3 variants — `<SkelRow />` (one table row height, gradient sweep), `<SkelCard />` (card-sized box), `<SkelText n={3} />` (N gray bars).
3. `use-keyboard-shortcuts.ts`: `useEffect` adds `keydown` listener on document; cleans up on unmount. Match `(e.metaKey || e.ctrlKey) && e.key === 'k'`. Pass callback for cmd-K.
4. Wire in shell: cmd-K → `history.push('/dev/chat-audit/search')` + dispatch focus event (or use ref forwarding to the search input).
5. ARIA: update `audit-tabs.tsx` — outer `<nav role="tablist">`, each `<a role="tab" aria-selected={isActive}>`. Tab panels in shell content area get `role="tabpanel" aria-labelledby={tabId}`.
6. `stale-cache-banner.tsx`: reads `staleRatio` prop from cache dashboard; renders only when ratio > 0.25 (constant in file, easy to tweak). Background T.amberSoft, T.amber500 text. Dismissable via sessionStorage key `dev-audit:stale-banner-dismissed`.
7. Swap inline empty text in 3 tabs to `<EmptyState />`.
8. Compile + manual run-through.

## Todo List
- [x] `empty-state.tsx`
- [x] `loading-skeleton.tsx`
- [x] `use-keyboard-shortcuts.ts`
- [x] `stale-cache-banner.tsx`
- [x] Wire cmd-K in shell
- [x] ARIA roles on tab bar + panels
- [x] Replace empty-text in 3 tabs
- [x] Manual a11y pass (keyboard-only navigation)
- [x] Compile

## Success Criteria
- Press cmd-K from any tab → lands on Search tab with input focused.
- Tab-key navigates 4 tabs in order; arrow keys cycle.
- Empty states consistent in 3 tabs.
- Stale banner appears at > 25% stale ratio; dismiss persists within session, returns next session.
- No layout shift between loading → loaded states.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| cmd-K conflicts with browser dev-shortcuts (Chrome address bar)| Low | Low | Browser cmd-K (focus omnibox) only fires when no app handler intercepts; we `preventDefault()` inside app. |
| sessionStorage banner-dismiss breaks SSR (none here, SPA) | None | None | Vite SPA, no SSR |
| Stale 25% threshold wrong for this workload | Med | Med | Open question to user (see planner report) |
| Reduced-motion users get sweeping skeleton animation | Low | Low | Respect `@media (prefers-reduced-motion)` — disable sweep |

## Security Considerations
- None — pure FE.

## Next Steps
- Optional follow-up: telemetry on cmd-K usage (out of scope).
