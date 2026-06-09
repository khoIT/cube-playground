---
title: "Per-game pre-generated starter questions"
description: "Generate + persist chat starter questions per (workspace, game) from cube meta — deterministic baseline + async LLM refine, static fallback."
status: completed
priority: P2
effort: 16h
branch: main
tags: [chat, chat-service, cube-meta, llm, starters]
created: 2026-06-05
---

# Per-game pre-generated starter questions

Replace the 18 static, identical-for-every-game starter questions with a per-(workspace, game) set
derived from that game's semantic-layer data (cube `/meta`). Hybrid generation: a deterministic
template engine produces an instant baseline from available members; an async LLM pass refines it.
Both stages persist to `chat.db`. Lazy trigger on first request, regenerate only when the game's
cube-meta hash changes, serve stale-while-revalidate. Static 18 stay as fallback (zero regression).

## Data flow (one line)

FE empty-hero / overlay chips → `GET /api/chat/starter-questions?game=` (proxy forwards X-Cube-Workspace + x-cube-game)
→ chat-service reads/writes `starter_question_sets` keyed by (workspace, game, meta_hash) → on miss/stale
fires template gen (sync, persisted) + LLM refine (fire-and-forget, persisted) → returns `{questions, source, status}`.

## Phases

| # | Phase | Status | Effort | Summary |
|---|-------|--------|--------|---------|
| 1 | [Schema + store + template engine](phase-01-schema-store-template-engine.md) | completed | 5h | `starter_question_sets` table, store module, deterministic template engine keyed on member availability |
| 2 | [Generation route + staleness + LLM refine](phase-02-generation-route-staleness-llm-refine.md) | completed | 4h | `GET /starter-questions` route, meta-hash staleness, single-flight, LLM refinement with strict validation |
| 3 | [Main-server proxy + FE fetch hook + empty-hero](phase-03-proxy-fe-hook-empty-hero.md) | completed | 3h | twin proxy handler (forward game), `use-generated-starters` hook, empty-hero integration w/ static fallback |
| 4 | [Overlay suggestion chips](phase-04-overlay-chips.md) | completed | 1h | sidebar chat-overlay 3 chips pull top-3 from generated set, static fallback |
| 5 | [Tests sweep + docs](phase-05-tests-and-docs.md) | completed | 3h | 33 new tests (28 chat-service + 5 FE), API-surface doc row added |

## Build notes (deltas from plan)

- Refiner model: user picked Opus — `CHAT_STARTER_REFINER_MODEL`, default `claude-opus-4-8` (not chatModel/titleModel).
- Lease semantics hardened during testing: `upsertSet` PRESERVES an in-flight lease (a concurrent template write must not wipe it → double LLM fire); refiner always releases in `finally`.
- Code-review M2 applied: second `getMeta` in the miss path wrapped in try/catch (never-500 contract holds across mid-request TTL expiry).

## Key dependencies

- Phase 2 blocked by Phase 1 (store + template engine).
- Phase 3 blocked by Phase 2 (route contract must exist).
- Phase 4 blocked by Phase 3 (reuses the same FE hook).
- Phase 5 blocked by Phases 1-4 (tests the final code).

## Locked decisions (do not change)

1. Hybrid: deterministic template baseline + async LLM refine; both persist.
2. Lazy + meta-hash staleness; stale-while-revalidate; never block page on LLM.
3. Fallback: existing static 18 when no generated set exists. Zero regression.
4. Both surfaces: /chat empty-hero grid AND sidebar overlay 3 chips (top-3).

## Key design decisions (made during planning)

- Reuse existing `computeMetaVersion` / `getMetaVersion` in `cube-meta-cache.ts` as the meta hash — no new hash code.
- Reuse `summariseTitle`'s Agent-SDK `callLlm` pattern (deps-injected, fire-and-forget) for the refine pass.
- Generated questions keep the EXACT `StarterQuestion` shape (id/text/personaTags/categoryTags/targetCatalogIds)
  so the existing persona filter + `persona-histogram` ranking work unchanged on the FE.
- No CI catalog-resolve gate exists today (scout assumption corrected). Validation lives server-side:
  reject any LLM member not in `extractMemberNames(meta)`; template engine only emits members it read from meta.
