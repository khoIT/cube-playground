---
title: "Cube Playground Chat Agent"
description: "Monet-style Node chat-agent microservice with SSE streaming, Cube-aware tools and clickable query-artifact deeplinks into /build."
status: pending
priority: P1
effort: ~18-22d
branch: new_design
tags: [chat-agent, claude-sdk, sse, cube, microservice, fastify, sqlite]
created: 2026-05-23
slug: cube-playground-chat-agent
---

# Plan — Cube Playground Chat Agent

Goal: ship a separate `chat-service/` (Node + `@anthropic-ai/claude-agent-sdk`) that turns natural-language playground questions into clickable Cube-query cards. The card click pushes the user into `/build` with the exact query loaded.

Brainstorm (full design + validation): `plans/reports/brainstorm-260523-1643-cube-playground-chat-agent.md` (§17 = locked decisions).

## Context Links

- Brainstorm: `/Users/lap16299/Documents/code/cube-playground/plans/reports/brainstorm-260523-1643-cube-playground-chat-agent.md`
- Scout (server + deeplink + sidebar surface): `/Users/lap16299/Documents/code/cube-playground/plans/reports/scout-260523-1643-cube-playground-chat-surface.md`
- Scout (Hermes chat UI primitives): `/Users/lap16299/Documents/code/cube-playground/plans/reports/scout-260523-1716-hermes-chat-ui.md`
- Scout (Monet reference architecture): `/Users/lap16299/Documents/code/cube-playground/plans/reports/scout-260523-1643-monet-chat-agent.md`

## Phases

| # | File | Title | Status |
|---|---|---|---|
| 01 | [phase-01-chat-service-skeleton-and-core-tools.md](./phase-01-chat-service-skeleton-and-core-tools.md) | chat-service skeleton + server proxy + 3 critical-path tools + /chat/:id MVP | [ ] |
| 02 | [phase-02-extended-tool-surface.md](./phase-02-extended-tool-surface.md) | Remaining 5 tools (business-metrics, segments, explain SQL) | [ ] |
| 03 | [phase-03-ui-surfaces-fab-panel-and-sidebar.md](./phase-03-ui-surfaces-fab-panel-and-sidebar.md) | AskCubeFab + ChatPanel + /chat landing + sidebar RecentItems | [ ] |
| 04 | [phase-04-skill-expansion-explore-and-metric-explain.md](./phase-04-skill-expansion-explore-and-metric-explain.md) | Author explore + metric_explain SKILL.md + intent-router tests | [ ] |
| 05 | [phase-05-skill-expansion-compare-and-diagnose.md](./phase-05-skill-expansion-compare-and-diagnose.md) | Author compare + diagnose SKILL.md + multi-query traces | [ ] |
| 06 | [phase-06-polish-auto-compact-and-rate-limits.md](./phase-06-polish-auto-compact-and-rate-limits.md) | Auto-compact, rate limits, cost dashboard, MCP exposure | [ ] |

## Key Dependencies

- 02 depends on 01 (registry + tool-context wiring shipped in 01).
- 03 depends on 01 (shared `ChatThreadView` + `ChatComposer` ship in 01).
- 04 depends on 01 (skill-loader + intent-router in place).
- 05 depends on 02 (compare/diagnose need full tool surface) and 04.
- 06 depends on all of 01–05.

## Out of Scope (Phase 1)

- Auto-compact at 80% context (Phase 6).
- LLM-generated session titles (Phase 6).
- Rename/delete affordances on session rows (Phase 6).
- MCP exposure of chat-service tools to other agents (Phase 6 optional).
- Per-game divergent master commands (revisit if vocab diverges).
- Production deploy target (infra ticket — Phase 2 ops concern).

## Constraints (carry through every phase)

- KISS / YAGNI / DRY. Phase 01 must do the smallest end-to-end click-through; resist `while-we're-at-it`.
- Vitest only; mock `@anthropic-ai/claude-agent-sdk` everywhere. No live-LLM in CI.
- Every code change ends with `tsc --noEmit` clean (or `npm --prefix <pkg> run typecheck`).
- LLM credentials always via VNG LiteLLM proxy (`ANTHROPIC_BASE_URL=https://aawp-litellm-testing.vnggames.net`). Source for `chat-service/.env`: copy `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`, `MONET_DEFAULT_MODEL` values from `monet-v1.3-20260519/.env`.
- Sessions are pinned to one immutable `game_id` at creation.
- Concurrent turn on same session → 409 Conflict with retry hint.

## Pre-Kickoff Decisions Confirmed (2026-05-23)

| Item | Decision | Affected phase |
|---|---|---|
| SDK parity smoke | **PASSED** — `@anthropic-ai/claude-agent-sdk@0.3.150` against VNG LiteLLM returned "pong" in 5.9 s (TTFT 2.4 s). Subprocess startup ~1.5 s noted. | 01 (cleared) |
| SDK isolation | SDK is Claude Code binary wrapped — inherits host `~/.claude/` settings + hooks + 60+ builtin tools. Phase 01 step 1 must isolate via `HOME=<runtime/claude-home>` env and explicit tool allowlist. | 01 |
| `get_cube_meta` shape | Raw `/meta` JSON in Phase 01; slim later if token budget pressures. | 01 |
| Large-query deeplink (>8 KB) | Phase 01 ships BOTH inline + sessionStorage paths; `/build` consumes `?from-chat-artifact=<id>` key on mount. | 01 |
| `explain_cube_sql` pretty-print | `sql-formatter` dep in `chat-service/package.json`; postgresql dialect. | 02 |
| Panel layout | **Push** (Hermes-faithful). Panel is flex sibling of page content; main shrinks when panel opens. | 03 |
