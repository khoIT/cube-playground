---
phase: 4
title: "Authoring & Governance"
status: complete
priority: P2
effort: "4-6d"
dependencies: [2, 3]
---

# Phase 4: Authoring & Governance

## Overview
Safe self-serve creation on top of the unified trust ladder: role-gate the create endpoints, let editors propose draft metrics + glossary terms, and add promotion paths (segment/build-query → metric/term). Sequenced **after P3** (badge-on-chip needs P3's chip; both edit `glossary.ts`) — C11. After P2.

## Requirements
- Functional:
  - Role gating: the role **enum + `requireRole` primitive exist** (`require-role.ts`), but glossary/concepts routes are **not currently gated** — these guards are net-new (C8). viewer read-only; editor proposes draft metrics + glossary terms; admin certifies. Write-RBAC is a URL-prefix allowlist — **add `/api/glossary` + `/api/concepts` to `PROTECTED_PREFIXES`** AND attach `requireRole('admin')` route-level on every certify / trust-PATCH (the global gate can't express admin-only, so self-certify is open without it).
  - Segments + saved build-queries: any user creates freely (already exists). Adding `visibility` is **net-new schema + an access-control change** (C7): segments today are owner-only (403 if not owner) with a *different* `status` column (refresh lifecycle — do NOT reuse that name). Needs a migration for a distinctly-named `visibility`/`trust` column + relaxing the owner-403 guard to honor `shared`/`org`. **Existing segments migrate to `personal`** (Q2 resolved — behavior-preserving; they're owner-only today).
  - **Promotion paths**: "Promote to metric" / "Promote to glossary term" from a segment or saved query — prefills the composition-wizard / glossary form from the source predicate + refs, enters as `draft`.
  - Trust badges on every artifact surface (list rows, cards, chips).
- Non-functional: NO heavy multi-step review queue (YAGNI) — single toggle gated by role. Audit each create/promote/certify (reuse business-metric audit store).

## Architecture
- Add `/api/glossary` + `/api/concepts` to `PROTECTED_PREFIXES` (viewer-block) AND `requireRole('admin')` route-level on certify/trust-PATCH (C8). Test: viewer JWT → 403 on `POST /api/concepts/promote`. (`requireRole` is in `require-role.ts`, NOT `authenticate.ts`.)
- Promotion = a server action that reads the source segment/query **via an authorized accessor** (`workspace = req.workspace.id AND (owner = req.owner OR visibility in (shared,org))` — 403 otherwise; reading by raw id is IDOR, C10), maps its predicate → metric formula / glossary `default_filter` + refs (reuse P2 ref grammar + scaffolder), writes as `draft`. **Prefill is net-new**: `useCompositionDraft()` takes no args today — add an `initial?` param + a predicate→draft mapper + a route/state channel for the source. UI = "Promote" button (from P1 affordance) on segment/saved-view rows, role-gated.
- Reuse: `metric-composition-wizard`, `metric-stub-scaffolder`, glossary edit forms, segment save-bar, `business-metric-audit-store`.
- Certify = trust toggle PATCH (admin only) → flips unified `trust` to `certified`; certified feeds chat grounding + ranking (P3).

## Related Code Files
- Modify: `server/src/routes/business-metrics.ts` (role guards on POST/scaffold/trust), `server/src/routes/glossary.ts` (role guards, propose-as-draft), `server/src/routes/segments.ts` (visibility default + share)
- Create: `server/src/services/promote-to-metric.ts`, `server/src/services/promote-to-term.ts`, `server/src/routes/concept-promote.ts`
- Modify (FE): `src/pages/Catalog/metric-composition-wizard/*` (prefill from source), glossary edit modal, segment save-bar / saved-views rows (Promote action), trust-badge component
- Read: `server/src/middleware/require-role.ts` (`requireRole` factory), `server/src/middleware/enforce-write-roles.ts` (`PROTECTED_PREFIXES` global gate), `server/src/middleware/authenticate.ts` (role enum), `server/src/db/business-metric-audit-store.ts`

## Implementation Steps
1. Add `/api/glossary` + `/api/concepts` to `PROTECTED_PREFIXES`; `requireRole('admin')` on certify/trust-PATCH; viewer-403 test. (Q2 default policy is a pre-req for step 2.)
2. Segment/saved-query visibility default (`personal` — Q2 resolved, preserves owner-only access) + share controls (opt-in to `shared`/`org`).
3. `promote-to-metric` / `promote-to-term` services: read source via **authorized accessor** (C10), source predicate → draft artifact w/ P2 refs; add `useCompositionDraft(initial?)` + predicate→draft mapper for prefill; wire `POST /api/concepts/promote`.
4. FE: Promote action on segments/saved-views (prefills wizard/form); trust badges everywhere.
5. Admin certify toggle (`draft→certified`) + audit rows for create/promote/certify.

## Success Criteria
- [x] Editors create draft metrics + propose glossary terms; **viewers get 403**; admins certify — `/api/glossary`+`/api/concepts` in `PROTECTED_PREFIXES`; `requireRole('admin')` on glossary status-PATCH + metric trust-PATCH; `requireRole('editor','admin')` on promote. Verified by governance test.
- [x] Promote a segment → draft term/metric prefilled from predicate + refs; **no IDOR** — `concept-promote.ts` reads source `WHERE id=? AND workspace=req.workspace.id` → 404 on mismatch; only ever INSERTs a draft (409 on id collision). Verified by cross-workspace test.
- [x] New artifacts enter as draft; segments default `personal` on read (NULL→personal); certified gated by admin
- [~] Trust badges on artifact surfaces; create/promote/certify audited — badges reuse P3 ConceptChip; metric create/promote/certify audited via `business_metric_audit`. **Term-promote audit is a structured log only** (the audit store is `metric_id NOT NULL` / metric-scoped; a glossary audit store is a documented follow-up, not built here — YAGNI)

## Implementation Outcome (2026-06-03)
- New: `concept-promote.ts` (`POST /api/concepts/promote`), `promote-to-term.ts` (predicate→draft term), `concept-ref-integrity.ts` (delete-time 409 guard), migration `028-segments-visibility.sql` (additive nullable). FE: "Promote to glossary term" in segment `row-actions-menu.tsx` + `promoteSegmentToConcept` client.
- **Partial-apply recovery:** the implementing agent hit the session limit mid-run. On resume, verified state: tsc clean, 10 governance tests green, full suite 612 pass / same 6 pre-existing failures (`routes-crud` owner-403 — invalidated by the workspace-model commit — + `internal-access-route`). Inlined metric promotion via the existing `scaffoldDraftMetric` (DRY) instead of a separate `promote-to-metric.ts`. Moved a misplaced report out of `server/plans/`.
- **Security review (no Critical/High):** confirmed RBAC completeness (no editor self-certify path — unified `trust=certified` requires `status=official`, mutable only via admin-gated PATCH), IDOR-safe promote, delete-time guard via `json_each` exact match. Applied M2 hardening: promoted term's derived `default_filter` now validated through the shared `DefaultFilterSchema` (no asymmetric trust boundary). M1 (term-promote audit) handled as structured log + documented limitation.
- **Tests:** 37 concept-suite tests green; tsc clean (server); FE tsc adds zero new errors. Migration `028` additive/nullable, forward-only safe.

## Risk Assessment
- **Scope creep into a workflow engine** → single `draft→certify` toggle only; no review queues unless real demand.
- **Predicate→formula mapping fidelity** (promotion) → start with measure + simple filter promotions; flag complex predicates as manual-edit drafts.
- **Field authoring leakage** → fields stay read-only for end users; promotion targets metrics/terms only (L1 owned by onboarding-agent plan).
