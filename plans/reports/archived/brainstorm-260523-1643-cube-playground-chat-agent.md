# Brainstorm — Cube Playground Chat Agent (Monet-style, Node SDK)

**Date:** 2026-05-23 16:43 +07 · **Branch:** new_design · **Author:** brainstormer

Source reports cited inline: `scout-260523-1643-monet-chat-agent.md`, `scout-260523-1643-cube-playground-chat-surface.md`.

---

## 1. Problem Statement

User asks playground questions in natural language. Backend must:

1. Understand intent (explore / explain / compare / diagnose).
2. Hold full context of cube-playground's metric vocabulary (cube `/meta` + 19 business-metric YAML files + segment definitions).
3. Generate a **Cube query JSON** (the same shape `/build` consumes today).
4. Stream reasoning + a clickable query summary card to the chat UI.
5. Click → React-Router-pushes the user into `/build` with the exact query loaded — they then explore freely.

Mirror Monet's UX (SSE multi-event stream, multi-turn session, reasoning trace), but in Node so we stay in one toolchain and reuse `server/`'s Cube wiring.

---

## 2. Locked Decisions (from clarifications)

| Decision | Choice | Why |
|---|---|---|
| Data path | **Cube-mediated** | `/build` already consumes Cube JSON; no Trino client in repo; YAML metric layer is the moat. |
| Runtime | **Node + `@anthropic-ai/claude-agent-sdk`** | One language across FE/BE; SDK gives MCP + tool plumbing + Claude session resume out of the box. |
| Process shape | **Separate Node microservice** | Mirrors Monet's process separation; keeps `server/` free of agent loop + SQLite chat schema; can be killed/restarted without dropping segments traffic. |
| Streaming | **SSE, 10-event protocol** (Monet-equivalent) | `loading / thinking / tool_call / tool_call_args / tool_result / token / query_artifact / result / error / done`. |
| Persistence | **SQLite chat.db** (in chat-service) | `chat_sessions`, `chat_turns`, `chat_audit`. Survives restart, enables `/compact` later. |
| Agent style | **Monet-style advisor** with master command + skill files | Pluggable: ship `explore`, `metric_explain`, `compare`, `diagnose` in Phase 1. |

---

## 3. Architecture

```
 ┌───────────────────────────────────────────────────────────────┐
 │ Client  (Vite + React, :3000)                                 │
 │   /chat route → ChatPage                                      │
 │   • SSE consumer (fetch + ReadableStream, Monet pattern)      │
 │   • Renders: text stream · reasoning timeline · query-artifact│
 │     cards (click → push to /build with deeplink URL)          │
 └───────────────┬───────────────────────────────────────────────┘
                 │ POST /api/chat/sessions/:id/turn  (SSE)
                 │ GET  /api/chat/sessions, /api/chat/sessions/:id
                 ▼ (Vite proxy → :3004)
 ┌───────────────────────────────────────────────────────────────┐
 │ Fastify Server  (:3004)  — thin proxy + token resolver        │
 │   server/src/routes/chat.ts                                   │
 │   • Forward SSE stream upstream → downstream                  │
 │   • Inject X-Cube-Token (resolveCubeTokenForGame) + X-Game    │
 │   • Inject X-Owner-Id (from owner-header middleware)          │
 │   • No agent logic here. Stays disposable.                    │
 └───────────────┬───────────────────────────────────────────────┘
                 │ POST http://localhost:3005/agent/turn  (SSE)
                 ▼
 ┌───────────────────────────────────────────────────────────────┐
 │ chat-service  (Node TS, Fastify, :3005)   ← NEW PACKAGE       │
 │                                                                │
 │   ┌────────── api/turn.ts  (SSE handler) ────────┐             │
 │   │ session.acquireLock(sessionId)               │             │
 │   │ intent = intentRouter(text)                  │             │
 │   │ sysPrompt = modePrompts.compose(intent)      │             │
 │   │ stream = claudeAgent.run({ sessionId,        │             │
 │   │   systemPrompt, userMessage, tools, mcp })   │             │
 │   │ for await (msg of stream) sseEmit(msg)       │             │
 │   └──────────────────────────────────────────────┘             │
 │                                                                │
 │   ┌─ core/ ──────────────────────────────────────┐             │
 │   │ claude-runner.ts   @anthropic-ai/claude-     │             │
 │   │                    agent-sdk wrapper         │             │
 │   │ intent-router.ts   keyword heuristic VN+EN   │             │
 │   │ mode-prompts.ts    master + skill + thinking │             │
 │   │ skill-loader.ts    .claude/skills/*/SKILL.md │             │
 │   │ sse-stream.ts      SDK msg → SSE event map   │             │
 │   │ session-manager.ts asyncLock + audit         │             │
 │   └──────────────────────────────────────────────┘             │
 │                                                                │
 │   ┌─ tools/ ─────────────────────────────────────┐             │
 │   │ get-cube-meta            list-segments       │             │
 │   │ list-business-metrics    get-segment         │             │
 │   │ preview-cube-query       explain-cube-sql    │             │
 │   │ emit-query-artifact      list-recent-pinned  │             │
 │   └──────────────────────────────────────────────┘             │
 │                                                                │
 │   ┌─ db/ (better-sqlite3) ───────────────────────┐             │
 │   │ chat_sessions  chat_turns  chat_audit        │             │
 │   └──────────────────────────────────────────────┘             │
 │                                                                │
 │   .claude/                                                     │
 │     commands/cube-playground.md   ← master persona             │
 │     skills/{explore,metric_explain,compare,diagnose}/SKILL.md  │
 │     mcp.json (optional — Phase 2)                              │
 └───────────────┬───────────────────────────────────────────────┘
                 │ tool calls dispatch to:
                 ▼
        ┌──────────────────────────────┐  ┌────────────────────────┐
        │ Cube (:4000) via shared      │  │ server/ services        │
        │  cube-client.ts (lift up)    │  │ business-metrics-loader │
        │  /meta · /load · /sql        │  │ segments service        │
        └──────────────────────────────┘  └────────────────────────┘
```

### Why a thin proxy at `server/`

- Cube token resolution stays where it already lives (`resolveCubeTokenForGame`).
- Owner-header middleware already authenticates; no auth duplication in chat-service.
- chat-service never talks to env tokens; everything arrives via injected headers per request.
- Easier to disable chat (feature flag) without touching the agent code.

---

## 4. Component Decisions (with rejected alternatives)

### 4.1 Claude SDK wrapper

**Chosen:** `@anthropic-ai/claude-agent-sdk` (Node, TypeScript). The Node sibling of the Python SDK Monet uses. Same primitives: `query()` returns async iterator of typed Message objects, supports `--resume <session-id>`, `allowed_tools`, `disallowed_builtin_tools`, MCP config, custom system prompt.

**Rejected — raw Anthropic SDK + DIY tool loop:** would re-implement tool calling, session resume, message typing. Throws away Monet's hard-won lessons (cf. monet report §7.2, SDK migration).

**Rejected — LangGraph/LangChain JS:** larger surface, more abstractions, less idiomatic for Anthropic-only.

### 4.2 Tool dispatch

**Chosen:** **In-process TypeScript functions** registered via the SDK's tool API. Phase 1 ships ~8 tools. Each tool:

```ts
{
  name: 'get_cube_meta',
  description: 'Return the Cube schema (cubes, dimensions, measures, joins) for the active game.',
  input_schema: zodToJsonSchema(z.object({ scope: z.enum(['full', 'compact']).default('compact') })),
  handler: async ({ scope }, ctx) => { /* fetch via cube-client, scope down */ },
}
```

**Rejected — MCP server for each tool:** Monet uses MCP because tools live in other languages/processes (PMT, Prometheus, vng-gds). Our tools are all TS calls into existing services. MCP adds a serialization hop, stdio bring-up time, and JSON-RPC ceremony for zero benefit. Keep MCP escape hatch in Phase 2 if we want to expose chat tools to other agents.

### 4.3 Skill loader

**Chosen:** **Markdown files with YAML frontmatter** at `chat-service/.claude/skills/<name>/SKILL.md`, loaded via `gray-matter` + LRU cache. Matches Monet exactly. Skills are content, not code — non-engineers can edit prompts.

**Rejected — static TS exports:** locks skill authoring to redeploys. Defeats the iteration loop.

### 4.4 Intent router

**Chosen:** **Keyword heuristic (VN + EN)** producing `{ skill: string|null, confidence: number, autoRoute: boolean }`. Cheap, transparent, debuggable. Explicit `/explore` / `/compare` slash prefix always wins.

**Rejected — LLM classifier round-trip:** adds 1–2 s and a token cost to every turn for a job the user can override with a slash command.

### 4.5 Query artifact shape (the deeplink contract)

This is the **new contract Monet does not have** — what gets emitted when the agent wants the user to click into `/build`.

```ts
type QueryArtifact = {
  id: string;                 // turn-scoped uuid (for FE keying)
  title: string;              // e.g. "Daily revenue, ID country, last 30 d"
  summary: string;            // 1–2 sentences plain English
  game: string;               // active game id
  query: CubeQuery;           // measures, dimensions, filters, timeDimensions, ...
  source: 'business-metric' | 'segment' | 'free';
  sourceRef?: { id: string }; // business metric id or segment id when applicable
  previewRows?: number;       // sample row count if the agent ran preview-cube-query
  deeplinkUrl: string;        // already built by emit-query-artifact tool
};
```

**`deeplinkUrl` is built by the tool, not the LLM.** The agent fills `query` + `title` + `summary`; `emit-query-artifact` validates via Zod, calls `buildPlaygroundDeeplink(...)`, and emits a `query_artifact` SSE event. The LLM cannot fabricate a URL.

### 4.6 SSE event taxonomy

Borrow Monet's 10 directly, add `query_artifact`:

| Event | Payload | When |
|---|---|---|
| `loading` | `{}` | turn accepted |
| `thinking` | `{ delta: string }` | reasoning blocks (dedup) |
| `tool_call` | `{ id, name, args }` | before tool exec |
| `tool_result` | `{ id, ok, ms, summary }` | after tool exec |
| `token` | `{ delta }` | text streaming |
| `query_artifact` | `QueryArtifact` | clickable card emitted |
| `result` | `{ text, cost, tokens }` | final message |
| `error` | `{ code, message }` | exception |
| `done` | `{}` | EOF |
| `compact_warning` | `{ turn, threshold }` | nearing context limit (Phase 2) |

### 4.7 Persistence

**SQLite** via `better-sqlite3` (sync, well-supported, fast). Tables:

```sql
chat_sessions(
  id TEXT PRIMARY KEY,            -- uuid
  owner_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  title TEXT,                     -- auto-summary of first user turn
  created_at INTEGER NOT NULL,
  last_turn_at INTEGER,
  turn_count INTEGER DEFAULT 0,
  total_input_tokens INTEGER DEFAULT 0,
  total_output_tokens INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active'    -- active | compacted | archived
);

chat_turns(
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  turn_index INTEGER NOT NULL,
  role TEXT NOT NULL,             -- user | assistant
  user_text TEXT,                 -- for user role
  assistant_text TEXT,            -- final text for assistant
  reasoning_json TEXT,            -- compressed thinking blocks
  tool_calls_json TEXT,           -- array of {name, args, result_summary, ms}
  artifacts_json TEXT,            -- array of QueryArtifact
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd REAL,
  skill TEXT,                     -- auto-routed skill
  started_at INTEGER NOT NULL,
  ended_at INTEGER
);

chat_audit(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  turn_id TEXT,
  kind TEXT,                      -- llm_call | tool_call | error
  detail_json TEXT,
  at INTEGER NOT NULL
);
```

`session_id` is the `--resume` key passed to the Claude SDK so it pulls its own message log; ours is mirror state for the UI history list, audit, and analytics.

---

## 5. Tools — Phase 1 surface

| Tool | Input | Output | Notes |
|---|---|---|---|
| `get_cube_meta` | `{ scope: 'full'|'compact' }` | compact list of cubes with one-line desc, dims, measures, joins | Hits `cube-client.getMeta()`. Scoped to active game. `compact` trims annotations to save tokens. |
| `list_business_metrics` | `{ query?: string, tier?: 1|2 }` | array of `{ id, label, description, formula, unit, game_compatibility }` | Reads `business-metrics-loader` cache. |
| `get_business_metric` | `{ id: string }` | full YAML object | Includes `related_concepts` so the agent can branch. |
| `list_segments` | `{ game: string }` | `[{ id, name, type, uid_count, last_refreshed_at }]` | Read-only call into segments service. |
| `get_segment` | `{ id: string }` | predicate, cube, identityDim, sample rows | Lets agent ground "segment X" mentions. |
| `preview_cube_query` | `{ query: CubeQuery, limit?: 10 }` | first N rows + row count + warnings | Validates query via Zod; calls Cube `/load`. Soft-caps at 50 rows. |
| `explain_cube_sql` | `{ query: CubeQuery }` | compiled SQL string | Calls `/cubejs-api/v1/sql`. For transparency in advisor traces. |
| `emit_query_artifact` | `{ title, summary, query, source, sourceRef? }` | `{ id, deeplinkUrl }` | **Side-effect:** emits `query_artifact` SSE event. The contract for clickable cards. |

Deferred to Phase 2: `compact_session`, `cancel_turn`, `list_recent_pinned`, MCP exposure.

---

## 6. Skills

All four ship in Phase 1 (locked in clarification). Each is `chat-service/.claude/skills/<name>/SKILL.md` with frontmatter:

```yaml
---
name: explore
display_name: Explore
description: Translate a natural-language analytics question into a Cube query
trigger_keywords: [show, plot, chart, count, sum, average, breakdown, top, biểu đồ, hiển thị]
allowed_tools: [get_cube_meta, list_business_metrics, get_business_metric, list_segments, get_segment, preview_cube_query, emit_query_artifact]
---
```

### explore (core)

1. Identify metric (business-metric YAML > raw measure).
2. Identify dimensions / filters / time grain.
3. If ambiguous → ask one clarifying question, don't guess.
4. Run `preview_cube_query` to sanity-check shape (≤ 10 rows).
5. Emit `query_artifact` with the chosen Cube JSON.
6. One-paragraph summary of what the user will see.

### metric_explain

1. Look up via `list_business_metrics` / `get_business_metric`.
2. If found → render description, formula, unit, game compatibility, related concepts.
3. If not → fall back to `get_cube_meta` and explain the raw measure/dimension.
4. No query execution unless user asks "and show me last week".

### compare

1. Identify two subjects (segments, time periods, countries...).
2. Build two queries via `preview_cube_query` (or one query with `compareDateRange`).
3. Compute delta / ratio in prompt.
4. Emit two `query_artifact`s OR a single combined one.
5. Plain-English winner/loser sentence.

### diagnose

1. Symptom from user ("revenue dropped Wednesday").
2. Hypothesis tree (channels, geos, products, anomalies).
3. For each branch, call `preview_cube_query` with relevant filter.
4. Stop when one branch explains > N% of the drop.
5. Emit the deeplink to the explanatory query.

Master command lives at `chat-service/.claude/commands/cube-playground.md`: identity ("you are the cube-playground analyst sidekick"), output rules (always emit `query_artifact` when the answer warrants exploration, never make up cube member names, prefer business-metric YAML over raw measures), tool allowlist defaults, refusal posture.

---

## 7. API Contract (server → chat-service)

### POST `/agent/turn` (SSE)

Request:
```json
{ "session_id": "uuid|null",
  "owner_id": "string",
  "game": "string",
  "message": "string",
  "context": {
    "page": "/segments/abc",
    "selected_blocks": [{ "kind": "segment", "id": "seg-xyz" }]
  }
}
```

Response: `text/event-stream` with the 10 events above. Final `done` closes the stream.

If `session_id` is null, server creates one and emits `{ event: 'session_created', data: { id } }` as first event.

### GET `/sessions?owner=<id>&game=<id>`

List recent sessions with `{ id, title, last_turn_at, turn_count }`.

### GET `/sessions/:id`

Full history: `[{ role, text, artifacts, reasoning_summary }]`. Used to rehydrate the FE chat panel.

### DELETE `/sessions/:id`

Soft-delete (status='archived').

### POST `/sessions/:id/compact` (Phase 2)

LLM-summarize past N turns into a system note; start a fresh Claude SDK session that picks up with that summary in context.

---

## 8. FE Wiring — Three Surfaces (Hermes-derived)

Reference: `scout-260523-1716-hermes-chat-ui.md`. Hermes already solved the dual-surface (FAB-rail + full page) problem with a clean separation; we mirror its layout/composition patterns but swap the canned-response engine for our real SSE stream.

### 8.1 Surfaces

| Surface | Visible when | Triggered by | Layout |
|---|---|---|---|
| **`AskCubeFab`** (floating button) | route is **not** `/chat` or `/chat/:id` | always present in `App` shell | `position: fixed`, bottom-right 24 px, z-index 900. Pill with MessageCircle icon + "Ask Cube" label. Hidden whenever `ChatPanel` is open (avoid overlap with composer). |
| **`ChatPanel`** (right-docked rail) | toggled by FAB; persists open state | `AskCubeFab` click; restored from localStorage on next mount | Right-docked `<aside>`, default 420 px, drag-to-resize 360–720 px on left edge. **No backdrop** — side-by-side push, main content reflows. 44 px header (title link to `/chat/:id`, "New" button, close X) + scrollable thread + composer footer. |
| **`/chat` + `/chat/:id` page** | route match | sidebar Chat section click; "Expand" button in panel header; click on a recent-conversation row | Full-width centred column (max 760 px), H1 title (= first user message), thread, composer pinned bottom. Optional left history rail (top 20 sessions) when ≥ md viewport. |

**Mutual exclusion:** Hermes pattern — FAB ↔ ChatPanel toggle one boolean; full `/chat` page hides FAB and panel both. Implemented by `useLocation()` check + `chatPanelOpen` Zustand atom.

### 8.2 Single backing store (no localStorage drift)

Hermes stores thread bodies in localStorage. We do **not** — our source of truth is the chat-service SQLite via `/api/chat/sessions/...`. Adopt only the *coordination* parts of Hermes' design:

| Concern | Mechanism |
|---|---|
| Thread content (turns, artifacts, reasoning) | **Server SQLite** — fetched by both panel and page via shared `useChatSession(id)` hook (TanStack Query or SWR-style cache keyed by `sessionId`). |
| Active session id (which session is in panel) | **In-memory React state** + URL hash on the page (`/chat/:id`). |
| Panel open + width | **localStorage** (`gds-cube:chat-panel:open`, `gds-cube:chat-panel:width`) — same key scheme Hermes uses for its rail. |
| Recent conversations | **localStorage LRU** via existing `pushRecent('chat', { id, title, href })` in `src/shell/sidebar/recent-items-store.ts`. The `'chat'` module is already declared there (line 13). |
| Cross-surface change broadcast | **Custom DOM event** `gds-cube:chat-session-changed` — emitted whenever a turn completes, a session is created, renamed, or deleted. Both panel and page listen and re-fetch the affected session. Same pattern the sidebar already uses for `gds-cube:recent-changed`. |

**Sync example:** User opens panel from `/segments/abc`, sends "show daily revenue last 7 days". On `done` SSE event:
1. Cache the new turn locally; UI updates immediately.
2. Fire `pushRecent('chat', { id: sessionId, title: 'Show daily revenue last 7 days', updatedAt: ... })`.
3. Fire `gds-cube:chat-session-changed` event with sessionId.
4. Sidebar `RecentItems` (module=chat) listens → re-reads localStorage → row appears at top.
5. User clicks Chat in sidebar → lands at `/chat`; page lists sessions → clicking the same row navigates to `/chat/<id>` → `useChatSession(id)` fetches from server → same conversation rehydrates fully (artifacts included).

### 8.3 Sidebar integration (drop-in change)

Today `sidebar.tsx:61–69` has:
```tsx
<SidebarSection id="chats" icon={MessageSquare} label={t('nav.chat')} to="/chat" collapsed={collapsed}>
  <SidebarItem label="No recent items" to="/chat" indent muted />
</SidebarSection>
```

Replace with the same `RecentItems` pattern already used by Data Model / Metrics Catalog / Segments:

```tsx
<SidebarSection id="chats" icon={MessageSquare} label={t('nav.chat')} to="/chat" collapsed={collapsed}>
  <RecentItems module="chat" seeAllTo="/chat" hrefFor={(id) => `/chat/${id}`} />
</SidebarSection>
```

Zero changes needed in `recent-items.tsx` or `recent-items-store.ts` — `'chat'` is already a recognised module. The empty-state "No recent items" rendering is already built in (line 40).

### 8.4 Component tree

```
App
├── Sidebar
│   └── SidebarSection "Chat"
│       └── RecentItems module="chat"           ← uses existing primitive
├── <route content>
└── ChatOverlay                                  ← NEW
    ├── AskCubeFab                               (hidden on /chat, /chat/:id, or when panel open)
    └── ChatPanel                                (mounted only when panelOpen)
        ├── ChatPanelHeader (title, "Expand → /chat/:id", "New", close)
        ├── ChatThreadView                       ← shared with /chat page
        │   ├── ChatMessageList
        │   │   ├── UserMessage
        │   │   └── AssistantMessage
        │   │       ├── ReasoningTrace          (collapsible Monet-style)
        │   │       ├── TextStream              (token-by-token)
        │   │       ├── ToolCallChip            (per tool_call event)
        │   │       └── QueryArtifactCard       (clickable → push deeplinkUrl)
        │   └── (empty state with RecentSessions + suggested prompts)
        └── ChatComposer
            ├── auto-sizing textarea (24–240 px)
            ├── Cmd/Ctrl+Enter to send, Esc to blur
            └── Send button

/chat route
└── ChatLandingPage
    ├── ChatComposer (compact=false)
    └── ChatHistoryRail (left, ≥ md)            sessions list, click → /chat/:id

/chat/:id route
└── ChatThreadPage
    ├── ChatThreadHeader (H1 = first user message)
    ├── ChatThreadView                          ← same component as panel uses
    └── ChatComposer
```

`ChatThreadView` and `ChatComposer` are shared between rail + page so messages render identically in both surfaces; only `compact` prop differs.

### 8.5 SSE client

Lift Monet's `pistol-fe/lib/mornet/client.ts` pattern into `src/api/chat-sse-client.ts` — `fetch()` POST with `Accept: text/event-stream` + `body.getReader()` + `TextDecoder` + line buffer + typed dispatcher. ~150 LOC. Returns `{ stream: AsyncIterable<SseEvent>, cancel: () => void }`. The `useChatStream(sessionId, message)` hook wraps this and surfaces React-friendly state (`messages`, `status`, `currentArtifacts`, `cancel`).

### 8.6 Session-title strategy

Hermes uses the first user message verbatim as `title`. Adopt that for v1 (truncate at 64 chars). Phase 2: chat-service can run a one-shot LLM call after turn-3 to produce a 3-word summary, then update via `PATCH /sessions/:id` and re-broadcast.

### 8.7 Deeplink consumption (unchanged)

`/build` already reads `?query=` or sessionStorage. Clicking a `QueryArtifactCard` calls `history.push(artifact.deeplinkUrl)` — no playground-side changes. If `via === 'session-storage'` (URL too long), the card writes the payload to sessionStorage before navigation, exactly as `buildPlaygroundDeeplink` already documents.

### 8.8 Game scoping

Active game lives in existing app context. `POST /agent/turn` always includes `game`. Switching games → close panel (or prompt "switch session? current session is pinned to game X"). Each session row in the sidebar / `/chat` lists the game it belongs to as a small mark chip (reuse `cubeBadge` style).

### 8.9 Visibility rules (single source of truth)

```ts
function useChatSurfaces() {
  const { pathname } = useLocation();
  const [panelOpen, setPanelOpen] = useChatPanelOpen();  // backed by localStorage
  const onChatPage = pathname === '/chat' || pathname.startsWith('/chat/');
  return {
    fabVisible:   !onChatPage && !panelOpen,
    panelVisible: !onChatPage &&  panelOpen,
    pageVisible:  onChatPage,
  };
}
```

One hook, three booleans, no overlap.

### 8.10 Hermes patterns explicitly adopted vs. dropped

| Hermes pattern | Adopt? | Note |
|---|---|---|
| FAB fixed bottom-right, z-900 | ✓ | Same offsets (24 px). |
| FAB hidden when rail open | ✓ | Avoids composer overlap. |
| Right-rail drag-to-resize, persisted width | ✓ | 360–720 px clamp (Hermes is 320–720; widen min for our artifact cards). |
| `delayedAppend(thread, msg, 800)` typing simulation | ✗ | We have real streaming — show actual token rate. Keep TypingDots component for `loading` phase before first `token` event. |
| Canned response registry | ✗ | Real LLM via SSE. |
| Assistant section discriminated union | ✓ | Start with `text` / `reasoning` / `tool_call` / `tool_result` / `query_artifact`; add later as skills grow. |
| User message artifact badge | ✓ | We attach `selected_blocks` to turn request — render badge for each. |
| Message follow-up suggestions | ✗ Phase 2 | Skill prompts can emit `followups` array in result event when relevant. |
| Cmd+Enter to send, Esc to blur | ✓ | Standard. |
| localStorage open/width persistence | ✓ | Same key prefix `gds-cube:chat-*`. |
| localStorage for thread content | ✗ | Server is source of truth; localStorage only for prefs + recents index. |
| `notifyRecentChanged()` custom event | ✓ | Already in our codebase (`gds-cube:recent-changed`). Add a sibling `gds-cube:chat-session-changed` for full-session reloads. |

---

## 9. Project Layout (new files)

```
chat-service/                                    ← NEW PACKAGE
  package.json                                   "@cube-playground/chat-service", "type": "module"
  tsconfig.json
  src/
    index.ts                                     fastify app, port 3005
    api/
      turn.ts                                    POST /agent/turn (SSE)
      sessions.ts                                GET / POST / DELETE
      health.ts                                  GET /health
    core/
      claude-runner.ts                           @anthropic-ai/claude-agent-sdk wrapper
      intent-router.ts
      mode-prompts.ts
      skill-loader.ts                            gray-matter + lru-cache
      sse-stream.ts
      session-manager.ts                         per-session async-mutex
    tools/
      registry.ts
      get-cube-meta.ts
      list-business-metrics.ts
      get-business-metric.ts
      list-segments.ts
      get-segment.ts
      preview-cube-query.ts
      explain-cube-sql.ts
      emit-query-artifact.ts
    db/
      schema.sql
      migrate.ts
      chat-store.ts                              better-sqlite3 facade
    config.ts                                    env, paths
    types.ts                                     CubeQuery, QueryArtifact, SseEvent, ...
  .claude/
    commands/
      cube-playground.md
    skills/
      explore/SKILL.md
      metric_explain/SKILL.md
      compare/SKILL.md
      diagnose/SKILL.md
  runtime/
    chat.db                                      gitignored
  test/
    intent-router.test.ts
    tool-emit-query-artifact.test.ts
    sse-stream.test.ts
  .env.example
  README.md

server/src/routes/chat.ts                        ← NEW: thin proxy
server/src/services/cube-token-header.ts         ← already inferred, may exist

src/api/chat-sse-client.ts                       ← NEW (Monet client pattern, ~150 LOC)
src/shell/chat-overlay/                          ← NEW (FAB + side panel orchestration)
  chat-overlay.tsx                                 mounts FAB + ChatPanel, uses useChatSurfaces
  ask-cube-fab.tsx                                 floating pill, route-gated
  chat-panel.tsx                                   right-docked rail (drag-resize, header, body, footer)
  chat-panel-open-store.ts                         localStorage open/width persistence + change events
  use-chat-surfaces.ts                             single hook → {fabVisible, panelVisible, pageVisible}
src/pages/Chat/                                  ← REPLACE placeholder
  chat-landing-page.tsx                            /chat — composer + history rail
  chat-thread-page.tsx                             /chat/:id — H1 + thread + composer
  components/
    chat-thread-view.tsx                           SHARED — message list + scroll pin (used by panel + page)
    chat-message-list.tsx
    user-message.tsx                               H2 + HelpCircle (Hermes shape)
    assistant-message.tsx                          discriminated-union sections
    chat-composer.tsx                              SHARED — textarea + send, compact prop
    reasoning-trace.tsx                            collapsible timeline of tool_call/tool_result events
    tool-call-chip.tsx
    query-artifact-card.tsx                        clickable → deeplinkUrl
    chat-history-rail.tsx                          left rail on /chat landing
    session-row.tsx                                row used by history rail + sidebar recents
    typing-dots.tsx                                shown between request and first token
  hooks/
    use-chat-session.ts                            fetch/cache session + turns
    use-chat-stream.ts                             wraps chat-sse-client → React state
    use-chat-sessions-list.ts                      list for landing page

docs/system-architecture.md                      ← UPDATE: add chat-service block
docs/codebase-summary.md                         ← UPDATE: chat-service section
docs/chat-agent-design.md                        ← NEW (this doc → finalised)
```

---

## 10. Configuration

`chat-service/.env`:
```
PORT=3005
LOG_LEVEL=info

# LLM
ANTHROPIC_BASE_URL=https://aawp-litellm-testing.vnggames.net    # or direct Anthropic
ANTHROPIC_API_KEY=<from-secrets>
CHAT_MODEL=claude-sonnet-4-6
CHAT_MAX_OUTPUT_TOKENS=4096

# Cube via server/
SERVER_BASE_URL=http://localhost:3004
CUBE_API_URL=http://localhost:4000          # used by tools when bypassing server

# Storage
CHAT_DB_PATH=./runtime/chat.db

# Limits
CHAT_MAX_TURNS_PER_SESSION=40
CHAT_MAX_TOKENS_PER_TURN=8000
CHAT_RATE_LIMIT_PER_OWNER_PER_MIN=30
```

`server/.env` additions:
```
CHAT_SERVICE_URL=http://localhost:3005
CHAT_FEATURE_ENABLED=true
```

Root `package.json` adds `"dev:all": "concurrently 'npm run dev' 'npm --prefix server run dev' 'npm --prefix chat-service run dev'"`.

---

## 11. Phasing

| Phase | Scope | Exit criteria |
|---|---|---|
| **1a · Skeleton** | chat-service package, Fastify boot, SSE infrastructure, SQLite schema + migrate, master command, `explore` skill, 3 tools (`get_cube_meta`, `preview_cube_query`, `emit_query_artifact`). Server proxy. FE: `chat-sse-client` + shared `ChatThreadView` + `ChatComposer` + `/chat/:id` page only. | End-to-end on `/chat/:id` only: user types "show daily revenue last 7 days" → query_artifact card → click → /build opens with the query. |
| **1b · UI surfaces** | `ChatOverlay` shell mount, `AskCubeFab`, `ChatPanel` (drag-resize + persisted open/width), `/chat` landing with composer + history rail, sidebar `RecentItems` swap (one-line in `sidebar.tsx`), `gds-cube:chat-session-changed` event broadcast, cross-surface session handoff. | FAB visible on all routes except `/chat[/:id]`; panel and page render identical thread via shared `ChatThreadView`; closing panel and reopening shows same conversation; clicking sidebar recent jumps to `/chat/:id` with same content. |
| **1c · Skill expansion** | Add `metric_explain`, business-metrics tools, `list_segments` / `get_segment`. Session list + history rehydration polish. | Four-tool surface; session list persists across restart. |
| **1d · `compare` + `diagnose`** | Author SKILL.md, validate tool sufficiency, add tests. | Both skills produce sensible multi-query traces. |
| **2 · Polish** | Auto-compact at 80% context, cost dashboard, rate limiting middleware, MCP exposure of tools, FE recovery on stream drop, LLM session-title summarisation, image / file attachments, message rename/delete affordances on session rows. | Stable for daily-use by analysts. |

Phase 1a is the hard gate to user value (one clickable card answers the original ask). Phase 1b/1c are slot-in.

---

## 12. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `@anthropic-ai/claude-agent-sdk` Node parity gaps vs Python | Med | High | Verify on day 1: spawn a hello-world session, confirm `--resume`, tool registration, SSE-friendly async iteration. If gaps: fall back to `@anthropic-ai/sdk` + DIY tool loop (~+2 days). |
| LLM produces invalid Cube query JSON (bad member names) | High | Med | `emit_query_artifact` Zod-validates against known cube/dim/measure names from `/meta` cache. Reject + return error → LLM self-corrects. |
| Token cost runaway | Med | Med | Per-turn token cap (env). Per-owner per-minute rate limit. Cost recorded per turn; dashboard in Phase 2. Hard stop if cost > $X / session. |
| Deeplink URL > 8 KB | Low | Low | `buildPlaygroundDeeplink` already has sessionStorage fallback. Chat-service emits `via: 'session-storage'` so FE knows to set sessionStorage before navigation. |
| Multi-game schema bloat in system prompt | Med | High | Sessions are pinned to one `game`. `get_cube_meta` only returns that game's schema. Switching games starts a new session. |
| Concurrent turns on same session | Med | High | `session-manager` async-mutex. Second POST returns 409 with hint "previous turn still running". |
| Cube backend down → all tools fail | Med | Low | `get_cube_meta` is the canary; if it fails return a friendly "data backend unavailable" message instead of looping. |
| YAML business-metric IDs change | Low | Med | `business-metrics-loader` watches files in dev; clear chat-service LRU on `meta-version` change (it already exists for cube). |
| Reasoning trace leaks PII | Low | Med | Skill prompts forbid echoing raw rows beyond 5 sample values; row count instead of contents in tool-result summaries. Same posture as Monet POC. |
| Two devs editing SKILL.md → cache stale | Low | Low | LRU TTL 5 s in dev; SIGHUP to clear cache; or just restart. |

---

## 13. Why NOT each major alternative (recap)

| Alternative | Why rejected |
|---|---|
| **Trino-direct** | No client in repo, would re-implement what Cube does, loses YAML metric semantics. User confirmed Cube-mediated. |
| **In-process inside `server/`** | Bloats `server/` from segments service to agent host; SQLite chat schema entangles with segments DB; harder to scale/restart independently. User confirmed separate microservice. |
| **Single-shot JSON response** | Loses reasoning trace UX that makes the advisor feel trustworthy; users won't know what tools ran. User confirmed SSE. |
| **Python sibling like Monet** | Adds Python venv to a TypeScript-everywhere repo; can't reuse `cube-client.ts`, segments types, deeplink builder; team friction. User confirmed Node. |
| **No skill files, inline prompts** | Locks prompt iteration to redeploys; non-engineers can't tune. |
| **No `query_artifact` event, parse markdown links** | Brittle (Monet's gap); LLMs hallucinate URLs; no structured analytics on click-through. |

---

## 14. Success Metrics

- **Time-to-first-deeplink-click** from chat answer < 8 s P50.
- **Click-through rate** on `query_artifact` cards > 30 % of qualifying turns (means summaries are useful).
- **Invalid query rate** (artifacts rejected by Zod before emission) < 5 % after 1 week.
- **Session resumption rate** > 25 % (means multi-turn is happening).
- **No P0 incident** in `server/` traced to chat-service for 30 days post-launch.

---

## 15. Unresolved Questions

1. **LLM credential source** — VNG LiteLLM proxy (like Monet) or direct `api.anthropic.com`? VNG proxy is org policy if it exists; direct is simpler in dev. Default: VNG proxy + env fallback to direct.
2. **Owner identity model in chat-service** — does it trust the proxied `X-Owner-Id` header verbatim, or re-verify a JWT? Current `server/` accepts owner-header in dev/test; chat-service can mirror that and tighten in prod.
3. **Should sessions be game-scoped or game-switchable mid-thread?** Default proposal: game-scoped. Confirm acceptable for analyst flows where they might pivot.
4. **Auto-compact in Phase 1 or punt to Phase 2?** Monet punted. Proposal: punt.
5. **FE entry point for chat** — sidebar `/chat` (current placeholder route) only, or also a floating "Ask" button on every page (Monet sidebar pattern)? Phase 1: dedicated page only; floating panel in Phase 2.
6. **Per-game prompts** — does each game need a different master command (PT vs Ballistar vocab)? Probably no in Phase 1; same master + game name fed as context.
7. **Tests** — Vitest is in repo. Confirm: chat-service uses Vitest with `better-sqlite3` in-memory DB for tool tests; SDK calls mocked.
8. **Production deploy target** — same Docker host as `server/`? Single docker-compose? Phase-2 concern but worth noting before infra ticket is needed.

---

## 16. Next Step

If this design is approved → invoke `/ck:plan` with this report as context to generate the phased implementation plan at `plans/260523-1643-cube-playground-chat-agent/`.

---

## 17. Validation Summary

**Validated:** 2026-05-23 17:26 +07 · **Questions asked:** 7 · **Mode:** prompt (range 3–8)

### Confirmed decisions

| # | Decision point | Choice |
|---|---|---|
| 1 | LLM credential source (§10) | **VNG LiteLLM proxy** — `ANTHROPIC_BASE_URL=https://aawp-litellm-testing.vnggames.net` + LiteLLM-issued API key. Same arrangement as Monet. Drop "or direct" fallback wording. |
| 2 | Game-scoping policy (§8.8) | **One game per session, pinned at creation.** `chat_sessions.game_id` is immutable. Switching active game in topbar opens a new session; recent list filters by active game. |
| 3 | Auto-compact (§11, §12) | **Punt to Phase 2.** Phase 1a/b/c ship without `/compact`; rely on SDK resume up to context budget. |
| 4 | Phase-1a tool surface (§6, §11) | **All 8 tools ship in Phase 1a** (was 3). `get_cube_meta`, `list_business_metrics`, `get_business_metric`, `list_segments`, `get_segment`, `preview_cube_query`, `explain_cube_sql`, `emit_query_artifact`. Skills layer on top in 1c/1d. |
| 5 | Concurrent-turn policy (§12) | **409 Conflict with retry hint** when a second POST hits a session still streaming. FE disables send button while SSE stream open. Mirrors Monet POC. |
| 6 | LLM test posture (§15) | **Mock the Agent SDK everywhere.** Vitest unit tests stub the SDK with a fake async iterator emitting canned Message objects. No live-LLM tests in CI. Real LLM only exercised manually during dev. |
| 7 | Session title strategy (§8.6) | **First user message, truncated to 64 chars.** Hermes pattern. Rename affordance moved to Phase 2. |

### Action items for plan generation

- [ ] **Re-estimate Phase 1a:** scope expanded from 3 tools to 8. Original estimate ~5 days; revised ~8–10 days. Consider splitting Phase 1a into:
  - **1a-core:** chat-service skeleton + SQLite + master command + 3 critical-path tools (`get_cube_meta`, `preview_cube_query`, `emit_query_artifact`) + `/chat/:id` page only
  - **1a-tools:** remaining 5 tools (`list_business_metrics`, `get_business_metric`, `list_segments`, `get_segment`, `explain_cube_sql`)
  - then 1b (UI surfaces), 1c (skills), 1d (compare/diagnose), 2 (polish + auto-compact)
- [ ] Update §10 `.env.example` to drop the "or direct" wording on `ANTHROPIC_BASE_URL`; VNG LiteLLM is canonical.
- [ ] Update §6 to note **all 8 tools land in Phase 1a**; remove the "Deferred to Phase 2" line from the tools table (only `compact_session`, `cancel_turn`, `list_recent_pinned`, MCP exposure remain Phase 2).
- [ ] Update §12 risks: concurrent-turn mitigation row → "409 reject (confirmed)".
- [ ] Update §15 — prune resolved questions; keep open: owner-identity model (default trust header in dev), per-game prompts (defer eval to Phase 2), prod deploy target (Phase 2 ops ticket).

### Items still open (intentionally deferred)

- Owner identity model — default to trusting `X-Owner-Id` header forwarded by `server/`, tighten in Phase 2 prod hardening.
- Per-game master command divergence — Phase 1 ships one master command + game name injected as context; revisit if game vocabularies diverge meaningfully.
- Production deploy target (same docker-compose vs separate) — Phase 2 infra concern.
- FAB iconography — pill ("Ask Cube") vs icon-only — to be decided during 1b implementation by UI designer.

### Recommendation

**Proceed to `/ck:plan`** with the brainstorm doc as input, applying the four action items above when phase files are authored. Plan dir target: `plans/260523-1643-cube-playground-chat-agent/`.
