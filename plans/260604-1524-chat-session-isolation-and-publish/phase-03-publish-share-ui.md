# Phase 03 — Publish/Share UI

**Priority:** P1 · **Status:** pending · **Depends on:** 02

## FE client (`src/api/chat-sessions-client.ts`)
- `shareChatSession(id)` / `unshareChatSession(id)` → POST share/unshare (uses chatHeaders).
- `listSharedChatSessions(game)` → GET `/api/chat/sessions/shared`.
- Session DTO gains `visibility`, `ownerLabel`, `readOnly`.

## UI surfaces (follow design-guidelines.md — tokens, Inter, existing patterns)
- **Share toggle** on a session you own: in `chat-panel-header.tsx` (and/or recents row menu) —
  a Share/Unshare control with a "Shared with team" indicator. Use semantic tokens.
- **Shared list**: in sidebar recents (`sidebar-chat-recents.tsx` / `chat-recents`) add a
  "Shared with team" group listing others' shared chats, each labelled "by {ownerLabel}".
- **Read-only shared view**: in `chat-thread-page.tsx` / `chat-panel.tsx`, when `readOnly` is true
  (viewing a shared chat you don't own), render turns and disable the composer with a notice
  ("Shared chat — read-only. Start your own to ask follow-ups."). Hide rename/delete/share.

## Access errors
- `/chat/:id` that 403s (private, not yours) → show a "no access / not found" empty state,
  not a crash.

## Success criteria
- Owner toggles Share; a second user sees the chat under "Shared with team" and opens it read-only.
- Non-shared chat opened by a non-owner shows the no-access state.
- Visual parity with Dashboards/Cohort/Segments (cross-check before shipping).

## Risks
- Composer gating must cover both the overlay panel and the full `/chat/:id` page.
- Don't leak share controls on read-only (non-owner) view.
