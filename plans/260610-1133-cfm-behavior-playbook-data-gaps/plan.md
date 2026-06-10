# cfm_vn behavior-playbook data gaps — make 07/11/12 real

Status: planning. No code changes yet. Part 1 (honest gating) already shipped — see
commit `98aa42e` (`fix(care): gate playbooks on their condition member…`).

## Context

CS sweep on cfm_vn left 5 playbooks not opening cases. Root cause: each references a
Cube member **absent from cfm_vn's live model**, so the cohort query failed mid-sweep
(400 not-found, behavior-cube date-bound 500, or empty filter → "no usable condition").

Part 1 fixed the *symptom*: availability gating now validates the condition's query
member (`ruleMembers`), so these skip cleanly as "not available for this game" instead
of erroring. They still don't open cases — that's this plan.

Verified member inventory (live cfm_vn `/meta`, 2026-06-10):
- `etl_prop_flow`: time dims `dteventtime`, `log_date`; `prop_id`, `prop_group_id`,
  `prop_type`, `prop_quality`, … — **no `acquired_at`**.
- `etl_lottery_shoot`: `history_draw_cnt`, `this_round_draw_cnt`, `luck_point`,
  `is_ten_pull`, … — **no `draws_since_ssr`** (no pity-since-SSR counter).
- `user_gameplay_daily`: only `ladder_*` + `clan_*` — **no `limited_set_owned_count`**.

Trino data verification (via Cube `/load` → Trino, cfm_vn, last 30d, 2026-06-10):
- `prop_quality` ∈ **{0,1,2,3,4}** — vol: 4=77.7M, 3=17.8M, 2=6.1M, 0=1.34M, 1=1.32M.
  Rare ≈ the low-volume codes (0/1), but the **code→rarity legend is NOT in this repo**
  (no data dictionary found) — needs the game's prop-quality mapping to confirm.
- `prop_type` ∈ **{1,2,3}** — vol: 1=73M, 2=21.9M, 3=9.3M. Which code = "limited set"
  is **undocumented** here.
- `etl_lottery_shoot.luck_point` ∈ **0–99** (smooth ramp 90→99, big spike at 90) →
  strongly a **pity/bad-luck accumulator** (per-pull, resets on SSR), capped ~99. This
  is the real pity signal for 12.
- `etl_lottery_shoot.result`: `0` dominates (3.17M = common/no-win); rare wins are
  discrete item codes (11092, 20002, 32032, …) — an SSR is a specific result-code set.
- No in-repo dictionary for these integer codes (grep of docs/ + server/ empty) — the
  code→meaning mapping is game-design knowledge / upstream schema, not stored here.

Out of scope (stay gated, decided): **19 Pre-major-patch**, **20 New faction/server** —
windowed on `ops_calendar.*` with no modeled data source.

## Model YAML locations + facts (verified 2026-06-10)

The cfm behavior cubes are bare column passthroughs — **no titles/descriptions/legends**,
so code meanings are NOT in the model (raw upstream columns):
- `cube-dev/cube/model/cubes/cfm/etl_prop_flow.yml` — `prop_quality` (`sql: propquality`,
  string), `prop_type` (`proptype`, string), `prop_group_id` (`propgid`, string).
- `cube-dev/cube/model/cubes/cfm/etl_lottery_shoot.yml` — `luck_point` (`luckpoint`,
  **type: string** → a numeric `>=` pity filter needs a casted number dimension/measure),
  `history_draw_cnt`/`this_round_draw_cnt` (number), `result` (string).
- (`cube-dev` is a checkout under the repo root; sibling `../cube-dev` may also exist —
  confirm which one the running `cube_api_dev` actually mounts before editing.)

## Cross-repo reality (read before touching the model)

- Live Cube YAMLs live in the sibling **`cube-dev`** repo, NOT this one.
- `etl_*` are **raw per-event tables** → behavior cubes that **reject any query not
  bounding `log_date`/`dteventtime`/`ts` within 31 days**, and are per-member only
  (`partial`), not refresh-cadence cohort scans. Prefer materializing the signal into a
  **daily mart** (`user_gameplay_daily` or sibling) so the playbook becomes a plain
  cohort filter — that is exactly what the registry already *expects* for 11
  (`user_gameplay_daily.limited_set_owned_count`).
- New rollups/models need the **serving instance restarted** to route (DEV_MODE=false,
  no hot-reload); the dedicated dev cube is `cube_api_dev` + `cubestore_dev` +
  `cube_refresh_worker_dev` (restart via `STACK_DEV_CUBE=1 node scripts/stack-local.mjs
  restart …`; the watchdog in `scripts/ensure-cube-api.mjs` now also recovers a dead
  cubestore router).
- Verify a rollup actually serves by reading compiled SQL / `usedPreAggregations`, not
  by assuming.

---

## Item A — 07 Cosmetic / rare unlock  (this repo, registry repoint)

Effort: small. Repo: cube-playground (`server/src/care/playbook-registry.ts`).

- **Current:** `condition: event on etl_prop_flow.acquired_at, window 'last 24 hours'`.
  `acquired_at` doesn't exist; even repointed, the bare time window matches *anyone who
  touched any prop in 24h* — not "rare".
- **Target:** window on the real event time **`etl_prop_flow.dteventtime`** (`last 24
  hours` — also satisfies the ≤31-day behavior-cube bound) **AND** filter
  **`prop_quality`** to the rare tier(s). This needs a compound condition (time window
  AND quality), so it may need a small predicate-shape change, not just a member swap.
- **Open domain Qs (BLOCKING):**
  1. `prop_quality` is the int set {0,1,2,3,4} (verified). Low-volume codes 0/1 are the
     rare candidates — but confirm the **code→rarity legend** (is rare = {0,1}? does a
     higher code mean higher rarity?). Not documented in-repo.
  2. Confirm "rare unlock" = a **gain** (filter `direction`/`prop_delta > 0`), not a loss/consume.
- **Verification:** repoint → `resolveAvailability('07', cfm_vn)` flips off
  `unavailable` (member present); single-playbook sweep `?playbook=07` opens a *small,
  plausible* cohort (rare-only), not a full-base match; inspect compiled SQL bounds
  `dteventtime` ≤ 31d.
- **Risk:** raw event table → `partial` (per-member); large row volume — keep the 24h
  window + COHORT_CAP. If the rarity cohort is still huge, the "rare" definition is wrong.

## Item B — 12 Gacha bad-luck  (cube-dev model addition)

Effort: medium. Repo: cube-dev (model) + maybe this repo (repoint dataReq/condition).

- **Current:** `condition: abs on etl_lottery_shoot.draws_since_ssr gte 70`. No such
  member; raw cube also needs a date bound.
- **Target:** a **per-user pity signal** the sweep can cohort-filter. Two paths:
  - B1 (preferred): materialize **`draws_since_ssr`** (or `pity_count`) into a daily mart
    member (e.g. `user_gameplay_daily.draws_since_ssr` or a new `user_gacha_daily`), then
    point the registry there → plain cohort filter, no 31-day-bound headache.
  - B2 (cheap, approximate): **`luck_point` (0–99) is verified to be the pity meter** —
    repoint to `etl_lottery_shoot.luck_point >= <threshold>` with a `last_30d` bound. But
    it's raw/per-member, and only the **latest-row value per player** is meaningful
    (needs latest-per-player aggregation → still points back to B1's mart).
- **Open domain Qs (BLOCKING):**
  1. `luck_point` confirmed 0–99 pity scale (verified). What threshold ≈ the intended "70
     draws since SSR" on this 0–99 scale? (spike at 90 suggests soft-pity ~90.)
  2. Does luck_point reset exactly on SSR, or is a true draws-since-SSR count needed
     (derive by windowing since last rare `result` code)?
  3. Which mart hosts the latest-per-player pity value (extend `user_gameplay_daily` vs
     new gacha mart)?
- **Verification:** new member appears in cfm_vn `/meta`; `resolveAvailability('12')`
  no longer `unavailable`; sweep opens a bad-luck cohort whose size matches expectation;
  compiled SQL hits the mart (not cold raw etl_).

## Item C — 11 Collector FOMO  (cube-dev model addition)

Effort: medium-large. Repo: cube-dev (model).

- **Current:** `condition: abs on user_gameplay_daily.limited_set_owned_count gte 4`.
  Member doesn't exist (mart has only ladder/clan).
- **Target:** add **`user_gameplay_daily.limited_set_owned_count`** (the member the
  registry already names) — a per-user daily count of distinct limited-set props owned,
  derived from `etl_prop_flow` (`prop_group_id` of limited `prop_type`, gains only).
- **Open domain Qs (BLOCKING):**
  1. What defines a "limited set"? (`prop_type` value? a `prop_group_id` allowlist?)
  2. "owned" = ever-acquired (cumulative distinct `prop_group_id`) or currently-held
     (net of losses/expiry — note `expire_time` exists)?
  3. Is `≥ 4` the right near-complete threshold, and is set size fixed (e.g. 5/6)?
- **Verification:** member in `/meta`; `resolveAvailability('11')` off `unavailable`;
  sweep opens a near-complete-set cohort; spot-check a few uids' actual ownership.

---

## Sequencing

1. **A (07)** — in-repo, ship once "rare" defined. Fastest real win.
2. **B (12)** & **C (11)** — cube-dev mart members; build + refresh-worker partition +
   serving restart; then (12 only) repoint the registry dataReq/condition. Bundle since
   both extend the gameplay mart.
3. Re-run cfm_vn sweep; confirm the gated count drops and cohorts are plausible.

## Open questions (consolidated — need product/domain input; data-narrowed where noted)

1. 07: `prop_quality` codes are {0..4} (verified); rare ≈ low-vol {0,1} — confirm the
   code→rarity legend (not in-repo). Gains-only?
2. 12: `luck_point` 0–99 confirmed as the pity meter — what threshold on that scale (≈90
   soft-pity?), and host mart for latest-per-player value.
3. 11: `prop_type` codes are {1,2,3} (verified) — which = "limited set" (undocumented)?
   ever-owned vs currently-held; threshold + set size.
4. Any of 07/11/12 not worth building (leave gated)? 19/20 confirmed gated.

Note: Trino verification (2026-06-10) resolved the value *sets* + the 12 pity signal,
but the integer **code meanings** (prop_quality/prop_type) are not stored in this repo —
they require the game's data dictionary, so those stay as domain questions.
