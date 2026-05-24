# Metrics Trust Tier Cleanup Shipped

**Date**: 2026-05-25
**Severity**: Medium
**Component**: metrics, trust-resolver, API
**Status**: Resolved
**Commit**: 244e19f on main
**Plan**: plans/260525-0012-metrics-trust-tier-cleanup/

## What Shipped

- Collapsed trust tiers from 5 to 3: `certified | draft | deprecated`. Folded unused `beta` and undocumented `orphaned` into `draft`.
- Auto-draft resolver: new `server/src/services/metric-trust-resolver.ts` (~130 LOC) wraps `GET /api/business-metrics[/:id]?game=<id>` at response time. Per-game cache (60s TTL), stores metaHash + trustMap. Fail-open on Cube errors (missing token or /meta fetch → return declared trust + warn).
- Pre-cleanup: 45 of 57 ballistar presets had unresolved Cube refs but were labeled `certified`. Badge was lying. Auto-draft now corrects this at request time.
- Tier (T1/T2/T3) hidden from all user surfaces (metric card, list row, filter rail, chat tool) but preserved in data model (Zod, YAML presets, FE interface) for future curation (Featured KPIs dashboard, starter-question ranking).
- Trust filter chip in `metrics-filter-rail` now renders via `TrustBadge` for consistency.

## Decisions Worth Remembering

**Request-time wrapping over loader mutation.** Wrapped at route handler instead of mutating loader state. Keeps `loadAll()` pure (file → memory) so cron jobs and anomaly-detector see raw declared trust. Only HTTP consumers see auto-draft adjustment.

**YAMLs stayed pristine.** Team's declared intent preserved on disk. When Cube schema is fixed, auto-draft naturally lifts without re-editing.

**Tier preserved despite being hidden.** Initial instinct: delete. Reconsidered: 57-metric curation (headline/working/specialist) is real signal. Future surfaces (Featured KPIs, starter-question ranking) can use it. Cost of keeping: 5 lines in Zod + one field per preset. Cost of killing: re-curate 57 metrics later.

**Fail-open on Cube down.** Return declared trust + warn instead of drafting everything. Stale green better UX than false negatives on brief downtime.

**Backwards-compatible.** `?game=` optional; callers without context get declared trust unchanged.

## Follow-ups

- 45 broken Cube refs: separate effort to fix formulas and lift auto-draft. Tracked separately.
- Featured KPIs dashboard: can now consume preserved tier signal.
- Starter-question ranking: can now use tier for prioritization.

## Verification

FE 863/863 passing, server 182/182, chat-service 210/210, TypeScript clean.
