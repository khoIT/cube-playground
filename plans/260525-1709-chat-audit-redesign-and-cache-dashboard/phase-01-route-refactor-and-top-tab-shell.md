# Phase 01 — Route refactor + top-tab shell

## Context Links
- Design: `design/hifi-mockup.html` (top-tab bar)
- Current routes: `src/index.tsx:143-144`
- Current shell: `src/pages/DevAudit/dev-audit-page.tsx:18-150`
- Theme: `src/shell/theme.tsx` (T tokens)

## Overview
- **Priority:** P1 (blocks phase 02/03/05/06)
- **Status:** pending
- **Description:** Replace the single `DevAuditPage` shell with a `DevAuditShell` that renders 4 top tabs (Sessions / Search / Leaderboard / Cache) driven by URL routing. Legacy URLs redirect.

## Key Insights
- React Router v5 in use (`useHistory`, `useParams`, `Link` — confirmed `src/pages/DevAudit/dev-audit-page.tsx:10`). No need for v6 migration.
- Existing route is `/dev/chat-audit/:sessionId?` — must keep working via `<Redirect>` to `/dev/chat-audit/sessions/:sessionId?`.
- Leaderboard route `/dev/chat-audit/leaderboard` already exists — fold under shell.
- Shell must NOT remount on tab change (preserve session list scroll, search input). Use shared shell + `<Switch>` for content area only.

## Requirements
**Functional**
- 4 tabs: Sessions (default), Search, Leaderboard, Cache.
- Tab click → URL push (history.push).
- Direct URL load → activates correct tab.
- Top banner (game badge, common chrome) shared across tabs.
- Legacy `/dev/chat-audit/:sessionId?` redirects to `/dev/chat-audit/sessions/:sessionId?`.

**Non-functional**
- Each new file < 200 LOC.
- No new global state (URL is single source of truth for tab).
- T.* tokens only; no new colors.

## Architecture

```
DevAuditShell (new — src/pages/DevAudit/dev-audit-shell.tsx)
├── <TopBanner /> (game badge, owner note)
├── <AuditTabs />  (src/pages/DevAudit/audit-tabs.tsx — pure presentational)
└── <Switch>
    ├── /dev/chat-audit                       → <Redirect to="/dev/chat-audit/sessions" />
    ├── /dev/chat-audit/sessions/:sessionId?  → <DevAuditSessionsTab />  (current DevAuditPage body, no banner)
    ├── /dev/chat-audit/search                → <UnifiedSearchPage />     (phase 02)
    ├── /dev/chat-audit/leaderboard           → <SkillLeaderboardPage />  (phase 03 re-skin)
    ├── /dev/chat-audit/cache                 → <CacheDashboardPage />    (phase 05)
    └── /dev/chat-audit/:sessionId            → <Redirect to="/dev/chat-audit/sessions/:sessionId" />  (legacy)
```

**Data flow:** `useActiveGameId()` lives in shell (src/components/Header/use-game-context). Pass via React context only if 2+ tabs need it (currently all 4 do → light context provider in shell).

## Related Code Files
**Modify**
- `src/index.tsx:140-145` — swap single Route for new shell mount.
- `src/pages/DevAudit/dev-audit-page.tsx` — strip banner + Link logic; keep two-pane session body. Rename internal function to `DevAuditSessionsTab` exported separately.

**Create**
- `src/pages/DevAudit/dev-audit-shell.tsx` (~120 LOC) — shell + Switch + Redirects.
- `src/pages/DevAudit/audit-tabs.tsx` (~60 LOC) — pure top-tab bar reading current pathname.

**Delete:** none.

## Implementation Steps
1. Create `audit-tabs.tsx`: renders 4 `<NavLink>`-style tabs. Active tab = whichever route prefix matches `useLocation().pathname` (manual match against `/sessions|search|leaderboard|cache`).
2. Create `dev-audit-shell.tsx`: top banner + AuditTabs + Switch. Mount each tab page via lazy or direct import. Wrap with feature-flag-friendly structure (no flag now, just clean separation).
3. Refactor `dev-audit-page.tsx`: export `DevAuditSessionsTab` (the two-pane). Remove banner+search-input+leaderboard-link from this file — they belong to the shell or to other tabs.
4. Add legacy redirects in `src/index.tsx`: keep one route mount `path="/dev/chat-audit"` → render `<DevAuditShell />`. Inside shell, the `<Switch>` handles all child routes incl. legacy `:sessionId` shim.
5. Wire URL ↔ tab: clicking `[Search]` → `history.push('/dev/chat-audit/search')`. Implicit because tabs are `<NavLink>`-style.
6. Manual test: visit `/dev/chat-audit/abc123` (legacy) → should land on `/dev/chat-audit/sessions/abc123` with Sessions tab active and session abc123 selected.
7. Compile check: `npm run build` from /Users/lap16299/Documents/code/cube-playground.

## Todo List
- [ ] Create `audit-tabs.tsx` (pure tab bar)
- [ ] Create `dev-audit-shell.tsx` (Switch + banner)
- [ ] Refactor `dev-audit-page.tsx` → export `DevAuditSessionsTab`
- [ ] Update `src/index.tsx` route mount
- [ ] Add legacy redirects (`:sessionId` → `sessions/:sessionId`)
- [ ] Manual route walkthrough (4 deep links + 1 legacy)
- [ ] Compile (`npm run build`)

## Success Criteria
- All 4 tab routes load without console errors.
- Legacy `/dev/chat-audit/<id>` redirects without flash to `/dev/chat-audit/sessions/<id>`.
- Tab switch does NOT remount shell-level state (game badge stays put).
- Existing session-list scroll & turn search not regressed.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Outbound links to `/dev/chat-audit/:id` from chat (`chat-thread-page.tsx:267`) break | Med | Low | Legacy redirect handles it; verify with click test |
| RR5 `<Switch>` order causes legacy redirect shadowing sessions route | Med | High | Place `/sessions/:sessionId?` before legacy `/:sessionId` shim, OR make legacy `exact` |
| Tab bar visual drifts from huashu mockup | Low | Med | Pull tokens directly from mockup CSS variables |

## Security Considerations
- No auth changes — all child tabs still call APIs with X-Owner-Id.
- No new public surface introduced.

## Next Steps
- Phase 02 (Unified search) renders inside the new `/search` tab slot.
- Phase 03 (Leaderboard re-skin) renders inside `/leaderboard` slot.
- Phase 05 (Cache dashboard) renders inside `/cache` slot.
