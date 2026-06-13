# Brainstorm: Tiered Chat Agent — Cube as Source of Truth

**Date:** 2026-05-28 · **Status:** Approved, proceeding to `/ck:plan`

## Problem

Chat-service runs as a Claude Code SDK subprocess with full builtin toolset (Bash, WebSearch,
Files, MCP servers incl. Atlassian) but uses them inconsistently. User toggled web-search;
question routed to `explore` skill which refused by guard rail; no current skill prompt
teaches the model when/how to call WebSearch. **Effect:** the toggle is a no-op for
research-style asks. Underlying gap: no policy distinguishing "data answer" (must come from
Cube) from "context enrichment" (web, Atlassian, files).

## Core principle (user)
> Cube + its semantic layer is the **only** source of truth for numbers. Other tools enrich
> context but never produce data facts.

## Architecture: two-axis policy

1. **Capability tier per tool** — `source-of-truth` (Cube MCP tools), `enrichment`
   (WebSearch, Atlassian, file reads), `meta` (artifact emitters, disambiguator),
   `destructive` (Bash write/network — default OFF).
2. **Intent tier per question** — `data` / `research` / `hybrid`. Router classifies before
   skill selection; routes to skill catalog by intent.

In a `data` intent, only source-of-truth tools may produce facts. In `research`, enrichment
allowed; refuse numeric claims (route back to data skill). In `hybrid`, data-first → emit
artifact → optional enrichment paragraph in a clearly-separated **"Context (not data)"** block
with provenance chips.

## Decisions (user-confirmed)

| Topic | Decision |
|---|---|
| Enforcement | **Prompt + soft validator** — skill prompts forbid non-Cube numbers; post-turn validator scans for numeric claims and tags missing-cube-provenance turns `unverified` in audit UI. No hard-strip. |
| Power-tool scope | **Read-only, allowlisted** — Atlassian read-only; Bash on fixed allowlist (ls, cat, grep, gh issue view, …); Files Read+Grep+Glob; no rm/network/curl/Write/Edit. Tied to Phase 6 RBAC (editor+). |
| Provenance UX | **Per-block source chips** — 📊 Cube / 🌐 Web / 🗂 Atlassian / 📁 Files on every paragraph/section. Reuses existing artifact-card affordance. |

## What changes (scoped to chat-service + chat-overlay)

- **Tool-tier registry** (`chat-service/src/tools/tool-tiers.ts`) — every tool tagged; runner
  filters available tools per intent.
- **Skill catalog expansion**: add `research` (enrichment-tier; refuses numeric facts) and a
  `data_with_context` hybrid (two-phase: Cube data → optional enrichment block). Keep
  existing data skills (`explore`, `diagnose`, `metric_explain`, `compare`) untouched.
- **Intent router**: classify `data | research | hybrid` before skill selection; the
  frontend "include web context" toggle raises the hybrid floor.
- **MCP wiring**: add Atlassian MCP (read-only); confirm WebSearch builtin works (it does —
  half-implemented today); Bash allowlist guard.
- **Provenance pipeline**: chat-service emits `sources[]` per block; `chat_turns` stores it;
  frontend renders per-block chips next to text.
- **Post-turn validator**: data/hybrid + numeric claim + no `cube` source → `unverified` tag;
  audit UI badge.

## Phasing (6 phases)

1. Tool-tier registry + Bash allowlist runtime guard
2. Skill catalog: new `research` + `data_with_context`; update existing skill prompts (provenance instructions)
3. Intent router upgrade (`data | research | hybrid`); hybrid floor from web-search toggle
4. MCP bindings — Atlassian read-only; verify WebSearch tool injection end-to-end
5. Provenance pipeline — `sources[]` schema, chat_turns column, per-block UI chips
6. Server-side validator — `unverified` tagging + audit UI badge

## Success criteria

- Data question on a data skill → numbers always have 📊 Cube chips; validator: 0 unverified.
- Research question → web/Atlassian results with their chips; if asks for a number, redirects to data skill.
- Hybrid question with web-search toggle on → Cube artifact + "Context (not data)" block with mixed chips.
- Atlassian/Bash scope provably read-only (test forbidden ops → fail safely).
- Per-block chips visible in chat UI; audit view shows source mix per turn.

## Risks

- **Tier registry drift** — new tools added without tier tag → silent enrichment-as-truth.
  Mitigation: lint check requiring tier metadata on every registered tool.
- **Validator false positives** — qualitative answers with figures from artifacts. Mitigation:
  whitelist numbers that originate from `emit_query_artifact`/`emit_chart` payloads.
- **Intent misclassification** — borderline hybrid asks get routed to `data` and refused
  (today's bug shape). Mitigation: bias to hybrid when toggle is on or when question mixes
  metric + open-ended phrase ("why", "what's", "explain").
- **Atlassian RBAC** — read-only is enforced by client config, not by the chat-service. If
  the user's Atlassian token has write scope, the model technically could write. Mitigation:
  use a service account with read-only scope; document.

## Relation to workspace plan

Parallel track. Touches chat-service (overlap with Phase 7 of `260527-1539-cube-workspace-switching`)
but addresses a different concern (tool policy vs workspace isolation). Coordinate the
chat-service changes so Phase 7 (workspace ctx) and this plan's runner changes don't conflict.

## Open questions

1. Where do Atlassian MCP credentials live? (service account vs per-user token via Keycloak claim)
2. Should `research` skill cache web-search results per turn to avoid repeated fetches on edits?
3. Cost/rate-limit posture for WebSearch + Atlassian — any quota the validator should respect?
4. Will Cube's own future `access_policy` (when DA enables it) need to be respected by the validator's "Cube provenance" check, or is tool-call presence sufficient?
