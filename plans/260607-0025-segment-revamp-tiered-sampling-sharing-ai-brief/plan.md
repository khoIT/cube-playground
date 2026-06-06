---
title: 'Segment Revamp: LTV-Tiered Sampling, Sharing, AI Brief'
description: >-
  Members tab → top/middle/bottom-50 LTV tiers with daily-precomputed member-360
  pages; segments shareable like chat with inline nav pill; auto-generated AI
  executive brief on segment open.
status: pending
priority: P1
branch: main
tags:
  - segments
  - sharing
  - llm
  - cube
  - cron
  - frontend
  - server
  - chat-service
blockedBy: []
blocks: []
created: '2026-06-06T17:35:25.838Z'
createdBy: 'ck:plan'
source: skill
---

# Segment Revamp: LTV-Tiered Sampling, Sharing, AI Brief

## Overview

Three user-facing upgrades to Segments:

1. **LTV-tiered member sampling** — replace the random-50 sample with three server-computed
   subgroups (top 50 / middle 50 / bottom 50 by LTV, 150 users total). Members tab redesigned
   around the tiers. Member-360 detail pages for those 150 users precomputed daily (core panels
   only) and served from cache.
2. **Shareable segments** — segments shareable like chat sessions. Shared segments from
   teammates appear inline in the left-nav Segments section with a "Shared" pill; non-owners
   get full use (view/refresh/rename/analyses/export/brief) — the destructive set (delete,
   visibility, predicate rewrite, uid mutations, activation-delete) stays owner/admin-only.
   Chat's separate "SHARED WITH TEAM" nav section is restyled to the same inline-pill pattern.
3. **AI Segment Brief** — cube-advisor idea `5aefe808` (impact 5 / effort 3 / confidence 4). On
   segment open, a collapsible card shows an LLM-written 3–4 sentence executive narrative
   (label chip + narrative + signal bullets), generated in the viewer's language (EN/VI),
   cached server-side per `(definition_hash, lang)`.

## User-locked decisions (260607)

| Decision | Choice |
|---|---|
| Member-360 precompute scope | **Core (eager) panels only**, all eligible segments, daily cron. Lazy behavior panels stay live-on-expand. |
| Shared-segment permissions | **Full use for non-owners EXCEPT the destructive set** (rev. 2 after red-team M2, user-confirmed 260607): delete, visibility change, predicate rewrite, uid_list overwrite/append, activation-delete are owner/admin-only. Rename/cadence/analyses/refresh/export/brief stay open. |
| Brief language/model | **Viewer's language**, cached per `(definition_hash, lang)`; sonnet via existing gateway key (`CHAT_BRIEF_MODEL` override env). |
| Chat shared-nav UI | Merge into main list with "Shared" pill — no separate section (user-supplied mock, Image #2). |

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [LTV-tiered member sampling (server)](./phase-01-ltv-tiered-member-sampling-server.md) | Completed |
| 2 | [Members tab tiered redesign (FE)](./phase-02-members-tab-tiered-redesign-fe.md) | Completed |
| 3 | [Member-360 daily precompute cache (server)](./phase-03-member-360-daily-precompute-cache-server.md) | Pending |
| 4 | [Member-360 cache-first serving (server+FE)](./phase-04-member-360-cache-first-serving-server-fe.md) | Pending |
| 5 | [Segment sharing backend (owner_label + guards)](./phase-05-segment-sharing-backend-owner-label-guards.md) | Pending |
| 6 | [Sidebar shared pill + share UI (FE)](./phase-06-sidebar-shared-pill-share-ui-fe.md) | Pending |
| 7 | [AI brief backend (hash + cache + LLM)](./phase-07-ai-brief-backend-hash-cache-llm.md) | Pending |
| 8 | [AI brief card (FE)](./phase-08-ai-brief-card-fe.md) | Pending |

**Dependency graph:** 1→2, 1→3→4, 5→6, 7→8. Tracks (1–4) / (5–6) / (7–8) are independent —
parallelizable. Phase 7 prefers Phase 1 tier data for richer context but degrades without it.

## Existing substrate (verified by scouts, 260607)

- Random sample today: client-side seeded shuffle of `uid_list_json`, `SAMPLE_SIZE=50`
  (`src/pages/Segments/detail/tabs/sample-users-tab.tsx:29`). Enrichment live via
  `use-member-dim-rows.ts`.
- Refresh job materializes identity-only uids, no LTV (`server/src/jobs/refresh-segment.ts:66`);
  cron ticks 60s, honors `refresh_cadence_min` (`server/src/jobs/cron-runner.ts:15`).
- Precompute+cache precedent: `segment_card_cache` + `card-runner.ts` (concurrency 4, 30s/card,
  90s phase budget, status/error columns) + `card-cache-store.ts` upsert-if-changed.
- Member-360 page shipped (plan 260605-1200): registry `member360-panels.ts` (cfm full,
  ballistar core), `use-member-cube-query.ts` (semaphore 3), `build-panel-query.ts`.
- Segments **already have** `visibility personal|shared|org` + `canAccessSegment/canMutateSegment`
  (`server/src/auth/can-access-segment.ts:25-45`); list endpoint already returns shared/org rows
  to non-admins. Missing: `owner_label`, share endpoints, nav surfacing, owner-only delete guard.
- Chat sharing shipped (plan 260604-1524): `visibility/owner_label/shared_at` columns,
  share/unshare routes (`server/src/routes/chat.ts:422`), `/api/chat/sessions/shared`, `readOnly`
  flag, separate nav section (`src/shell/sidebar/sidebar-chat-recents.tsx:111`).
- One-shot LLM pattern for prod: `summariseTitle`
  (`chat-service/src/api/turn/maybe-summarise-title.ts:46-68`) — gateway-keyed.
  ⚠️ `defaultCallLlm` (`starter-question-refiner.ts`) strips the gateway env (local
  subscription auth, dev batches only) — unusable in prod (red-team C1). Per-feature model
  env overrides: `chat-service/src/config.ts:247`. Gateway↔chat-service internal call
  pattern: `chat-stats-client.ts` + `INTERNAL_SECRET` / `x-internal-secret`.
- Cube member physicalization: `cube-member-resolver.ts` (`physicalizeQuery`) — every server-side
  Cube query must go through it (prefix vs bare workspaces).
- Latest migration: `031-per-workspace-game-grants.sql`. Phase docs cite 032–035 as
  **indicative** — tracks are parallelizable, so assign the actual number = next-free at merge
  time (red-team m4); don't treat phase order as migration order.

## Cross-plan dependencies

- **260604-2319-segment-snapshot-pull-api (draft, not started):** its Phase 1 plans a
  `definition_hash`. Phase 7 here lands `segment-definition-hash.ts` first — snapshot plan must
  **reuse** that util, not re-implement (pointer added to that plan).
- **260605-1200-per-member-360-page (done):** Phases 3–4 build on its registry/hooks. Its open
  item (in-browser value reconcile) unaffected.
- **260604-1524-chat-session-isolation-and-publish (done):** Phase 6 restyles its nav section;
  share/unshare backend untouched.
- **260605-1147-segment-card-runner-and-refresh-cadence (done):** card-runner patterns (budgets,
  status columns, physicalization) are the template for Phase 3 and Phase 7 enrichment.

## Risks (top)

- **Cube load from member-360 precompute** (~1,350 queries/segment/day worst case): nightly
  window, low concurrency, per-segment budget, skip-if-unchanged. See Phase 3.
- **Middle-tier offset query correctness** on large segments (Cube `offset` near median). Phase 1.
- **Brief quality on games without mf_users enrichment**: explicit `limited` data-coverage
  disclaimer; never confident-thin output. Phases 7–8.
- **Permission tightening regression**: owner-only delete/visibility must not break existing
  collaborative editing paths; regression tests in Phase 5.
