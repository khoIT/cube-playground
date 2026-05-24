---
title: "Chat Stream Resume Across Views (Phase 1 client hoist + Phase 2 server replay)"
description: "Make Cube chat SSE stream survive module switches (Phase 1) and same-tab page refresh (Phase 2). Both views (right side-panel + /chat/:id) bind to the same live state."
status: completed
priority: P1
effort: ~4-5d (Phase 1 ~2d, Phase 2 ~2-3d)
branch: "main"
tags: [chat, sse, zustand, chat-service, ring-buffer, ux-resume]
blockedBy: []
blocks: []
created: "2026-05-24T15:29:47.285Z"
completed: "2026-05-24T23:33:00.000Z"
createdBy: "ck:plan"
source: skill
slug: chat-stream-resume
---

# Chat Stream Resume Across Views

## Overview

Today, switching modules mid-generation makes the side panel show empty until `done`. Cause: streaming state lives inside React local state of whichever view (`/chat/:id` page OR side-panel) mounted the SSE hook. No server replay either, so refresh is also broken. This plan ships fix in two phases: client-side state hoist via Zustand (Phase 1, fixes module switch), then server-side in-memory replay registry (Phase 2, fixes same-tab refresh).

Source brainstorm: [`brainstorm-260524-2216-chat-stream-resume.md`](../reports/brainstorm-260524-2216-chat-stream-resume.md) — locked design.

## Non-Goals

- Cross-tab or cross-device resume.
- Surviving chat-service process restart.
- Incremental DB writes per chunk.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Spike: verify open Qs](./phase-01-spike-verify-open-qs.md) | Completed |
| 2 | [Client store + useChatStream refactor](./phase-02-client-store-usechatstream-refactor.md) | Completed |
| 3 | [Bind both views + invalidate on done](./phase-03-bind-both-views-invalidate-on-done.md) | Completed |
| 4 | [Phase 1 tests (S1-S3 S5)](./phase-04-phase-1-tests-s1-s3-s5.md) | Completed |
| 5 | [Server stream-registry + uuid turnId](./phase-05-server-stream-registry-uuid-turnid.md) | Completed |
| 6 | [Replay endpoint + activeTurnId + proxy](./phase-06-replay-endpoint-activeturnid-proxy.md) | Completed |
| 7 | [Client attach-replay + Phase 2 tests (S4)](./phase-07-client-attach-replay-phase-2-tests-s4.md) | Completed |

## Success Criteria

- S1. Submit prompt → switch module within 200ms → return within 3s: side panel shows accumulated text + continues live.
- S2. Submit prompt → switch to `/chat/:id` main view mid-stream: main view shows accumulated text + continues live.
- S3. On `done`, final assistant message in both views matches `GET /api/chat/sessions/:id` payload exactly.
- S4. Refresh page mid-stream: within 1s of mount, chat view re-attaches and shows buffered events + live tail. (Phase 2)
- S5. No duplicate SSE connections per turn (verified via DevTools network panel).

## Dependencies

No external cross-plan dependencies. Touches files owned by chat surface: `src/pages/Chat/hooks/*`, `src/shell/chat-overlay/*`, `src/stores/`, `src/api/chat-sse-client.ts`, `chat-service/src/`, `server/src/routes/chat.ts`.

## Validation Log

### Verification Results (Session 1, 2026-05-24)
- **Tier:** Full (7 phases → all 4 roles, 15+ claims/phase)
- **Claims checked:** 22
- **Verified:** 19 | **Failed:** 1 | **Unverified:** 2

#### Verified (selected)
- `chat-service/src/api/turn.ts:227` → `turnId = sessionId + ':' + (userTurnIndex + 1)` (Phase 1/5 claim).
- `rg turnId.split` returns nothing across `chat-service/src/` → UUID v4 migration safe (Phase 5 contract).
- `chat-store.ts:296` `insertAudit` accepts opaque turnId string (Phase 5 sanity check).
- `server/src/routes/chat.ts:113-209` SSE proxy pattern present and pipes through (Phase 6 reuse).
- `chat-service/src/api/sessions.ts` is the session-fetch handler (Phase 6 `activeTurnId` injection site).
- `src/shell/chat-overlay/use-panel-chat-state.ts` already consumes `useChatStream` (Phase 3 plumbing intact).

#### Failed
1. [Fact Checker] Phase 3 line 51 says main view is "likely `src/pages/Chat/ChatPage.tsx` or similar". Actual: `src/pages/Chat/chat-thread-page.tsx`. → Resolved via Q2 (Phase 3 updated).

#### Unverified
1. [Scope Auditor] Compact-service swaps sessionId mid-turn (`chat-service/src/api/turn.ts:95-113`); Phases 5-7 do not address the swap. Refresh during compact transition would fail `findRunning(oldSessionId)`. → Resolved via Q1 (alias-map added to Phase 5/6).
2. [Contract Verifier] No `playwright.config.*` found in repo; Phase 4 Playwright path likely unsupported. → Resolved via Q5 (JSDOM-only commitment).

### Decisions (Session 1)
1. **Compact gap → alias map (Q1):** Stream registry tracks `oldSessionId → newSessionId` alias for active turns. `findRunning(sessionId)` resolves alias before lookup. Inlined into Phase 5 (registry capability) + Phase 6 (findRunning resolves alias). No new phase file.
2. **Phase 3 main view path (Q2):** Update Related Code Files to `src/pages/Chat/chat-thread-page.tsx`.
3. **Ring-buffer defaults (Q3):** Accept N=2000 / M=100 / TTL=300s. Surface via chat-service config so they tune without redeploy. Reflected in Phase 5.
4. **startTurn guard (Q4):** Silent no-op when `streams[sessionId]?.status === 'streaming'`. Composer disable already covers UX. Removes the "no-op or throw — pick & document" ambiguity in Phase 2.
5. **SSE parser DRY (Q5):** Extract shared `parseSseFromResponse(response, signal)` in `chat-sse-client.ts`. Phase 7 adds a focused unit test for the helper.
6. **E2E testing (Q6):** Commit to JSDOM-only for cross-view tests. Playwright fallback wording dropped from Phase 4.
7. **409 overflow UX (Q7):** Toast "some output skipped, resuming" + auto-restart from `availableFromOffset` (one retry). Phase 7 already drafts this; wording locked.

### Recommendation
**Proceed.** Verification failures all resolved by Session 1 decisions. No unresolved blockers.
