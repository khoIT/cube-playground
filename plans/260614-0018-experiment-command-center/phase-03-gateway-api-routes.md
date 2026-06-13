# Phase 03 — Gateway API Routes (CRUD / work-queue / scorecard)

## Context links
- Route template: `server/src/routes/segment-cs-tickets.ts` (cache + envelope + degrade pattern), `server/src/routes/care-cases.ts` (zod validation + write-gate + game scoping).
- Registration: `server/src/index.ts` (import + `app.register(...)` block, lines 11–147).
- Game scope helper: `server/src/care/game-scope.ts` (`resolveGameScope`).
- Write gate: global `enforceWriteRoles` middleware (already registered in `index.ts:95`) — mutations require editor/admin.
- Stores/readers from Phases 1–2.

## Overview
- **Priority:** P0.
- **Status:** pending.
- One route module `server/src/routes/experiments.ts` exposing CRUD + assign + work-queue + scorecard. Mirror `segment-cs-tickets`/`care-cases` conventions exactly (zod, error envelope `{error:{code,message}}`, in-process cache for expensive scorecard reads, degrade-to-partial on lakehouse hiccup).

## Endpoints
```
GET    /api/experiments?game           list (registry, by game)
POST   /api/experiments                create draft           [write-gated]
GET    /api/experiments/:id            get one
PATCH  /api/experiments/:id            edit draft params / status [write-gated]
POST   /api/experiments/:id/assign     freeze assignment (draft→running) [write-gated]
GET    /api/experiments/:id/work-queue treatment arm list + script (CS surface, NO PII)
GET    /api/experiments/:id/scorecard  ITT + treated-on-treated + series
GET    /api/experiments/:id/members/:uid  experiment-360 per-member drilldown
```

## Key insights
- Work-queue returns `uid` + member name (best-effort, via `resolveMemberNamesLive` like `segment-cs-tickets`) + reachability flag + the static outreach script from the experiment row. NO phone/email — that's the whole PII boundary.
- Scorecard is the expensive call → cache it (TTL ~30min; outcome is yesterday-fresh so no need to recompute per request). Mirror the `cache` Map + `MAX_CACHE_ENTRIES` + `__clearScorecardCache()` test hook in `segment-cs-tickets.ts`.
- Scorecard computation lives in a pure module (`scorecard-stats.ts`) so it's unit-testable without Trino: takes outcome rows + exposure rows + arm membership → returns lift/CI/p-value. Route just wires readers → stats.
- Statistics: two-proportion z-test for re-pay rate (binary outcome) + Welch-ish CI on mean rev (KISS: report mean + 95% normal-approx CI). Document formulas in the stats module.

## Data flow
```
/assign     → assignment-service.assignExperiment(id)
/work-queue → experiment-assignment-reader.armUids(id,'treatment')
              → resolveMemberNamesLive (best-effort names)
              + reachability (aggregate coverage only — see Security)
              + experiment.outreach_script
/scorecard  → armMembers(id) ⨯ payment-outcome-reader ⨯ cs-exposure-reader
              → scorecard-stats(ITT: assigned arms; ToT: contacted vs control)
              → cache → payload {itt, treatedOnTreated, series}
```

## Related code files
Create:
- `server/src/routes/experiments.ts`
- `server/src/experiments/scorecard-stats.ts` (pure: z-test, CI, lift)
- `server/src/experiments/work-queue-assembly.ts` (uid+name+reachability merge)

Modify:
- `server/src/index.ts` — `import experimentsRoutes from './routes/experiments.js';` + `await app.register(experimentsRoutes);` in the register block (after `segmentRefreshOpsRoutes`, alongside care routes).

Read for context: `segment-cs-tickets.ts`, `care-cases.ts`, `game-scope.ts`, `services/resolve-member-names-live.ts`.

## Implementation steps
1. `scorecard-stats.ts` — pure fns: `twoProportionZTest(a, b)`, `meanWithCI(values)`, `computeScorecard({armRows})`. Returns `{ itt: {treatment, control, liftPct, ci, pValue}, treatedOnTreated: {...}, }`.
2. `work-queue-assembly.ts` — merge arm uids + live names + reachability bucket. No PII columns.
3. `experiments.ts`:
   - Validate `?game` via `resolveGameScope`.
   - zod schemas for create/patch (mirror `care-cases.ts` `patchSchema`).
   - CRUD → `experiment-store`. Mutations rely on the global write-role gate (already registered) — assert game scope; no extra role check needed unless `care-cases` does more (verify).
   - `/assign` → `assignment-service`.
   - `/work-queue` → assembly module.
   - `/scorecard` → readers + stats + cache; degrade outcome/exposure to partial (null section) on failure, never 500 the whole card if one edge is down.
   - `/members/:uid` → membership-assert (uid in this experiment's arms, like `segment-cs-tickets` membership gate) → outcome+exposure for that uid + arm.
4. Register in `index.ts`.
5. Compile check.

## Todo
- [ ] `scorecard-stats.ts` (pure, documented formulas)
- [ ] `work-queue-assembly.ts` (no PII)
- [ ] `experiments.ts` (8 endpoints, zod, cache, degrade)
- [ ] membership-assert on `/members/:uid`
- [ ] register in `index.ts`
- [ ] compile clean

## Success criteria
- All endpoints return typed envelopes; invalid game → 400; missing experiment → 404; unknown uid not in arms → 404.
- `/work-queue` payload contains zero contact-PII fields (grep payload type).
- `/scorecard` cached; second call within TTL skips reader work.
- Mutations rejected for non-editor identities (write gate).

## Risks
| Risk | L×I | Mitigation |
|---|---|---|
| Scorecard reader latency (35M-row outcome scan) | M×M | Cache TTL 30min; date-pruned queries from Phase 1; series query arm-aggregated not per-uid. |
| One edge (exposure) down fails whole card | M×M | Degrade per-section to null; ITT (outcome-only) still renders. |
| Readable experiment used to dump arbitrary uid history | L×H | Membership-assert on `/members/:uid` (uid must be in this experiment's frozen arms) — mirrors `segment-cs-tickets` guard. |
| Stats correctness | M×H | Pure stats module + unit tests with known fixtures (Phase 7); document each formula inline. |

## Security (PII)
- `/work-queue` is the CS-facing surface: returns `uid`, best-effort display name, aggregate reachability bucket, static script. NEVER phone/email/msisdn. The reachability flag is derived from AGGREGATE coverage (`vga_pii_*` counts), not a per-user contact lookup — POC may ship a static "CS resolves contact in own tooling" note instead of any reachability call (YAGNI; simplest compliant option).
- Mutations write-gated; reads game-scoped to the caller's workspace games.

## Next steps
Phases 4–6 consume these endpoints from React.
