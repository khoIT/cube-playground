---
title: "Tiered chat agent (Cube as source of truth)"
description: "Two-axis policy for chat-service: capability tier per tool, intent tier per question. Cube produces facts; web/Atlassian/files enrich context only. Per-block provenance + soft validator."
status: pending
priority: P2
branch: "main"
tags: [chat, agent, mcp, provenance, policy]
blockedBy: []
blocks: []
related: [project:260527-1539-cube-workspace-switching]
created: "2026-05-28T04:54:20.825Z"
createdBy: "ck:plan"
source: skill
---

# Tiered chat agent (Cube as source of truth)

## Overview

Establish a two-axis policy inside `chat-service/`: every tool has a **capability tier**
(`source-of-truth | enrichment | meta | destructive`) and every question gets an **intent
tier** (`data | research | hybrid`). Data questions answer only from Cube; research questions
may use web/Atlassian/files but cannot fabricate numeric facts; hybrid questions answer data
first, then optionally enrich with context in a clearly-separated "Context (not data)" block.
Per-block provenance chips in UI; soft server-side validator tags drift. Source of truth:
`plans/reports/brainstorm-260528-1144-tiered-chat-agent-data-as-truth.md`.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Tool-tier registry + Bash allowlist guard](./phase-01-tool-tier-registry-bash-allowlist-guard.md) | Pending |
| 2 | [Skill catalog: research + data_with_context + prompt provenance](./phase-02-skill-catalog-research-data-with-context-prompt-provenance.md) | Pending |
| 3 | [Intent router (data \| research \| hybrid)](./phase-03-intent-router-data-research-hybrid.md) | Pending |
| 4 | [MCP bindings: Atlassian read-only + WebSearch verify](./phase-04-mcp-bindings-atlassian-read-only-websearch-verify.md) | Pending |
| 5 | [Provenance pipeline: sources[] schema + per-block UI chips](./phase-05-provenance-pipeline-sources-schema-per-block-ui-chips.md) | Pending |
| 6 | [Server-side validator: unverified tagging + audit UI badge](./phase-06-server-side-validator-unverified-tagging-audit-ui-badge.md) | Pending |

## Key Decisions (user-confirmed)

- **Core principle:** Cube + semantic layer = the ONLY source of truth for numeric facts.
  All other tools enrich context but never produce data.
- **Enforcement:** Prompt + soft validator. Skill prompts forbid non-Cube numbers; post-turn
  validator tags drift as `unverified` in audit UI. No hard-strip.
- **Power-tool scope:** Read-only, allowlisted. Atlassian read-only; Bash allowlist (`ls`,
  `cat`, `grep`, `gh issue view`, …); Files Read+Grep+Glob; no rm/network/curl/Write/Edit.
- **Provenance UX:** Per-block source chips (📊 Cube / 🌐 Web / 🗂 Atlassian / 📁 Files).

## Dependencies

- Phase 1 → 2 → 3 → 4 → 5 → 6 (each layer builds on previous; tier registry first,
  validator last so it has provenance to check against).
- **Related plan:** `260527-1539-cube-workspace-switching` Phase 7 (chat-service workspace
  awareness) — coordinate runner changes to avoid conflicts. The two plans touch chat-service
  but for different concerns (this = tool policy; that = data-source isolation).

## Open questions

1. Atlassian MCP credentials — service account (single, read-only) vs per-user via Keycloak claim (Phase 6 of workspace plan)?
2. Cache web-search results per turn to avoid repeat fetches on edits/regenerates?
3. Cost/rate-limit posture for WebSearch + Atlassian — quota the validator should respect?
4. When DA enables Cube's `access_policy`, does validator's "Cube provenance" check need a
   stricter signal than just "tool was called"?
