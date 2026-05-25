# Planner Report — Cube Playground Chat Agent

**Date:** 2026-05-23 17:47 +07
**Plan dir:** `/Users/lap16299/Documents/code/cube-playground/plans/260523-1643-cube-playground-chat-agent/`
**Inputs:** brainstorm `brainstorm-260523-1643-cube-playground-chat-agent.md` (§17 locked), 3 scout reports.
**Scope:** authored phased implementation plan only. No code.

## Files Created

| File | LoC |
|---|---|
| `260523-1643-cube-playground-chat-agent/plan.md` | 61 |
| `260523-1643-cube-playground-chat-agent/phase-01-chat-service-skeleton-and-core-tools.md` | 406 |
| `260523-1643-cube-playground-chat-agent/phase-02-extended-tool-surface.md` | 175 |
| `260523-1643-cube-playground-chat-agent/phase-03-ui-surfaces-fab-panel-and-sidebar.md` | 251 |
| `260523-1643-cube-playground-chat-agent/phase-04-skill-expansion-explore-and-metric-explain.md` | 174 |
| `260523-1643-cube-playground-chat-agent/phase-05-skill-expansion-compare-and-diagnose.md` | 167 |
| `260523-1643-cube-playground-chat-agent/phase-06-polish-auto-compact-and-rate-limits.md` | 219 |

Total: 1453 lines, 7 files.

## Phase Summary

| # | Title | Est. days | Blocking deps |
|---|---|---|---|
| 01 | chat-service skeleton + server proxy + 3 critical-path tools + /chat/:id MVP | 5–7d | none (gate) |
| 02 | Extended tool surface (5 remaining tools) | 2–3d | 01 |
| 03 | UI surfaces: FAB + ChatPanel + /chat landing + sidebar RecentItems | 3–4d | 01 |
| 04 | Skill expansion: explore + metric_explain + keyword intent-router | 1.5–2d | 01, 02 |
| 05 | Skill expansion: compare + diagnose | 1.5–2d | 02, 04 |
| 06 | Polish: auto-compact + rate limits + cost stats + LLM titles + rename/delete + optional MCP | 4–5d | 01–05 |

**Total estimate:** ~17–23 engineer-days. Phase 01 is the hard gate; 02 + 03 + 04 can begin once 01 ships.

## Key Architectural Decisions Locked into Plan (from brainstorm §17)

- Separate `chat-service/` Node TypeScript microservice (Fastify, port 3005) using `@anthropic-ai/claude-agent-sdk`.
- Thin proxy in `server/src/routes/chat.ts` injects `X-Cube-Token`, `X-Cube-Game`, `X-Owner-Id`; SSE pass-through with `reply.hijack()` + `X-Accel-Buffering: no`.
- SQLite via `better-sqlite3` at `chat-service/runtime/chat.db`; tables `chat_sessions`, `chat_turns`, `chat_audit` (+ `parent_session_id` / `compacted_into` in Phase 06).
- 10 SSE events (incl. `query_artifact`, `session_created`, `compact_warning`).
- LLM credentials only via VNG LiteLLM proxy.
- Sessions pinned to one immutable `game_id`.
- Concurrent turn → 409 (per-session async mutex).
- Title = first user message truncated to 64 chars (LLM refinement at turn 3 in Phase 06).
- Tests: Vitest + mocked SDK only; no live-LLM in CI.
- All 8 tools land in Phase 01–02 (3 in 01, 5 in 02). Skills `explore`/`metric_explain`/`compare`/`diagnose` author in Phase 04–05.
- New helper `chat-service/src/utils/build-chat-deeplink.ts` — sibling of existing `src/utils/playground-deeplink.ts` because the existing one is segment-shaped, not free-form-query-shaped.

## Open Questions / Decisions Deferred to Implementation

1. **SDK parity smoke test** must run day-1 of Phase 01 to confirm `@anthropic-ai/claude-agent-sdk` supports `--resume`, tool registration, headless async iteration. Fallback: raw `@anthropic-ai/sdk` + DIY loop (~+2d).
2. **`get_cube_meta` compact shape** — raw `/meta` JSON or slimmed list. Default Phase 01: raw.
3. **sessionStorage handoff for >8KB deeplinks** — Phase 01 wires the path (`from-chat-artifact=<id>` key) but defers `/build` consumption to Phase 03 to keep Phase 01 scope tight. Phase 01 prompts encourage compact queries to avoid the fallback.
4. **Panel push-layout vs overlay** — brainstorm §8.1 says "side-by-side push, main content reflows"; Phase 03 ships overlay (`position: fixed`) for simplicity. Reviewer can flip to flex push-layout if desired.
5. **Slash prefix aliases** — `/metric` vs `/metric_explain`. Default Phase 04: both, alias table.
6. **`explain_cube_sql` pretty-printer** — pull `sql-formatter` into chat-service deps or return raw. Default: raw.
7. **`metric_explain` allowed to emit `query_artifact`?** Permitted for explicit follow-ups; reviewer can drop if too permissive.
8. **`diagnose` branch cap** — 4 default; tune after analyst feedback.
9. **Auto-compact threshold** — 80 % default (matches Monet); env-configurable.
10. **Title-summariser model** — `claude-3-5-haiku` placeholder; confirm availability on VNG LiteLLM.
11. **Production owner-identity model** — explicitly deferred to infra hardening phase (NOT Phase 06).

## Adherence Notes

- All file paths absolute under `/Users/lap16299/Documents/code/cube-playground/...`.
- Every phase has all 11 mandatory sections (`Context Links`, `Overview`, `Key Insights`, `Requirements`, `Architecture`, `Related Code Files`, `Implementation Steps`, `Todo List`, `Success Criteria`, `Risk Assessment`, `Security Considerations`, `Next Steps`, `Unresolved Questions`).
- Each implementation step ends with `tsc --noEmit` clean and/or Vitest green; suggested commit messages use conventional-commit prefixes.
- Plan dir uses brainstorm timestamp `260523-1643` (NOT hook-injected `260523-1748`) so brainstorm + plan share slug per §16 recommendation.
- KISS gates respected: Phase 01 is the smallest possible end-to-end click-through; sessionStorage-fallback `/build` consumption, push-layout panel, LLM titles, rate limits all deferred to later phases.

**Status:** DONE
**Summary:** Authored 7 plan files (1 overview + 6 phases, 1453 lines total) at `plans/260523-1643-cube-playground-chat-agent/`. All locked decisions from brainstorm §17 captured; risks rolled forward per phase; 11 deferred-to-impl decisions enumerated.
