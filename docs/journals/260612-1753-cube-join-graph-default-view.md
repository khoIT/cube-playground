# Cube join-graph as default Data Model view shipped

**Date**: 2026-06-12 18:33 GMT+7
**Severity**: Low
**Component**: Catalog → Cubes tab, reactflow data-model board, join-graph builder
**Status**: Completed

## What Happened

Shipped the cube join-graph as the default view in the Catalog Cubes tab. Three-phase plan completed: pure-TS port of model-viewer Python generators → FE reactflow board → tab IA restructure. All uncommitted, 61 new/updated tests pass (306 catalog-scope total). Code-reviewer gave DONE with 6 minor findings, 2 fixed.

## The Brutal Truth

This was a clean run. The originally planned server-side YAML-parsing phase evaporated the moment we verified that Cube's `/v1/meta?extended=true` already exposes `joins[]{name,relationship,sql}` + `aliasMember` on view members — no backend work needed, feature became FE-only and automatically workspace-aware for free. One mid-implementation correction cost maybe 30 minutes: CubeGraphPage switched from self-fetching catalog to accepting props (to avoid duplicate `/meta` fetch), broke the page test, caught and fixed it. No frustration — expected cleanup when refactoring prop-passing.

## Technical Details

- **Load-bearing discovery**: Cube already serves join metadata in extended meta. Relationship vocab differs from YAML: `belongsTo/hasMany/hasOne` not `many_to_one`. Meta SQL backtick-wrapped as `${ref}.col` vs YAML `{ref}.col`.
- **Phase 1**: ported Python join-graph builder + cluster-grid layout to `src/pages/Catalog/cube-graph/{build-join-graph,cluster-grid-layout,view-composition}.ts`. Fixed latent overlap bug from Python original: hub + profile clusters shared anchor (1,1) and would collide — bumped profile to (2,0) when both exist, pinned by pairwise rect-overlap test.
- **Phase 2**: reactflow board UI reusing concept-map precedent (CSS token overrides, lazy chunking at 11.4kB, shared reactflow bundle not double-bundled). Existing DetailPanel on node click, lint chip surfacing real jus/muaw model gaps.
- **Phase 3**: tab order restructured — Cubes(=root, Graph default, ?view=grid toggle), Schema(/schema), Concepts, Models, Concept Map. Redirect matrix preserves chat field-chip `?focus=` deep links (root+focus → /schema). View derives from URL not state (KeepAliveRoute for back-nav safety).
- **Verification**: 306 catalog tests pass (61 new/updated); playwright walks full redirect matrix + dark-mode screenshots; prod build green.

## What We Tried

No failed attempts. One deliberate refactor (props vs self-fetch) broken a test, caught immediately, fixed in-place. Code-reviewer found 6 minor findings: stale header comment, page state not reset on game switch — both fixed before merge.

## Root Cause Analysis

None — no root cause. Smooth delivery. The "why did this go so clean?" answer: the load-bearing discovery (Cube already exposed joins in meta) collapsed the original multi-phase plan into a smaller feature. Smaller surface = fewer edge cases = fewer surprises.

## Lessons Learned

**Signal**: Before proposing a server-side data-transformation feature, check whether the upstream API already exposes the shape in raw form. Cube's `/v1/meta?extended=true` is the oracle — always consult it. Saves a backend phase.

**Pattern**: Workspace-aware member names happen for free when you read joins from meta (local bare names in dev, prod prefixed names in prod). Don't hardcode namespace translation — let the API tell you what names to use.

**Overlap bug**: Clustering algorithms that place anchors can silently collide if multiple clusters pin to the same (x,y). Pairwise rect-overlap check post-placement catches it; always validate layout didn't compress multiple logical clusters into the same visual space.

## Next Steps

- Merge (all tests green, code-reviewer DONE, no blockers)
- Monitor analytics: graph view adoption (toggle tracking on ?view param)
- Follow-up: lint chip on missing-target joins should link to pending cube onboarding (deferred to later roadmap phase)

**Status:** DONE
**File path:** `/Users/lap16299/Documents/code/cube-playground/docs/journals/260612-1753-cube-join-graph-default-view.md`

---

## Addendum (2026-06-13) — model-viewer feature parity

After clicking around the shipped graph, the standalone viewer still had a richer layer. Ported it:

- **Root cause of "colors unclear"**: accents reused semantic/layer tokens → 3 blues + 3 ambers across 9 clusters. Fix was a *new* categorical `--cluster-*` palette (9 distinct hues, light+dark), not a legend band-aid. Lesson: when categories outnumber the semantic palette's hue families, build a dedicated qualitative scale — don't overload semantic tokens.
- **CSS-var-in-marker check**: was unsure `var(--cluster-*)` would resolve inside reactflow's SVG `<marker>` defs. It does — the generated marker `<polyline>` computes to the real rgb and re-resolves on theme switch. Verified live before trusting it (`getComputedStyle` on the polyline), rather than assuming.
- **Dead-link guard**: PK + private dimensions are excluded from the concept index, so their concept pages 404. Detail panel renders those rows non-clickable instead of linking into a 404. Pattern: before turning a list into links, confirm every target resolves.
- Folded `detail-panel-measures` into a tabbed `detail-panel-members` (reused `MeasureRow`); removed "Open in Playground" — member links are the query entry now.

**Status:** DONE
