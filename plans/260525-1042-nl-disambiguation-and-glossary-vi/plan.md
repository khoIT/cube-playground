---
title: "NL→Cube disambiguation + bilingual editable glossary"
description: "VI/EN chat slot-extraction with Official-only glossary; Draft/Official editable glossary."
status: completed
priority: P2
effort: 5d
branch: main
tags: [chat, glossary, nl, vietnamese, cube, disambiguation]
created: 2026-05-25
completed: 2026-05-25
---

## Goal

Two intertwined deliveries:

1. **NL→Cube disambiguation** inside chat-service `explore` skill. Extracts slots (metric/dimension/timeRange/filter/comparison) from VI+EN+code-switched messages, resolves synonyms via the Official glossary, normalises numbers/dates, computes a confidence score, and either auto-resolves (`mode=aggressive` ≥ 0.75) or returns a targeted clarification.
2. **Editable bilingual glossary** with `status ∈ {draft,official}` and VI columns (`label_vi`, `description_vi`, `aliases_vi`). One-click promote/demote. Modal edit UI on the existing index page. Chat agent reads **only Official rows** for term resolution.

## Phases

| # | Title | Status | Effort | Depends on |
|---|---|---|---|---|
| 01 | [Glossary schema + API](phase-01-glossary-schema-and-api.md) | completed | 6h | — |
| 02 | [Glossary edit UI (modal)](phase-02-glossary-edit-ui.md) | completed | 6h | 01 |
| 03 | [Settings 'Chat' tab + mode store](phase-03-settings-chat-tab-and-mode-store.md) | completed | 3h | — |
| 04 | [Chat panel mode chip](phase-04-chat-panel-mode-chip.md) | completed | 3h | 03 |
| 05 | [chat-service nl-to-query engine](phase-05-chat-service-disambiguation-engine.md) | completed | 10h | 01 |
| 06 | [Tool wiring + intent router](phase-06-chat-service-tool-wiring.md) | completed | 4h | 05 |
| 07 | [VI seed enrichment](phase-07-vi-glossary-seed-enrichment.md) | completed | 4h | 01 |
| 08 | [Eval harness + tests](phase-08-eval-harness-and-tests.md) | completed | 6h | 05,06,07 |

## Key dependencies

- Phase 01 unlocks 02, 05 (DB + API contract).
- Phase 03 unlocks 04 (shared mode store).
- Phase 05 unlocks 06 (tool surface needs engine).
- Phase 07 informs eval set in 08.

## Cross-phase risks (handled in phases)

- **R1 — Seed-vs-user-edit conflict (orphan purge in `glossary-migrate.ts:69-91`).** Solved in phase-01 with `source TEXT NOT NULL DEFAULT 'user'` column; purge restricted to `source='seed'` rows.
- **R2 — Glossary cache races with edits.** Phase-05 reads via short-TTL (30s) cache + `If-None-Match` ETag from API; phase-01 emits `updatedAt` max as ETag.
- **R3 — Number locale ambiguity** ("1.000"). Phase-05 normaliser uses VI-context heuristic: trailing-zero clusters with `.` and length≤4 → thousands, otherwise decimal. Documented + unit-tested.
- **R4 — Code-switched phrases.** Phase-05 synonym-resolver tokenises by max-phrase-length first (longest-match-wins) over a flattened alias map.
- **R5 — Confidence calibration.** Phase-08 establishes 20-40 example eval set; threshold 0.75 is provisional until eval pass/recall reported.

## Modularisation watchpoints (CLAUDE.md <200 LOC)

- `nl-to-query/` must split into ≥5 files (slot-extractor, synonym-resolver, number-normaliser, clarification-builder, query-composer, types). No single file >180 LOC.
- Glossary edit modal: split into modal shell + form-fields + status-toggle components.

## Open questions

See bottom of phase-05 and phase-08. None block phase-01.
