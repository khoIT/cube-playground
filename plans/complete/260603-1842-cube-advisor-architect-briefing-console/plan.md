---
title: "Cube Advisor — local architect's briefing console"
description: ""
status: complete
priority: P2
branch: "main"
tags: []
blockedBy: []
blocks: []
created: "2026-06-03T11:53:04.573Z"
createdBy: "ck:plan"
source: skill
---

# Cube Advisor — local architect's briefing console

## Overview

Standalone local app (sibling repo `../cube-advisor`) that gives the chief product/tech architect a recurring, researched briefing of highest-leverage moves across the cube-playground ecosystem — two categories (Product/data-layer experience · Code architecture/performance), top-3 ranked open ideas each.

Engine = **Approach A** (thin orchestrator + Claude-as-engine): a Fastify backend (`:5181`) spawns a `claude -p --dangerously-skip-permissions --output-format stream-json` child that inherits the user's OAuth'd claude.ai MCP (Atlassian + Microsoft 365), reads cube-playground + `cube-dev` + `plans/` + `docs/`, pulls Confluence (Tesseract) + Outlook, runs deep-research per candidate, and writes a schema-validated `runs/<id>/ideas.json`. Backend ingests → dedup (vs prior ideas AND `plans/`) → rank → SQLite store → serves a Vite/React dashboard (`:5180`) with three surfaces: **Briefing**, **Landscape** (existing features/plans), **Backlog**. On-demand: "Generate briefing" button shells out to Claude, progress streams over SSE, cards refresh.

Authoritative design: [`../../reports/brainstorm-260603-1842-cube-advisor-architect-briefing-console-report.md`](../reports/brainstorm-260603-1842-cube-advisor-architect-briefing-console-report.md).

**Mode:** TDD — each phase is tests-first. **Gating:** Phase 1 (MCP-in-headless) must pass before 3-8; if it fails, the engine falls back to direct Confluence REST + Microsoft Graph with stored tokens (re-plan Phase 5 inputs, rest unchanged).

**Stack** (mirrors cube-playground): Fastify + better-sqlite3 (backend), Vite + React 18 + TS strict + **recharts** (frontend; mermaid is NOT a cube-playground dep — dropped from v1, recharts-only), vitest + RTL (tests), zod (schema validation). **Single package** (Fastify serves the built frontend; shared `src/shared/idea-schema.ts` via Vite path alias) — not a two-package split, to avoid cross-package type drift.

**Red-team status (2026-06-03):** the gating MCP assumption was **empirically validated** — a live headless `claude -p` probe fetched the real Tesseract Confluence page (`1609334800`, exit 0). 15 hardening findings + 4 minor edits applied across phases (see `## Red Team Review`). Net new design constraints baked in: loopback-only bind + shared-secret on `POST /runs`; prompt-injection threat model (external Confluence/email is untrusted, agent runs least-privilege, never exposes `~/.claude.json`); absolute `ideas.json` path + robust run-lifecycle (reaper, process-group kill); per-connector MCP pre-flight; defensive LLM-output parsing.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [MCP-headless spike (gating)](./phase-01-mcp-headless-spike-gating.md) | Complete (spike PASS, recorded) |
| 2 | [Repo scaffold + backend skeleton](./phase-02-repo-scaffold-backend-skeleton.md) | Complete |
| 3 | [Run orchestration + SSE streaming](./phase-03-run-orchestration-sse-streaming.md) | Complete |
| 4 | [Idea store + dedup + ranking](./phase-04-idea-store-dedup-ranking.md) | Complete |
| 5 | [Orchestration prompt + output contract](./phase-05-orchestration-prompt-output-contract.md) | Complete (structural; live eval PENDING — see prompts/eval-notes.md) |
| 6 | [Frontend Briefing + Generate flow](./phase-06-frontend-briefing-generate-flow.md) | Complete |
| 7 | [Landscape + Backlog surfaces](./phase-07-landscape-backlog-surfaces.md) | Complete |
| 8 | [Plan-handoff + polish](./phase-08-plan-handoff-polish.md) | Complete |

## Build status (2026-06-03)

Built into sibling repo `../cube-advisor`. **77 tests pass** (20 files, backend +
frontend), `tsc --noEmit` clean, `vite build` succeeds. code-reviewer pass
applied: per-run cost ceiling now ENFORCED (was dead config), `ADVISOR_TOKEN`
scrubbed from the spawned child env, `POST /api/runs` auth now tested, git-guard
fails-safe on missing git, brief filename id sanitized. The only deferred item is
the **live prompt eval** (real run spends ~$1–$2.50 + reads live Confluence/email)
— intentionally not auto-triggered; steps recorded in `../cube-advisor/prompts/eval-notes.md`.

## Dependencies

- **External tooling (must be present):** `claude` CLI ≥ 2.1 (verified 2.1.161) and `ck` CLI (verified 4.4.0). The backend shells out to `claude -p`.
- **MCP auth:** user must have authenticated the claude.ai Atlassian + Microsoft 365 connectors interactively at least once (tokens cached in `~/.claude.json`); the spawned child inherits them. Phase 1 validates this.
- **Read targets (host paths):** `../cube-playground` (docs, plans, src, server, chat-service), `../cube-dev` (Cube YAMLs).
- **Cross-plan:** no file overlap with any cube-playground in-flight plan (`260603-1439-workspace-isolation…`, `260603-0324-unified-concept-fabric`, etc.) — advisor is a separate repo. No `blockedBy`/`blocks` relationship. The advisor only *reads* cube-playground; the `POST /api/ideas/:id/plan` handoff *writes* into `cube-playground/plans/reports/` (one idempotent brief per idea, keyed on idea id) under a strict realpath guard.
- **MCP auth is per-connector:** Atlassian + M365 verified `Connected`, but VNGGames data connectors (GDS/VDA) show "Needs authentication". Phase 1 pre-flights every *required* connector; Phase 3 refuses a run if a required connector is un-authed (no silent dead-signal).

## Red Team Review

### Session — 2026-06-03
**Findings:** 35 raw → 15 accepted (+ 4 minor edits) ( reviewers: Security Adversary, Failure Mode Analyst, Assumption Destroyer, Scope & Complexity Critic )
**Severity breakdown:** 5 Critical, 8 High, 2 Medium accepted
**Scope decisions (user-confirmed, NOT auto-applied):** keep full 8-phase vision; keep Landscape in v1 — both reaffirmed against the YAGNI cut.
**Empirical result:** gating MCP-headless assumption PASSED via live `claude -p` probe (Tesseract page fetched). Live probes cost ~$2.50 of real account spend.

| # | Finding | Severity | Disposition | Applied To |
|---|---------|----------|-------------|------------|
| 1 | Unauthenticated `--dangerously-skip-permissions` trigger; `0.0.0.0` bind + reflective CORS (`index.ts:195`) | Critical | Accept | Phase 2 |
| 2 | Indirect prompt injection into FS-write, send-capable agent | Critical | Accept | Phase 1/3/5 |
| 3 | `ideas.json` cwd/path mismatch + exit-0-no-file → stuck `running` | Critical | Accept | Phase 3/5 |
| 4 | Run-lock/timeout inconsistency, no reaper, zombie children | Critical | Accept | Phase 3 |
| 5 | Idea schema drift across phases (camel↔snake, dropped fields) | Critical | Accept | Phase 4/5 |
| 6 | CLI stdout parsing version-coupled; SDK precedent (`claude-runner.ts:166`) | High | Accept | Phase 1/3 |
| 7 | Sync better-sqlite3 ingest blocks loop during SSE | High | Accept | Phase 4 |
| 8 | Fingerprint-merge un-dismisses dismissed ideas | High | Accept | Phase 4 |
| 9 | SSE replay buffer unbounded/in-memory; restart wedges UI | High | Accept | Phase 3 |
| 10 | Deep-research×10 vs 15-min kill; no budget ceiling (~$1/probe) | High | Accept | Phase 1/3 |
| 11 | Per-connector MCP auth (VNGGames connectors un-authed) | High | Accept | Phase 1/3 |
| 12 | `confidence` unbounded while impact/effort 1-5 | High | Accept | Phase 4/5 |
| 13 | Landscape parser assumes frontmatter (only 3/6 plans have it) | High | Accept | Phase 7 |
| 14 | Path-guard underspecified; slug from injectable title; path contradictions | High | Accept | Phase 8 |
| 15 | Backend trusts LLM output (hallucinated `duplicate-of`, fences, XSS refs) | Medium | Accept | Phase 4/5/6 |
| — | Minor: drop mermaid→recharts; fixed `impact-effort` (no weights); P1/P5 = spikes/evals; idea status state-machine | Medium | Accept | Phase 4/5/6 |

Per-phase hardening detail is in each phase file under **Red Team Hardening (applied)**. Full reviewer reports in `./reports/`.

### Whole-Plan Consistency Sweep
Re-read plan.md + all 8 phase files after applying findings. Reconciled stale contradictions introduced by the edits:
- **mermaid → recharts-only**: fixed Phase 6 Requirements/Architecture/TDD/Risk (4 lines) + Phase 5 contract + plan.md stack; zero remaining mermaid-as-feature references.
- **Ranking formula**: removed `impact*w_i - effort*w_e + confidence*w_c` (configurable weights) → `impact - effort`; `confidence` demoted to tiebreak, not addend (Phase 4).
- **Briefing population**: `status in (new, accepted)` → `status=new` (accepted → "In motion" lane) consistently in Phase 4 + Phase 6.
- **Type sharing**: removed "copied .d.ts" escape hatch → single-package shared schema via Vite alias (Phase 6).
- **Timeout**: "default 15 min" → "set from Phase 1 measured run" (Phase 3).
- **Handoff path**: `plans/` → `plans/reports/` reconciled in plan.md + Phase 8.
- **Bind**: all `0.0.0.0` references are explicit "do NOT copy" warnings; advisor binds `127.0.0.1`.

**Result: zero unresolved contradictions.** Plan is internally consistent and ready for implementation.
