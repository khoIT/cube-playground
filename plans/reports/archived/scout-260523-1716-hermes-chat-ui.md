# Scout: Hermes Chat UI Primitives

**Date:** 2026-05-23  
**Report:** hermes codebase exploration for Cube Playground chat UI design  
**Scope:** Floating action button, side chat panel, full page, message components, composer, recent conversations, design tokens, streaming, cross-page persistence.

---

## 1. Floating Action Button / Global Trigger

**File:** `/Users/lap16299/Documents/code/hermes/apps/web/src/components/fab/ask-hermes-fab.tsx` (lines 1–66)

**Shape:**
- Component: `AskHermesFab({ open, onToggle })`
- Position: `fixed bottom-right` (24px offset from corners)
- Visibility: Route-gated via `isRailHidden(pathname)` — returns null on `/`, `/chat`, `/chat/:id`, `/welcome`
- **Key insight:** FAB hides when the chat rail is already open (line 29) to avoid overlap with input area
- Label: "Ask Hermes" pill button with MessageCircle icon
- State: On/off toggle drives parent's `railOpen` boolean
- Styling: Fixed position z-index 900, dark background (T.n900), hover lifts +1px and brightens to brand color
- No accessibility issues; includes `aria-label` and `aria-pressed`

---

## 2. Side Chat Panel (Chat Rail)

**File:** `/Users/lap16299/Documents/code/hermes/apps/web/src/components/chat-rail/chat-rail.tsx` (lines 1–365)

**Shape:**
- Component: `ChatRail({ open, onClose })` — docked right-side `<aside>`
- Width: Default 400px, resizable 320–720px via drag on left edge (line 37)
  - Persisted in localStorage (`hermes:chat-rail:width`) via `setStoredWidth()`
- Backdrop: **No dim/modal** — side-by-side push layout; rail slides in alongside main content
- Animation: None on open/close (CSS transition on width via parent shell flex)
- Layout: 44px header + scrollable body (flex-1) + input footer
  - Header: Title (clickable → navigate to `/chat/{id}`), "New" button, close X
  - Body: Shows either empty state (recent threads + scripted prompts) or active thread messages
  - Input: `ChatInputBox` (compact=true) with "Ask Hermes..." placeholder
- State store: **In-memory** (React useState per component mount) + localStorage persistence of open state
  - Thread data persists in localStorage via `chat-store.ts` (see #3)
  - Active thread id managed via `activeThreadId` state (line 68)
  - Scroll auto-pins to latest message; thread switches jump instantly (line 195)
- Resizing: Left-edge drag handler, cursor changes to `col-resize` (line 320)
- **Persistence note:** When rail closes, pending timer is cancelled (line 177) but thread remains in store for next open

---

## 3. Full Chat Page

**File:** `/Users/lap16299/Documents/code/hermes/apps/web/src/modules/chat/thread-page.tsx` (lines 1–150+)

**Shape:**
- Route: `/chat` (landing page) and `/chat/:id` (thread detail)
- Layout: H1 first-message header → scrollable message thread → bottom input
- Architecture:
  - Reads thread from `chat-store.ts` by id (line 62: `useThread(id)`)
  - First user message auto-renders as page header (line 16: ThreadHeader)
  - Subsequent messages render as UserMessage / AssistantResponse pairs
  - Bottom: ChatInputBox (compact=false) with "What do you want to know?" placeholder
- **Demo arc flow:** Hard-resets demo threads to slim state on entry, auto-plays T1 after typing-dot delay (lines 93–105)
- Pending UI: Shows `TypingDots` while assistant message is being composed (line 65)

---

## 4. Message List & Components

**User Message:**
- File: `/Users/lap16299/Documents/code/hermes/apps/web/src/components/chat/user-message.tsx` (lines 1–34)
- Shape: `<h2>` subheading with HelpCircle icon (14px, muted color T.n500)
- Includes optional `MessageArtifactBadge` (shows context artifact: feature, segment, board, campaign)

**Assistant Message:**
- File: `/Users/lap16299/Documents/code/hermes/apps/web/src/components/chat/assistant-response.tsx` (lines 1–100+)
- Header: "VG" monogram + "Hermes" label
- Body structure: Sections (discriminated union; types in `chat-store.ts` lines 28–50):
  - `narrative` — plain text paragraph
  - `h2` — heading
  - `widget` — interactive component (Phase 3)
  - `insights` — bulleted list
  - `action_card_segment` / `action_card_campaign` — CTA cards with "View" nav (Phase 5)
  - `tool_call` — chip showing executed tool + args (Phase 3)
  - `provenance` — source footer (Phase 3)
  - `working_status`, `task_progress`, `subagent_panel` — deep-research trace (Phase 4, gated by toggle)
- Follow-ups: Optional suggested next-turn sentences (line 63: `followUps?: string[]`)
- Action bar: `ResponseActionBar` + `FollowUps` below message
- Credits counter: Cosmetic PRD tracking (line 65: `credits?: number`)

**Tool Call Chip:**
- File: `/Users/lap16299/Documents/code/hermes/apps/web/src/components/chat/tool-call-chip.tsx`
- Shows: Tool name, args, status badge

---

## 5. Composer / Input Area

**File:** `/Users/lap16299/Documents/code/hermes/apps/web/src/components/chat/chat-input-box.tsx` (lines 1–108)

**Shape:**
- Component: `ChatInputBox({ onSubmit, showDeepResearch?, placeholder?, compact?, autoFocus? })`
- Layout:
  - Auto-sizing textarea (min 24px, max 240px height, line 50)
  - Below: horizontal flex row with Deep Research toggle (left) + Send button (right)
- Keyboard:
  - `Cmd+Enter` or `Ctrl+Enter` to submit (line 61)
  - `Esc` to blur
- Send button: `<SendButton/>` — disabled when empty
- Deep Research toggle: Only shown on landing page by default (showDeepResearch prop)
- Compact mode: Smaller font (13px vs 15px), tighter padding (line 80)
- No slash commands, no attachments in current implementation

---

## 6. Recent Conversations Rail

**Files:**
1. `/Users/lap16299/Documents/code/hermes/apps/web/src/components/chat-rail/recent-threads-section.tsx` (lines 1–75)
2. `/Users/lap16299/Documents/code/hermes/apps/web/src/utils/recent-items-store.ts` (lines 1–103)

**Shape:**

Recent Threads Section (chat rail only):
- Component: `RecentThreadsSection({ onOpen })`
- Renders top 3 threads from `getRecent('chats')` store
- Each row: MessageCircle icon (13px) + truncated title (48 char max)
- Click → opens thread inline in rail (`setActiveThreadId(threadId)`)
- Returns null if no items exist
- Subheader: "RECENT THREADS" in mono font, small caps

Sidebar Recent Items:
- File: `/Users/lap16299/Documents/code/hermes/apps/web/src/components/sidebar/recent-items.tsx` (lines 1–94)
- Component: `RecentItems({ module, seeAllTo, hrefFor, visible?, filter? })`
- Renders up to 4 recent threads in sidebar under Chat section header
- Each row: SidebarItem with optional trailing context menu for chats
- "See all..." link when items.length > visible
- Localization support for thread titles (`localizedThreadTitleById`)

Storage:
- Store: localStorage key `hermes.recent.v1.chats`
- Max 8 items (LRU eviction, line 10)
- Item shape: `{ id, title, updatedAt, href? }`
- Title: First user message text OR user-provided label
- Update hook: `notifyRecentChanged()` fires custom event `hermes:recent-changed` → sidebar re-fetches (line 38)
- Push API: `pushRecent('chats', { id, title, updatedAt })`
- On new thread: `pushRecent` called immediately after `createThread()` (chat-rail line 222)
- On append: `notifyRecentChanged()` fired after `appendMessage()` (chat-rail line 171, 226)

---

## 7. Design Tokens

**Files:**
1. `/Users/lap16299/Documents/code/hermes/apps/web/src/theme.tsx` (lines 1–80+)
2. `/Users/lap16299/Documents/code/hermes/apps/web/src/theme-tokens.css` (lines 1–60+)

**Token System:**
- All colors are CSS custom properties (`--hermes-*`) exposed via TypeScript const `T` object
- Theming: Light/dark mode via `html.dark` class toggle; ThemeProvider flips all values instantly
- **Chat-specific tokens:** None currently tokenized (no `--hermes-chat-*` prefix)
  - Could add `--hermes-chat-rail-bg`, `--hermes-message-user-bg`, etc. as design matures

**Tokens used in chat UI:**
- Neutral scale: `T.n50`, `T.n100`, `T.n200`, `T.n400`, `T.n500`, `T.n800`, `T.n900`, `T.n950`
- Brand: `T.brand`, `T.brandHover`, `T.brandSoft`
- Surface: `T.surface`, `T.surfaceMuted`, `T.surfaceSubtle`
- Chrome: `T.shell`, `T.sidebar`, `T.topbar`
- Fonts: `T.fSans` (Inter), `T.fMono` (Geist Mono), `T.fDisp` (League Gothic)

CSS var values (light mode):
- `--hermes-n900: #171717` (dark text/backgrounds)
- `--hermes-brand: #f05a22` (orange)
- `--hermes-surface: #ffffff`
- `--hermes-sidebar: #f9f6f2`
- `--hermes-shell: #efe9e0` (outer gap)

---

## 8. Streaming UX

**Finding:** Hermes does **not** use streaming (no EventSource, getReader, fetch with SSE).

**Instead:**
- File: `/Users/lap16299/Documents/code/hermes/apps/web/src/utils/chat-respond.ts` (lines 1–63)
- Pattern: Synchronous canned-response lookup
  1. Multi-turn registry (active thread + exact follow-up match)
  2. Intent matcher (keyword scoring on initial prompts)
  3. Soft-hint fallback (generic message for off-script text)
- No async/await; responses are instant (pre-composed)
- Demo arc: Uses `delayedAppend(threadId, msg, delayMs=800)` to simulate "typing" delay (chat-rail line 165)
  - Timer added to pendingTimerRef, shows typing dots while pending
  - Perfect for your design: maintains UX feel without actual streaming

---

## 9. Cross-Page Persistence

**Mechanism:**
1. **Thread data**: localStorage-backed chat-store (key: `hermes.chat.v1.thread.{id}`)
   - Survives navigation, page reload, browser close
   - Indexed via `hermes.chat.v1.threads` (ThreadIndexEntry list)
   - Append/create functions immediately write to store (no async save)

2. **Recent list**: Same localStorage (key: `hermes.recent.v1.chats`)
   - Persists top 8 threads across pages
   - Sidebar re-fetches on mount + listens to `hermes:recent-changed` event

3. **Rail open state**: localStorage (key: `hermes:chat-rail:open`)
   - getStoredOpen() / setStoredOpen() APIs
   - App.tsx line 31–35: read on mount, apply route defaults

4. **Rail width**: localStorage (key: `hermes:chat-rail:width`)
   - getStoredWidth() / setStoredWidth() APIs

5. **Active thread in rail**: **In-memory only**
   - When user navigates away with rail open, active thread is lost
   - Next time rail opens on same route, auto-resumes most recent thread (chat-rail lines 116–122)
   - After "+ New" click, `userClearedRef.current = true` prevents auto-resume (line 207)

**Summary:** Full conversation history + metadata survives everything (localStorage). Active session (which thread is "selected") is ephemeral but resumes sensibly.

---

## 10. Key Implementation Notes

**Architecture Decisions:**
- Chat is routable (both `/chat` landing + `/chat/:id` detail pages) AND embeddable (right-rail surface)
- Single source of truth: localStorage chat-store; components read on demand (no Redux/Zustand)
- Drag-to-resize: Pointer events with capture, localStorage persistence on pointerUp (not during drag)
- Demo threads: Hard-reset logic ensures repeatability (useful for onboarding demos)

**Composition:**
- ChatRail is a leaf component; parent (App.tsx) manages open/close via state + route gating
- FAB is separately mounted in App; toggles the rail open state
- Recent threads section lives inside ChatRail empty state (not a separate rail overlay)
- Sidebar Recent Items is a standalone section; uses same recent-items-store but different rendering (4 items max, sidebar nav style)

**Event System:**
- `hermes:recent-changed` custom event fires when chat-store or recent-items-store change
- Sidebar's RecentItems listens and re-fetches (line 38 of recent-items.tsx)
- Allows multiple consumers without tight coupling

---

## Recommendations: Copy vs. Adapt

### Copy Verbatim

1. **Layout grid system** — FAB fixed bottom-right (24px), z-index 900 ✓
2. **Design token structure** — CSS vars + T object pattern for light/dark ✓
3. **Recent items LRU store** — localStorage key scheme, pushRecent/getRecent API ✓
4. **Custom event pattern** — `window.dispatchEvent` for subscribers (recent-changed) ✓
5. **Drag-to-resize left edge** — pointer capture, clamped width range, localStorage save on pointerUp ✓
6. **Typing delay pattern** — `delayedAppend(threadId, msg, 800)` + pending timer + TypingDots ✓
7. **Message artifact badge** — capture viewing context (feature/segment/board/campaign) at submit time ✓

### Adapt / Customize

1. **Streaming:** Hermes uses canned responses; Cube Playground will likely use real LLM streaming.
   - Keep the typing-delay pattern for UX consistency
   - Hook `fetch(...).body.getReader()` into delayedAppend or use streaming library (Vercel AI SDK)
   
2. **Composer:** Hermes has no slash commands or attachments.
   - Add these as needed for Cube's feature set
   - ChatInputBox structure is solid; extend props for new features

3. **Message sections:** Hermes has many phase-specific types (tool_call, working_status, subagent_panel).
   - For Cube, start lean; add section types as features mature
   - Keep discriminated union pattern (ResponseSection.type + payload)

4. **Recent thread titling:** Hermes uses first user message.
   - Consider auto-summarization if messages are long (Claude API + memoize on thread create)
   - Or let users set titles manually (optional rename dialog)

5. **Floating button:** Hermes shows "Ask Hermes" pill.
   - Consider simpler icon-only floating FAB for Cube (MessageCircle + tooltip)
   - Or match Hermes' pill style if brand consistency desired

6. **Sidebar section:** Hermes has 4-item cap + "See all..." link.
   - Cube's "Recent conversations" under Chat entry can follow this exactly
   - Reuse ChatContextMenu for delete/rename affordances

---

## Unresolved Questions

1. **Streaming latency:** How will Cube handle long-running agent queries? Hermes' 800ms delay pattern won't feel natural for 5–10s responses. Consider progressive reveal (initial response + follow-up expansions).

2. **Message edit / regenerate:** Hermes doesn't have these; Cube might need them. Plan storage schema early (avoid breaking backwards compat).

3. **Thread export / sharing:** No mention in Hermes. If Cube needs URL-shareable threads, plan immutable snapshot storage.

4. **Multi-language fallback:** Hermes uses `localizedThreadTitleById` for i18n. Cube's titling strategy affects this.

---

**Status:** All read-only; no edits made. Safe to reference as implementation guide.
