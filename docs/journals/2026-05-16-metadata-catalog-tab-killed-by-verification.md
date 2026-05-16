# Metadata Catalog Tab — Plan Killed By Empirical Verification

**Date**: 2026-05-16 14:00–15:30
**Severity**: High (avoided week of misdirected work)
**Component**: Hypothetical `/metadata` route (never built)
**Status**: Cancelled / pivoted

## What Happened

Brainstormed a new top-level "Metadata Catalog" tab to surface `/cubejs-system/v1/meta` as a faceted, DA-oriented metric discovery surface. Plan written (4 phases, ~1 week). Red-team review by 3 hostile reviewers flagged two structural assumptions. Empirical probe against the actual Cube backend confirmed both were wrong. Plan cancelled before any code was written. Brainstorm annotated; pivot direction noted; ~0.5 day "enrich existing sidebar" idea queued for later.

## The Brutal Truth

The plan was beautiful and would have shipped a feature that did nothing useful. Three pillars of the design — per-measure SQL snippets, hidden-member discovery, adaptive `meta.*` facets — all assumed schema features that this Cube deployment doesn't have. The red-team caught it; the empirical probe proved it; we saved a week. Without verification, the cost of building it would have been small compared to the cost of explaining why it shows so little.

## Technical Details

**The original premise**

- Brainstorm landed on `/cubejs-system/v1/meta` as the catalog source (a privileged Cube endpoint requiring `CUBEJS_API_SECRET`).
- Plan baked the API secret into the bundle via `VITE_CUBE_API_SECRET`, added a Vite proxy entry, signed an HS256 JWT in the browser, and gated the route in prod builds via `import.meta.env.PROD`.
- Adaptive Tier 2 facets would self-tune to whatever `meta.*` conventions existed in the schema (≥3 cubes, ≤20 unique values).

**What the red-team found**

Three hostile reviewers in parallel (Security Adversary + Assumption Destroyer + Failure Mode Analyst), each carrying a Standard-tier verification role (Fact Checker + Contract Verifier). 30 raw findings → 15 after dedupe → 2 Critical + 10 High + 3 Medium.

Two Critical findings:

1. **PROD guard ≠ secret protection.** `vite.config.ts:9` sets `sourcemap: true`; `import.meta.env.VITE_CUBE_API_SECRET` is replaced as a string literal by esbuild at every callsite; the hook module is statically imported via `src/pages/index.tsx` barrel. The guard only hides the UI entry — the secret string is in every build artifact. And Phases 1–3 ship without any guard at all (added in P4), so any CI build between phases leaks irreversibly.

2. **The endpoint might not exist on this Cube deployment.** Reviewer's reading of `cubejs-api-gateway/src/gateway.ts` showed only `/cubejs-system/v1/context` and `/cubejs-system/v1/pre-aggregations/*` routes; no `/meta`. Auth on the system namespace uses `CUBEJS_PLAYGROUND_AUTH_SECRET`, not `CUBEJS_API_SECRET` (wrong env var). This was assumption-based; needed a probe.

**The probe**

```
curl http://localhost:4000/cubejs-system/v1/meta
→ HTTP 404 "Cannot GET /cubejs-system/v1/meta"  (Express default, not auth challenge)

curl http://localhost:4000/cubejs-system/v1/context
→ HTTP 404

curl http://localhost:4000/cubejs-system/v1/pre-aggregations/*
→ HTTP 404

curl http://localhost:4000/cubejs-api/v1/meta
→ HTTP 200, 91,777 bytes
```

Entire `/cubejs-system/*` namespace absent. Not a permissions issue.

**The deeper finding**

Pivoted the plan to use `/cubejs-api/v1/meta` (already in use elsewhere in the app via `@cubejs-client/core`) — but a field census across the actual schema (11 cubes / 58 measures / 215 dimensions) revealed:

| Field plan depended on | Populated |
|---|---|
| `cube.meta`, `measure.meta`, `dimension.meta` | **0 / 0 / 0** |
| `measure.sql` | **0 / 58** |
| `cube.dataSource`, `cube.preAggregations`, `cube.joins[]` | **0 / 11** each |
| Hidden members (`public: false`) | **0 / 11** |

All three brainstorm pillars (SQL snippets, hidden-member discovery, adaptive `meta.*` facets) had zero schema support. The pivot didn't simplify the plan — it gutted its value prop.

## Decisions

1. **Plan cancelled.** `plans/260516-1521-metadata-catalog-tab/plan.md` set to `status: cancelled`; all 4 phase files retained as historical record of the rejected design.
2. **Brainstorm annotated.** `plans/reports/metadata-catalog-tab-system-meta.md` carries a `## Pivot Note (2026-05-16)` at the top explaining the kill; body retained.
3. **New direction.** Enrich the existing Playground sidebar (`src/QueryBuilderV2/QueryBuilderSidePanel.tsx`) with a per-cube / per-measure details popover showing description + aggType + format. ~0.5 day work. Not started; queued.

## Lessons Learned

1. **Verify endpoints before designing around them.** The whole feature was predicated on `/cubejs-system/v1/meta`'s existence. A 30-second `curl` would have killed the entire architecture before any plan was written. Make endpoint probes a default first step for any feature that claims to use a specific API path.

2. **Red-team verification roles earn their keep.** Fact Checker (verify every cited symbol/endpoint) caught the endpoint-existence assumption that brainstorm and planner both missed. The persona-driven adversarial review *plus* the codebase-evidence requirement is what made the difference — pure adversarial review without evidence enforcement produces noise.

3. **A plan that looks good on paper can have zero data support.** This codebase's schemas don't populate `meta.*`, `sql`, `dataSource`, `joins[]`, `preAggregations`, or `public:false` flags. The plan would have shipped UI for fields that are universally empty. Field-population census against the *actual data* is cheap and prevents "well, in theory" feature design.

4. **`import.meta.env.X` in Vite is not a privacy boundary.** Every `import.meta.env.VITE_*` reference becomes a string literal in the bundle. PROD-only route gating is theater if the secret-reading code path is still in the import graph. Anything that touches a secret must (a) never enter the browser bundle, or (b) be removed entirely from prod builds via tree-shaking / dynamic-import gating, not just route-level conditionals.

5. **Cost of clarifying questions << cost of building the wrong thing.** Today: 3 rounds of `AskUserQuestion` after scout, 1 hour of red-team, 5 minutes of curl. Avoided: ~1 week of misdirected work. Ratio worth remembering.

## Next Steps

- [ ] If pursued: scaffold a tiny single-phase plan for the sidebar-details-popover enrichment (~0.5 day scope).
- [ ] Consider whether to push schema authors toward populating `meta.*` (owner, domain, tags). The catalog UX is fine — the data isn't ready. Lobbying for richer metadata is a multi-month soft change.
- [ ] If "show me the SQL behind this measure" remains a DA need: a separate small feature using `/cubejs-api/v1/sql` (which compiles a query to SQL) is achievable and addresses the real ask.

**Unresolved:** Whether the wider Cube deployment has any environment where `/cubejs-system/*` is enabled (`CUBEJS_PLAYGROUND_AUTH_SECRET` set). The current target backend definitively doesn't, but the existing reports in `plans/reports/` cite the endpoint as if it were always available — those reports may need correction.
