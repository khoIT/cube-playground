# Red-Team Plan Review — Scope & Complexity Critic

**Reviewer lens:** YAGNI enforcer + Contract Verifier (duplication of shipped work)
**Plan:** `plans/260603-1439-workspace-isolation-and-sysadmin-hub/` (plan.md + phase-01..07)
**Verdict:** Phase 1 + 2 + 3 are sound and grep-verified. **Phase 6 is ~70% rebuild of shipped UI.** **Phase 4/7 telemetry is gold-plated past what the user's own researcher scoped as v1.** Recommend collapsing 7 phases → 5 and deferring half the telemetry to v2. User-confirmed decisions flagged, not silently reversed.

---

## CRITICAL

### C1. Phase 6 rebuilds shipped AccessEditor functionality — "fine-grained controls" already exist
**Evidence:** `src/pages/Admin/access/access-editor.tsx:25-114`, `use-admin-access.ts:92-121`, `grant-matrix.tsx`.

Phase 6 ("Make the per-user panel fully operational… set role/status, workspace grants, game grants, feature visibility") lists as deliverables things that are **already shipped and working**:

| Phase 6 "requirement" | Already exists |
|---|---|
| Save role/status `PATCH /api/admin/users/:email` | `access-editor.tsx:48` `patchAdminUser` |
| Save workspaces `PUT …/workspaces` | `access-editor.tsx:35` `putAdminUserWorkspaces` |
| Save games `PUT …/games` | `access-editor.tsx:36` `putAdminUserGames` |
| Save features `PUT …/features` | `access-editor.tsx:38-42` `putAdminUserFeatures` |
| Last-admin 409 inline (no crash) | `access-editor.tsx:5` header + `roleMsg` 51-52, 82-93 |
| Last login shown | `access-editor.tsx:63` |
| All four mutations from one panel | the whole `AccessEditor` already does this |

Phase 6's *genuinely net-new* surface is small: (a) game-count label ("4 of 12"), (b) switch-ability derivation from ≥2 workspaces, (c) bulk select-all/clear, (d) effective-default-vs-override display, (e) "last changed by/at" from `access_audit`, (f) optimistic-with-rollback. That is **a ~1-day enhancement to `GrantMatrix` + a pure selector**, not a 3-4d phase. The plan's own framing ("Backend mutation API already exists; this wires the UI to it") understates that the UI *also* already exists. **Recommend:** rescope Phase 6 to "GrantMatrix enhancements + derive-user-experience selector" (~1-1.5d), drop the re-implication.

### C2. Phase 2 backfill `NULL → shared` directly contradicts the shipped migration-028 contract
**Evidence:** `server/src/db/migrations/028*.sql:5-6` ("personal (default/NULL) — only the owner sees it"); `segments.ts:108-112` hydrate comment ("NULL… treated as owner-private"); `trust-mapping.ts:43` `SEGMENT_DEFAULT_VISIBILITY` = personal; seed `segments-snapshot.json` ships rows with `"visibility": null`.

Plan.md §57 + phase-02:19 want to backfill `NULL → shared` "because existing rows were created under shared semantics." But the *current* shipped read contract is NULL→**personal**=owner-private. Meanwhile unified-concept-fabric's drift note (verified, phase-02 outcome line 60) says the live access boundary for segments is **workspace**, and `owner` is provenance only — i.e., today segments are *workspace-shared regardless of visibility*, and the visibility column has never been enforced. So both framings coexist in the plan: "NULL means personal" (028) vs "NULL rows are de-facto shared" (current LIST leaks everything). They can't both drive the backfill silently. This is a **real data-semantics decision that flips visibility of every existing segment** and the plan states it two contradictory ways. **Recommend:** make the backfill an explicit, called-out decision with the user (NULL→shared preserves current *behavior*; NULL→personal honors the *028 doc*). Do not let a migration silently overwrite a documented column contract — this is exactly the class of "silent breaking change to shipped contract" that bites in prod.

---

## HIGH

### H1. Telemetry (Phases 3+4) exceeds the user's OWN researcher v1 scope — 8 event types is gold-plating
**Evidence:** `researcher-260603-1439-…-report.md:226` ("NICE-TO-HAVE V2 (Month 2+)"), :234-242 (last-login detection + per-user activity summary = v2), :250-259 (query audit log = v2, "Skip v1 if Cube doesn't expose query duration"), :373-379 (v1 = audit table basic ~3pts; query log + activity summary = Month 2+). brainstorm:49-50 "NICE (v2): per-user activity timeline" / "SKIP (overkill internal)".

The plan ships the full 8-event spine + aggregator + per-user activity API + 90d prune job + inactive detection + audit viewer in v1. The user's commissioned research explicitly buckets per-user query telemetry, activity summary, and the query audit log as **Month 2+ / v2**, and conditions query telemetry on "if Cube exposes duration" (resolved-question §1 already admits duration is deferred). The 8-type closed enum (`query_run|segment_create|segment_edit|segment_delete|segment_refresh|feature_open|export|workspace_switch`) for a tens-of-users internal tool is the textbook YAGNI smell — `segment_create/edit/delete/refresh` are 4 events where 1 (`segment_op` + action in `detail_json`) suffices, and `export`/`workspace_switch` add aggregation surface with low triage ROI.

**User-confirmed — recommend reconsider, do NOT silently cut:** brainstorm §3.32 locks "Telemetry depth = FULL… ship event-spine + top event types first (incremental)." So the *target* is full and that is the user's call. But the user ALSO said "incremental, not all-at-once," and the user's own researcher says most of it is v2. **Recommend surfacing to user:** ship Phase 3 (spine + query_run + segment_op + feature_open) as v1; **defer Phase 4 entirely** (export/workspace_switch emit, aggregator, prune, inactive) to a v2 phase. This honors "incremental" literally and matches the research. Present as: research says v2 + you said incremental → defer 4? Keep/defer/hybrid.

### H2. Phase 5 rebuilds a tab-shell that already ships twice — and in the wrong token system
**Evidence:** `src/pages/DevAudit/dev-audit-shell.tsx` + `audit-tabs.tsx` (full URL-driven, ARIA `role=tablist`, keyboard-nav tab shell already in prod); `audit-tabs.tsx:11` imports `shell/theme` `T.*` NOT `tokens.css`.

Phase 5 wants a "lightweight tab container above AdminAccessPage." A complete, accessible, URL-state tab shell **already exists** in `DevAudit` (Sessions/Search/Leaderboard/Cache). Phase 5 should *lift/generalize that component*, not author a new one. Worse: the existing tab shell is built on the legacy `T.*`/`shell/theme` token system, while `/admin/access` uses `tokens.css` CSS variables (`access-editor.tsx`). Folding "Dev/Chat-Audit" into the new hub (phase-05:17,24,30) therefore drags a *different token system* into the hub — a design-guidelines violation the plan never flags. The "move, not duplicate" instruction is right, but moving a `T.*`-themed shell under a `tokens.css` hub creates exactly the drift `CLAUDE.md` design rules forbid.

**Recommend:** (a) extract the existing `AuditTabs` into a shared token-clean tab primitive and reuse for both; (b) add a phase-5 task to migrate the relocated Dev/Chat-Audit surfaces off `T.*` onto `tokens.css`, or the "move" will visibly clash with Users&Access.

### H3. Phase 4 "inactive detection" + prune treated as new infra; last_login already exists
**Evidence:** `server/src/services/users-store.ts:18,37-43`, `migrations/018-users-audit.sql:20` (`last_login TEXT NOT NULL`, touched every login).

Inactive detection is "user with last_login older than 30d." `last_login` is already populated on every KC login. This is a **WHERE clause**, not a feature warranting its own emphasized deliverable + risk row across Phase 4 and Phase 7. The researcher (:234) sizes it ~2pts and v2. Fine to keep cheap; do not let it inflate Phase 4's effort estimate or imply new schema.

---

## MEDIUM

### M1. Phase count: 7 → 5 achievable; A/B/C split adds coordination overhead for a solo build
**Evidence:** plan.md build-order graph; phase dependencies 5→6→7 are strictly serial.

Phases 5/6/7 are one serial FE chain on one surface (the hub) owned by one builder. The A/B/C sub-project framing is brainstorm-era taxonomy, not a parallelization win here (plan.md:39 admits C's controls path only needs the existing grant API). **Recommend merges:** (a) Phase 5+6 → one "Hub shell + per-user panel enhancements" phase (the shell is trivial per H2, the controls are mostly shipped per C1); (b) if H1 accepted, Phase 4 folds into a deferred v2, and Phase 7's observability tab shrinks to "audit viewer over access_audit + summary cards." Net: 7 phases → ~5 (1 identity, 2 segments, 3 spine, 4 hub+controls, 5 observability-lite). Fewer cross-phase handoffs, same TDD discipline.

### M2. Dev-mode "deterministic per-user-distinct principals" is net-new machinery for a test convenience
**Evidence:** `authenticate.ts:48-53,122-134` — `AUTH_DISABLED` synthesizes a single fixed user; `X-Owner` header already overrides owner per-request in tests/fixtures.

Phase 1 wants env-gated dev-mode principals "distinct per simulated user" so multi-user isolation is testable locally. But `X-Owner` already lets tests set a per-request owner (used by existing fixtures, :132-134). The isolation tests can drive distinct users via `X-Owner` + a matching `users` row, without new dev-principal machinery. The *core* of Phase 1 (the `principal.ts` sub↔email resolver) is genuinely justified (H-justified below), but the "dev-mode principal" sub-feature is likely redundant with the existing `X-Owner` test seam. **Recommend:** verify the existing `X-Owner` path can't already simulate multi-user before building env-gated dev principals.

---

## What is NOT over-engineered (verified — do not cut)

- **Phase 1 `principal.ts` (the sub↔email resolver):** genuinely needed, not premature. The "email≠sub, never matched/null in dev" bug is **verified** in the unified-concept-fabric drift note (phase-02 outcome line 60, fixed by commit `4de2bc5`) and in code: `authenticate.ts:111-118` writes `request.owner = claims.sub` while grants/audit key on `claims.email`. This is a real cross-cutting trust-boundary bug that both isolation (A) and telemetry (B) inherit. A "5-line helper" is *not* sufficient because three surfaces (segments owner-scope, telemetry actor key, admin UI) each independently pick the wrong key today; centralizing + golden-locking is the correct call. Keep Phase 1. (Trim only the dev-principal sub-feature per M2.)
- **Phase 2 LIST predicate + canMutateSegment:** the data-spill is real — `segments.ts:137-168` LIST has no visibility filter, only optional `owner`/`type`/`q`/`game_id`. Enforcing is legitimate. (Resolve the backfill contradiction per C2.)
- **Phase 3 `/internal/stats` chat seam:** correct — mirrors shipped `/internal/access/:email` shared-secret pattern; "never open chat.db directly" is the right boundary.
- **`recordActivity` fire-and-forget:** mirrors the verified `business-metric-audit-store.ts` append+swallow pattern. Sound.

---

## Duplication-of-shipped-work summary (Contract Verifier)

| New surface in plan | Shipped equivalent | Net-new? |
|---|---|---|
| Phase 5 tab shell | `DevAudit/audit-tabs.tsx` + `dev-audit-shell.tsx` | **Re-skin/lift**, not new |
| Phase 6 role/status/grants panel | `access-editor.tsx` + `grant-matrix.tsx` (all 4 mutations) | **~70% shipped** |
| Phase 6 last-admin 409 inline | `access-editor.tsx:5,82-93` | Shipped |
| Phase 4 inactive detection | `users.last_login` (mig 018) | Query only |
| Phase 7 audit viewer | `access_audit` table (mig 020) + `access-audit-store.ts` | Data shipped; viewer is new (legit) |
| Phase 3 chat bridge | `/internal/access/:email` pattern | Pattern shipped; endpoint new (legit) |

---

## Recommended actions (priority order)

1. **C2 (blocking decision):** surface the NULL→shared vs NULL→personal backfill conflict to user before any migration; it silently flips every existing segment's visibility and contradicts shipped migration 028.
2. **C1:** rescope Phase 6 from "build controls" → "enhance GrantMatrix (counts/bulk/effective-default) + derive-user-experience selector + last-changed-by"; ~1-1.5d not 3-4d.
3. **H1 (user-confirmed, recommend reconsider):** propose deferring Phase 4 (export/workspace_switch, aggregator, prune, inactive) to v2 per the user's own researcher; ship Phase 3 spine + 3 events as v1. Keep/defer/hybrid — user's call.
4. **H2:** extract existing `AuditTabs` as the shared tab primitive; add task to migrate relocated Dev/Chat-Audit off `T.*` onto `tokens.css` or flag the design drift.
5. **M1:** merge Phase 5+6; collapse 7→~5 phases.
6. **M2:** verify `X-Owner` test seam before building dev-mode principals.

---

## Unresolved questions

1. **C2 backfill direction** — does the user want existing segments to stay broadly visible (NULL→shared, preserves current LIST behavior) or honor the documented 028 owner-private semantic (NULL→personal)? This is a business/governance call, not a code call.
2. **H1** — is "full telemetry as target" meant as v1 scope or as a roadmap target with v1 = top events only? brainstorm §3.32 says "incremental"; researcher says v2. Needs explicit v1 line.
3. Does the huashu prototype gate (phase-05:38 sign-off) apply given design-guidelines.md + shipped `access-editor`/`GrantMatrix` already define the visual system? The prototype may be ceremony for a panel that's 70% an existing component reskin — confirm the user wants a full hi-fi pass vs. iterating on the live components. (User-confirmed huashu per §3.33 — flag, don't cut.)
