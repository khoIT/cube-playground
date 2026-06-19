# Phase 01 — Genre-aware Knowledge Library (cfm_vn FPS + jus_vn MMORPG)

## Context links
- Overview: [plan.md](plan.md)
- Seed: `server/src/advisor/lever-map.ts` (factor→family→playbook, FPS/VIP-centric, no genre tag)
- Seed: `server/src/care/playbook-registry.ts` (`SEED_PLAYBOOKS`, 21 playbooks, `availabilityHints.blocked` data-gate pattern)
- Availability/data-gate precedent: `server/src/care/availability.ts`
- Grounded lever map: plan task brief (cfm/jus levers + data gates)

## Overview
- **Priority**: P1 (foundation; everything downstream cites this)
- **Status**: pending
- **Description**: Author a versioned, genre-tagged knowledge library encoding, per game/genre: `lever → triggering signal → required cubes (data-gate) → benchmarked threshold (internal + external) → recommended action + defaultWrite`. Author cfm_vn (competitive FPS) and jus_vn (wuxia MMORPG) now on a genre-tag framework so more games plug in without re-architecting. Serve read-only.

## Key insights
- `lever-map.ts` already encodes factor→family→playbook with honest feasibility (`feasible`/`nearest-feasible`/`infeasible`) — REUSE its honesty model, do NOT rebuild feasibility logic. The net-new layer is: genre tagging, per-game data-gate, dual benchmarks, and `defaultWrite`.
- The 21 `SEED_PLAYBOOKS` are INPUT, not authority. The library references playbook ids (`playbookIds`) for CS-actuated levers; it does not duplicate playbook bodies.
- Data-gate must be per-game: a rule fires only if its `requiredCubes` exist for that game (resolve via existing care availability, which checks live `/meta`). cfm has clan/gacha; jus does NOT (no guild/clan, fighting_power null, no gacha cube) — author jus social/progression lever as **server + role-level**, never clan/gacha/PvP.
- Cheating is the #1 FPS churn driver but NOT in our data → encode as an explicit **blind spot** lever (`dataGate: missing`), surfaced never fabricated.

## Requirements
**Functional**
- Library is one declarative config (TS, mirrors `playbook-registry.ts` shape) under `server/src/knowledge/genre-levers/`.
- Each lever entry: `{ id, genreTags:[], games:[], lever, signal, requiredCubes:[], benchmark:{ metricKey, internalPercentileBand?, externalNorm:{ value, unit, source, citation } }, action:{ text, mapsToPlaybookIds?:[], leverFamily? }, defaultWrite:'case'|'sweep'|'experiment'|'none', blindSpot?:boolean }`.
- Genre taxonomy file: `competitive-fps`, `social-mmorpg` (+ open enum). Game→genre map.
- Internal percentile band sourced at read-time from the percentile snapshot (built in this phase, see below).
- External norms hand-authored with citation string (published F2P/FPS/MMORPG sources).
- New route `GET /api/knowledge/levers?game=` (public read) → resolves library for a game: filters by genre/game, runs data-gate against live availability, attaches internal+external benchmark, marks withheld levers + blind spots. Returns `{ levers:[...], withheld:[{lever,reason,missingCubes}], blindSpots:[...] }`.
- Internal percentile snapshot: new nightly server job computes per-metric percentile bands across all live portfolio games over trailing 30d; persists to `segments.db` (new migration). A reader returns point-in-time band for a metric.

**Non-functional**
- Files <200 LOC → split: `genre-taxonomy.ts`, `lever-library-fps.ts`, `lever-library-mmorpg.ts`, `lever-library-index.ts`, `benchmark-resolver.ts`, `percentile-snapshot-store.ts`, `percentile-snapshot-job.ts`.
- No plan-artifact refs in code/filenames/migration names. Migration: `0NN_genre_lever_percentile_snapshot.up.sql` (domain slug only).

## Architecture
Data flow (read): chat/UI → `GET /api/knowledge/levers?game=cfm_vn` → index resolves genre → filters levers → `availability` checks `requiredCubes` vs live meta (withhold on miss) → `benchmark-resolver` joins external norm (static) + internal band (snapshot store) → response.
Data flow (snapshot build): nightly job → for each portfolio game query Cube for each tracked metric → compute percentile bands → upsert into snapshot table (`computed_at`, `game`, `metric_key`, `p25/p50/p75/p90`).

## Related code files
**Create**
- `server/src/knowledge/genre-levers/genre-taxonomy.ts`
- `server/src/knowledge/genre-levers/lever-library-fps.ts` (cfm_vn)
- `server/src/knowledge/genre-levers/lever-library-mmorpg.ts` (jus_vn)
- `server/src/knowledge/genre-levers/lever-library-index.ts`
- `server/src/knowledge/genre-levers/lever-types.ts`
- `server/src/knowledge/benchmark-resolver.ts`
- `server/src/knowledge/percentile-snapshot-store.ts`
- `server/src/knowledge/percentile-snapshot-job.ts`
- `server/src/routes/knowledge-levers.ts`
- `server/src/db/migrations/0NN_genre_lever_percentile_snapshot.up.sql`
**Modify**
- `server/src/index.ts` (register route + schedule nightly job)
**Reuse (read)**
- `server/src/care/availability.ts`, `server/src/care/playbook-registry.ts`, `server/src/advisor/lever-map.ts`

## Implementation steps
1. Define `lever-types.ts` + `genre-taxonomy.ts` (genre enum, game→genre map: cfm_vn=competitive-fps, jus_vn=social-mmorpg).
2. Author `lever-library-fps.ts`: clan-social-retention, competitive-integrity (blindSpot for cheating), skin/crate FOMO+gacha, battle-pass, season-cadence, whale-cause-types. Each with requiredCubes (e.g. clan flags in `user_gameplay_daily`, `etl_lottery_shoot`).
3. Author `lever-library-mmorpg.ts`: server-health/merges (`ccu_by_server`), VIP-tier thresholds (`max_vip_level`), role-level progression speed, whale care (role-level+LTV), recharge-timing-vs-engagement. NO guild/gacha/PvP levers.
4. Author external norms with citations + map each lever's `benchmark.metricKey`.
5. Build `percentile-snapshot-store.ts` + migration + `percentile-snapshot-job.ts`; wire nightly schedule.
6. Build `benchmark-resolver.ts` joining static external + snapshot internal.
7. Build `lever-library-index.ts` resolver (genre filter + data-gate via availability + benchmark join + withhold/blindSpot collection).
8. Build + register `knowledge-levers.ts` route.

## Todo
- [ ] lever-types + genre taxonomy + game→genre map
- [ ] FPS lever library (cfm_vn) incl. cheating blind-spot
- [ ] MMORPG lever library (jus_vn) with jus data gates respected
- [ ] external norms + citations
- [ ] percentile snapshot store + migration + nightly job
- [ ] benchmark-resolver (internal+external)
- [ ] index resolver (data-gate + withhold + blind spots)
- [ ] GET /api/knowledge/levers route + register

## Success criteria
- `GET /api/knowledge/levers?game=cfm_vn` returns FPS levers with both benchmarks; cheating present as blindSpot.
- `?game=jus_vn` returns server/role-level levers; contains NO clan/gacha/PvP lever; jus-gated levers (guild) appear in `withheld` with missingCubes.
- Adding a third game = add genre map entry + (optional) game-specific overrides, zero index/route edits.

## Risks
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Library duplicates playbook data → drift | M×M | Reference `playbookIds` only; never copy bodies. DRY. |
| jus levers leak clan/gacha (fabrication) | M×H | Hard data-gate per game; tests assert jus has no clan/gacha lever. |
| Snapshot job heavy / slow Cube | M×M | Nightly only, trailing 30d, per-metric cap; reuse rollups where present. |
| External norms become a "made-up number" surface | M×H | Every external norm requires a `source` + `citation` string; resolver rejects entries missing it. |

## Security
- Route is public read (no PII). Snapshot stores aggregate percentiles only (no user rows).

## Next steps
- Unblocks P2 (diagnose narrative cites these benchmarks) and P3 (`recommend_actions` reads this library).
