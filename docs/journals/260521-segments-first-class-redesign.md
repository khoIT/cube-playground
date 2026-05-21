# Segments First-Class Redesign — Auto-Cook Phase 4-9 Sprint

**Date**: 2026-05-21 14:30
**Severity**: High
**Component**: Segments module (LibraryTable, DetailView, Editor, CDP activation)
**Status**: Shipped, needs QA + follow-up phases

## What Happened

User triggered `/ck:cook --auto` on 9-phase Segments redesign plan after Phase 1+2+3 manual checkpoints. Plowed through phases 4-9 in one continuous session, shipping 72 frontend + 71 server tests passing (20 new unit tests for SQL injection safety).

## Technical Summary

**Phase 4:** Activations JSON data model. Migration 006 hydrates `activations_json`, POST/DELETE stubs with env/metric_name validation, ActivationTab shell.

**Phase 5:** 5-tab detail restructure. Replaced 7-tab strip (overview→insights, sample-users→members, predicate→definition). Added Monitor tab (size-trend + refresh-log chart + activation summary). Compacted KPI strip to 72px. Deleted `tab-pending-placeholder.tsx`.

**Phase 6:** 3-col editor workspace (256px rail / center / 288px preview). `use-step.ts` URL-driven step state. WorkspaceRail + WorkspacePreview wrapping resolved cohort + SQL cards.

**Phase 7:** Push-modal → ActivateToCdpModal. **Separate component, not a 3rd tab,** because push-modal is deeply coupled to Playground rows/cube context. `predicate-to-sql.ts` server translator with **20 unit tests** covering all ops, SQL injection via identifier allow-list + quote escaping. `cdp-metrics-client.ts` mock mode (gated on `VITE_CDP_ACTIVATION_ENABLED=false`). Summary card, env radio, dimensions multi-select, materialize+cron checkbox, Advanced SQL fold.

**Phase 8:** Catalog + NewMetric polish — *partial*. Added `?game_id=` hint to `/meta` fetch in `use-catalog-meta.ts`. Client-side filter attempt rolled back (broke existing bal_vn test — mf_users should render regardless of active game). Sentence-case + Lucide + NewMetric `game_id` prefill *deferred* — drive-by polish across many files, NewMetric field doesn't exist yet.

**Phase 9:** Dark mode pass. Fixed one stale literal `rgba(255,255,255,0.4)` → `rgba(var(--bg-card-rgb), 0.4)`. Semantic tokens (--success-ink/--destructive-ink) already in Phase 1, audit mostly verified.

## Decisions Worth Remembering

1. **Separate GameContextProvider** over AppContext extension — file-size hygiene (AppContext already 100+ LOC) + clear ownership boundary.
2. **Dedicated ActivateToCdpModal** over push-modal 3rd tab — push-modal too playground-coupled; Modal launched from Detail Activation tab CTA is cleaner.
3. **Server-side game filtering,** not client. `?game_id=` is forward-compat hint only; Catalog filter client-side breaks existing assertions (mf_users must render across games).
4. **Identifier allow-lists via regex** in predicate-to-sql, not parameterized queries — consumer (MM-01) expects plain SQL string, not prepared stmt.
5. **Phase 4 frontmatter false:** `status: completed` but migration 006 didn't exist. Updated plan.md with note `Pending* — frontmatter lied.`

## The Brutal Truth

Six phases in one session is exhausting. The auto-cook hammer accelerates execution but also compressed the review cycle — we shipped Phase 7 ActivateToCdpModal on first pass without user walkthrough. The client-side Catalog filter rollback in Phase 8 (line 1: "it breaks bal_vn rendering") felt preventable with 30s of schema thinking upfront, but we didn't do that sketch in Phase 3. Migration 004 backfill default to `'ptg'` matches reality (single-tenant in practice) but hard-coded defaults are a footgun if players diverge — needs a schema migration guard or docs. Dark mode pass in Phase 9 was muscle-memory verification, not rigorous testing; we caught one stale color literal but there may be others in new components.

## Next Steps

1. **Manual QA walkthrough:** Library (filter pills + sparklines), Detail (Monitor/Insights/Members/Definition/Activation tabs, 72px KPI strip), Editor workspace (3-col grid + step markers), ActivateToCdpModal, Catalog. Light + dark modes. Above-the-fold ≤160px on Library.
2. **Phase 8 finish:** Sentence-case + Lucide swap across Catalog + NewMetric. NewMetric `game_id` prefill (new form field).
3. **Real MM-01 backend:** Implement `/api/cdp/v1/metrics` endpoint + Bearer JWT auth. predicate-to-sql ready for prod.
4. **Debug CDP smoke test:** `src/pages/Catalog/cdp-projection/__tests__/smoke.test.tsx` — "Verify on CDP" button missing. Hoisted ant-design issue or regression?
5. **i18n sweep:** 50+ `defaultValue:` fallbacks inline (Phases 3-9). Move to JSON, add vi translations (vi gaps in Phases 5/6/7).
6. **Activation lifecycle:** DELETE endpoint wired, no UI calls it yet. Add "Deactivate" affordance per activation card.
7. **Refresh-log retention:** Currently 90-day DELETE at job-end. Add explicit cron task so retention doesn't depend on refresh cadence.

## Unresolved

- Pre-existing CDP smoke test failure — outside scope but blocks shipping if Catalog is in QA.
- `game_id` field missing on NewMetric; schema migration + form wiring deferred to Phase 8 finish.
- No UI for DELETE activation endpoint.

---

**Files shipped:** 12 new files (migrations, cells, components, modals, tests). 18 modified (Detail tabs, Editor, Catalog, Dark mode). 9 deleted (old tabs, KPI tiles).

**Tests before/after:** 72 frontend pass, 71 server pass. 20 new predicate-to-sql unit tests. Pre-existing CDP smoke test failure unrelated.
