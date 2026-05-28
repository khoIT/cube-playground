---
phase: 7
title: "Chat-service workspace awareness"
status: pending
priority: P2
effort: "1.5d"
dependencies: [1, 4]
---

# Phase 7: Chat-service workspace awareness

## Overview
Extend the workspace concept into the separate `chat-service/` microservice (port 3005) so
that chat answers/queries follow the user's active workspace and chat sessions are isolated
per workspace. Closes the wiring gap where today chat-service has its own single
`CUBE_API_URL` config and would silently desync from the frontend's active workspace.

## Requirements
- Functional: every chat request runs against the workspace the frontend selected; chat
  sessions/messages persist with `workspace_id` and the session list is workspace-filtered.
- Non-functional: mirror Phase 1's per-request ctx pattern (no global config switch); reuse
  existing `chat_sessions` table + idempotent migration helper.

## Architecture
- **Header forwarding (frontend → chat-service):** `src/api/chat-sse-client.ts` (`openChatTurn`
  line 349) — add `X-Cube-Workspace` to `reqHeaders` (line 360-371), value from
  `WorkspaceContext` (Phase 2). The chat-overlay caller threads it down.
- **Chat-service request hook:** `chat-service/src/routes/turn.ts:96-108` — parse
  `X-Cube-Workspace` alongside the existing `X-Cube-Token` / `X-Cube-Game` / `X-Owner-Id`.
  Pass `workspaceId` into the `ToolContext` constructed for the turn.
- **Per-request Cube ctx:** add optional `workspaceId` to `ToolContext` (chat-service types);
  `preview-cube-query.ts:125-132` and `refresh-cached-artifacts.ts` `runCubeLoad` set
  `X-Cube-Workspace` on outbound calls to Cube. (Per Phase 1, the upstream Fastify server
  routes by this header; for direct calls to prod from chat-service, the URL/auth come from a
  workspace resolver — mirror Phase 1's `resolveWorkspace(id)` pattern in chat-service.)
- **Meta-cache key:** `chat-service/src/core/cube-meta-cache.ts:32` — expand cache key from
  `gameId` to `${workspaceId}#${gameId}` so prod meta and local meta don't collide.
- **Session isolation:** migrate `chat_sessions` — add `workspace_id TEXT` via
  `addColumnIfMissing` in `chat-service/src/db/migrate.ts:43`; rebuild index as
  `idx_sessions_owner_workspace_game (owner_id, workspace_id, game_id, last_turn_at DESC)`.
  `chat-store.ts` — `createSession`/`listSessionsByGame`/`getSession` accept + filter
  `workspaceId`. Backfill existing rows to `'local'`.
- **Workspace registry sharing:** chat-service reads the same `workspaces.config.json` via the
  Phase 1 loader (copy or via a shared lib) so resolution + SSRF guard are identical.

## Related Code Files
- Modify (chat-service):
  - `chat-service/src/routes/turn.ts` (header parse + ToolContext)
  - `chat-service/src/core/cube-meta-cache.ts` (cache key + header)
  - `chat-service/src/tools/preview-cube-query.ts` (header on `/load`)
  - `chat-service/src/cache/refresh-cached-artifacts.ts` (RefreshDeps + `runCubeLoad`)
  - `chat-service/src/db/schema.sql` + `chat-service/src/db/migrate.ts` (add `workspace_id`)
  - `chat-service/src/db/chat-store.ts` (CRUD with workspace)
  - `chat-service/src/config.ts` (workspace resolver — port Phase 1 loader)
  - `chat-service/src/core/types.ts` (`ToolContext.workspaceId?`)
- Modify (frontend):
  - `src/api/chat-sse-client.ts:349` (`openChatTurn` adds `X-Cube-Workspace` header)
  - chat-overlay call sites (`src/shell/chat-overlay/*`) pass active workspace from context

## Implementation Steps
1. Port Phase 1's workspace resolver into chat-service (shared `workspaces.config.json`).
2. Add `workspace_id` migration to chat-service schema; expand the sessions index; backfill.
3. Parse `X-Cube-Workspace` in `turn.ts`; thread through `ToolContext`.
4. Update `cube-meta-cache` key + outbound Cube calls to include workspace.
5. Update `chat-store` CRUD to accept/filter `workspaceId`.
6. Frontend: add header in `chat-sse-client.ts`; thread workspace from `WorkspaceContext` at
   chat-overlay call sites.
7. Verify: switching workspaces hides other-workspace sessions; chat answers reflect the
   correct meta (e.g. cfm prefixes on prod); pre-existing sessions backfilled to `local`.

## Success Criteria
- [ ] Every `POST /agent/turn` carries `X-Cube-Workspace`; chat-service forwards it on
      outbound Cube calls.
- [ ] `cube-meta-cache` keyed by `(workspace, game)`; no cross-workspace meta bleed.
- [ ] `chat_sessions` has `workspace_id`; session list filtered by active workspace;
      pre-existing sessions backfilled to `'local'`.
- [ ] Switching workspaces in the UI swaps the chat session list and grounds new turns in
      the new workspace's meta — no silent desync.

## Risk Assessment
- **Config drift between Fastify server + chat-service** — both must read the same
  `workspaces.config.json`. Pick a single canonical path or extract a tiny shared package to
  avoid divergence.
- **Pre-existing chat sessions referencing local cube names** — backfilling to `'local'`
  keeps them visible only on the local workspace (correct). Document for users.
- **In-flight turns during a workspace switch** — frontend should disable the switcher while a
  turn is streaming, or queue switch until the SSE stream closes; otherwise mid-turn meta
  changes can produce incoherent answers.
