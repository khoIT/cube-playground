# Phase 01 — Chat History in panel header

**Priority:** High (cheapest visible win). **Effort:** S. **Status:** pending. **Depends on:** none.

## Overview
Add a Cube-Cloud-style **History** affordance to the right-side chat panel header so users can search and switch among past sessions without leaving the panel. Backend + list API + hook already exist — this is UI wiring only.

## Key insights
- `GET /api/chat/sessions?game=&q=` already supports search; `useChatSessionsList(gameId, q)` already consumed by sidebar tray.
- Panel session switch mechanism exists: `setActiveChatSession(id)` + `usePanelChatState` re-hydrates on id change (`chat-panel.tsx:32,62-67`).
- Header today (`chat-panel-header.tsx`) has Title→expand, mode chip, New(+), Close(X). Add History between mode chip and New.

## Requirements
- History button (clock icon) opens a popover anchored under the header.
- Popover: search input on top (debounced → `q`), scrollable recent-session rows below (title + relative time), empty state.
- Select row → `setActiveChatSession(id)` + close popover; panel hydrates that thread.
- Keyboard: Esc closes; click-outside closes. a11y: button `aria-label`, popover focus trap not required for POC but focus the search input on open.
- Must appear in BOTH the panel and the full `/chat` page header (parity). The full page already has a sessions tray via sidebar — confirm it exposes equivalent search; if not, reuse the new popover component there too.

## Related code files
- Modify: `src/shell/chat-overlay/chat-panel-header.tsx` (add History button + render popover; pass `gameId`, `onSelectSession`).
- Modify: `src/shell/chat-overlay/chat-panel.tsx` (wire `onSelectSession` → `setSessionId`+`setActiveChatSession`; pass current `gameId`).
- Create: `src/shell/chat-overlay/chat-history-popover.tsx` (popover UI; reuse `useChatSessionsList`).
- Read for reuse: sidebar chat tray component (`SidebarChatRecents`) + `useChatSessionsList` hook + `notifyChatSessionChanged`/`chat-session-events`.

## Implementation steps
1. Build `chat-history-popover.tsx`: props `{ gameId, activeSessionId, onSelect, onClose }`; internal `q` state (debounced 200ms); `useChatSessionsList(gameId, q)`; render rows (highlight active); loading + empty states; design tokens only.
2. Add History icon button to `chat-panel-header.tsx`; local `open` state; render popover when open; pass `gameId` (thread it from panel → header).
3. Wire `onSelect(id)` in `chat-panel.tsx` to set active session.
4. Refetch freshness: popover already re-renders on `chat-session-changed` via the hook; verify a just-finished turn shows up.
5. Parity: drop the same popover into the full-page chat header if it lacks search.

## Todo
- [ ] `chat-history-popover.tsx` with search + rows + states
- [ ] History button in panel header + open/close + click-outside/Esc
- [ ] `gameId` threaded to header; `onSelect` wired in panel
- [ ] Parity check on `/chat` full page
- [ ] Unit test: popover lists sessions, filters by `q`, calls onSelect
- [ ] Visual cross-check vs adjacent panels (tokens, 44px header rhythm)

## Success criteria
- From the panel, open History → type a query → click a past session → thread loads in panel, no route change required.
- New Chat still works; active session highlighted; works on both surfaces.

## Risks
- Popover overflow/clipping inside `overflow:hidden` aside → render in a portal or allow header to host an absolutely-positioned layer above the panel body.
- Game scoping: ensure popover uses the panel's current game, not a stale global.
