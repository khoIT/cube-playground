# Brainstorm — CDP Projection + Verify on `mf_users` Measures

Date: 2026-05-17
Branch: `new_metric`
Status: Approved by user; ready for `/ck:plan`.
Skill: `superpowers:brainstorming`
Related architecture: [`./architecture/cube-vs-cdp-metrics-architecture.md`](./architecture/cube-vs-cdp-metrics-architecture.md), [`./architecture/cube-mm01-integration-and-schema-reload.md`](./architecture/cube-mm01-integration-and-schema-reload.md)
Spec: `C:\Users\CPU12830-local\Downloads\MM-01-CRUD.openapi.yaml` (metrics_mgm v1.0.0)

---

## 1. Problem statement

User goal: measures created in the New Metric wizard must eventually be pushed via `POST /cdp/v1/metrics` (MM-01-CRUD) and persisted in the CDP metrics store.

This round is **slice 1 of that arc**:

- (A) **Display** projected CDP fields (`game_id, metric_name, metric_codename, source, expression, dimensions, filter`) for measures on the `mf_users` cube inside the existing `/catalog` DetailPanel.
- (B) **Programmatic verify** the metric exists on CDP via a round-trip `GET /cdp/v1/metrics/{game_id}/{metric_name}` with field-equality check.

Explicitly NOT in this round: wizard → MM-01 push, cubes other than `mf_users`, backfill, real CDP wiring.

---

## 2. Exact requirements (locked)

### 2.1 Expected output

1. Catalog DetailPanel Measures section: each row click-to-expand.
2. Expanded row shows the CDP-projected payload + a `Verify on CDP` button + status badge.
3. Non-projectable measures (calculated `type: number` w/ `{x}` refs, segment-backed, multi-cube) render disabled with a `Not projectable — <reason>` badge.
4. Cube YAML gains `meta.game_id` + `meta.cdp_source` on `mf_users` so projection has its required FQN inputs.
5. Vite middleware mocks `/cdp/v1/*` with in-memory store + seed fixture.

### 2.2 Acceptance criteria

- `/catalog` → `mf_users` → expand `user_count` → card shows `{game_id: bal_vn, metric_name: user_count, metric_codename: user_count, source: iceberg.ballistar_vn.mf_users, expression: COUNT(*), dimensions: [...], filter: ""}`.
- Verify on seeded measure → `Available`.
- Verify on unseeded → `Missing`.
- Verify on tampered seed (different `expression`) → `Mismatch` with diff.
- `arpu_vnd` (calculated) → `Not projectable — references other measures`.
- Projection mapper unit tests cover all 6 measure shapes from §3.3 of the architecture doc.

### 2.3 Scope boundary (OUT)

- Real MM-01 reachability (mock-only this round).
- POST from the wizard.
- Cubes other than `mf_users`.
- Backfill of existing measures via mock-POST seed button (deferred).
- Edit / push UI for non-projectable measures (cannot represent).
- `materialize` / `schedule` UI (mock accepts defaults; not surfaced).

### 2.4 Non-negotiable constraints

- RR5 + HashRouter (no RR6 idioms).
- 200-line ceiling on files (`detail-panel.tsx` is at 216 — refactor required).
- No `dangerouslySetInnerHTML`.
- File-naming = kebab-case w/ descriptive names.
- Typed discriminated unions for API responses (mirror `NewMetric/api.ts` pattern).
- No throws in the API client — return discriminated results.

### 2.5 Touchpoints

| File | Action |
|---|---|
| `cube-dev/cube/model/cubes/mf_users.yml` (external) | edit — add `meta.game_id`, `meta.cdp_source` |
| `src/pages/Catalog/detail-panel.tsx` | refactor (split measure row out) |
| `src/pages/Catalog/measure-row.tsx` | new (expandable row) |
| `src/pages/Catalog/use-catalog-meta.ts` | extend type to expose `cube.meta` |
| `src/pages/Catalog/cdp-projection/types.ts` | new |
| `src/pages/Catalog/cdp-projection/project-measure.ts` | new pure mapper |
| `src/pages/Catalog/cdp-projection/use-cdp-verify.ts` | new state-machine hook |
| `src/pages/Catalog/cdp-projection/cdp-projection-card.tsx` | new UI |
| `src/pages/Catalog/cdp-projection/api.ts` | new typed client |
| `vite-plugins/cdp-mock-middleware.ts` | new |
| `vite.config.ts` | register plugin |
| `src/pages/Catalog/cdp-projection/__tests__/project-measure.test.ts` | new |
| `vite-plugins/__tests__/cdp-mock-middleware.test.ts` | new |

---

## 3. Approaches evaluated

### A — Single CDP vertical inside `src/pages/Catalog/` ✅ chosen

Self-contained module: mapper + hook + UI + API client + mock middleware.

**Pros**
- One namespace, one new sub-tree (`cdp-projection/`), zero cross-cutting refactor outside Catalog.
- Mock middleware mirrors `vite-plugins/schema-write-middleware.ts` shape — familiar local pattern.
- Easy swap: replace mock with a real proxy later by editing one plugin + one env URL.
- API client mirrors `NewMetric/api.ts` — same discriminated-union style.

**Cons**
- 5–6 new files for a mock-only feature; small YAGNI risk.
- DetailPanel refactor needed to stay under 200-line ceiling.

### B — Bolt CDP info onto QueryBuilderV2 metadata-catalog tab ❌

Rejected — user picked Catalog DetailPanel as the surface; this would contradict the chosen surface and split CDP info across two views.

### C — Standalone `/cdp-metrics` page ❌

Rejected — user explicitly rejected this option.

---

## 4. Chosen architecture

```
┌────────────────────────────────────────────────────────────┐
│ Cube YAML (external: cube-dev/cube/model/cubes/mf_users.yml)│
│   meta:                                                    │
│     game_id: bal_vn                ◄── NEW                 │
│     cdp_source: iceberg.ballistar_vn.mf_users   ◄── NEW    │
└──────────────────────────┬─────────────────────────────────┘
                           │ /cubejs-api/v1/meta?extended=true
                           ▼
┌────────────────────────────────────────────────────────────┐
│ src/pages/Catalog/                                         │
│  detail-panel.tsx                                          │
│   └─ <MeasureRow>  (click-to-expand)                       │
│        └─ <CdpProjectionCard>                              │
│             payload preview + [Verify on CDP]              │
│                                                            │
│  cdp-projection/                                           │
│    project-measure.ts   (pure)                             │
│    use-cdp-verify.ts    (idle → checking → … )             │
│    api.ts               (typed client)                     │
│    cdp-projection-card.tsx                                 │
│    types.ts                                                │
└──────────────────────────┬─────────────────────────────────┘
                           │ fetch /cdp/v1/...
                           ▼
┌────────────────────────────────────────────────────────────┐
│ vite-plugins/cdp-mock-middleware.ts                        │
│   In-memory Map<(game_id, metric_name), Metric>            │
│   Seed fixture (2–3 measures for `bal_vn`)                 │
│   POST  /cdp/v1/metrics         200 / 409 METRIC_EXISTED   │
│   GET   /cdp/v1/metrics/{g}     list w/ pagination shape   │
│   GET   /cdp/v1/metrics/{g}/{n} 200 / 404                  │
│   GET   /cdp/v1/metrics/{g}/total                          │
└────────────────────────────────────────────────────────────┘
```

### 4.1 Cube → CDP mapping table

Implements §3.3 of `architecture/cube-vs-cdp-metrics-architecture.md`.

| Cube measure type | → CDP `expression` | → CDP `filter` | Projectable? |
|---|---|---|---|
| `count` | `COUNT(*)` | `""` | yes |
| `sum, sql: x` | `SUM(x)` | `""` | yes |
| `count_distinct, sql: x` | `COUNT(DISTINCT x)` | `""` | yes |
| `count_distinct_approx, sql: x` | `approx_distinct(x)` | `""` | yes |
| `<agg>, filters: [{sql: P1}, {sql: P2}…]` | `<agg>(col)` | `(P1) AND (P2) …` | yes |
| `number` calculated w/ `{a}/{b}` refs | — | — | **no** — references other measures |
| `meta.segment` or multi-cube | — | — | **no** — not single-source |

`dimensions[]` projection = all `cube.dimensions` where `public !== false` and `primaryKey !== true`, by raw column name (no granularity semantics carried for time dims — out of MM-01 scope).

### 4.2 Verify state machine

```
idle ── click Verify ──▶ checking
                          │
                          ├─ GET 200 + field-equal ──▶ available
                          ├─ GET 200 + field-diff  ──▶ mismatch (show diff)
                          ├─ GET 404 ──────────────▶ missing
                          └─ network / 5xx ────────▶ error (retry)
```

Equality check covers `metric_codename, source, expression, dimensions, filter`. Ignores `materialize, schedule, created_at, updated_at`.

### 4.3 Mock middleware behavior

- Seed fixture file `vite-plugins/cdp-mock-seed.json` — 2–3 measures keyed `(bal_vn, <name>)` matching the projection of real `mf_users` measures, plus 1 mismatch case for testing.
- POST creates → 200 on first; 409 `METRIC_EXISTED` on duplicate `(game_id, metric_name)`.
- GET one → 200 on hit, 404 `METRIC_NOT_FOUND` on miss, 404 `GAME_NOT_FOUND` for unknown `game_id`.
- All responses follow MM-01 envelope `{ status, error?, data?, pagination? }`.
- In-memory only — dev refresh resets to seed.

---

## 5. Risks & mitigations

| # | Risk | Mitigation |
|---|---|---|
| 1 | Cube YAML lives in external repo (`cube-dev/`). May not be touchable this round. | Fallback: client-side mapping map `src/pages/Catalog/cdp-projection/cube-to-cdp-mapping.ts` keyed by cube name. Plan offers both paths; ship YAML-first w/ fallback if blocked. |
| 2 | `/meta?extended=true` survival through `useCatalogMeta`. | Quick probe in P1: log `cube.meta` on catalog mount; if absent, patch `useCatalogMeta` to request extended. |
| 3 | DetailPanel grows past 200 lines. | Extract `<MeasureRow>` + `<CdpProjectionCard>` to siblings; keep DetailPanel orchestration only. |
| 4 | Mock state ephemeral. | Acceptable for POC; seed fixture gives stable Available baseline; document in module README. |
| 5 | Mismatch diff renderer scope creep. | v1 = expected/actual two-column list. No JSON diff lib. |
| 6 | Calculated measures opaque (~6 on `mf_users` per arch doc §1.3). | Render disabled w/ `Not projectable — references other measures`. Document in mapper. |
| 7 | `cdp_source` FQN convention (`iceberg.ballistar_vn.mf_users` is a guess). | Surface in Open Questions; user picks final FQN before P2 of plan. |
| 8 | Time dimensions in `dimensions[]`. | Include by column name; document that granularity semantics aren't carried — MM-01 has no time-dim concept. |
| 9 | Tampered seed mismatch is the only test path; hard to exercise from real wizard. | Mock-POST endpoint accepts arbitrary payload; manual test path documented. |
| 10 | Refresh wipes mock state. | Seed fixture covers main demo path; document. |

---

## 6. Success metrics

- All 6 mapper unit tests green (one per measure shape in §4.1).
- Mock middleware tests cover 200 / 404 / 409 paths.
- Manual smoke: `npm run dev` → `/catalog` → `mf_users` →
  - Expand `user_count` → card matches seeded payload → Verify → `Available`.
  - Expand `lifetime_active_days` (or any unseeded sum measure) → Verify → `Missing`.
  - Expand `arpu_vnd` → `Not projectable — references other measures`, no Verify button.
- DetailPanel + every new file ≤ 200 lines.
- No `dangerouslySetInnerHTML` in new code.

---

## 7. Implementation considerations

- **TDD per phase** — mapper + middleware are pure / deterministic; tests precede implementation.
- **File ownership** — entire vertical lives in `src/pages/Catalog/cdp-projection/` + one middleware file. No cross-cutting changes.
- **Backwards compat** — DetailPanel refactor preserves current rendering for non-mf_users cubes (no expand behavior unless `cube.meta.cdp_source` present).
- **Naming** — kebab-case, descriptive (e.g. `project-measure.ts`, not `mapper.ts`).
- **Type re-export** — `CdpMetricPayload` reused by future wizard push code; lives in `cdp-projection/types.ts` even if wizard isn't wired this round.

---

## 8. Phase outline (for `/ck:plan` handoff)

Suggested phases — `/ck:plan` will own final structure.

| # | Phase | Effort |
|---|---|---|
| 1 | Foundation: types + projection mapper + unit tests (pure modules) | 0.5d |
| 2 | Mock middleware + seed fixture + middleware tests | 0.5d |
| 3 | `useCatalogMeta` extension + `cube.meta` exposure + `mf_users.yml` edit (or client-side mapping fallback) | 0.25d |
| 4 | DetailPanel refactor: extract `<MeasureRow>`, click-to-expand wiring | 0.25d |
| 5 | `<CdpProjectionCard>` + `useCdpVerify` + Verify button UI | 0.5d |
| 6 | Smoke test + docs + cleanup | 0.25d |

Total ≈ 2.25 focused days. Calendar 4–5 working days.

---

## 9. Open Questions

1. `cdp_source` FQN for `mf_users` — is `iceberg.ballistar_vn.mf_users` correct, or some other catalog prefix (`hive.`, `lakehouse.`)? Need confirmed answer before mapper hardcodes the FQN OR before the cube-dev YAML edit lands.
2. Seed fixture composition — which 2–3 `mf_users` measures should be pre-seeded as Available? Suggest `user_count`, `paying_user_count`, plus one filtered variant; pick during P2.
3. Cube YAML edit vs client-side mapping — user picked YAML, but if `cube-dev` is locked / requires PR review, the client-side fallback becomes primary. Decide at start of P3.
4. Should the mismatch diff include `dimensions[]` ordering? Cube's order may differ from MM-01 storage order. Normalize via sort before compare or treat as ordered? Suggest: sort both sides for `dimensions`; ordered compare elsewhere.
5. Verify button placement when measure is `Not projectable` — fully hidden vs disabled grey? Suggest: hidden (no value to click).
6. Mock 401 path — do we exercise unauthenticated flow at all, or only happy-path? Suggest: skip 401 in v1; revisit when real proxy lands.

---

## 10. Next step

User has approved the design. Recommended handoff: `/ck:plan --tdd <this report path>`.
