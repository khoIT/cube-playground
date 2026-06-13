# Phase 03 — Onboarding generator script (clean-case emit)

## Context links
- Existing tooling: `scripts/trino-query.mjs` (Node ESM, catalog game_integration) — the pattern to match
- Canonical spec: phase 01 catalog
- GAME_SCHEMA map: `cube-dev/cube/cube.js:22-31`
- Prior intent (memory): "cube-model onboarding agent plan (introspect Trino → infer → stage draft Cube models)"

## Overview
- Priority: P1. Status: pending. Depends on 01.
- Build the generator that introspects a game's Trino schema and EMITS the canonical cube YAMLs for the
  clean case. Anomaly handling is phase 04 (the script flags, the agent decides — NOT a rules engine).

## Key insights
- Because cube SQL uses BARE table names and schema resolves per-tenant (`cube.js:298-307`), the emitted YAML
  for a clean cube is IDENTICAL across games. The generator's clean path is therefore a near-copy of the
  canonical template with only `title:` (game label) substituted. This keeps the script trivial (KISS/DRY).
- Single source of truth = the canonical templates the generator carries (open decision 4: generator-as-truth).
  Re-running regenerates; do NOT hand-maintain 8 copies. Mirrors the drift lesson in
  `preset-bundles-loader.ts:1-10` (hand-synced mirrors drifted twice).

## Language + location (LOCKED — user 2026-06-14)
**Node `.mjs` at `cube-dev/scripts/`** (submodule, co-located with the cube YAMLs it emits). Reuses the
`scripts/trino-query.mjs` Trino-client pattern; emits YAML via `js-yaml`. No Python venv. The script writes
into the same repo it lives in (cube-dev) — simpler than the cross-repo `--cube-dev-root` indirection.
**Generator-as-single-source-of-truth**: re-run to regenerate; no maintained hand-copies (drift-risk doc per
`preset-bundles-loader.ts:1-10`).

## Requirements
Functional (clean case only this phase):
1. **Introspect**: given `<game>`, resolve schema via GAME_SCHEMA, query `information_schema.columns` for the
   33-table core; report table-present + column-signature vs the canonical expectation.
2. **Emit**: for each of the FULL canonical set (all 33-table-core cubes — locked full scope) whose source
   table(s) are present with the expected signature, write `cube-dev/cube/model/cubes/<game>/<cube>.yml`
   from the carried template, substituting only the title.
3. **Idempotent + non-destructive**: never overwrite an existing file unless `--force`; default writes only
   missing cubes (so re-run = fill gaps). Print a diff/summary of what it would write under `--dry-run`.
4. **Manifest**: emit a per-run `reports/onboarding-<game>-<date>.md` listing emitted/skipped/flagged cubes.

Non-functional:
- < ~250 LoC for the clean path (split introspect / template / emit modules if >200, per repo rule).
- No network writes beyond read-only Trino introspection (uses existing trino client).
- Templates stored as data (one canonical YAML per cube under `scripts/cube-templates/` or inline), so the
  spec lives in ONE place.

## Architecture / data flow
```
<game> ──▶ resolveSchema (GAME_SCHEMA) ──▶ introspect(information_schema.columns)
                                              │
                          ┌───────────────────┴───────────────────┐
                   table+sig matches canonical?              mismatch / sampling signal
                          │ yes (clean)                            │ (Phase 04)
                          ▼                                        ▼
                   emit <cube>.yml from template            flag + propose strategy → agent decision
                          │                                        │
                          └──────────────┬─────────────────────────┘
                                         ▼
                              manifest report + validate (Phase 07)
```
- Location (LOCKED): `cube-dev/scripts/onboard-game-cube-model.mjs` — lives in the same submodule it writes
  to, so no cross-repo `--cube-dev-root` indirection. Output lands in the same repo. (The whole change set
  still spans both repos because Phase 05 touches main-repo presets — but the SCRIPT is single-repo.)

## Related code files
Create (cube-dev submodule):
- `cube-dev/scripts/onboard-game-cube-model.mjs` (entry: introspect + emit + manifest)
- `cube-dev/scripts/cube-templates/<cube>.yml.tmpl` (the canonical templates from phase 01) — or a single
  `cube-dev/scripts/cube-canonical-templates.mjs` exporting template strings.
- `cube-dev/scripts/lib/trino-introspect.mjs` (column-signature fetch; mirror `scripts/trino-query.mjs` client)
Read: `scripts/trino-query.mjs` (client pattern), phase-01 catalog, `cube-dev/cube/cube.js`.
Write target (cube-dev submodule): `cube-dev/cube/model/cubes/<game>/*.yml`.

## Implementation steps
1. Extract the Trino client from `trino-query.mjs` into `scripts/lib/trino-introspect.mjs` (or import it).
2. Encode canonical templates (phase 01) with a `{{GAME_TITLE}}` placeholder; everything else literal/bare.
3. `introspect(game)`: fetch column list per core table; compute signature; compare to canonical expected sig.
4. `emit(game, opts)`: for clean cubes, render template → write if missing (or `--force`). Skip + flag others.
5. Manifest writer + CLI flags `--dry-run`, `--force`, `--only <cube,…>`, `--cube-dev-root`.
6. Wire the phase-04 anomaly hooks as callbacks (implemented in 04) — keep the clean path independent so it
   ships first.

## Todo
- [ ] Trino introspect lib (reuse existing client)
- [ ] Canonical templates with title placeholder
- [ ] introspect() table+signature compare
- [ ] emit() idempotent, non-destructive, --dry-run/--force
- [ ] Manifest report writer
- [ ] CLI wiring + help

## Success criteria
- Running against cfm regenerates byte-equivalent canonical cubes (excluding bespoke etl_*) — proves
  template fidelity (diff vs current cfm files = only title/whitespace).
- Running against a clean game with gaps writes ONLY the missing canonical cubes; re-run is a no-op.
- `--dry-run` prints intended writes without touching disk.
- No file outside `cube-dev/cube/model/cubes/<game>/` is written.

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Generator overwrites a hand-tuned cube (e.g. jus mf_users) | Med×High | Non-destructive default; jus mf_users is anomaly-flagged (04) so clean path never emits it. `--force` explicit. |
| Template drifts from cfm reality over time | Med×Med | Success criterion = cfm round-trip diff in CI (phase 07); generator-as-truth doc. |
| Writing into submodule from main-repo script confuses commits | Med×Low | `--cube-dev-root` explicit; PR description states both repos; manifest lists touched files. |
| Column signature false-mismatch (col order vs set) | Med×Med | Compare as SET of (name,type), not ordered list. |

## Security considerations
- Introspection is read-only `information_schema`. No data exfil. PII cube templates carry `public: false`
  from phase 01 — generator must not strip it.
- Reuse `trino-query.mjs` credential handling; do not add new secret surfaces.

## Next steps
- Phase 04 adds anomaly detection + agent-decision hooks onto this skeleton.
- Phase 07 adds the cfm round-trip + compile/load validation.
