---
title: "Segment Members Paginated Pull API"
description: ""
status: pending
priority: P2
branch: "main"
tags: []
blockedBy: []
blocks: []
created: "2026-06-26T11:25:06.963Z"
createdBy: "ck:plan"
source: skill
---

# Segment Members Paginated Pull API

## Overview

Add a **paginated full-cohort pull** to the public segment members API (shipped in `260625-1106-public-segment-export-api`): downstream consumers page through the *entire* cohort (millions of uids) 1000-at-a-time via an opaque `page_id`, with a **stable point-in-time** guarantee (page N belongs to the same cohort as page 1).

Reads the existing nightly Iceberg snapshot `stag_iceberg.khoitn.segment_membership_daily` directly for predicate segments, and `uid_list_json` for manual segments — **zero new storage, no migration, no new table**. Closes "Gap A": today's full-cohort read only exists as a single NDJSON/CSV *stream*; this adds a discrete JSON page model consumers can resume at their own pace.

### Scope boundary (explicit)
- **IN:** asks #1 + #2 — paginated, stable-point-in-time, full-cohort pull of an *already-defined* segment.
- **OUT (deliberately cut):** bonus #3, custom-filter refine API. Rationale: letting downstream POST arbitrary `{field,op,value}` creates **shadow segments** — cohorts with no owner, lineage, trust-tier, or visibility in the tool — violating "all exploration happens in cube-playground," and an unmaintainable per-segment field-validation surface at the API edge (the original example fields `total_ltv`/`days_since_last_active` don't even exist in the catalog). Refinement = define a new *governed* segment in the tool, then pull it by id. Revisit only if multi-consumer self-serve demand appears, and then as governed segment-creation, not raw API filters.

### Locked decisions (from brainstorm + red-team — authoritative)
- The full-cohort reader is wired into the **API-key `/api/public/v1/...` surface ONLY**. The tokenless `/api/segments/:id/members` (`segments.ts:878`) stays capped at the top-1000 redacted snapshot — regression-tested. (Prevents mass-uid exposure on the unauthenticated route.)
- **Stable point-in-time:** `page_id` pins the snapshot. For predicate segments the reader picks the latest `(snapshot_date, snapshot_ts)` at page-1 and freezes it; subsequent pages walk that pinned partition. `page_id` is opaque, encodes `{ source:'daily'|'manual', segmentId, snapshotDate?, snapshotTs?, lastUid }`, and is rejected if its `segmentId` ≠ the path `:id` (so it can't be re-pointed at another segment; the path is already scope-checked, so no HMAC needed).
- **`snapshot_ts` is nullable** (legacy/daily rows). Reader uses a NULL-tolerant predicate (`snapshot_ts IS NULL` when pinned ts is null), mirroring `segment-overlap-counts.ts:69`. Never `= NULL`.
- **No partition + predicate segment → `409` "no snapshot available; refresh the segment first"**, NOT silent-empty and NOT a live compile (a live compile can't be point-in-time). Requires `SEGMENT_SNAPSHOT_ENABLED=true` on the target instance — a verified prerequisite.
- **Manual (uid-list) segments are served**: reader pages from `uid_list_json` (uid-sorted keyset), `source='manual'`. Point-in-time is the list as-of page-1 (note the edit-mid-pull caveat).
- **Out-of-scope/unknown segment → `404`** (no existence leak), matching `loadScopedSegment` (`public-export.ts:296`). Never 403.
- **No rank** — uid-ordered only.
- **`total_count`** is looked up server-side (segment `uid_count` / `COUNT(*)` over the pinned partition), **not** trusted from the token.
- Reuse the existing `streamExportPages` keyset loop internally (DRY) — don't build a parallel pager; the JSON mode is a thin wrapper that returns `page_id` instead of streaming.

### Verified codebase anchors
- Public members route: `server/src/routes/public-export.ts:157` (NDJSON/CSV stream; uid-keyset `cursor` already exists; API-key auth via `requireApiKey` hook → `req.apiKeyScope`; scope gate `canKeyAccessSegment` / `loadScopedSegment` at :288-299, returns null→404).
- Keyset engine to reuse: `server/src/services/segment-export-stream.ts` — `resolveExportSource()` (table vs live), `streamExportPages()` keyset loop (`uid > cursor ORDER BY uid LIMIT n`), `PUBLIC_EXPORT_PAGE_SIZE` default 50_000; executes via `streamQuery(connector, schema, sql)`; `toSqlLiteral` for safe literals (`inline-sql-params.ts:31`).
- Tokenless route (must stay capped): `server/src/routes/segments.ts:878` + `redactSensitiveMembers`.
- NULL-ts handling precedent: `server/src/lakehouse/segment-overlap-counts.ts:69`.
- Manual members: `uid_list_json` column on segments (`public-export-routes.test.ts:41` seeds it).
- Iceberg table (read-only here): `segment_membership_daily`, partition `(snapshot_date, game_id, segment_id)`, `sorted_by uid` (`segment-membership-ddl.ts:48-53`) — keyset over uid matches sort.
- Snapshot gating to verify on target: `SEGMENT_SNAPSHOT_ENABLED` default false, 08:00–24:00 GMT+7 window, predicate-only (`snapshot-segment-membership.ts:110,481`).
- Tests: **Vitest** in `server/test/`; route tests `app.inject()` + `:memory:` DB (`setDb(makeMemDb())` runs migrations from disk); service tests inject mocked `query`; `vi.mock()` lakehouse readers. Examples: `public-export-routes.test.ts`, `compute-segment-size.test.ts`.

### Conventions (repo dev rules)
Files < 200 LOC; kebab-case; no plan-reference strings in code/test names. Each phase: tests pass → code-reviewer gate. Verify against running stack (API :3004, FE :3000).

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Keyset pagination reader](./phase-01-keyset-pagination-reader.md) | Pending |
| 2 | [JSON paginated members endpoint](./phase-02-json-paginated-members-endpoint.md) | Pending |
| 3 | [Frontend + OpenAPI docs](./phase-03-frontend-openapi-docs.md) | Pending |

## Dependencies

- **Builds on (shipped):** `260625-1106-public-segment-export-api` — API-key auth, `/api/public/v1/segments/*` surface, NDJSON/CSV streaming members endpoint, OpenAPI/Scalar docs. Extends that surface; not a hard `blockedBy` (already complete).
- **Relies on (existing infra, read-only):** nightly `snapshot-segment-membership` job + Iceberg `segment_membership_daily` table; `streamExportPages` keyset engine; `loadScopedSegment` scope gate.
- **Runtime prerequisite:** `SEGMENT_SNAPSHOT_ENABLED=true` on the target instance (else predicate-segment pulls 409). Verify before/at Phase 2.

## Sequencing
Linear: P1 (pure reader: daily + manual sources, keyset, pin, NULL-ts, no-snapshot error) → P2 (wire JSON `page_id` mode onto the public endpoint, scope/404/409, tokenless-route regression lock) → P3 (docs + Pull API tab).

## Red Team Review

### Session — 2026-06-26
Adversarial review (4 reviewers) ran against the prior 6-phase version (which included bonus #3). Outcome: **bonus #3 descoped entirely** on governance grounds (shadow-segment risk) + user decision, which removed 2 Critical + 5 High findings (token IDOR, job-recovery leaks, refine DoS, SQL-literal injection, predicate-merge mismatch, refined-TTL truncation, field-existence). Findings about the surviving base pull were folded into this plan's locked decisions:

| # | Finding | Severity | Disposition | Applied |
|---|---------|----------|-------------|---------|
| 1 | Token IDOR via forged `result_id` | Critical | Resolved by descope (no refined source); residual: reject `page_id` whose `segmentId`≠path `:id` | Locked decisions, P1 |
| 2 | Crashed/pending jobs leak | Critical | Resolved by descope (no jobs) | — |
| 3 | Base pull empty where stream returns data (`SEGMENT_SNAPSHOT_ENABLED` default false, no live fallback) | Critical | Accept → 409 on no-partition, verify flag | P1, P2 |
| 4 | Headline filter fields don't exist | Critical | Resolved by descope (no custom filters) | — |
| 5 | "Gap A" could expose tokenless route | High | Accept → reader on `/public/v1` only; tokenless capped + regression test | P2 |
| 6 | NULL `snapshot_ts` → false 410 | High | Accept → NULL-tolerant predicate | P1 |
| 7 | `403` vs `404` existence leak | High | Accept → 404 everywhere | P2 |
| 8 | Manual segments silent-empty | High | Accept → page `uid_list_json` | P1, P2 |
| 9 | `page_id` reinvents existing cursor | Med | Accept → reuse `streamExportPages` keyset loop internally | P1 |
| 10 | `total_count` trusted from token | Med | Accept → look up server-side | P1 |
| 11 | Per-page latency overstated ("cheap") | Med | Accept → perf spike + honest latency note | P1 |

**Whole-plan consistency:** plan rewritten from scratch around the descope; no stale refine/job/migration references remain in plan.md or phase files (verified — phases 4-6 of the prior version deleted).
