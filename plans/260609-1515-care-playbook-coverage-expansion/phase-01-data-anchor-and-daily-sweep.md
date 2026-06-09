# Phase 01 — Data as-of anchor + daily sweep cadence

**Priority:** P0 (foundational) · **Status:** ☐ not started

## Overview
The cfm_vn raw-etl behavior data lags (latest ~early May 2026; today Jun 9), and raw behavior cubes cap any query at 31 days. So `last 7d / last 24h / anniversary` windows resolve to an empty range. Fix: resolve relative windows from a per-game **data anchor** (the freshest date that actually has data) instead of `now()`. One mechanism unblocks every etl-backed playbook. Plus: add a daily periodic sweep so cohorts refresh without the trigger engine.

## Key insight
`expandRelativeDateRange(raw, now=new Date())` already accepts an injectable `now`. The translator calls it WITHOUT that arg (`server/src/services/translator.ts:93`), so it always anchors on real today. Thread an anchor date down to it.

## Requirements
- Functional: cohort queries for etl-backed playbooks resolve windows against the anchor; available/partial playbooks return non-empty cohorts for the demo.
- Anchor is **per-game**, auto-detected (max `log_date` of a fresh std mart), with a config override; cached per sweep.
- A daily scheduled sweep per game (replaces "run sweep" being purely manual).
- Non-functional: anchor adds ≤1 cheap Cube query per sweep; fail-safe → fall back to `now()` if detection fails (never crash a sweep).

## Architecture
- New `server/src/care/resolve-data-anchor.ts`: `resolveDataAnchor(ctx, game): Promise<Date>` —
  queries the freshest std mart (`active_daily` max `log_date`, fall back `user_recharge_daily`); cache (TTL ~10 min) keyed by workspace×game; override via games-config `dataAnchorDate` / env `CARE_DATA_ANCHOR_<GAME>`; fallback `new Date()`.
- Thread anchor as an optional param: `treeToCubeFilters(node, opts?: { anchorDate?: Date })` → passes to `expandRelativeDateRange(vals[0], opts?.anchorDate)`. Default undefined = today (no behavior change for other callers — segments, drift, etc.).
- `makeCubeCohortFetcher` / `runCaseSweep` resolve the anchor once and pass it into `treeToCubeFilters`.
- Daily cadence: extend the existing auto-sweep scheduler (see `test/care-auto-sweep.test.ts`) to a per-day interval per game; keep manual "Run sweep" too.

## Related code files
- Modify: `server/src/services/translator.ts` (thread `anchorDate` through `treeToCubeFilters`).
- Modify: `server/src/care/care-case-sweep.ts` (`makeCubeCohortFetcher`, `runCaseSweep` — resolve + pass anchor).
- Modify: `server/src/care/care-sweep-execute.ts` (resolve anchor at sweep start; log it).
- Create: `server/src/care/resolve-data-anchor.ts`.
- Modify: auto-sweep scheduler (daily cadence) — locate via `grep -rn "auto.*sweep\|setInterval\|scheduleSweep" server/src`.
- Tests: `test/expand-relative-date-range.test.ts` (anchor arg already supported — add anchor cases), new `test/resolve-data-anchor.test.ts`, extend `test/care-auto-sweep.test.ts`.

## Implementation steps
1. Write `resolveDataAnchor` (cheap max-`log_date` query + cache + override + fallback). Unit-test with a stub loader.
2. Add optional `opts.anchorDate` to `treeToCubeFilters` and the internal leaf walker; pass into the expander. Keep signature back-compatible.
3. Resolve the anchor once in `makeCubeCohortFetcher` (or `runCaseSweep`) and pass it through; `console.info` the resolved anchor per sweep.
4. Wire the daily scheduler; confirm manual sweep still works.
5. Re-run a cfm_vn sweep; confirm previously-empty windows now bind to the anchored range.

## Todo
- [ ] `resolve-data-anchor.ts` + test
- [ ] `treeToCubeFilters` anchor param + translator wiring + expander cases
- [ ] sweep path resolves + threads anchor
- [ ] daily sweep cadence + manual still works
- [ ] cfm_vn sweep re-run shows anchored windows

## Success criteria
- A cfm_vn sweep logs a resolved anchor (~latest May date), not today.
- An etl-backed playbook with a `last N days` window returns a non-empty cohort.
- Non-care Cube queries (segments/drift) unchanged (anchor defaults off).
- All existing server tests pass.

## Risks
- Anchor too aggressive → cohorts look "stale-dated" in UI. Mitigation: surface the anchor in the sweep summary so CS knows the as-of date.
- Over-broad anchoring on `event`/`tierStep` windows. Mitigation: anchor only affects relative-date expansion; absolute/tier rules unaffected.
- 31-day guard still applies to raw cubes → keep anchored windows ≤31 days for raw-etl playbooks (aggregated marts in later phases have no guard).

## Security
Read-only Cube reads; no new PII surface. Anchor override via trusted config/env only.

## Next
Unblocks Phases 02–05. Phase 02 can start in parallel (registry edits don't depend on the anchor landing).
