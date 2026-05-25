---
title: "Chat disambig memory expansion + Settings remembered defaults"
description: "Per-turn slot-memory writes, cross-session user prefs, Settings UI surface, suppress follow-up chips during disambig."
status: pending
priority: P2
effort: 12h
branch: main
tags: [chat, disambiguation, settings, memory]
created: 2026-05-26
---

# Chat disambig memory + Settings defaults — Overview

Four-wave delivery. Fixes three layered defects observed in session `1399825c-3c24-441d-9bed-e6a29e908f74`:

1. Date-range memory leak across turns (timeRange not memorised, write only on auto-route).
2. Cross-session prefs absent + no UI surface.
3. Follow-up chips render alongside disambig chips during clarify turns.

Backed by brainstorm `plans/reports/brainstorm-260526-0436-chat-disambig-memory-and-settings-defaults.md`.

## Phases

| # | File | Status | Effort | Depends on |
|---|------|--------|--------|------------|
| 1 | [phase-01-wave-a-session-memory-expansion.md](./phase-01-wave-a-session-memory-expansion.md) | pending | 4h | — |
| 2 | [phase-02-wave-b-cross-session-user-prefs.md](./phase-02-wave-b-cross-session-user-prefs.md) | pending | 3h | Phase 1 |
| 3 | [phase-03-wave-b2-settings-remembered-defaults-ui.md](./phase-03-wave-b2-settings-remembered-defaults-ui.md) | pending | 4h | Phase 2 |
| 4 | [phase-04-wave-c-suppress-followups-during-disambig.md](./phase-04-wave-c-suppress-followups-during-disambig.md) | pending | 1h | — (standalone) |

Phase 4 is independent and can land in parallel with phases 1–3 (different files).

## Locked user decisions (do NOT re-debate)

1. Memory writes on every confidently-resolved slot, not auto-route gated.
2. Explicit slot in current turn wins; memory fills gaps only.
3. Cross-session prefs implemented now (no defer).
4. Chip dismissal deferred (composer suffices).
5. Phrase storage for all slots (metric/dimension/timeRange/filters).
6. Two stacked SectionCards in existing Settings → Chat tab.

## Key dependencies / cross-cutting

- All BE changes live under `chat-service/`. FE changes under `src/pages/Settings/` and `src/pages/Chat/`.
- `phrase-resolver.ts` (new) is shared between slot-extractor (write) and memory reader (re-resolve on read). Phase 1 owns it.
- `user_disambig_prefs` SQLite table (phase 2) is read by phase 3 API only.
- All phases respect 200-LOC cap; `disambiguate-query.ts` splits into `disambiguate-memory-merge.ts` when it exceeds.

## Delivery model

- One PR total, four commits (one per wave).
- Each phase independently testable with vitest. FE uses vitest + RTL.
- Code comments must NOT reference phase numbers, finding codes, or audit labels.

## Success metrics (whole plan)

- T0 "top spenders this week" → T1 clarify metric → T2 "ARPU" → T3 auto-routes with metric + timeRange from memory. No clarify.
- May session sets phrase `this month`; mock clock June 3, new session → auto-resolved range `[Jun 1, Jun 30]`.
- Settings → Chat → Remembered defaults row × click → DELETE 204 → row gone.
- Clarify turn renders only disambig chips, no FollowupChips.

## Out of scope

- Chip dismissal affordance (composer covers it).
- Multi-user owner partitioning beyond owner-scoped reads (same review gate as `response_cache` wave-2).
- `hit_count` display in Settings (hidden by default; add later if asked).
