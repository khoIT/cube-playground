# Phase 01 — chat-service Skeleton + Server Proxy + 3 Critical-Path Tools + /chat/:id MVP

## Context Links

- Brainstorm: `/Users/lap16299/Documents/code/cube-playground/plans/reports/brainstorm-260523-1643-cube-playground-chat-agent.md` (§3, §4, §6 tools 1/6/8, §7, §9, §11 row 1a-core, §17 action items)
- Server scout: `/Users/lap16299/Documents/code/cube-playground/plans/reports/scout-260523-1643-cube-playground-chat-surface.md` (§2, §5)
- Hermes scout (composer/thread shapes): `/Users/lap16299/Documents/code/cube-playground/plans/reports/scout-260523-1716-hermes-chat-ui.md`
- Plan overview: `./plan.md`

## Overview

- **Priority:** P1 — gating phase, no other phase can ship without this.
- **Current status:** pending.
- **Description:** Build the smallest possible end-to-end slice: chat-service Fastify boot on port 3005, SQLite persistence, Claude Agent SDK wrapper, SSE event mapper, 3 critical-path tools (`get_cube_meta`, `preview_cube_query`, `emit_query_artifact`), master command, `explore` skill stub, server proxy at `/api/chat/*`, FE SSE client + shared `ChatThreadView` + `ChatComposer` + `/chat/:id` route. Definition of done: user opens `/chat`, types "show daily revenue last 7 days", sees streamed reasoning + a clickable query-artifact card, clicks → `/build` opens with the query loaded.

## Key Insights

- Brainstorm §4.1: Claude Agent SDK Node parity is the day-1 risk → smoke-test the hello-world session before wiring tools.
- Brainstorm §4.5: `deeplinkUrl` is built by the `emit_query_artifact` tool, **not** the LLM. The LLM cannot fabricate URLs; Zod gates the contract.
- Brainstorm §4.5 + scout §5: existing `src/utils/playground-deeplink.ts` is **segment-shaped** (`segmentId`, `identityDim`, `uids`). Chat-agent emits a free-form Cube query. Need a sibling helper that just JSON-encodes the query into `#/build?query=…` with the same 8000-char + sessionStorage fallback contract.
- Brainstorm §12 row 1: SDK feature gaps may need fallback to `@anthropic-ai/sdk` + DIY loop — keep the wrapper boundary clean.
- Brainstorm §17 row 5: concurrent-turn → 409. Implemented as per-session async-mutex in `session-manager.ts`.
- Brainstorm §17 row 6: SDK mocked everywhere in tests; no live-LLM in CI.
- Scout server: existing `server/src/services/resolve-cube-token.ts`, `server/src/middleware/owner-header.ts`, `server/src/services/cube-client.ts` are reused — no duplication.
- Sidebar at `src/shell/sidebar/sidebar.tsx:61-69` and `recent-items-store.ts:13` already declare a `'chat'` module; defer wiring to Phase 03.

## Requirements

### Functional

1. POST `/api/chat/sessions/:id/turn` (FE → server proxy → chat-service) streams SSE events back to FE.
2. POST `/agent/turn` on chat-service accepts `{ session_id, owner_id, game, message, context? }`, runs Claude SDK, emits 10 SSE event types: `loading`, `thinking`, `tool_call`, `tool_result`, `token`, `query_artifact`, `result`, `error`, `done`, plus `session_created` when `session_id` is null.
3. GET `/api/chat/sessions?game=<id>` → list owner+game sessions.
4. GET `/api/chat/sessions/:id` → full history (turns + artifacts + reasoning summaries).
5. DELETE `/api/chat/sessions/:id` → soft-archive.
6. `emit_query_artifact` tool builds the `#/build?query=…` deeplink and emits a `query_artifact` SSE event. The artifact MUST include a fully-formed `deeplinkUrl`.
7. Clicking a `QueryArtifactCard` in the FE pushes `artifact.deeplinkUrl` via `react-router-dom` history. If `via === 'session-storage'`, write payload to sessionStorage first.
8. `/chat/:id` route renders the existing thread (rehydrate from `/api/chat/sessions/:id`) and supports sending more turns.
9. Sessions are pinned to a single `game_id` at creation; cannot be changed.
10. Concurrent turn on same session → 409 with body `{ code: 'turn_in_progress', retry_after_ms }`.

### Non-functional

- Streaming first-byte < 400 ms after `POST /agent/turn` accepts (excluding LLM latency).
- chat-service `tsc --noEmit` clean; server `tsc --noEmit` clean; root `npm run typecheck` clean.
- Vitest unit tests for `intent-router`, `sse-stream` mapping, `emit_query_artifact` Zod validation, `session-manager` mutex, `chat-store` CRUD. SDK and Cube `/load` mocked.
- chat-service starts cold in < 1.5 s on dev laptop.
- SSE stream survives a 60 s LLM turn without proxy timeout (server proxy must disable response buffering).

## Architecture

```
FE (/chat/:id)
  └── useChatStream(sessionId, message)         src/pages/Chat/hooks/use-chat-stream.ts
      └── chat-sse-client.ts                    src/api/chat-sse-client.ts
          └── POST /api/chat/sessions/:id/turn  (text/event-stream)
                     ↓ Vite proxy → :3004
server/ (Fastify, :3004)
  └── routes/chat.ts (NEW)
       • forwards request body + injects X-Cube-Token, X-Cube-Game, X-Owner-Id
       • pipes upstream SSE response body 1:1 to client (no buffering)
                     ↓ POST http://localhost:3005/agent/turn (SSE)
chat-service/ (Fastify, :3005, NEW)
  └── api/turn.ts
       • session-manager.acquireLock(sessionId) → 409 if held
       • intent = intentRouter(text)        (keyword heuristic, can be no-op in 01)
       • sysPrompt = modePrompts.compose({ master, skill: 'explore', game })
       • stream = claudeRunner.run({ sessionId, systemPrompt, message, tools, toolContext })
       • for await (msg of stream) → sseEmit(msg)
       • on done: persist turn (chat-store.appendTurn)
  └── core/
       claude-runner.ts        @anthropic-ai/claude-agent-sdk wrapper
       intent-router.ts        keyword heuristic VN+EN (stub: always 'explore')
       mode-prompts.ts         master + skill composer
       skill-loader.ts         gray-matter + lru-cache (TTL 5s in dev)
       sse-stream.ts           SDK Message → SSE event mapper
       session-manager.ts      per-session AsyncMutex
  └── tools/
       registry.ts             { name, description, input_schema, handler }[]
       get-cube-meta.ts        → cube-client.getMeta() via server token
       preview-cube-query.ts   → cube-client.load() with limit cap
       emit-query-artifact.ts  → builds deeplink, emits SSE event side-effect
  └── db/
       schema.sql              chat_sessions / chat_turns / chat_audit
       migrate.ts              better-sqlite3 migrator (idempotent)
       chat-store.ts           CRUD facade
  └── config.ts                env + paths

Tool execution context (injected per request):
  ToolContext = { ownerId, gameId, cubeToken, sseEmitter, sessionId, turnId }
```

### SSE event payload contract (Phase 01 subset — all 10 wired even if some are no-op)

```
event: session_created     data: { id: string }            // only when input session_id was null
event: loading             data: {}
event: thinking            data: { delta: string }
event: tool_call           data: { id: string, name: string, args: unknown }
event: tool_result         data: { id: string, ok: boolean, ms: number, summary: string }
event: token               data: { delta: string }
event: query_artifact      data: QueryArtifact              // see §4.5 of brainstorm
event: result              data: { text: string, cost_usd?: number, input_tokens?: number, output_tokens?: number }
event: error               data: { code: string, message: string }
event: done                data: {}
```

### Data flow — happy path "show daily revenue last 7 days"

1. FE POST `/api/chat/sessions/new/turn` body `{ message, game: 'ptg' }`.
2. server/chat.ts: resolves cube token via `resolveCubeTokenForGame('ptg')`, owner via `request.owner`, forwards as headers; opens upstream SSE stream.
3. chat-service: no `session_id` → creates row, emits `session_created`.
4. session-manager grabs lock; intent-router returns `explore`; mode-prompts composes system prompt with master + explore skill.
5. claude-runner starts SDK query; SDK calls tool `get_cube_meta` → handler hits Cube `/meta` using injected `cubeToken`.
6. SDK calls `preview_cube_query` with `{ measures: ['recharge.revenue_vnd'], timeDimensions: [{ dimension: 'recharge.created_at', granularity: 'day', dateRange: 'last 7 days' }] }` → 7 sample rows back.
7. SDK calls `emit_query_artifact({ title, summary, query, source: 'business-metric', sourceRef: { id: 'revenue' } })`.
   - Handler Zod-validates `query` against cube meta cache (member names exist) — if invalid, returns `{ ok: false, error }`; LLM retries.
   - Handler synthesises `deeplinkUrl` via the new `buildChatDeeplink(query)` util — inline or session-storage shape.
   - Handler emits `query_artifact` event to SSE stream (side effect via `sseEmitter`).
8. SDK finalises with text → `result` → `done`.
9. chat-service persists turn (assistant text, tool calls, artifacts, tokens).
10. FE click on `QueryArtifactCard` → `history.push(deeplinkUrl)` (after sessionStorage write if needed) → `/build` reads `?query=` and renders.

## Related Code Files

### MODIFY

- `/Users/lap16299/Documents/code/cube-playground/server/src/index.ts` — register `chatRoutes`.
- `/Users/lap16299/Documents/code/cube-playground/.env.example` — add `CHAT_SERVICE_URL`, `CHAT_FEATURE_ENABLED`.
- `/Users/lap16299/Documents/code/cube-playground/package.json` — add `chat-service` to `dev:all`.
- `/Users/lap16299/Documents/code/cube-playground/src/index.tsx` — register `/chat/:id` route (keep `/chat` placeholder for now; Phase 03 swaps the landing).
- `/Users/lap16299/Documents/code/cube-playground/src/QueryBuilderV2/` (the playground entry that reads `?query=` / `?from-segment=`) — extend to also accept `?from-chat-artifact=<id>`: read `sessionStorage['gds-cube:pending-chat-deeplink:<id>']`, parse, hydrate playground store, clear the key. Show stale-link toast if missing. Exact file: whichever component currently reads the URL params (likely `src/QueryBuilderV2/playground-store-hydration.ts` or similar — implementer to scout on day 1).
- `/Users/lap16299/Documents/code/cube-playground/vite.config.ts` — confirm `/api` proxy already targets :3004; no change expected.
- `/Users/lap16299/Documents/code/cube-playground/.gitignore` — add `chat-service/runtime/` and `chat-service/.env`.

### CREATE — chat-service package

- `/Users/lap16299/Documents/code/cube-playground/chat-service/package.json`
- `/Users/lap16299/Documents/code/cube-playground/chat-service/tsconfig.json`
- `/Users/lap16299/Documents/code/cube-playground/chat-service/.env.example`
- `/Users/lap16299/Documents/code/cube-playground/chat-service/.gitignore`
- `/Users/lap16299/Documents/code/cube-playground/chat-service/README.md`
- `/Users/lap16299/Documents/code/cube-playground/chat-service/src/index.ts` — Fastify boot on :3005.
- `/Users/lap16299/Documents/code/cube-playground/chat-service/src/config.ts`
- `/Users/lap16299/Documents/code/cube-playground/chat-service/src/types.ts` — `CubeQuery`, `QueryArtifact`, `SseEvent`, `ToolContext`.
- `/Users/lap16299/Documents/code/cube-playground/chat-service/src/api/turn.ts` — POST `/agent/turn`.
- `/Users/lap16299/Documents/code/cube-playground/chat-service/src/api/sessions.ts` — GET/DELETE sessions.
- `/Users/lap16299/Documents/code/cube-playground/chat-service/src/api/health.ts` — GET `/health`.
- `/Users/lap16299/Documents/code/cube-playground/chat-service/src/core/claude-runner.ts`
- `/Users/lap16299/Documents/code/cube-playground/chat-service/src/core/intent-router.ts` — Phase 01 returns `{ skill: 'explore', confidence: 1, autoRoute: true }`.
- `/Users/lap16299/Documents/code/cube-playground/chat-service/src/core/mode-prompts.ts`
- `/Users/lap16299/Documents/code/cube-playground/chat-service/src/core/skill-loader.ts`
- `/Users/lap16299/Documents/code/cube-playground/chat-service/src/core/sse-stream.ts`
- `/Users/lap16299/Documents/code/cube-playground/chat-service/src/core/session-manager.ts`
- `/Users/lap16299/Documents/code/cube-playground/chat-service/src/core/cube-meta-cache.ts` — TTL-cached `/meta` per game (used by `emit_query_artifact` validation).
- `/Users/lap16299/Documents/code/cube-playground/chat-service/src/tools/registry.ts`
- `/Users/lap16299/Documents/code/cube-playground/chat-service/src/tools/get-cube-meta.ts`
- `/Users/lap16299/Documents/code/cube-playground/chat-service/src/tools/preview-cube-query.ts`
- `/Users/lap16299/Documents/code/cube-playground/chat-service/src/tools/emit-query-artifact.ts`
- `/Users/lap16299/Documents/code/cube-playground/chat-service/src/db/schema.sql`
- `/Users/lap16299/Documents/code/cube-playground/chat-service/src/db/migrate.ts`
- `/Users/lap16299/Documents/code/cube-playground/chat-service/src/db/chat-store.ts`
- `/Users/lap16299/Documents/code/cube-playground/chat-service/src/utils/build-chat-deeplink.ts` — sibling of `playground-deeplink.ts` for free-form Cube query (no segment shape).
- `/Users/lap16299/Documents/code/cube-playground/chat-service/.claude/commands/cube-playground.md` — master persona.
- `/Users/lap16299/Documents/code/cube-playground/chat-service/.claude/skills/explore/SKILL.md` — stub (full content in Phase 04).
- `/Users/lap16299/Documents/code/cube-playground/chat-service/test/intent-router.test.ts`
- `/Users/lap16299/Documents/code/cube-playground/chat-service/test/sse-stream.test.ts`
- `/Users/lap16299/Documents/code/cube-playground/chat-service/test/tool-emit-query-artifact.test.ts`
- `/Users/lap16299/Documents/code/cube-playground/chat-service/test/session-manager.test.ts`
- `/Users/lap16299/Documents/code/cube-playground/chat-service/test/chat-store.test.ts`
- `/Users/lap16299/Documents/code/cube-playground/chat-service/test/build-chat-deeplink.test.ts`
- `/Users/lap16299/Documents/code/cube-playground/chat-service/test/turn-flow.integration.test.ts` — mocked SDK, asserts full SSE order.
- `/Users/lap16299/Documents/code/cube-playground/chat-service/vitest.config.ts`

### CREATE — server proxy

- `/Users/lap16299/Documents/code/cube-playground/server/src/routes/chat.ts`
- `/Users/lap16299/Documents/code/cube-playground/server/test/chat-proxy.test.ts` — mocks chat-service with a tiny SSE server fixture.

### CREATE — FE

- `/Users/lap16299/Documents/code/cube-playground/src/api/chat-sse-client.ts` — `fetch()` + `body.getReader()` SSE parser, ~150 LOC. Returns `{ stream, cancel }`.
- `/Users/lap16299/Documents/code/cube-playground/src/api/__tests__/chat-sse-client.test.ts`
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Chat/chat-thread-page.tsx` — `/chat/:id` route, mounts shared view.
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Chat/components/chat-thread-view.tsx` — shared list (used by panel + page in Phase 03).
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Chat/components/chat-message-list.tsx`
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Chat/components/user-message.tsx`
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Chat/components/assistant-message.tsx`
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Chat/components/reasoning-trace.tsx`
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Chat/components/tool-call-chip.tsx`
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Chat/components/query-artifact-card.tsx`
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Chat/components/chat-composer.tsx` — auto-sizing textarea, Cmd/Ctrl+Enter, `compact` prop.
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Chat/components/typing-dots.tsx`
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Chat/hooks/use-chat-session.ts` — fetch+cache turns.
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Chat/hooks/use-chat-stream.ts` — wraps `chat-sse-client`.
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Chat/__tests__/query-artifact-card.test.tsx` — click → history.push assert.

### DELETE

None in Phase 01. `src/pages/ChatPlaceholder/chat-placeholder-page.tsx` stays as `/chat` landing until Phase 03 replaces it.

## Implementation Steps

### 1. Smoke-test SDK parity (risk gate — DO FIRST)

1. In a scratch dir, `npm i @anthropic-ai/claude-agent-sdk@latest`. Run `tsx scratch.ts` with `ANTHROPIC_BASE_URL` + key set against VNG LiteLLM. Confirm: (a) `query()` returns an async iterator, (b) tool registration works, (c) `--resume` accepts a UUID, (d) SDK does not require an interactive TTY. If any gap blocks Phase 01 design, raise to lead before scaffolding.
2. Commit: none (scratch only).

### 2. Scaffold chat-service package

1. Create `chat-service/package.json` with `"type": "module"`, scripts `dev` (`tsx watch src/index.ts`), `build` (`tsc`), `start` (`node dist/index.js`), `test` (`vitest run`), `typecheck` (`tsc --noEmit`). Dependencies: `fastify`, `@anthropic-ai/claude-agent-sdk`, `better-sqlite3`, `zod`, `zod-to-json-schema`, `gray-matter`, `lru-cache`, `uuid`, `async-mutex`. Dev: `tsx`, `typescript`, `vitest`, `@types/better-sqlite3`, `@types/node`.
2. Create `chat-service/tsconfig.json` extending root with `"module": "ESNext"`, `"moduleResolution": "Bundler"`, `"strict": true`, `"outDir": "dist"`.
3. Create `chat-service/.env.example` with: `PORT=3005`, `LOG_LEVEL=info`, `ANTHROPIC_BASE_URL=https://aawp-litellm-testing.vnggames.net`, `ANTHROPIC_API_KEY=`, `CHAT_MODEL=claude-sonnet-4-6`, `CHAT_MAX_OUTPUT_TOKENS=4096`, `SERVER_BASE_URL=http://localhost:3004`, `CUBE_API_URL=http://localhost:4000`, `CHAT_DB_PATH=./runtime/chat.db`, `CHAT_MAX_TURNS_PER_SESSION=40`, `CHAT_MAX_TOKENS_PER_TURN=8000`.
4. Create `chat-service/.gitignore` (`runtime/`, `.env`, `dist/`, `node_modules/`).
5. `npm --prefix chat-service install`. Run `npm --prefix chat-service run typecheck` (passes on empty `src/`).
6. **Commit:** `feat(chat-service): scaffold package + tsconfig`.

### 3. Types + config

1. `chat-service/src/types.ts`: export `CubeQuery` (shape per scout §5), `QueryArtifact` (per brainstorm §4.5), `SseEvent` union (10 variants), `ToolContext { ownerId, gameId, cubeToken, sessionId, turnId, sseEmitter }`, `ChatSessionRow`, `ChatTurnRow`.
2. `chat-service/src/config.ts`: read env, expose typed `Config` object, throw on missing required.
3. Run `tsc --noEmit`. 0 errors.

### 4. SQLite schema + store

1. `chat-service/src/db/schema.sql`: tables per brainstorm §4.7 — `chat_sessions`, `chat_turns`, `chat_audit`. Indices on `(owner_id, game_id, last_turn_at DESC)` and `(session_id, turn_index)`.
2. `chat-service/src/db/migrate.ts`: idempotent runner — `CREATE TABLE IF NOT EXISTS` from schema.sql, runs at boot.
3. `chat-service/src/db/chat-store.ts`: CRUD facade — `createSession`, `getSession`, `listSessions({ ownerId, gameId, limit })`, `archiveSession`, `appendTurn`, `listTurns(sessionId)`, `incrementTurnCount`.
4. `test/chat-store.test.ts`: in-memory SQLite (`:memory:`), assert CRUD + indices.
5. Run `tsc --noEmit && vitest run test/chat-store.test.ts`. 0 errors, tests pass.
6. **Commit:** `feat(chat-service): SQLite schema + chat-store facade`.

### 5. Session manager (per-session async mutex)

1. `core/session-manager.ts`: Map<sessionId, Mutex> via `async-mutex`. `tryAcquire(sessionId)` returns release fn or throws `TurnInProgressError`.
2. `test/session-manager.test.ts`: assert second `tryAcquire` on same id throws while first held; releases unblock.
3. `tsc --noEmit && vitest run test/session-manager.test.ts`. Pass.
4. **Commit:** `feat(chat-service): per-session async mutex`.

### 6. Cube meta cache

1. `core/cube-meta-cache.ts`: LRU `Map<gameId, { meta, fetchedAt }>` with 60 s TTL. `getMeta(gameId, cubeToken)` either returns cached or fetches via existing server-side helpers (chat-service has its own `cube-client.ts` lifted from server — keep DRY by reading via HTTP `GET ${SERVER_BASE_URL}/cubejs-api/v1/meta`).
2. No dedicated unit test in Phase 01; covered by `emit_query_artifact` validation tests.

### 7. SSE event mapper + Claude runner

1. `core/sse-stream.ts`: pure function `mapSdkMessage(msg): SseEvent | null`. Handles SDK Message variants (`text_delta`, `thinking_delta`, `tool_use`, `tool_result`, `message_stop`, etc.). Returns null for unmapped events.
2. `core/claude-runner.ts`: wraps `query()` from SDK. `run({ sessionId, systemPrompt, message, tools, toolContext })` returns `AsyncIterable<SseEvent>`. Injects `toolContext` into each tool handler via closure.
3. `test/sse-stream.test.ts`: feed fixture SDK messages, assert event types + payloads.
4. **Commit:** `feat(chat-service): SDK runner + SSE event mapper`.

### 8. Master command + explore skill stubs + mode-prompts + skill-loader + intent-router stub

1. `.claude/commands/cube-playground.md`: 30–60 line master persona — identity, output rules (always prefer business-metric YAML, never invent cube member names), tool allowlist defaults, refusal posture for non-analytics asks.
2. `.claude/skills/explore/SKILL.md`: minimal stub with frontmatter (`name`, `display_name`, `description`, `trigger_keywords`, `allowed_tools: [get_cube_meta, preview_cube_query, emit_query_artifact]`) + 1-paragraph body. Full content in Phase 04.
3. `core/skill-loader.ts`: walks `.claude/skills/*/SKILL.md`, parses frontmatter via `gray-matter`, caches in LRU (TTL 5 s).
4. `core/mode-prompts.ts`: `compose({ master, skill, game, contextPreamble? })` → string.
5. `core/intent-router.ts`: keyword stub — Phase 01 always returns `{ skill: 'explore', confidence: 1, autoRoute: true }`. Full router in Phase 04.
6. `test/intent-router.test.ts`: smoke that stub returns `explore` for any input.
7. `tsc --noEmit && vitest run`. Pass.
8. **Commit:** `feat(chat-service): master command + explore skill + prompt composer`.

### 9. Tool: get_cube_meta

1. `tools/get-cube-meta.ts`: input `z.object({ scope: z.enum(['full','compact']).default('compact') })`. Handler calls `cube-meta-cache.getMeta(ctx.gameId, ctx.cubeToken)`, optionally compacts.
2. Register in `tools/registry.ts` with Zod-to-JSON-Schema conversion.
3. No unit test (integration covers it).

### 10. Tool: preview_cube_query

1. `tools/preview-cube-query.ts`: input `z.object({ query: CubeQuerySchema, limit: z.number().int().min(1).max(50).default(10) })`. Handler runs `cube-client.load({ ...query, limit })` and returns `{ rows, rowCount, warnings }`. Soft-cap at 50 even if LLM requests more.
2. Brief unit test asserting limit is capped (mocked Cube fetch).

### 11. Tool: emit_query_artifact (the contract)

1. `utils/build-chat-deeplink.ts`: pure module, mirrors `playground-deeplink.ts` shape but accepts a free-form Cube query. Returns `{ url, via, artifactId, payload }`. Inline url encodes JSON in `#/build?query=...`; falls back to `#/build?from-chat-artifact=<artifactId>` + caller-side sessionStorage write when JSON > 8000 chars. **Phase 01 ships BOTH paths end-to-end** (user decision 2026-05-23): FE `QueryArtifactCard` click handler writes `sessionStorage.setItem('gds-cube:pending-chat-deeplink:<artifactId>', JSON.stringify(payload))` before navigation, and the `/build` page is taught to consume the new `from-chat-artifact=<id>` key on mount (read + clear sessionStorage, hydrate playground store; show "this link has expired" toast if the key is missing — e.g. user refreshed long after click).
2. `tools/emit-query-artifact.ts`: input Zod schema for `title`, `summary`, `query`, `source`, `sourceRef?`. Handler:
   - Validates `query.measures` / `query.dimensions` / `query.timeDimensions[*].dimension` against `cube-meta-cache.getMeta(ctx.gameId)`. On unknown member → `{ ok: false, error: 'unknown_member', detail }`.
   - Builds `deeplinkUrl` via `build-chat-deeplink`.
   - Calls `ctx.sseEmitter.emit('query_artifact', artifact)`.
   - Returns `{ id, deeplinkUrl }`.
3. `test/tool-emit-query-artifact.test.ts`: covers (a) valid query → artifact emitted, (b) unknown measure → error, (c) deeplink size cap.
4. `test/build-chat-deeplink.test.ts`: covers inline + size-cap.
5. **Commit:** `feat(chat-service): 3 critical-path tools (get_cube_meta, preview_cube_query, emit_query_artifact)`.

### 12. API handler: POST /agent/turn

1. `api/turn.ts`: validate body, acquire mutex (else 409), open SSE stream, create session if `session_id` null + emit `session_created`, run runner, persist turn on `result`, release mutex in `finally`.
2. `api/sessions.ts`: GET list, GET detail, DELETE.
3. `api/health.ts`: `{ ok: true, db: <true|false> }`.
4. `src/index.ts`: register routes, run `migrate()`, listen on `PORT`.
5. `test/turn-flow.integration.test.ts`: spins up Fastify (no listen), mocks SDK to emit canned messages including a tool call to `emit_query_artifact`, asserts ordered SSE events on a test consumer.
6. `tsc --noEmit && vitest run`. Pass.
7. **Commit:** `feat(chat-service): /agent/turn handler + sessions + health`.

### 13. Server proxy

1. `server/src/routes/chat.ts`: Fastify plugin. Routes:
   - POST `/api/chat/sessions/:id/turn` (`:id` may be the literal string `new` for create).
   - GET `/api/chat/sessions`
   - GET `/api/chat/sessions/:id`
   - DELETE `/api/chat/sessions/:id`
2. POST handler:
   - Resolve cube token: `resolveCubeTokenForGame(req.body.game)` → 503 if null.
   - Open upstream `POST ${CHAT_SERVICE_URL}/agent/turn` with headers `X-Cube-Token`, `X-Cube-Game`, `X-Owner-Id`, body forwarded as JSON.
   - Set response `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`. Disable Fastify reply buffering (`reply.raw.write` + `reply.hijack()`).
   - Pipe upstream `res.body` to client as `Readable.fromWeb`.
   - On client abort, propagate to upstream (`AbortController`).
3. GET/DELETE handlers: plain JSON proxy.
4. Register in `server/src/index.ts` (add `await app.register(chatRoutes);`).
5. `server/test/chat-proxy.test.ts`: fake upstream that writes 3 SSE events; client reads them.
6. `npm --prefix server run typecheck && npm --prefix server test`. Pass.
7. **Commit:** `feat(server): /api/chat proxy with cube-token injection and SSE pass-through`.

### 14. FE: SSE client + shared thread + composer + /chat/:id route

1. `src/api/chat-sse-client.ts`: `openChatTurn({ sessionId, message, game, context? })` returns `{ stream: AsyncIterable<SseEvent>, cancel: () => void }`. Uses `fetch` + `body.getReader()` + `TextDecoder` + line-buffered SSE parser. Handles `session_created` by yielding before subsequent events.
2. `src/api/__tests__/chat-sse-client.test.ts`: feed mocked `ReadableStream`, assert dispatched events.
3. `src/pages/Chat/hooks/use-chat-session.ts`: fetch `/api/chat/sessions/:id` once, cache in `useState`; expose `refetch`.
4. `src/pages/Chat/hooks/use-chat-stream.ts`: wraps `chat-sse-client`. Returns `{ status, currentText, currentReasoning, currentArtifacts, sendTurn, cancel }`.
5. `src/pages/Chat/components/chat-composer.tsx`: textarea (24–240 px auto-grow), Cmd/Ctrl+Enter to send, Esc to blur, `compact` prop. Mirror Hermes structure.
6. `src/pages/Chat/components/typing-dots.tsx`: simple `…` animation.
7. `src/pages/Chat/components/user-message.tsx`, `assistant-message.tsx`, `tool-call-chip.tsx`, `reasoning-trace.tsx`, `query-artifact-card.tsx`, `chat-message-list.tsx`, `chat-thread-view.tsx`: render discriminated union of sections (`text`, `reasoning`, `tool_call`, `tool_result`, `query_artifact`).
8. `query-artifact-card.tsx` click handler: if `artifact.deeplinkVia === 'session-storage'`, write payload first; then `history.push(artifact.deeplinkUrl)`. Use `useHistory()` from `react-router-dom` v5.
9. `src/pages/Chat/chat-thread-page.tsx`: route `/chat/:id` — read `:id` from params, mount `<ChatThreadView/>` + `<ChatComposer/>`. If `:id` === `'new'`, render empty state.
10. `src/index.tsx`: add `<Route key="chat-thread" path="/chat/:id" component={ChatThreadPage} />` after the existing `/chat` route.
11. `src/pages/Chat/__tests__/query-artifact-card.test.tsx`: render card with stub artifact, assert click navigates.
12. `npm run typecheck && npm run test`. Pass.
13. **Commit:** `feat(chat): SSE client + shared thread view + /chat/:id route + query-artifact card`.

### 15. Wire env + dev:all

1. Update root `.env.example` with `CHAT_SERVICE_URL=http://localhost:3005`, `CHAT_FEATURE_ENABLED=true`.
2. Update root `package.json` `dev:all` to also spawn chat-service: `concurrently -n vite,server,chat -c blue,green,magenta "npm run dev" "npm --prefix server run dev" "npm --prefix chat-service run dev"`.
3. Update `.gitignore` to exclude `chat-service/runtime/` and `chat-service/.env`.
4. **Commit:** `chore: include chat-service in dev:all + env example`.

### 16. End-to-end smoke (manual)

1. Set `chat-service/.env` with VNG LiteLLM key.
2. `npm run dev:all`. Verify Vite + server + chat-service all up.
3. Navigate to `/chat/new`, type "show daily revenue last 7 days", press Cmd+Enter.
4. Confirm SSE events stream into UI: thinking → tool_call (`get_cube_meta`) → tool_result → tool_call (`preview_cube_query`) → tool_result → tool_call (`emit_query_artifact`) → query_artifact card visible → done.
5. Click the card → URL changes to `#/build?query=…` and `/build` renders the query.
6. Refresh `/chat/<id>` → conversation rehydrates (calls `GET /api/chat/sessions/:id`).
7. Open a second turn while one is streaming → server returns 409.

## Todo List

- [ ] 1. SDK parity smoke-test against VNG LiteLLM
- [ ] 2. Scaffold `chat-service/` package + tsconfig + `.env.example` + `.gitignore`
- [ ] 3. Types + config module
- [ ] 4. SQLite schema, migrator, `chat-store` facade + tests
- [ ] 5. `session-manager` (async-mutex) + tests
- [ ] 6. `cube-meta-cache` TTL store
- [ ] 7. SSE event mapper + Claude runner wrapper + tests
- [ ] 8. Master command + `explore` skill stub + `skill-loader` + `mode-prompts` + `intent-router` stub + tests
- [ ] 9. Tool: `get_cube_meta`
- [ ] 10. Tool: `preview_cube_query` + cap test
- [ ] 11. Tool: `emit_query_artifact` + `build-chat-deeplink` util + tests
- [ ] 12. API handlers (turn, sessions, health) + integration test
- [ ] 13. Server proxy `/api/chat/*` + cube-token injection + SSE pass-through + test
- [ ] 14. FE: `chat-sse-client` + `useChatStream` + `ChatThreadView` + `ChatComposer` + `QueryArtifactCard` + `/chat/:id` route + tests
- [ ] 15. Wire `dev:all` + env example + `.gitignore`
- [ ] 16. Manual end-to-end smoke; verify click-through to `/build`
- [ ] 17. Final `tsc --noEmit` clean across root, server, chat-service; full Vitest run green

## Success Criteria

- All Vitest suites green in root, server, chat-service.
- `tsc --noEmit` clean in all three packages.
- Manual smoke (step 16) renders a clickable `QueryArtifactCard` and clicking opens `/build` with the same query.
- 409 returned on concurrent turn against same session.
- `chat.db` survives chat-service restart and `/chat/:id` rehydrates the prior turn list.
- Server proxy strips no headers besides auth-injection rewrites; SSE stream is delivered chunked (verify with `curl -N`).

## Risk Assessment

| Risk (from brainstorm §12) | Mitigation in this phase |
|---|---|
| Claude SDK Node parity gaps | **Smoke test PASSED 2026-05-23**: `@anthropic-ai/claude-agent-sdk@0.3.150` against VNG LiteLLM proxy returned correct "pong" in 5.9 s end-to-end (TTFT 2.4 s, API 2.1 s, subprocess startup ~1.5 s). `query()` returns async iterable as expected; `model: 'claude-sonnet-4-6'` accepted; LiteLLM proxy reachable. NEW finding to address in step 1: SDK is the Claude Code binary wrapped — inherits host `~/.claude/` settings + hooks + 60+ builtin tools by default. Must isolate via `HOME=<chat-service/runtime/claude-home>` env, `pathToClaudeCodeExecutable` override if needed, and a stricter tool whitelist (per-skill `allowedTools`, not just `disallowedTools`). |
| Subprocess cold-start latency | ~1.5 s per turn observed in smoke. Acceptable for Phase 01. Phase 06 polish item: investigate pre-warmed subprocess pool or session resume to amortise startup across turns within one session. |
| Host `~/.claude/` leakage | Set `HOME=$(pwd)/runtime/claude-home` for the SDK subprocess (or use the SDK option to specify config dir if exposed). Phase 01 must seed `runtime/claude-home/.claude/settings.json` with hooks disabled + an explicit tools allowlist. |
| LLM produces invalid Cube query JSON | `emit_query_artifact` Zod-validates measures/dimensions against `cube-meta-cache`; rejects unknown members → LLM retries. |
| Concurrent turns | `session-manager` async-mutex; second POST → 409. |
| Cube backend down | `get_cube_meta` is canary; on throw the agent receives `{ ok: false, error }` and surfaces friendly message instead of looping. |
| Reasoning trace leaks PII | `preview_cube_query` soft-caps 50 rows; tool-result summaries return row counts only, not raw rows. Skill prompts (Phase 04) reinforce. |
| Multi-game schema bloat | Session pinned to one `game_id`; meta cache keyed by `gameId`. |
| Deeplink URL > 8 KB | `build-chat-deeplink` falls back to sessionStorage path; FE click handler writes payload before nav; `/build` page reads + clears on mount. Stale-link toast covers refresh-after-close edge case. |
| Server proxy buffers SSE | Set `X-Accel-Buffering: no`, `reply.hijack()`, `Readable.fromWeb` pipe — verified in `chat-proxy.test.ts`. |

## Security Considerations

- chat-service NEVER touches env tokens directly; it accepts `X-Cube-Token` per request from the server proxy. Token TTL is whatever server mints (existing behaviour).
- chat-service NEVER writes/reads files outside `runtime/`. `disallowed_builtin_tools` includes `Read`, `Write`, `Bash`, `WebFetch` in SDK options — advisory service only.
- Owner-header is forwarded verbatim from server (matches existing dev posture documented in `server/src/middleware/owner-header.ts`). Production hardening lives in Phase 06.
- Session ownership: chat-service refuses to read a session whose `owner_id` differs from the request's `X-Owner-Id`. Tests cover this.
- LLM credentials only via VNG LiteLLM proxy. No direct Anthropic fallback. `.env.example` must not include keys.

## Next Steps

- Unblocks: Phase 02 (extended tool surface — slot 5 more tools into the registry), Phase 03 (UI surfaces — reuse `ChatThreadView` + `ChatComposer`), Phase 04 (skill expansion — explore skill body becomes real).
- Dependencies: requires VNG LiteLLM key procured before manual smoke step.

## Unresolved Questions

1. ~~Compact `get_cube_meta` shape~~ **RESOLVED 2026-05-23:** return raw `/meta` JSON in Phase 01.
2. ~~Whether `/build` page accepts the new `from-chat-artifact=<id>` sessionStorage key in Phase 01 or Phase 03~~ **RESOLVED 2026-05-23:** ship in Phase 01 (both inline + sessionStorage paths end-to-end).
3. Whether to throw on second concurrent turn (HTTP 409) or surface as SSE `error` event then close. Brainstorm §17 row 5 says 409 — applied at HTTP layer.
