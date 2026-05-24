# Phase 03 — UI Surfaces: AskCubeFab + ChatPanel + /chat Landing + Sidebar RecentItems

## Context Links

- Brainstorm: `/Users/lap16299/Documents/code/cube-playground/plans/reports/brainstorm-260523-1643-cube-playground-chat-agent.md` (§8.1–§8.10, §17 row 7)
- Hermes scout: `/Users/lap16299/Documents/code/cube-playground/plans/reports/scout-260523-1716-hermes-chat-ui.md`
- Server scout: `/Users/lap16299/Documents/code/cube-playground/plans/reports/scout-260523-1643-cube-playground-chat-surface.md` (§6 sidebar integration)
- Phase 01: `./phase-01-chat-service-skeleton-and-core-tools.md` (shared `ChatThreadView` + `ChatComposer`)
- Plan overview: `./plan.md`

## Overview

- **Priority:** P1 — the UX that makes chat discoverable from every route.
- **Current status:** pending (blocked by Phase 01).
- **Description:** Mount the floating `AskCubeFab`, the right-docked `ChatPanel` (drag-resize 360–720 px, persisted open/width), the `/chat` landing page with composer + history rail, and the sidebar RecentItems swap. Wire cross-surface state via the existing `recent-items-store` + a new custom event `gds-cube:chat-session-changed`. Sidebar one-liner replacement in `sidebar.tsx:61-69`.

## Key Insights

- Brainstorm §8.2: server SQLite is source of truth for thread content; localStorage only for panel prefs + recents LRU.
- Brainstorm §8.9: visibility is one hook, three booleans — no overlap.
- Hermes scout §1–§2: FAB hidden when panel open avoids composer overlap. Drag-resize uses pointer capture + persist on `pointerUp`.
- Server scout §6: existing `'chat'` module already declared in `recent-items-store.ts:13` — sidebar swap is one line.
- Phase 01 already created `ChatThreadView` + `ChatComposer`. Both panel and `/chat` page mount the same components.
- Brainstorm §17 row 7: session title = first user message truncated to 64 chars (no rename/delete affordances in Phase 1).

## Requirements

### Functional

1. Floating `AskCubeFab` renders fixed bottom-right (24 px) on all routes EXCEPT `/chat`, `/chat/:id`, and `/welcome` (none here, but route-guard list is centralised).
2. FAB hidden when `ChatPanel` open (avoid composer overlap).
3. Click FAB toggles `ChatPanel`.
4. `ChatPanel` is right-docked `<aside>` 420 px default, drag-resize 360–720 px from left edge. Width persisted in `localStorage`.
5. Open state persisted in `localStorage` (key `gds-cube:chat-panel:open`); width key `gds-cube:chat-panel:width`.
6. Panel header: title (link to `/chat/:id`), "New" button, close X.
7. Panel body and `/chat/:id` page render IDENTICAL thread via shared `ChatThreadView` (`compact` prop differs).
8. `/chat` landing: composer + left history rail (≥ md viewport) listing top 20 sessions via `GET /api/chat/sessions?game=<active>`.
9. Sidebar `MessageSquare` section uses `<RecentItems module="chat" seeAllTo="/chat" hrefFor={(id) => `/chat/${id}`} />` — single-line swap of existing placeholder `<SidebarItem label="No recent items" .../>` in `sidebar.tsx:61-69`.
10. On every `done` SSE event (turn finished), FE fires:
    - `pushRecent('chat', { id, title, updatedAt, href: `/chat/${id}` })`
    - `window.dispatchEvent(new Event('gds-cube:chat-session-changed'))` with the session id in `event.detail` (use `CustomEvent`).
11. Sidebar / `/chat` history rail listens to `gds-cube:chat-session-changed` AND existing `gds-cube:recent-changed` and re-fetches.
12. Switching active game (existing topbar GameSwitcher) closes the panel and triggers a re-fetch of the landing history rail filtered by the new game.
13. Panel ↔ page handoff: clicking "Expand" in panel header navigates to `/chat/:id` (continues same session); navigating back keeps panel `chatPanelOpen` state as it was.
14. Empty state in panel + landing: short prompt suggestions (3 hard-coded strings for v1) — clicking inserts into composer.

### Non-functional

- `useChatSurfaces()` hook is the single source of truth for visibility booleans.
- Panel drag-resize uses pointer events with `setPointerCapture`; persist on `pointerUp` only (no localStorage thrash).
- Sidebar swap MUST NOT alter `recent-items.tsx` or `recent-items-store.ts`. Drop-in only.
- `tsc --noEmit` clean for root.
- All new components have `data-testid` on top-level node for visual + unit tests.

## Architecture

```
App
├── Sidebar (existing)
│   └── SidebarSection "chats"
│       └── RecentItems module="chat" hrefFor={id => `/chat/${id}`}   ← swap
│
├── <Routes>
│   ├── /chat            → ChatLandingPage   (composer + ChatHistoryRail)
│   ├── /chat/:id        → ChatThreadPage    (existing from Phase 01)
│   └── ... other routes
│
└── <ChatOverlay/>                            ← NEW (mounted once near App root)
    ├── useChatSurfaces() → {fabVisible, panelVisible, pageVisible}
    ├── if fabVisible   → <AskCubeFab onClick={togglePanel}/>
    └── if panelVisible → <ChatPanel onClose={closePanel}/>
                             ├── ChatPanelHeader
                             ├── ChatThreadView (shared, compact=true)
                             └── ChatComposer  (shared, compact=true)

State stores:
  - chat-panel-open-store.ts : localStorage `gds-cube:chat-panel:open` / `:width`
  - active-chat-session-store.ts : in-memory current session id for panel
  - recent-items-store.ts (existing) : module='chat'
  - Custom DOM event 'gds-cube:chat-session-changed' (detail.sessionId)
```

### Cross-surface change broadcast

```
On SSE 'done' event:
  pushRecent('chat', { id, title: first64chars(userMsg), updatedAt: ISO, href: `/chat/${id}` })
  window.dispatchEvent(new CustomEvent('gds-cube:chat-session-changed', { detail: { sessionId } }))

Listeners:
  - Sidebar RecentItems   → already listens to `gds-cube:recent-changed` (fired by pushRecent)
  - ChatHistoryRail       → listens to BOTH events; re-fetches GET /api/chat/sessions
  - useChatSession(id)    → listens; if event matches its id, refetch turns
```

## Related Code Files

### MODIFY

- `/Users/lap16299/Documents/code/cube-playground/src/shell/sidebar/sidebar.tsx` — replace lines 61–69 placeholder with `<RecentItems module="chat" seeAllTo="/chat" hrefFor={(id) => `/chat/${id}`} />`.
- `/Users/lap16299/Documents/code/cube-playground/src/index.tsx` — replace existing `/chat` route's `ChatPlaceholderPage` with new `ChatLandingPage`. Mount `<ChatOverlay/>` inside `<App>` or just above route switch. Keep `/chat/:id` route from Phase 01.
- `/Users/lap16299/Documents/code/cube-playground/src/App.tsx` — mount `<ChatOverlay/>` once near top.
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Chat/hooks/use-chat-stream.ts` (from Phase 01) — emit `pushRecent` + `gds-cube:chat-session-changed` on `done`.

### CREATE

- `/Users/lap16299/Documents/code/cube-playground/src/shell/chat-overlay/chat-overlay.tsx`
- `/Users/lap16299/Documents/code/cube-playground/src/shell/chat-overlay/ask-cube-fab.tsx`
- `/Users/lap16299/Documents/code/cube-playground/src/shell/chat-overlay/chat-panel.tsx`
- `/Users/lap16299/Documents/code/cube-playground/src/shell/chat-overlay/chat-panel-header.tsx`
- `/Users/lap16299/Documents/code/cube-playground/src/shell/chat-overlay/chat-panel-open-store.ts` — `getOpen/setOpen/onOpenChange`, `getWidth/setWidth`.
- `/Users/lap16299/Documents/code/cube-playground/src/shell/chat-overlay/use-chat-surfaces.ts`
- `/Users/lap16299/Documents/code/cube-playground/src/shell/chat-overlay/use-active-chat-session.ts` — in-memory atom for which session id the panel is showing.
- `/Users/lap16299/Documents/code/cube-playground/src/shell/chat-overlay/chat-session-events.ts` — `notifyChatSessionChanged(sessionId)`, `onChatSessionChanged(cb)`.
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Chat/chat-landing-page.tsx` — `/chat` route.
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Chat/components/chat-history-rail.tsx`
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Chat/components/session-row.tsx`
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Chat/hooks/use-chat-sessions-list.ts`
- `/Users/lap16299/Documents/code/cube-playground/src/shell/chat-overlay/__tests__/use-chat-surfaces.test.tsx`
- `/Users/lap16299/Documents/code/cube-playground/src/shell/chat-overlay/__tests__/chat-panel.test.tsx` — assert drag-resize clamps + localStorage persistence.
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Chat/__tests__/chat-landing-page.test.tsx`

### DELETE

- `/Users/lap16299/Documents/code/cube-playground/src/pages/ChatPlaceholder/chat-placeholder-page.tsx` — no longer routed.
- `/Users/lap16299/Documents/code/cube-playground/src/pages/ChatPlaceholder/` directory.

## Implementation Steps

### 1. Panel open/width persistence store

1. Create `chat-panel-open-store.ts` — small module with `getOpen()`, `setOpen(b)`, `onOpenChange(cb)`, `getWidth()`, `setWidth(n)`, `onWidthChange(cb)`. Mirror Hermes' API but with `gds-cube:chat-panel:*` keys.
2. No unit test (trivial localStorage shim).

### 2. Chat session change events

1. Create `chat-session-events.ts` with `notifyChatSessionChanged(sessionId: string)` (uses `CustomEvent` with `detail`) and `onChatSessionChanged((sessionId) => void)` (returns unsub).
2. Wire `use-chat-stream.ts` (from Phase 01) to call `pushRecent('chat', ...)` and `notifyChatSessionChanged(id)` on `done` event.

### 3. useChatSurfaces hook

1. `use-chat-surfaces.ts`: reads `useLocation()`, `useChatPanelOpen()` → returns `{ fabVisible, panelVisible, pageVisible }` per brainstorm §8.9.
2. Unit test asserting matrix:
   - `/chat` → page only.
   - `/chat/:id` → page only.
   - `/build` panel closed → fab only.
   - `/build` panel open → panel only.

### 4. AskCubeFab

1. `ask-cube-fab.tsx`: fixed bottom-right 24 px, z-index 900. Pill button with `MessageCircle` lucide icon + "Ask Cube" label. `aria-label`, `aria-pressed`. Brand color hover.
2. Phase-01 brainstorm §8.10 confirms iconography decision deferred — ship pill for v1.

### 5. ChatPanel + header

1. **Push-layout** (user decision 2026-05-23 — Hermes-faithful, NOT overlay): `chat-panel.tsx` is a flex sibling of the page content inside the shell, NOT `position: fixed`. The shell wraps `<main>` + `<ChatPanel/>` in `display: flex; flex-direction: row`. When panel open, main content shrinks by `<persisted-width>`. Implementation: modify `src/App.tsx` (or whichever component renders the routed page next to sidebar) so the routed page + panel are flex siblings.
2. `chat-panel.tsx` itself: `<aside>` with `width: <persisted>`, `flex: 0 0 <persisted>px`, `borderLeft: 1px solid var(--hermes-border-card)`, `background: var(--hermes-sidebar)`. Header (44 px) + scrollable thread (flex-1) + composer.
3. Drag handle: 6-px-wide bar on left edge with `cursor: col-resize`. Pointer events: on `pointerDown` capture pointer, on `pointerMove` clamp `window.innerWidth - clientX → [360, 720]`, on `pointerUp` call `setWidth(n)` once. While dragging, set transient inline `width` for smooth feedback; commit on release.
4. `chat-panel-header.tsx`: title (clickable → `history.push('/chat/' + sessionId)` if sessionId exists, else `/chat`), New button (calls `setActiveSession(null)`), Close X.
5. Body: `<ChatThreadView compact />` + `<ChatComposer compact />` (both from Phase 01).
6. **Reflow contracts:** verify that on `/segments` table, `/build` playground, and `/catalog/data-model` the layout reflows without breaking (no horizontal scroll, charts re-render to new width). Use a `ResizeObserver` test in the panel mount/unmount paths to ensure consumers receive resize signals (Cube's Chart components subscribe to container size already, no action expected).
7. Unit test for drag clamp + localStorage write on pointerUp.

### 6. ChatOverlay shell

1. `chat-overlay.tsx`: mounts FAB + Panel based on `useChatSurfaces()`. Single mount point in `App`.
2. Modify `src/App.tsx` to render `<ChatOverlay/>` once.

### 7. ChatLandingPage + history rail

1. `chat-landing-page.tsx`: full-width column max 760 px, large H1 "What do you want to ask?", `<ChatComposer/>` (compact=false), with `ChatHistoryRail` on the left when viewport ≥ md (use existing `react-responsive`).
2. `use-chat-sessions-list.ts`: fetches `GET /api/chat/sessions?game=<activeGame>`, returns `{ sessions, loading, refetch }`. Subscribes to `onChatSessionChanged` for refetch.
3. `chat-history-rail.tsx`: lists `SessionRow` items; clicking navigates to `/chat/:id`.
4. `session-row.tsx`: shared row component (one-line title truncated 48 char + game mark chip).

### 8. Route + sidebar swap

1. `src/index.tsx`: swap `/chat` route handler from `ChatPlaceholderPage` to `ChatLandingPage` (lazy-loaded).
2. `src/shell/sidebar/sidebar.tsx` lines 61–69: replace `<SidebarItem label="No recent items" to="/chat" indent muted />` with `<RecentItems module="chat" seeAllTo="/chat" hrefFor={(id) => `/chat/${id}`} />`.
3. Delete `src/pages/ChatPlaceholder/` directory.

### 9. Game-switcher integration

1. In `chat-overlay.tsx`, subscribe to existing `GameContext` (`src/components/Header/use-game-context.tsx`). On game change → `setOpen(false)` + `setActiveSession(null)`. Document this in `chat-overlay.tsx` JSDoc.
2. `useChatSessionsList` filters by active game already (via query param).

### 10. Tests + typecheck

1. `__tests__/use-chat-surfaces.test.tsx` covers all 4 cases.
2. `__tests__/chat-panel.test.tsx` covers drag-resize + persistence (jsdom pointer events).
3. `__tests__/chat-landing-page.test.tsx` renders + asserts session row click navigates.
4. `npm run typecheck && npm run test`. Pass.
5. **Commit:** `feat(chat): FAB + ChatPanel + /chat landing + sidebar RecentItems swap`.

### 11. Manual smoke

1. From `/build`, click FAB → panel opens. Send a turn → SSE streams. Close panel; reopen → same session shown (active session in memory; on hard refresh, panel opens to empty state and user picks from recents).
2. From `/segments`, repeat — confirm push-layout reflows segments list (no overlap).
3. Resize panel drag handle to 600 px; reload page → opens at 600 px.
4. From sidebar, click recent chat row → navigates to `/chat/:id`; thread rehydrates.
5. Switch game in topbar → panel closes; landing rail re-filters.

## Todo List

- [ ] 1. `chat-panel-open-store.ts` (open + width persistence)
- [ ] 2. `chat-session-events.ts` + wire `useChatStream` to broadcast on done
- [ ] 3. `useChatSurfaces` hook + tests
- [ ] 4. `AskCubeFab` component
- [ ] 5. `ChatPanel` (drag-resize + persistence) + header + tests
- [ ] 6. `ChatOverlay` shell + `App.tsx` mount
- [ ] 7. `ChatLandingPage` + `ChatHistoryRail` + `useChatSessionsList` + `SessionRow`
- [ ] 8. Route swap in `src/index.tsx` (lazy `ChatLandingPage`) + sidebar one-line swap + delete `ChatPlaceholder/`
- [ ] 9. Game-switcher subscription closes panel + re-filters
- [ ] 10. `tsc --noEmit` clean + all Vitest suites green
- [ ] 11. Manual smoke (panel, FAB, sidebar, landing, game switch, drag-resize)

## Success Criteria

- FAB visible on every route except `/chat`, `/chat/:id`. Hidden when panel open.
- Panel drag-resize clamps 360–720 px; width persists across reloads.
- Panel and `/chat/:id` render the same thread (artifacts visible in both).
- Sidebar `Chat` section lists recent chat sessions; clicking opens the correct session.
- Custom event `gds-cube:chat-session-changed` fires on every turn `done`.
- Switching games closes the panel and refilters the landing rail.
- `tsc --noEmit` clean.

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Page layouts break under push-resize | Panel uses flex-sibling layout (Hermes-faithful, user decision 2026-05-23). Manual reflow walkthrough on `/segments`, `/build`, `/catalog/data-model` is a step in §6. Cube chart components already subscribe to container size, so resize cascades automatically. |
| Drag-resize jank | Pointer-capture + RAF throttle. Persist width on `pointerUp` only. |
| `gds-cube:chat-session-changed` event missed if listener mounts after dispatch | Always `refetch` once on listener mount; event is a hint not a contract. |
| Sidebar swap breaks an existing test | Re-run sidebar visual + unit tests after swap; existing tests target other sections, not chat placeholder. |
| Game switch races with in-flight turn | Closing panel cancels the SSE stream (calls `cancel()` from `use-chat-stream`). |
| FAB z-index conflicts with modal stacks | Set z-index 900; ensure existing modals are ≥ 1000. Grep `z-index` to confirm. |

## Security Considerations

- No new auth surface; FE calls the same `/api/chat/*` proxy from Phase 01.
- `pushRecent('chat', ...)` is per-browser localStorage — no PII beyond the truncated title.
- Custom events stay within window; no postMessage cross-origin risk.

## Next Steps

- Unblocks: nothing strictly (Phase 04/05 can run in parallel since they touch chat-service skills only).
- Phase 06 will add rename/delete affordances on `SessionRow`.

## Unresolved Questions

1. ~~Push-layout vs overlay panel~~ **RESOLVED 2026-05-23:** push-layout (Hermes-faithful). Panel is a flex sibling of the page content inside the shell; main content shrinks when panel opens.
2. FAB pill copy — "Ask Cube" string only; i18n key TBD. Default: hard-code English; add i18n key in Phase 06.
3. Visibility on `/welcome` — no such route exists today; ignore.
