---
title: "CDP Projection + Verify on mf_users Measures"
description: "Display projected CDP fields for mf_users cube measures in /catalog DetailPanel with per-measure expandable rows, plus mocked round-trip verify via GET /cdp/v1/metrics/{game_id}/{metric_name}. Mock-only CDP wiring this round; wizard push deferred."
status: complete
priority: P2
branch: "new_metric"
tags: [feature, cdp, mm-01, catalog, mock, tdd]
blockedBy: []
blocks: []
created: "2026-05-17T17:15:00.000Z"
createdBy: "ck:plan"
source: skill
---

# CDP Projection + Verify on mf_users Measures

## Overview

Implement the first slice of the wizard → MM-01-CRUD pipeline: project Cube measures on the `mf_users` cube into CDP `Metric` shape (`game_id, metric_name, metric_codename, source, expression, dimensions, filter`), show them inside the existing `/catalog` DetailPanel as per-measure expandable rows, and verify each metric exists on CDP via a round-trip `GET /cdp/v1/metrics/{game_id}/{metric_name}` with field-equality check. CDP is entirely **mocked** by a new vite middleware this round — no real MM-01 wiring, no POST from the wizard, no cubes other than `mf_users`. Non-projectable measures (calculated `type: number` w/ `{x}/{y}` refs, segment-backed) render a disabled `Not projectable — <reason>` badge.

Brainstorm: [`../reports/brainstorm-260517-cdp-projection-verify-mf-users.md`](../reports/brainstorm-260517-cdp-projection-verify-mf-users.md)
Architecture: [`../reports/architecture/cube-vs-cdp-metrics-architecture.md`](../reports/architecture/cube-vs-cdp-metrics-architecture.md), [`../reports/architecture/cube-mm01-integration-and-schema-reload.md`](../reports/architecture/cube-mm01-integration-and-schema-reload.md)
Spec: `C:\Users\CPU12830-local\Downloads\MM-01-CRUD.openapi.yaml`

Mode: **TDD per phase** — tests precede implementation for every phase. Pure modules (mapper, middleware handlers) are 100% test-first; UI phases lead with component + hook tests before render code.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Foundation projection mapper and types](./phase-01-foundation-projection-mapper-and-types.md) | Complete |
| 2 | [Mock CDP middleware and seed](./phase-02-mock-cdp-middleware-and-seed.md) | Complete |
| 3 | [Cube meta exposure and YAML wiring](./phase-03-cube-meta-exposure-and-yaml-wiring.md) | Complete |
| 4 | [DetailPanel split and measure-row expand](./phase-04-detailpanel-split-and-measure-row-expand.md) | Complete |
| 5 | [CDP projection card and verify hook](./phase-05-cdp-projection-card-and-verify-hook.md) | Complete |
| 6 | [Smoke test and cleanup](./phase-06-smoke-test-and-cleanup.md) | Complete |

## Sequence

```
P1 (pure mapper + types + tests) ──▶ P2 (mock middleware + tests)
                                        └─▶ P3 (cube meta mapping module + type widen)
                                              └─▶ P4 (DetailPanel split + expand)
                                                    └─▶ P5 (CDP card + verify hook + UI)
                                                          └─▶ P6 (smoke + cleanup)
```

Strictly linear. P1+P2 are pure modules; their tests are the gating contract for downstream phases. P3 unblocks P4+ which need `cube.meta.game_id`/`cube.meta.cdp_source` from `/meta`.

## Locked Decisions

- **Surface** = `/catalog` DetailPanel; per-measure click-to-expand row → inline `<CdpProjectionCard>`. Not a new tab, not a separate page.
- **Verify trigger** = manual button per measure. No auto-verify on panel open.
- **MM-01 plumbing** = vite middleware mock only. No real proxy, no env URL, no JWT. Real wiring deferred to a later plan.
- **Non-projectable handling** = show disabled w/ reason badge. No "inline best-effort" projection of calculated measures.
- **Equality check fields** = `metric_codename, source, expression, dimensions, filter`. Ignore `materialize, schedule, created_at, updated_at`.
- **`dimensions[]` ordering** = sort both sides before equality compare.
- **`game_id` + `cdp_source`** = client-side mapping map only (`src/pages/Catalog/cdp-projection/cube-to-cdp-mapping.ts`). External Cube YAML edit dropped per validation. `mf_users` → `{ game_id: 'bal_vn', cdp_source: 'iceberg.ballistar_vn.mf_users' }`.
- **Mismatch renderer** = color-coded two-column diff (red `expected`, green `actual`) for fields that differ. No external diff library.
- **Verify button on Not Projectable** = hidden (no button shown). Card shows only the reason text.
- **Mock auth** = no 401 path; middleware ignores `Authorization` header. Real auth lands w/ real proxy in a later plan.
- **Seed fixture coverage** = 5+ records, one per Cube agg type (`count`, `sum`, `count_distinct`, `count_distinct_approx`, filtered variant) + 1 deliberate mismatch for testing the `mismatch` badge.
- **Stack constraint** = RR5 + HashRouter, no RR6 idioms (the existing `useHistory` in detail-panel.tsx stays).
- **No `dangerouslySetInnerHTML`** — explicit success criterion on every UI phase.
- **File ceiling** = 200 lines. `detail-panel.tsx` (currently 216) must be split.
- **API client style** = mirror `src/QueryBuilderV2/NewMetric/api.ts` — typed discriminated unions, no throws.
- **Mock state** = in-memory only; dev refresh resets to seed; documented.
- **Branch** = continue on `new_metric` (no new branch — this is small scope and shares the new-metric mental model).

## Total Effort

≈ 2.5 focused days. Calendar ≈ 1 week.

| Phase | Effort | Priority |
|-------|--------|----------|
| P1 | 0.5d | P1 (gate) |
| P2 | 0.5d | P1 (gate) |
| P3 | 0.25d | P1 |
| P4 | 0.5d | P2 |
| P5 | 0.5d | P2 |
| P6 | 0.25d | P2 |

## Dependencies

- **Independent** of `260517-1500-new-metric-fullpage-6step-rebuild` — touches `src/pages/Catalog/` not `src/QueryBuilderV2/NewMetric/full-page/`; no file overlap, no shared modules. Both can land in parallel.
- **Independent** of `260516-0140-filter-results-compact-resize` — unrelated UI surface.

## Out of Scope

- Real MM-01 reachability (proxy, env URL, JWT handling).
- `POST /cdp/v1/metrics` from the wizard submit flow.
- Cubes other than `mf_users`.
- Backfill of existing measures via mock-POST seed button.
- Editing CDP fields from UI (no PUT).
- `materialize` / `schedule` UI.
- `cube.meta.cdp_source` for cubes other than `mf_users` (P3 ships mapping for `mf_users` only).
- Pre-aggregation / materialization availability check (out — that's a CDP downstream concern).
- Permissions / auth on the mock middleware.

## Open Questions

1. Exact measure names + agg types on the live `mf_users` cube — needed to populate `cdp-mock-seed.json` in P2. The 5+ seed records map 1:1 to `mf_users` measures of each agg type. Resolve at start of P2 by hitting `/cubejs-api/v1/meta?extended=true` against the running Cube and listing them. Plan assumes `mf_users` has at least one measure of each of `count, sum, count_distinct, count_distinct_approx` plus one filtered variant — if any are absent on the live cube, scope-down seed accordingly.

> All other open questions from the original brainstorm have been resolved — see `## Validation Log` (Session 1) below.

## Related Reports

- Brainstorm: [`../reports/brainstorm-260517-cdp-projection-verify-mf-users.md`](../reports/brainstorm-260517-cdp-projection-verify-mf-users.md)
- Architecture: [`../reports/architecture/cube-vs-cdp-metrics-architecture.md`](../reports/architecture/cube-vs-cdp-metrics-architecture.md), [`../reports/architecture/cube-mm01-integration-and-schema-reload.md`](../reports/architecture/cube-mm01-integration-and-schema-reload.md)

## Validation Log

### Session 1 — 2026-05-17
**Trigger:** `/ck:plan validate` after initial plan write.
**Questions asked:** 6 (split across 2 rounds)

#### Verification Results (Step 2.5)
- **Tier:** Full (6 phases)
- **Claims checked:** 8 | **Verified:** 7 | **Failed:** 0 | **Unverified:** 1
- Verified: `detail-panel.tsx` 216 lines · `runIdRef` pattern at `use-live-preview.ts:76,99,103` · `schema-write-middleware.ts` 69 lines · vitest + `@testing-library/react ^16.0.1` installed · `useCatalogMeta` already calls `/meta?extended=true` at `use-catalog-meta.ts:73` · `CatalogCube` type lacks cube-level `meta` field (confirms P3 widening) · `vite-plugins/` pattern + `vite.config.ts` present.
- Unverified: `/meta?extended=true` returns `cube.meta` when YAML has it — not testable until external YAML edited; **moot after Q1 below switched to client-side mapping**.

#### Questions & Answers

1. **[Architecture]** Cube YAML `meta:` block edit — Path A or Path B for P3?
   - Options: Path B client-side mapping only (Recommended) | Path A external YAML edit | Both with fallback
   - **Answer:** Path B — client-side mapping only
   - **Rationale:** Lower coordination cost; no external repo dependency; no Cube restart. P3 simplifies to "write the mapping module + widen the type".

2. **[Architecture]** `cdp_source` FQN for `ballistar_vn.mf_users`?
   - Options: `iceberg.ballistar_vn.mf_users` (Recommended) | `hive.ballistar_vn.mf_users` | TBD placeholder
   - **Answer:** `iceberg.ballistar_vn.mf_users`
   - **Rationale:** Locks the mapper output so projection is deterministic. Verifiable against real CDP env when proxy wiring lands.

3. **[Scope]** Seed fixture composition for mock middleware?
   - Options: 3 records 2-match-1-mismatch | 5+ records one per agg type (Recommended-by-user) | 2 records minimal
   - **Answer:** 5+ records covering each agg type + filtered variant + 1 mismatch
   - **Rationale:** Better coverage — exercises every projection branch end-to-end during manual smoke. Cost: P2 grows ~30 min for the extra seed entries + one extra round-trip test per agg type.

4. **[Architecture]** Mismatch diff renderer in P5?
   - Options: Plain text two-column list (Recommended) | Color-coded line diff (user-chosen) | Full JSON-diff library
   - **Answer:** Color-coded line diff (red expected, green actual)
   - **Rationale:** Slightly more JSX (~30 lines) but readability win is worth it for long SQL expressions. Still no diff library — pure CSS coloring.

5. **[Architecture]** Verify button on Not Projectable measure?
   - Options: Hidden (Recommended) | Disabled grey + tooltip
   - **Answer:** Hidden
   - **Rationale:** Cleanest UX. Card just shows the reason; no dead-end button.

6. **[Scope]** Mock middleware 401 path?
   - Options: Skip 401 entirely (Recommended) | Return 401 when Authorization absent
   - **Answer:** Skip 401 entirely
   - **Rationale:** Mock-only round. Real auth lands w/ real proxy later. Saves ~1h of mock-test surface for no real coverage gain.

#### Confirmed Decisions
- Path B locked — drop external Cube YAML edit; ship `cube-to-cdp-mapping.ts` only
- `cdp_source` = `iceberg.ballistar_vn.mf_users` (mf_users entry)
- Seed = 5+ records covering each Cube agg type + 1 mismatch
- Mismatch renderer = color-coded two-column diff (no library)
- Verify button hidden on Not Projectable
- Mock ignores Authorization header

#### Action Items
- [ ] P2: expand seed fixture spec from 3 → 5+ records; one per agg type
- [ ] P2: drop any 401 references from middleware requirements + tests
- [ ] P3: rewrite phase as Path B only (drop probe step, drop YAML edit, drop FQN check-in)
- [ ] P5: card visual sketch updated for hidden button on N/P + color-coded diff
- [ ] P5: card test cases updated — hidden-button assertion, diff color classes

#### Impact on Phases
- **P2** — seed fixture grows from 3 → 5+ records; auth-related tests dropped. Effort unchanged (~0.5d).
- **P3** — simplifies to type-widening + writing client-side mapping module. Effort drops 0.25d → ~0.15d.
- **P5** — diff renderer adds ~30 lines + CSS classes; card hides button branch added. Net effort unchanged.
- **P1, P4, P6** — no change.

### Whole-Plan Consistency Sweep
- **Files reread:** plan.md, phase-01, phase-02, phase-03, phase-04, phase-05, phase-06
- **Decision deltas checked:** 6 (Path B lock, FQN lock, seed expansion 3→5+, color-coded diff, hidden N/P button, no-401)
- **Reconciled stale references:** 3
  1. `plan.md` sequence diagram — "P3 (cube meta exposure + YAML/fallback)" → "P3 (cube meta mapping module + type widen)"
  2. `plan.md` TDD Strategy table — P3 row "YAML edit + (if fallback) mapping map" → "`cube-to-cdp-mapping.ts` + type widen"
  3. `phase-02` — measure-name conflict (sum match & mismatch both named `lifetime_recharge_amount_vnd`); clarified mismatch as a distinct record + pinned name
- **Unresolved contradictions:** 0
- **Notes:**
  - Phase 3 filename retains `…-yaml-wiring` for plan-table-of-contents stability; H1 + content clearly describe the mapping-module scope. Cosmetic only.
  - All P2/P5/P6 references to specific measure names (`user_count`, `paying_user_count`, `lifetime_recharge_amount_vnd`, `arpu_vnd`) are consistent across files.
  - No `401` / `Authorization` references remain except as historical context inside the Validation Log itself.

**Verdict:** plan + phase files are internally consistent. Ready for `/ck:cook`.

## TDD Strategy (per phase)

| Phase | Tests written first | Then implementation |
|---|---|---|
| P1 | `project-measure.test.ts` — 6 measure-shape cases incl. non-projectable variants | `project-measure.ts` pure mapper |
| P2 | `cdp-mock-middleware.test.ts` — 200/404/409 paths, MM-01 envelope shape | `cdp-mock-middleware.ts` |
| P3 | `use-catalog-meta.test.ts` — `cube.meta.game_id` / `cube.meta.cdp_source` survival after mapping merge | `cube-to-cdp-mapping.ts` + type widen |
| P4 | `measure-row.test.tsx` — click-to-expand, aria, keyboard nav | `measure-row.tsx` extraction |
| P5 | `use-cdp-verify.test.ts` — state machine (idle→checking→available/missing/mismatch/error); `cdp-projection-card.test.tsx` — render-states | `use-cdp-verify.ts` + `cdp-projection-card.tsx` |
| P6 | Integration smoke (`smoke.test.tsx`) — render catalog page, mf_users → expand → mock-verify happy path | docs + cleanup |
