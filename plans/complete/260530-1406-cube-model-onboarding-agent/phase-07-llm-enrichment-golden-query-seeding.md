---
phase: 7
title: "LLM enrichment + golden-query seeding"
status: complete
priority: P2
effort: "6h"
dependencies: [6]
---

# Phase 7: LLM enrichment + golden-query seeding

## Overview
The "intelligence" layer, toggleable and additive on top of the heuristic v1: an LLM pass
that generates business-friendly names, descriptions, and synonyms grounded in sampled
values; plus seeding the draft's dimension/measure pool from real validated queries already
in the system (Snowflake-Cortex-style golden queries).

## Requirements
- Functional: given an `InferredSchema` + column samples, produce names/descriptions/synonyms per member; mine existing validated queries to suggest which dimensions/measures matter and which co-occur; both surfaced as *suggestions* in the canvas, never auto-applied.
- Non-functional: feature-flagged (off → pure heuristic v1 still works); grounded in real samples (no hallucinated columns); bounded token cost.

## Architecture
- New `server/src/services/cube-model-enrichment.ts` — reuse chat-service's Claude/LLM client infra (see `chat-service/src/tools/*`); prompt with column names + `sampleValues` + table context; return structured `{ member, label, description, synonyms[] }` (Zod-validated, members must match the draft — reject unknown).
- New `server/src/services/golden-query-seeder.ts` — mine three sources (per grounding):
  - `chat_turns.artifacts_json` (chat-service DB, `CHAT_SERVICE_DB_PATH`) — primary; parse `QueryArtifact.query`, build `measure → {dimensions, segments, granularities}` co-occurrence index.
  - `segment_analyses.query_json` + `dashboard_tiles.query_json` (server DB) — high-confidence saved queries.
  - Fallback: preset specs in `server/src/presets/mf-users-hub.js`.
  - Note: chat DB ≠ server DB — open both.
- Feature flag via `app-settings-store.ts` (`onboarding.llmEnrichment`, `onboarding.goldenSeeding`).
- UI: enrichment suggestions render as accept-to-apply chips in `draft-model-canvas.tsx`; seeded members get a "seen in N real queries" badge.

## Related Code Files
- Create: `server/src/services/cube-model-enrichment.ts`, `server/src/services/golden-query-seeder.ts`.
- Modify: `draft-model-canvas.tsx` (suggestion chips + badges), onboarding routes (enrich/seed endpoints), `app-settings-store.ts` (flags).
- Read for context: `chat-service/src/tools/preview-cube-query.ts:42-51` (CubeQuery Zod), `chat-service/src/db/chat-store.ts:19-74` (artifacts), `server/src/routes/analyses.ts`, `server/src/services/dashboard-store.ts:10-100`, `server/src/presets/mf-users-hub.js`.

## Implementation Steps
1. Add feature flags (default off).
2. Build golden-query seeder: open chat DB + server DB, extract + parse queries, build co-occurrence index (cache it; don't re-scan per request).
3. Build LLM enrichment service; ground prompt in samples; Zod-validate; drop unknown members.
4. Add enrich/seed endpoints to `onboarding.ts`.
5. Wire suggestion chips + "seen in N queries" badges into the canvas.

## Success Criteria
- [x] With flags off, heuristic v1 is unchanged.
- [x] Enrichment never invents a member not in the draft.
- [x] Seeder surfaces real measures/dimensions from actual chat/segment/dashboard history.
- [x] All suggestions require explicit DA accept to apply.

## Risk Assessment
- **LLM hallucinates members** → validate output against draft; discard mismatches.
- **Cross-DB mining cost** → build index once, cache; bound by recency window.
- **Token cost** → batch per cube; cap sample size in prompt.
