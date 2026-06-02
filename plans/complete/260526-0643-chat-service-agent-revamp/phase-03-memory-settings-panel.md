# Phase 03 — Memory Settings Panel + Chat Header Chip

## Context Links

- `src/pages/Settings/chat-remembered-defaults-list.tsx` — current cross-session prefs UI (reuse pattern)
- `src/pages/Settings/use-chat-remembered-defaults.ts` — fetch hook
- `chat-service/src/api/chat-user-prefs.ts` — existing cross-session API
- `chat-service/src/api/chat-user-prefs-labels.ts` — label resolution helper
- Phase 01 + Phase 02 — provide the two layers this UI surfaces

## Overview

- **Priority:** P1 — depends on phase 01 + 02 backend landing
- **Status:** Pending
- **Flag:** `CHAT_MEMORY_UI` (FE only; backend endpoints unflagged)
- **Description:** Three surfaces:
  1. **Settings → Chat → Memory** panel: view + edit + delete every remembered thing per game (cross-session prefs, current session focus, SDK resume thread).
  2. **Chat header chip**: compact single-line state with click-to-expand popover.
  3. **Inline `/forget` command** in the chat composer for power users (session scope only).

## Locked Decisions

- **Chip shape:** compact single-line (`● Revenue · 7d · VN ✕`); click opens popover with per-slot forget links + "Forget all". Symmetric with existing disambig-mode chip.
- **Settings detail:** show inference phrase AND confidence — `metric: Revenue (95% — from "doanh thu")`. Trust-building > terseness.
- **`/forget` scope:** session focus + SDK resume id only. Cross-session prefs editable only via Settings (smaller blast radius; matches mental model of "in-chat = current chat").
- **Sessions list:** active session only (YAGNI; defer multi-session view).

## Forget Matrix (authoritative)

| Action | Session focus | SDK resume id | Cross-session prefs |
|---|---|---|---|
| Chip ✕ on one slot | clear that slot | — | — |
| Chip popover "Forget all" | clear all slots | clear | — |
| `/forget` (no args) | clear all slots | clear | — |
| `/forget <slot>` | clear that slot | — | — |
| Settings: per-row delete on session focus | clear that slot | — | — |
| Settings: "Forget all session focus" | clear all (focus-store slots **+ 02a-D disambig slots: intent/concept/entity/metric/dimension/timeRange/filters**) | clear | — |
| Settings: per-row delete on cross-session pref | — | — | clear that row |
| Settings: "Clear all defaults for this game" (confirm) | — | — | clear all for (user, game) |
| Compaction (system) | — | clear (phase 01 spec) | — |
| Turn cancellation (phase 04) | — | preserve | — |

Backend `DELETE /focus` atomicity: clearing focus + clearing SDK resume id + clearing 02a-D disambig slots are now THREE writes — wrap in a SQLite transaction. If transaction fails, focus is source of truth (preserve focus, retry the rest).

**Compaction × chip hand-off (X6).** When `context_compacted` SSE fires, the chat-header chip's hook (`use-session-focus`) must re-subscribe to the new session id. Spec:
- Hook signature: `useSessionFocus(currentSessionId)` — re-subscribes whenever the prop changes.
- FE chat container listens for `context_compacted`; on receipt, swap `currentSessionId = newSessionId` (passed via React state); React re-renders, hook re-subscribes, chip briefly empty then repopulates from new session's ported focus (per phase 02 spec).
- No flash-of-stale-content: chip renders `null` while transitioning rather than the pre-compact bag.

## Key Insights

- Cross-session prefs UI already exists — extend, don't duplicate.
- Chip mirrors the disambig-mode chip already on the full-page chat header (recent commit `3026aa8`).
- Resetting focus must touch both layers atomically (Phase 02 store + Phase 01 resume id) — single backend endpoint.

## Requirements

**Functional**

Backend
- `GET /api/chat/sessions/:id/focus` → current focus bag.
- `DELETE /api/chat/sessions/:id/focus` → clears focus + SDK resume id; emits SSE `focus_reset` on any open stream for that session.
- `GET /api/chat/user-prefs?game=:gameId` (existing) — expand response to group by slot kind for the panel.
- `DELETE /api/chat/user-prefs/:slot?game=:gameId` (existing) — confirm idempotent.

Frontend
- New section `chat-memory-section.tsx` under Settings → Chat tab. Two subsections:
  - **Cross-session defaults** (existing list, polished). Per-row delete + "Clear all defaults for this game" with confirm dialog.
  - **Current session memory** (live focus bag for the active session; empty state when no session active). Each row shows `<slot>: <value> (<confidence>% — from "<phrase>")`; per-row delete.
- New `chat-header-focus-chip.tsx` component rendered alongside the existing disambig-mode chip. Compact single-line summary; click opens popover.
- Popover content: per-slot rows with same `<slot>: <value> (<conf>% — "<phrase>")` formatting + per-slot ✕ + "Forget all" footer button.
- New `use-session-focus.ts` hook (SSE-driven; consumes `focus_updated` / `focus_reset` events alongside existing turn events).
- `/forget` slash command handler in chat composer → calls `DELETE focus`. Recognised arg forms: `/forget`, `/forget metric|dimension|timeRange|segment|artifact|filter:<key>`. Unrecognised args show inline hint, do not call backend.
- Confidence values come from the focus store; each `SlotMemory<T>` is extended in phase 02 with optional `confidence?: number` populated by the disambig step (0–1, rendered as percent).

**Non-functional**
- Chip updates within 200ms of focus mutation (push via SSE, not poll).
- Settings panel CRUD round-trip <500ms.
- All design-tokens compliant (see `./docs/design-guidelines.md` rules — `var(--text-primary)`, `var(--border-card)`, etc.).

## Architecture

```
SSE stream events (additions)
  focus_updated  { sessionId, focus: SessionFocus }
  focus_reset    { sessionId }

FE state
  useSessionFocus(sessionId) → { focus, reset(): Promise<void> }
    ├─ initial GET /api/chat/sessions/:id/focus
    └─ subscribes to SSE focus_* events

Components
  ChatHeader
    ├─ <DisambigModeChip />              (existing)
    └─ <ChatHeaderFocusChip />           (new)

Settings
  ChatTab
    ├─ <ChatPreferencesSection />        (existing — disambig mode)
    ├─ <ChatRememberedDefaultsList />    (existing — cross-session, polished)
    └─ <ChatMemorySection />             (new — current session focus + bulk forget)
```

## Related Code Files

**Modify**
- `src/pages/Settings/settings-page.tsx` (add new section)
- `src/pages/Settings/chat-remembered-defaults-list.tsx` (group by slot kind + per-row delete polish)
- `src/pages/Chat/...` (chat header — add chip slot)
- `chat-service/src/api/chat-user-prefs.ts` (expand response shape)
- `chat-service/src/core/sse-stream.ts` (new event types)
- `chat-service/src/api/turn.ts` (emit `focus_updated` after focus write)

**Create**
- `chat-service/src/api/chat-session-focus.ts` (GET/DELETE /focus)
- `src/pages/Settings/chat-memory-section.tsx`
- `src/pages/Settings/use-chat-session-focus.ts`
- `src/pages/Chat/chat-header-focus-chip.tsx`
- `src/pages/Chat/use-session-focus.ts`
- `src/pages/Chat/__tests__/chat-header-focus-chip.test.tsx`
- `src/pages/Settings/__tests__/chat-memory-section.test.tsx`

## Implementation Steps

1. Backend API: `chat-session-focus.ts` route module. Reuses `session-focus-adapter` from Phase 02. DELETE also calls `chatStore.clearSdkConversationId` (Phase 01) when flag on.
2. SSE: new event types `focus_updated`, `focus_reset` registered in `sse-stream.ts`. Emit from `turn.ts` after `mergeFocus`. Stream registry notifies subscribers.
3. FE hook `use-session-focus.ts`: GET on mount, subscribe to SSE focus events, exposes `{ focus, reset }`.
4. `ChatHeaderFocusChip` component: renders compact summary (truncated). Click → opens popover listing each slot with per-slot "forget" links + a "Forget all" button. All design-token compliant.
5. Settings: `ChatMemorySection` reuses `useChatSessionFocus` to show the active session's focus alongside the cross-session list.
6. `/forget` composer handler: parses `/forget [slot|all]`; calls DELETE endpoint; emits local toast.
7. Chat composer slash-command discovery: add `/forget` to the suggestions list shown when user types `/`.
8. Polish `ChatRememberedDefaultsList`: group rows by slot kind (metric / dimension / timeRange / filter) with collapsible headers.
9. A11y: chip is button-role, keyboard reachable; popover traps focus.
10. Cross-check against `Dashboards` and `Cohort` pages per design rules (header pattern, paddings, radii).

## Todo List

- [x] Backend GET/DELETE /focus endpoint (`chat-service/src/api/chat-session-focus.ts`)
- [x] SSE focus_updated / focus_reset events (typed in `chat-service/src/types.ts`; emitted from `turn.ts` after `mergeFocus` + from DELETE route)
- [x] use-session-focus hook (`src/pages/Chat/hooks/use-session-focus.ts`)
- [x] ChatHeaderFocusChip + popover (`src/pages/Chat/components/chat-header-focus-chip.tsx`)
- [x] ChatMemorySection in Settings (`src/pages/Settings/chat-memory-section.tsx`, wired into ChatPreferencesSection)
- [ ] ChatRememberedDefaultsList polish — deferred (cross-session list already shipped; group-by-slot-kind polish out of revamp window)
- [x] /forget slash command handler (intercepted in `handleSubmit` on both `chat-thread-page` + `usePanelChatState`; clears focus + SDK resume id + disambig slots via DELETE)
- [ ] A11y pass — basic aria roles + keyboard reachable; lighthouse-95 sweep deferred
- [x] Design-token compliance review — chip + section use `var(--*)` tokens only (font-sans, border-card, destructive-soft/ink, etc.)

## Success Criteria

- User can see what the agent currently remembers (chip + settings panel) for any active session.
- User can clear any slot (or all) and observe the chip update <200ms.
- "Forget all" empties the chip AND prevents next turn from carrying any focus (verified by inspecting next-turn system preamble).
- Visual diff vs Dashboards/Cohort headers: zero drift (paddings, typography, tokens).
- Lighthouse a11y ≥95 on the Settings → Chat page.

## Risk Assessment

- **R1 SSE flood** — focus updates on every turn could spam the chip animation. Debounce client-side to 300ms; only animate on slot-set / slot-cleared transitions.
- **R2 Stale chip after compact** — compaction creates a new session; chip should switch context with session id. Ensure hook re-subscribes on sessionId change.
- **R3 Design drift** — Settings UI tends to accrete bespoke styles. Mitigation: visual diff against neighbouring sections required in PR review.

## Security Considerations

- All endpoints require existing chat auth (session ownership check).
- Focus values include user data; cache headers `no-store`.
- DELETE is idempotent; rate-limit not strictly needed but inherit existing chat-service limits.

## Next Steps

- Phase 04 (cancellation): user can also clear focus *during* a streaming turn; cancellation should not corrupt focus state.
- Future: "pin" a focus slot so it survives `/forget all`.
