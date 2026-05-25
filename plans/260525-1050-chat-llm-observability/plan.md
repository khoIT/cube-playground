---
title: "Chat LLM Observability — Triage UI + Langfuse Mirror"
description: "Per-LLM-call capture for chat-service with /dev/chat-audit triage UI and env-gated Langfuse Cloud mirror"
status: pending
priority: P2
effort: 22h
branch: main
tags: [chat-service, observability, langfuse, sqlite, triage, dev-ui]
created: 2026-05-25
---

## Goal

Engineer opens `/dev/chat-audit` → picks a past chat session → drills into a turn → sees every LLM call (tokens/cost/latency/content/thinking), every tool invocation (args/result/latency), and the raw SDK event firehose. Same data mirrored to Langfuse Cloud when env keys present.

## Locked Decisions (do not revisit)

1. Storage: SQLite primary (source of truth) + Langfuse mirror (env-gated, no-op when absent).
2. UI: triage-grade only (session list → turn timeline → expandable JSON). No cross-session aggregates — Langfuse owns that.
3. Backfill: pre-feature sessions render with degraded detail + `legacy` badge.
4. Access: reuse `X-Owner-Id` header. Owner sees own sessions only.
5. Branch: main. Files < 200 LOC.

## Phase Map

| # | Phase | Effort | Status | Owner-file boundary |
|---|---|---|---|---|
| 01 | [DB migrations + chat_turns columns](./phase-01-db-migrations.md) | 2h | pending | `chat-service/src/db/*` |
| 02 | [Observer contract + claude-runner hook](./phase-02-observer-hook.md) | 3h | pending | `chat-service/src/core/claude-runner.ts`, `src/observability/observer-types.ts` |
| 03 | [SQLite trace recorder](./phase-03-sqlite-recorder.md) | 2h | pending | `chat-service/src/observability/llm-trace-recorder.ts`, `*-store.ts` |
| 04 | [Langfuse mirror (env-gated)](./phase-04-langfuse-mirror.md) | 3h | pending | `chat-service/src/observability/langfuse-tracer.ts` |
| 05 | [turn.ts composite observer wiring](./phase-05-turn-wiring.md) | 1.5h | pending | `chat-service/src/api/turn.ts`, `src/observability/composite-observer.ts` |
| 06 | [Debug API + main-server proxy pass-through](./phase-06-debug-api.md) | 3h | pending | `chat-service/src/api/debug.ts`, `server/src/routes/chat.ts` |
| 07 | [Frontend triage UI at /dev/chat-audit](./phase-07-frontend-triage-ui.md) | 5h | pending | `src/pages/DevAudit/*`, `src/index.tsx` |
| 08 | [Cross-cutting tests](./phase-08-tests.md) | 2.5h | pending | `chat-service/test/observability/*`, `src/pages/DevAudit/__tests__/*` |

## Dependency Graph

```
01 ──┬─► 02 ──► 03 ──┐
     │         04 ──┼──► 05 ──► 06 ──► 07
     │               │
     └───────────────┘                 ▲
                                       │
                                  08 (each phase contributes its own test slice)
```

- 02 depends on 01 (turn columns + tables in place).
- 03, 04 are parallel after 02 (different files, share only ObserverHooks contract).
- 05 needs 03+04.
- 06 needs 01 (schema for reads); can start before 05 in parallel.
- 07 needs 06 (API to call). 06's main-server proxy diff lives in `server/src/routes/chat.ts` (already touched by chat proxy — single file owner).
- 08 fans out across all phases; planner permits inline mini-tests per phase and one cross-cutting integration test in phase 08.

## Cross-cutting Constraints (must echo in every affected phase)

- User-facing SSE event types byte-identical from FE perspective (no new SSE types yielded from runner).
- chat_turns / chat_sessions migrations are ADDITIVE only.
- All files < 200 LOC; split when exceeded.
- Service boots without `LANGFUSE_*` env vars.
- Reuse `X-Owner-Id`; no new auth surface.
- Don't modify `chat-service/src/api/sessions.ts` (user-facing chat UI), `src/pages/Chat/*`, or existing `src/index.tsx` routes.

## Success Criteria (feature-level)

- POST /agent/turn unchanged byte-for-byte from existing FE client perspective.
- After one new turn, `/dev/chat-audit` shows that session → turn with N llm_calls, M tool_invocations, raw SDK events.
- Legacy pre-feature sessions render with `legacy` badge and no per-step detail; no errors.
- With `LANGFUSE_PUBLIC_KEY` + `LANGFUSE_SECRET_KEY` set, one trace per turn appears in Langfuse Cloud; without keys, service still boots and turns run.

## Rollback

Each phase is reversible. Phase 01 migrations are additive and never read by older code paths. Phases 02–05 can be disabled by removing the `observer` param at the turn.ts call site (one-line revert). Phase 06–07 routes can be unregistered without affecting chat. No data migration needed on revert.
