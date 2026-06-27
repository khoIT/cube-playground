---
title: "Segment serving contracts & consumption observability"
status: pending
created: 2026-06-28
owner: khoitn
blockedBy: []
blocks: []
related:
  - plans/260626-1750-segment-members-paginated-pull-api   # shipped: the pull API this observes
---

# Segment serving contracts & consumption observability

Separate **exploration** segments (scratch analysis, disposable) from **served** segments
(published contracts a downstream LiveOps/CS app pulls by id). Make "served" an explicit,
owned, observable state instead of an accident of refresh cadence.

Design source: huashu mockup `served-vs-exploration-segments.html` (artifact
`cb891575-ebf0-4dc9-af75-8b99ac4e1846`). Concepts B (library lanes), C (lifecycle +
contract + promotion), D (snapshot schedule + per-app tokens), E (consumption history).

## Locked decisions
- **Served = explicit publish flag** (new `lifecycle` column + "Publish for downstream" action). Not derived.
- **Pull audit = per-page events**, enriched with latency / snapshot version / http status / failed-auth.
- **Scope = full B+C+D+E** in v1.

## What already exists vs what's NEW (red-team corrected — read carefully)
- **Scoped keys (exist):** `api_keys` scoped to `workspace+segment_ids+game_ids`, with free-text `label`/last-used/revoke/expiry/recoverable; admin UI `src/pages/Admin/hub/api-keys-tab.tsx`; routes `server/src/routes/api-key-admin-routes.ts`. ⚠️ A key has a **label, not an app identity** — "per-app" is a display convenience; the data dimension is `key_id`. Do NOT claim app identity (breaks on key rotation). See Phase 3.
- **Pull log (partial):** `public_pull_audit` exists BUT captures **stream pulls only** — the paged JSON/`csv_paged` branch (`handleMembersPage`, `public-export.ts:381`) writes **no audit row today**. Columns are `key_id, segment_id, started/finished, rows, source, format, status, ip` — there is **NO latency / snapshot_ts / http_status / page_index** (those are added in Phase 0). So consumption (E) reads empty until Phase 2 ships paged-pull auditing.
- **Rate limiter (EXISTS — earlier plan said it didn't):** `server/src/services/api-key-rate-limiter.ts` enforces per-key concurrency + daily quota and returns **429 on the stream path** (`public-export.ts:305`) *before* the audit opens (so today's 429s are uncaptured). The **paged path is unlimited**. Phase 2 must capture 429 and decide paged-path limiting.
- **Snapshot job + `track_cadence` + `snapshot_ts` (exist):** `server/src/jobs/snapshot-segment-membership.ts` (window **[08:00,24:00) GMT+7**), `services/snapshot-cadence.ts` (daily bucket rolls at **00:00**), `segment-page-token.ts` (snapshot pinned in the *outgoing* token only — page 1 has no incoming token).
- **Activation tab + recipes (exist, but modal NOT reusable as-is):** `pull-api-tab.tsx` (already 872 LOC — split, don't grow), `paginated-pull-card.tsx`. ⚠️ `CreateKeyModal`/`PlaintextReveal` in `api-keys-tab.tsx` are **non-exported, no pre-scope prop, admin-gated mint** — Phase 5 reuse = an explicit extract + new props, not drop-in.

## Migration runner invariant (must respect — red-team)
`server/src/db/sqlite.ts` sets `user_version = files.length` (a **count**) and runs `files.slice(currentVersion)`. The dir has **permanent gaps** (044/045/047/070); "next free = 076" works only because all gaps are below it. **Never back-fill a gap.** Each migration file must be transaction-safe (SQLite `ADD COLUMN` has no `IF NOT EXISTS`); a half-applied multi-statement file wedges boot with no rollback — wrap each file's exec in a transaction and document the manual recovery (`PRAGMA user_version`).

## Phases
| # | Phase | Status | Depends |
|---|-------|--------|---------|
| 0 | Data model — `lifecycle` flag + per-page audit enrichment (migrations 076/077) | done | — |
| 1 | Backend — serving-contract compute + publish/demote endpoints | done | 0 |
| 2 | Backend — per-page audit capture + failed-auth logging | done | 0 |
| 3 | Backend — per-segment consumption rollup + tokens-by-segment endpoints | done | 1,2 |
| 4 | Frontend — library lane split + served badge + publish action (B) | done | 1 |
| 5 | Frontend — activation tab: contract banner + schedule + per-segment tokens + promotion (C,D) | done (scoped) | 1,3 |
| 6 | Frontend — per-segment consumption view (E) | done | 3 |
| 7 | Tests + docs sync | done | 4,5,6 |

### Post-ship UX pass (2026-06-28, variant B)
Operator-tested the shipped tab; three fixes:
1. **Consumption "0 pulls" bug** (`segment-consumption-store.ts`): the pull log listed rows but the summary read 0. Root cause — pulls/consumingKeys/byKey/dailyByKey all filtered `audit_schema='v2'` while the log didn't, so pre-enrichment (legacy) pulls vanished from the headline. Fix: counts now cover ALL audited rows (a pull is a pull); only ENRICHED metrics (success/p95/freshness/outcomes) stay v2-only. `successRate` → `number|null` (null → UI "—", not a fake 0%). +1 regression test (4/4).
2. **Demote button** moved from a floating bottom-right orphan into the persistent contract header.
3. **Tab redesign — huashu variant B (job-to-be-done switcher)**: 3 hi-fi HTML variants explored (`design-demos/variant-{a,b,c}*.html`), user picked B. New structure under `tabs/pull-api/`:
   - `pull-contract-header.tsx` — merges the old serving-banner + snapshot-strip (killed the status/members/game/computed/filters duplication) into one persistent row; owns publish/demote/re-publish.
   - `pull-job-switcher.tsx` — two captioned intent cards (Build / Monitor·admin).
   - `build-mode-view.tsx` — integration docs (brand card, paginated pull, Trino SQL, auth recipes, preview, PII), moved out of the 872-LOC tab.
   - `monitor-mode-view.tsx` — schedule + edit-guard note + tokens + consumption.
   - `pull-api-tab.tsx` is now a thin orchestrator (<70 LOC); Monitor gated on `useAuthUser()?.role==='admin'` (its endpoints are admin-only). Deleted `serving/serving-contract-section.tsx` + `serving/serving-contract-banner.tsx` (superseded). Verified live (both modes screenshot-checked).

### Implementation notes (2026-06-28)
- Shipped commits: `22797f49` (backend 0–3), `ec899de5` (lanes 4), `c894df1f` (activation 5), `562c3dd5` (consumption 6), `66fec46e` (tests 7).
- **Rollout decision (user-confirmed):** existing segments default to `draft` → publish manually. Lifecycle gate is a breaking change to the shipped pull path (intended); fixtures updated to serve their segments.
- **Phase 5 scope adjustments (vs plan, surfaced):** (a) inline token MINT ("Issue token", CreateKeyModal extraction) deferred — tokens table is read-only + deep-links to the admin API-keys tab (the plan's non-admin fallback, applied for everyone); (b) `publish-segment-modal.tsx` realized as an antd `Modal.confirm` (no separate file); (c) `pull-api-tab.tsx` (872 LOC, pre-existing) NOT split — serving sections are self-contained <200-LOC modules mounted via one line; the file remains over the 200-LOC rule (pre-existing debt).
- **Phase 4 DRY:** one reusable `library-lane-section.tsx` instead of separate `served-lane`/`exploration-lane` files.
- Tests: 13 new (next-ready clamp, publish/demote + pull-path kill-switch, consumption rollup math). Non-admin 403 paths covered by the shared `guardSegment`/admin gate (same gate as share/pull-credentials, already tested). Note: `buildApp`-heavy route tests can exceed the default 5s vitest timeout under machine load — not a regression.

## Key dependencies / constraints
- SQLite (better-sqlite3); migrations `server/src/db/migrations/NNN-*.sql`, run on boot by count-based `user_version` (see invariant above). Next free = **076**.
- Snapshot only runs where `SEGMENT_SNAPSHOT_ENABLED=true`; "served" requires a snapshot to pull → publish guard checks snapshot enabled.
- Times shown to users in **GMT+7** (Asia/Saigon).
- A **rate limiter already exists** (per-key concurrency + daily quota, 429 on stream). Phase 2 captures its 429s; building a *new* limiter is out of scope, but adding the existing limiter to the paged path IS in scope (parity decision in Phase 2).
- **Demote is enforced** (user decision): the public pull path gains a `lifecycle = 'served'` gate so demote/unpublish actually denies pulls (403), not advisory-only.
- **Per-page audit retained** (user decision) → the retention-prune ships in Phase 2 (not deferred).
- Authz: publish/demote = `guardSegment(…, 'administer')` (owner-or-admin); consumption/tokens reads = **admin-only** (mirror pull-credentials exactly, not "owner/admin").
- Design tokens only (`src/theme/tokens.css`); served accent = segment-member violet (`--layer-segment`). FE files <200 LOC → modularize (`pull-api-tab.tsx` already over — split during Phase 5).

## Out of scope (v1)
- A *new* rate-limiter. Per-consumer SLA alerting/notifications. Cross-segment "all consumers" dashboard (admin tab already covers global). Auto-archiving stale exploration segments. Stable cross-rotation app identity (`app_id`) — consumption groups by `key_id`, deduped by label for display with an explicit caveat.

## Red Team Review

### Session — 2026-06-28
4 reviewers (Security / Failure-Mode / Assumption-Destroyer / Scope). ~27 findings → deduped to 14, all `file:line`-evidenced (all passed the evidence filter).
**Accepted (applied):** 10 correctness/security + drop nothing. **Surfaced to user (decided):** scope kept full B+C+D+E; per-page kept (prune now in Phase 2); demote = enforce.

| # | Finding | Sev | Disposition | Applied |
|---|---------|-----|-------------|---------|
| 1 | Publish/demote name no authz gate | Critical | Accept | P1 |
| 2 | consumption/tokens must be admin-only (not owner/admin) | High | Accept | P3 |
| 3 | Failed-auth DB writes = token-spray DoS + NOT-NULL violation + key-byte leak → log to `req.log`, not the audit table | High | Accept | P0,P2 |
| 4 | Count-based `user_version` + dir gaps → migration ordering fragility | Critical | Accept | P0 |
| 5 | Non-transactional multi-ALTER file half-applies → boot wedge | Critical | Accept | P0 |
| 6 | snapshot_ts/page_index not recoverable from token (page 1 / no index field) | High | Accept | P0,P2 |
| 7 | "No rate-limiter" false; 429 live & uncaptured; paged path unlimited | High | Accept | P2 |
| 8 | Demote race + pull path never reads lifecycle = false safety | High | Accept (enforce) | P1 |
| 9 | next-ready: 00:00 bucket vs [08:00,24:00) window; `Off` dead-code | Med | Accept | P1 |
| 10 | Consumer count scope-derived → wildcard key counts everywhere; make audit-derived | High | Accept | P3 |
| 11 | "per-app" = key_id relabel, breaks on rotation | Critical→High | Accept (rename) | P3 |
| 12 | Paged unaudited + audit lacks enrich cols → "already exists" overstated | Critical | Accept (doc fix) | plan,P2 |
| 13 | CreateKeyModal not exported/scopeable + admin-gated mint → reuse = refactor | High | Accept | P5 |
| 14 | pre-enrichment NULL vs legacy-partition NULL snapshot_ts conflated | Med | Accept | P3 |
| — | Per-page write-amplification; deprecated state; Phase-6 dup of AuditSection; MVP-first | High | User-confirmed full scope — cost noted, prune→P2, reuse AuditSection/chart renderer→P6 | P2,P6 |
