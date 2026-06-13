# Brainstorm Summary — Cube Advisor (local architect's briefing console)

- Date: 2026-06-03
- Status: approved → plan (TDD)
- Owner: khoitn (chief product + chief tech architect)
- Lives in: sibling repo `../cube-advisor` (outside cube-playground)

## Problem statement

Recurring, well-researched briefing of highest-leverage moves for the cube-playground ecosystem, split into two categories:
1. **Product / data-layer experience**
2. **Code architecture / performance**

Each run must: read live codebase + `plans/` + `docs/` + sibling `cube-dev`; pull external signal from email + Confluence (e.g. Tesseract Architecture target v0.2, GDS space); remember prior ideas + already-planned work (dedup); present each idea ready-to-act with evidence + visuals in a local dashboard.

## Locked decisions (from discovery)

- **Data access**: semi-interactive — backend spawns a Claude Code session that inherits user's OAuth'd claude.ai MCP (Atlassian + Microsoft 365). Not pure headless cron.
- **Output**: local Vite/React dashboard.
- **Trigger**: on-demand — "Generate briefing" button in dashboard shells out to Claude; progress streams; cards refresh.
- **Scope**: full vision (both categories, email+Confluence, deep-research per idea, persistent backlog).
- **Idea memory**: persistent backlog + dedup against prior ideas AND against `plans/`. "Top 3" = highest-ranked currently-open per category.
- **Consolidation**: dashboard also surfaces existing feature landscape, not just new ideas.

## Approaches evaluated

- **A. Thin orchestrator + Claude-as-engine (CHOSEN)** — backend spawns one `claude -p` session; fixed orchestration prompt does research+dedup+scoring+visual-specs, emits schema-validated `ideas.json`; backend = thin spawn+stream+SQLite+serve. Rigor pushed *inside* session (fan-out deep-research per candidate).
- B. Backend-driven multi-stage pipeline — more rigorous but over-built for v1; revisit as engine v2.
- C. No backend, static HTML per run — rejected; can't hold mutable backlog/status, conflicts with chosen dashboard+button UX.

## Architecture

- `../cube-advisor`: Vite/React dashboard (`:5180`) + Fastify backend (`:5181`) + SQLite (ideas + runs). Mirrors cube-playground stack (Fastify + better-sqlite3).
- Backend `POST /api/runs` spawns `claude -p --dangerously-skip-permissions --output-format stream-json` as child (runs as user → inherits MCP auth). stdout(stream-json) → SSE `GET /api/runs/:id/stream`.
- Session reads cube-playground (docs, plans, src, server, chat-service) + cube-dev YAMLs; MCP → Confluence + Outlook; WebSearch; writes `runs/<id>/ideas.json`.
- Backend ingests JSON → validate → dedup → rank → store → serve.

## Components

1. **Backend (Fastify + better-sqlite3)**: `POST /api/runs`, `GET /api/runs/:id/stream` (SSE), `GET /api/ideas`, `PATCH /api/ideas/:id` (status), `GET /api/landscape`, `POST /api/ideas/:id/plan` (writes `/ck:plan`-ready brief into `cube-playground/plans/`).
2. **Orchestration prompt** (`prompts/briefing.md`, versioned — the core IP): injected with scan paths, Confluence page IDs (Tesseract + GDS), email queries, current open-idea backlog, plan index. Marks each candidate `new | duplicate-of:<id> | already-planned`. Returns top-5/category → ranker keeps top-3 open.
3. **Idea schema** (validated on ingest): `id, category, title, oneLiner, problem, evidence[]{type:file|metric|confluence|email|web, ref, quote}, proposal, impact(1-5), effort(1-5), confidence, risks[], suggestedVisual{kind:mermaid|chart, spec}, sources[], fingerprint, status, firstSeenRun, lastSeenRun, dedupVerdict`.
4. **Frontend (Vite/React/TS, recharts, mermaid)**: 3 surfaces — **Briefing** (2 columns × top-3 cards: problem→evidence→proposal→impact×effort→visual→Accept/Dismiss/Snooze), **Landscape** (existing features/plans from docs/codebase-summary.md, README routes, plans/complete/), **Backlog** (full history + status filters). Generate button → SSE progress.

## Implementation phases

1. **De-risk spike (GATES everything)**: confirm `claude -p --dangerously-skip-permissions` child sees Atlassian + M365 MCP and can fetch Tesseract page. If fail → fallback to direct Confluence REST + Graph API w/ stored tokens.
2. Scaffold sibling repo + backend skeleton (spawn + SSE + SQLite).
3. Idea schema + ingest/validate/dedup/rank.
4. Orchestration prompt v1 + structured-output contract.
5. Frontend: Briefing + Generate flow.
6. Landscape + Backlog surfaces.
7. Plan-handoff endpoint + polish.

## Success criteria

- One click → within minutes, 3 researched ideas/category render with real evidence (actual file refs, real Tesseract/email quotes) + a visual each.
- Re-runs don't re-pitch already-planned or previously-dismissed ideas.
- "Accept → create plan" drops usable brief into `cube-playground/plans/`.

## Risks

- **MCP-in-headless unproven** until phase 1 (biggest risk, gates build). Fallback: direct REST/Graph APIs + tokens.
- **Token cost / latency**: full run = deep-research × ~10 candidates + repo reads → minutes + meaningful spend. On-demand keeps controlled.
- **Idea quality prompt-bound**: v1 may be generic until prompt tuned over runs; backlog/dedup loop drives improvement.
- **Email content lands in local dashboard**: stays local (SQLite on machine).
- **Two design systems**: advisor is separate app; echo minimal token set for kinship, no hard coupling.

## Unresolved questions

1. Repo name — `../cube-advisor` OK, or other?
2. Visual kinship — echo cube-playground design tokens, or independent clean look?
3. Email scope — which mailboxes/queries seed product signal (default: "Tesseract", "GDS roadmap"; refine later)?
