# Phase 07 — Frontend Triage UI at /dev/chat-audit

## Context Links
- Route registration: `src/index.tsx:38-42` (loadable pattern), `src/index.tsx:109-163` (Router + Route children)
- Owner-id helper: `src/api/chat-owner-id.ts:14-20`
- Existing API client pattern: `src/api/chat-sessions-client.ts:8-17`, `src/api/chat-audit-client.ts:19`
- Phase 06 endpoints: `/api/chat/debug/sessions`, `/sessions/:id`, `/turns/:turnId`, `/turns/:turnId/raw`
- Sibling page layout: `src/pages/Catalog/catalog-page.tsx` (two-pane reference)

## Overview
- **Priority:** P0 — without UI the feature is invisible.
- **Status:** complete (2026-05-25)
- **Brief:** New `/dev/chat-audit` route mounted in `src/index.tsx`. Page directory `src/pages/DevAudit/`. Two-pane layout: session list (left) + session detail with turn timeline (right). Each turn expands into collapsible sections (system prompt | user msg | LLM calls | tool calls | raw SDK events lazy-loaded). Legacy turns get a badge. NO modifications to existing `src/pages/Chat/*` or to chat-related App.tsx logic.

## Key Insights
- The FE already uses `/api/chat/*` (proxied through main-server). All debug API calls go to `/api/chat/debug/*` with `X-Owner-Id` header via `getOwnerId()`.
- React Router is v5-style (`react-router-dom` with `<Route>` children, not v6 `<Routes>`). Add new `<Route key="dev-audit" path="/dev/chat-audit" component={DevAuditPage} />` to `src/index.tsx` alongside other routes. Use `loadable()` pattern (src/index.tsx:38) for code-split.
- Raw SDK events list can be huge — cursor-paginated, lazy-loaded on accordion open ("Load raw SDK events" button → fetch first page → "Load more"). DO NOT prefetch.
- The triage UI is **dev-internal**. Display a banner: "Internal triage tool — sessions visible only to owner from X-Owner-Id." No new auth.
- Files < 200 LOC each — the page split into 7 small files makes the budget trivial to hit.

## Requirements

### Functional
- Route: `/dev/chat-audit` (hash router: actual URL is `#/dev/chat-audit`).
- Left pane: search box (filters by title substring, posted to `?q=`) + virtualised list of sessions.
- Right pane: shows nothing until a session is selected; once selected shows session header (id, title, created_at, owner_id, turn_count) and a vertical turn timeline.
- Per-turn card (collapsible):
  - Header line: turn #, role, started_at, model, latency, total tokens, badge (legacy if applicable).
  - Body sections (each collapsible inside the turn card):
    1. **System prompt** — raw text, monospace, copy-to-clipboard button.
    2. **User message** / **Assistant content** — text + thinking blocks.
    3. **LLM calls** — table of { step_index, model, tokens, cost, latency, stop_reason } + per-row expand to view raw `content_json`.
    4. **Tool invocations** — table of { name, args (truncated), result_summary, ok, latency } + per-row expand for full args/result.
    5. **Raw SDK events** — closed by default; opens with a "Load events" button that fetches `/raw?cursor=0&limit=200`; "Load more" appends next page.
- All JSON expansions use a lightweight pretty-printer (`<pre>` with monospace + word-wrap; no react-json-tree dependency to avoid bundle bloat — KISS).

### Non-functional
- All files < 200 LOC.
- No new npm deps; reuse existing styling tokens (`src/theme/tokens.css`) and ui-kit components.
- Lazy-loaded route bundle (loadable() wrapper).
- Polite empty states and error states (e.g. legacy session, 403).

## Architecture

### File layout
```
src/pages/DevAudit/
├── dev-audit-page.tsx              (~90 LOC; outer layout, owns selected-session state)
├── session-list.tsx                (~90 LOC; left pane, search box, list)
├── session-detail.tsx              (~80 LOC; right pane header + turns container)
├── turn-detail.tsx                 (~150 LOC; collapsible sections per turn)
├── raw-events-accordion.tsx        (~90 LOC; lazy load + pagination for /raw)
├── legacy-turn-badge.tsx           (~25 LOC; visual badge)
├── use-debug-api.ts                (~120 LOC; 4 hooks: useDebugSessions, useDebugSession, useDebugTurn, useDebugRawEvents)
└── __tests__/
    ├── turn-detail.test.tsx
    └── use-debug-api.test.ts
```

### Data fetching contract (hooks in `use-debug-api.ts`)
```ts
useDebugSessions({ game, q })            → SWR-like { data, error, isLoading }
useDebugSession(id)                       → same; null when id undefined
useDebugTurn(turnId)                      → same; null when turnId undefined
useDebugRawEvents(turnId)                 → { events, hasMore, loadMore }
```

All hooks use `fetch('/api/chat/debug/...', { headers: { 'X-Owner-Id': getOwnerId() } })`. No new client library — keep with the existing simple-fetch convention.

### Two-pane layout
```
+--------------------+----------------------------------+
| Banner             |                                  |
| Search box         |                                  |
| Session 1          |  (no selection: empty state)     |
| Session 2 (active) |  or                              |
| Session 3          |  Session header                  |
|                    |  Turn timeline (cards)           |
+--------------------+----------------------------------+
```

### Route registration (`src/index.tsx`)
After the existing `<Route key="chat-thread" ...>` line:
```tsx
const DevAuditPage = loadable(() =>
  import('./pages/DevAudit/dev-audit-page').then((m) => ({ default: m.DevAuditPage }))
);
// ...
<Route key="dev-audit" path="/dev/chat-audit" component={DevAuditPage} />
```

DO NOT touch existing routes.

## Related Code Files

### Create
- `src/pages/DevAudit/dev-audit-page.tsx`
- `src/pages/DevAudit/session-list.tsx`
- `src/pages/DevAudit/session-detail.tsx`
- `src/pages/DevAudit/turn-detail.tsx`
- `src/pages/DevAudit/raw-events-accordion.tsx`
- `src/pages/DevAudit/legacy-turn-badge.tsx`
- `src/pages/DevAudit/use-debug-api.ts`
- `src/pages/DevAudit/__tests__/turn-detail.test.tsx`
- `src/pages/DevAudit/__tests__/use-debug-api.test.ts`

### Modify
- `src/index.tsx` — add lazy import + Route entry (+8 LOC).

### Delete
- None.

## Implementation Steps
1. Create `use-debug-api.ts` with 4 hooks; each uses native `fetch` + `useState`+`useEffect` (or `useSWR` if already a dep — grep first; otherwise stay native).
2. Create `dev-audit-page.tsx` skeleton with two-pane layout, banner, and state for `selectedSessionId`.
3. Create `session-list.tsx` consuming `useDebugSessions`, search box debounced 200 ms.
4. Create `session-detail.tsx` consuming `useDebugSession`, rendering header + list of `<TurnDetail turnId=... />`.
5. Create `turn-detail.tsx` consuming `useDebugTurn`, with collapsible sections. Legacy turns render badge + degraded ("no per-step data captured for this turn — predates observability feature").
6. Create `raw-events-accordion.tsx` consuming `useDebugRawEvents` with explicit load button.
7. Create `legacy-turn-badge.tsx` as a tiny visual.
8. Register the route in `src/index.tsx`.
9. Sanity check each file < 200 LOC; split further if any nears the cap (e.g. `turn-detail.tsx` is the highest risk — extract section components if so).
10. Smoke run: navigate to `#/dev/chat-audit` → verify list renders, click a session, expand a turn, expand raw events.

## Todo List
- [x] `use-debug-api.ts` with 4 hooks
- [x] `dev-audit-page.tsx` outer layout
- [x] `session-list.tsx` with search
- [x] `session-detail.tsx` with turn timeline
- [x] `turn-detail.tsx` with 5 collapsible sections
- [x] `raw-events-accordion.tsx` lazy + paginated
- [x] `legacy-turn-badge.tsx`
- [x] Route entry in `src/index.tsx`
- [x] Banner + degraded empty states
- [x] Verify file LOCs

## Success Criteria
- Navigating to `#/dev/chat-audit` lists current owner's sessions (including new + archived).
- Selecting a session shows its turns. Expanding a turn reveals system prompt, user/assistant content, LLM calls table, tool invocations table, and a closed "Raw SDK events" accordion.
- Clicking the raw events accordion's "Load events" button fetches the first page and renders rows; "Load more" appends.
- A legacy (pre-feature) turn shows the badge and a friendly "no per-step data captured" body.
- No file in `src/pages/DevAudit/` exceeds 200 LOC.
- Existing `/chat` and `/catalog` routes continue to function (regression check).

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Huge content_json blocks render | M | M | Wrap in `<pre style="max-height: 400px; overflow:auto">`. Truncated at storage time anyway (phase 03 4 KB / 64 KB caps). |
| `turn-detail.tsx` blows past 200 LOC due to 5 sections | M | L | Extract per-section components (`llm-call-row.tsx`, `tool-invocation-row.tsx`) when nearing 180 LOC. Plan calls this out preemptively. |
| Hash-router base ('./' in vite.config) breaks deep links to /dev/chat-audit | L | M | createHashHistory() already in use — `#/dev/chat-audit` works the same as `#/chat`. Verified by symmetry with `#/catalog/*`. |
| useEffect race: switching session before previous fetch resolves shows stale data | M | M | Standard AbortController inside each hook (set on effect cleanup). |
| Search box hammers backend on every keystroke | L | L | Debounce 200 ms inside session-list.tsx. |
| Adding to `src/index.tsx` accidentally breaks an existing Route ordering | L | H | Insert after existing chat-thread route, before /build. Validated by lint + e2e smoke. |

## Security Considerations
- The page shows current-owner data only (X-Owner-Id sent on every request; phase 06 enforces server-side).
- Banner explicitly states the tool's owner-scoping. No multi-owner switcher (would be a new auth surface — out of scope per locked decisions).
- Copy-to-clipboard buttons can leak PII into clipboard; that's the user's intent (they triggered it) — no further mitigation needed.
- Route is reachable only by direct URL knowledge; not linked from any nav. (Could be hidden behind a dev-only env flag — out of scope; KISS.)

## Next Steps
- Phase 08 adds a render test for `turn-detail.tsx` and hook contract tests.
- Optional follow-up: surface Langfuse deep link in turn header when `isLangfuseEnabled` is true (requires a small exposure endpoint or a build-time flag).
