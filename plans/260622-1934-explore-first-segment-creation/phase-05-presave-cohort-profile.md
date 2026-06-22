# Phase 05 — Pre-save cohort profile ("who are these people?")

**Move:** 3 · **Priority:** P1 · **Status:** pending · **Service:** server + src

## Context
A count is not understanding. Saved segments already expose member-panel breakdowns (`segmentsClient.memberPanels`); a *candidate* predicate has no saved row. This phase profiles a candidate before it's saved, reusing the same query shapes over `/api/preview`'s base population.

## Requirements
- `POST /api/profile` body `{ primary_cube, predicate, dimensions? }` → `{ total, breakdowns: [{ dimension, top: [{ value, count, pct }] }], measures?: [{ name, avg/median }], took_ms, approx }`.
- Default dimensions chosen from the segmentable-dimension catalog per cube (country, platform, tenure band, spend band, favorite mode where modeled). Degrade gracefully when a dim is absent for the game.
- Per-user grain, timeout-bounded, best-effort (partial breakdowns OK).
- FE: a compact **profile panel** in the proposal card — a few top-k bars/rows, collapsed by default with a "Profile this cohort" toggle to avoid auto-cost on every proposal.

## Architecture
- New `server/src/routes/cohort-profile.ts` + SQL builder (group-by top-k per dimension over the predicate-scoped per-user grain). Reuse preview connector/cache.
- New `src/pages/Chat/components/cohort-profile-panel.tsx` (<200 lines), lazy-fetched on expand.

## Related code
- Read: member-panel query shapes (`server/.../segment member panels`), `get-segmentable-measures.ts` / segmentable-dimension catalog, `/api/preview` handler.
- Create: profile route + SQL + test; profile panel component.
- Modify: proposal card to mount the (collapsed) panel.

## Implementation steps
1. Dimension selection from the catalog per cube; contract + schema.
2. Top-k group-by SQL over predicate-scoped population; timeout + cache + approx flag.
3. Profile panel UI (lazy on expand), token-compliant.
4. Tests: pct sums ≤ 100 per dimension; missing-dim degradation; timeout fallback.

## Todo
- [ ] Per-cube dimension selection
- [ ] Top-k profile SQL + endpoint
- [ ] Lazy profile panel UI
- [ ] Tests (pct sanity, degradation, timeout)

## Success criteria
- Expanding "Profile this cohort" shows top countries/platform/tenure for the candidate within the timeout budget.
- Games missing a dimension simply omit that breakdown — no error.

## Risks
- Auto-profiling every proposal is expensive → lazy on explicit expand only.

## Next
Move 3 shippable. Overlap (Phase 06) is the last guard.
