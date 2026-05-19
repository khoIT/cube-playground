# 2026-05-19 — Segments workspace P0/P1 foundation

## Context

Plan: `plans/260519-1610-query-results-to-segments/` — 9-phase, 6-10 week build of a persistent Segments workspace (row-select from playground results → cohort objects with predicate trees, preset analytics tabs, live cron refresh). Today's autonomous session executed scaffolding for **P0 (design-system port)** and **P1 (backend skeleton)** in parallel via two `fullstack-developer` subagents.

## What shipped

### P1 — Backend, fully done
- New `server/` workspace: Fastify + `better-sqlite3` + zod + vitest, idempotent SQL migrations keyed by `PRAGMA user_version`.
- CRUD for `segments` (incl. `/append` + `/refresh` stub), `segment_analyses`, `cube_identity_map`, `presets`, plus `/api/meta/version` SHA-256 hash with 60s TTL.
- Pure translator (`treeToCubeFilters` / `cubeFiltersToTree`) covering AND/OR groups + every operator listed in the brainstorm; `UnsupportedOperatorError` for unknowns.
- `X-Owner` middleware enforces 403 on write to rows owned by another user.
- 23/23 vitest pass (translator 11, owner-header 4, routes-crud 8); `npm run server:build` clean.

### P0 — Partial scaffolding
- 26 new mock-aligned design tokens added to `src/theme/tokens.css`. Notable: `--radius-pill` corrected from `8px` → `9999px` (existing value was semantically wrong); `--member-pill-{measure,dimension,segment,time}-{bg,text}` added.
- 14 visual primitives + 4 chart wrappers under `src/pages/Segments/visuals/`. 32/32 Vitest pass.
- Mock vendored to `tests/visual/mock-fork/` with `MOCK-REVISION.md` marker.
- Playwright configured (1440×900 + 375×812 viewports, 2% diff threshold). `screens.spec.ts`, `playground-polish.spec.ts`, `capture-baselines.ts` scaffolded but not run (baseline PNGs intentionally absent).
- Dev-only fixtures endpoint `POST /api/__fixtures__/segments` registered when `NODE_ENV !== 'production'`, mirroring the `FIXTURE_SEGMENTS` seed Playwright will consume.
- `docs/design-tokens-migration.md` published with full token audit.

## What's deferred (explicitly out of this session)

- **Existing-screen polish pass.** `/`, `/build`, `/catalog`, `/metric/*`, `/metrics/new`, `/settings` all need eyeball QA + per-screen regression fixes against the new tokens. Multi-day manual work.
- **antd + `@cube-dev/ui-kit` theme overrides.** Token additions exist; component-level CSS overrides to consume them are not written.
- **Baseline PNG capture.** Scripts wired; running `npm run visual:capture-baselines` and committing the resulting PNGs is gated on the polish pass landing first.
- **CI gate.** GitHub Actions workflow update to run `test:visual` on PRs.

## Decisions & rationale

- **`--radius-pill` value fix.** Existing token was `8px`, mock spec says full-round. Treated as a bug, not a breaking change — no current site has shipped against `--radius-pill` expecting `8px` (kept `--radius-md: 8px` for backward compat). Migration log documents.
- **Server `vitest.config.ts` isolated from root.** Root vitest picks up `server/test/**` as part of its glob; without a server-local config, the root jsdom env conflicts with node-env unit tests. Resolved by adding `server/vitest.config.ts` with `environment: 'node'`.
- **`better-sqlite3` Node 24.** No prebuilt binary for Node 24 yet; built from source on Apple Silicon successfully. If CI requires prebuilds, pin Node 20 LTS — risk row in `phase-01` already calls this out.
- **`fixtures.ts` route guarded at registration time, not request time.** `if (process.env.NODE_ENV !== 'production') await app.register(fixturesRoutes)` keeps the route out of the prod handler tree entirely; a misconfigured request can't expose it.

## Lessons / things to watch

- The plan is honestly bigger than one autonomous Cook run. Two parallel subagents finished the *bounded* P1 fully; P0 needed scope-cuts (polish + baselines deferred) to land in one session. Reporting partial-but-honest beats claiming a phase done that isn't.
- The autosynced status update in `plan.md` (Pending → Done / Partial) is the load-bearing artifact for the next session — anyone resuming this work should read `phase-00`'s "Session 2026-05-19 delivery" section to know what's left.
- Pre-existing typecheck errors in `QueryBuilderV2/QueryBuilderResults.tsx` (`@cube-dev/ui-kit` Menu props) and `rollup-designer/utils.ts` (`String.replaceAll`, ES2021 lib) are *not* mine — both subagents confirmed zero new errors. Worth flagging as cleanup work but out of scope here.

## Next sessions

Roughly in order:
1. **Run baseline capture** against `tests/visual/mock-fork/` and commit PNGs; verify `screens.spec.ts` passes once `/segments` routes exist.
2. **Phase 2** — FE row-select on Playground Results + push-to-segment modal + Library page consuming `GET /api/segments`. Needs the actual `/segments/*` routes wired in `App.tsx` and `react-router-dom` config.
3. **Phase 3** — Settings identity mapping UI under `src/components/Settings/Settings.tsx`.
4. **Existing-screen polish pass** + antd/ui-kit theme overrides. Can run in parallel with P2.
