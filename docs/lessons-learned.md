# Lessons Learned — Bug-Pattern Catalog

Living catalogue of bug *shapes* (not specific bugs). When a new symptom matches a signal here, jump to the rule before debugging.

Format per lesson:
- **Rule** — what to do.
- **Why** — the failure mode that motivated it (one concrete bug).
- **Signal** — what you'll see if you're about to hit this class.
- **Apply** — concrete fix recipe.

---

## Cube model

### Time dimensions must resolve to TIMESTAMP, not DATE
- **Rule:** any Cube `type: time` dimension must be backed by a SQL expression that yields TIMESTAMP. Cast at the source CTE / column expression, not in a separate dimension wrapper.
- **Why:** Cube wraps time dims with `<col> AT TIME ZONE 'UTC'` and emits `from_iso8601_timestamp(?)` for `dateRange` filters. Trino rejects either operation on DATE — and Cube's generated SQL has no opportunity to coerce after the fact. The cohort retention cube shipped with `MIN(log_date) AS install_date` (DATE), so every `/load` 400'd and `/liveops/cohort` was stuck on "Detecting data path…".
- **Signal:** Cube `/load` returns 400 with `"Type of value must be a time or timestamp with or without time zone (actual date)"`, or any error referencing `AT TIME ZONE` / `from_iso8601_timestamp` on a DATE column.
- **Apply:** `CAST(<col> AS TIMESTAMP) AS <alias>` at the inner SELECT or aggregate. Don't try to patch via the dimension's `sql:` — Cube still emits the `AT TIME ZONE` wrap around your expression, so the inner type still needs to be TIMESTAMP.

### Ratio measures over integer counts must CAST to DOUBLE, not `* 1.0`
- **Rule:** a ratio measure whose **numerator is an integer count** (`count` / `count_distinct`) must force floating-point division with `CAST({numerator} AS DOUBLE) / NULLIF({denominator}, 0)`. Do NOT use the `{numerator} * 1.0 / …` idiom when the numerator is integer.
- **Why:** `mf_users.paying_rate = {paying_users} * 1.0 / NULLIF({user_count}, 0)`. `paying_users` is `count_distinct` → bigint; `bigint * 1.0` is `decimal(_,1)`. Trino decimal division keeps the **dividend's scale** (1 here), so a real rate of 0.69% (`5835/841072`) truncated to scale-1 = `0.0`. Every country/game came back `0.0` because lifetime paying rates are all <5%. The sibling `arpu_vnd` used the same `* 1.0` idiom but was fine — its numerator is a `sum` of a DOUBLE column, so division stayed floating-point. So the bug only bites count/count ratios.
- **Signal:** a percent/ratio measure reads exactly `0` (often the string `'0.0'`) while its component count measures are clearly non-zero in the same row; small ratios all collapse to 0 while large ones (ARPU) look fine. Compiled SQL looks arithmetically correct — the loss is in Trino's decimal scale, not the formula.
- **Apply:** `CAST({count_measure} AS DOUBLE) / NULLIF({denom}, 0)`. Audit every `* 1.0 /` ratio in the model: numerator a `sum` of a DOUBLE column → fine; numerator a `count`/`count_distinct` → must cast. Verify with a live `/load` (a known >0 case should show real decimals, not `0.0`). Note: stale `0.0` may persist in `response_cache` / pre-aggregations until cleared or rebuilt.

### Preset / starter-pack YAML must match live `/meta`
- **Rule:** every measure / dimension referenced by a starter dashboard, KPI config, or anomaly metric must be present in the active game's `/cubejs-api/v1/meta` payload — exact path, exact casing.
- **Why:** `user_recharge_daily.recharge_date` was hard-coded across the starter pack, FE KPI config, anomaly config, and a refresh handler — but the cube exposes `user_recharge_daily.log_date`. Result: every cohort/Revenue/Paying-users tile cached `status: broken` with `"'recharge_date' not found for path …"`.
- **Signal:** `Cube /load → 400: …'<member>' not found for path '<cube>.<member>'`. Also `Invalid query format` for any unknown field.
- **Apply:** before editing presets, diff against `curl <cube>/cubejs-api/v1/meta` for each game in the rotation. Treat the preset's measure/dim list as a typed reference into `/meta`. Add a fast sanity script (`scripts/check-metric-drift.ts` already exists for this) and run it on preset edits.

### Cube `/load` rejects unknown query fields
- **Rule:** internal-only hints (renderer flags, compare modes, viz prefs) must be stripped before the query reaches Cube. Treat the persisted query JSON as a superset; the over-the-wire shape is a subset.
- **Why:** the dashboard starter pack stored `"compare":"prev"` on each KPI tile for a deferred compare-prev render. The tile-refresh cron passed the raw JSON to `/load`, which 400'd with `"compare" is not allowed`. Every tile cached broken.
- **Signal:** `Invalid query format: "<field>" is not allowed`. The field is one your renderer added, not a Cube concept.
- **Apply:** maintain an `INTERNAL_QUERY_FIELDS` allowlist next to the refresh job; `delete` those keys before `loadWithContinueWait`. Mirror the same strip on any other code path that ships persisted tile/segment queries to Cube.

---

## Server cache contract

### Empty-placeholder rows must not be served as `200 OK`
- **Rule:** a cache row whose payload has not been populated yet (status `refreshing`, empty `{}` payload) must return `202 warming`, not `200`. `200` is reserved for rows that have ever been written by a real refresh.
- **Why:** `ensurePlaceholder()` inserts a row with `payload_json: '{}'` + `status: 'refreshing'` on cache miss so the cron can pick it up. The route returned `200 + toView(cached)`, the FE's `isCached()` checked only `status === 'fresh' | 'refreshing'`, and `payload.tiles.map(...)` threw silently — the LiveOps strip rendered nothing.
- **Signal:** FE component renders empty (no skeletons, no errors) on a freshly-evicted/cold cache. Console has `console.warn('[useX] cache read failed: payload.tiles is undefined')` or similar swallowed throw.
- **Apply:** add a sentinel — empty `payload_hash` is unambiguous since a real upsert hashes the JSON — and branch on it in the route to send `202 warming`. Defensively, the FE should also guard `Array.isArray(payload.<list>)` before mapping; missing list ≠ "renderable cached row".

### Never cache empty/zero-row data-fetch responses
- **Rule:** when caching the result of a remote data query (Cube `/load`, Trino, anomaly probe, etc.), skip the cache write when `rows.length === 0`. Cache only confirmed-good payloads. Failures and empties are almost always transient and must not be glued in for the cache's TTL window.
- **Why:** chat-service `preview_cube_query` hit Cube during a ~60s blip where every cube returned `{rows: []}`. `load-cache-adapter` cached the empty arrays for 10 min (the default TTL), keyed by `(query, gameId, metaHash)`. The agent's chart emission requires `data.min(1)` (Zod schema in `chart-spec.ts`), so the empty payload caused `emit_query_artifact({ chart })` to fail with `code: too_small`. The model dropped `chart`, retried, and persisted a chartless artifact to `response_cache`. From then on, the question replayed verbatim with no chart even though Cube was back to returning real rows seconds later. Same bug existed in `refresh-cached-artifacts.ts:58`.
- **Signal:** a data card / chart that "used to work" stops working after a brief upstream blip, and stays broken for ~exactly the cache TTL even though hitting the upstream directly returns data. Cache row payload is `{"rows":[]}` / `{"data":[]}` / equivalent empty shape. Downstream consumers fail schema validation (`min: 1`) or render an empty state on a query that should be populated.
- **Apply:** guard every `putCachedX(...)` call with `rows.length > 0` (or the kind-specific "is non-empty" predicate). Apply equally to: live preview reads, scheduled refreshers, any meta/probe call whose empty result might be transient. If an empty result is *legitimately* cacheable (rare — e.g. confirmed "no players in cohort"), cache it under a separate kind/key with a much shorter TTL and an explicit `emptyOk: true` flag, not the same row as non-empty results.

---

## Test infrastructure

### ESM imports hoist above top-level `process.env =`
- **Rule:** never rely on top-level `process.env.X = value; import …` to override env *for* the import. ES module imports are hoisted; the assignment runs *after* the module has already read its top-level constants.
- **Why:** `dashboard-starter-pack-seeder.test.ts` (and similar) set `process.env.DB_PATH = "<tmp>/test.db"` at the top, then imported `getDb`. The `const DB_PATH = process.env.DB_PATH ?? "data/segments.db"` in `sqlite.ts` had already evaluated — captured the dev DB path. The test's `DELETE FROM dashboards` then wiped the dev DB. We only noticed because daily-health vanished mid-session.
- **Signal:** an env override "isn't taking effect" only when the module was already imported earlier; the dev DB / cache / file mysteriously loses rows after running tests; module re-imports cached at a different path than the test set.
- **Apply:** (1) move env-reads to lazy resolution at first use, not module top level (`getDb()` does this now via `resolveDbPath()`); (2) use `vi.hoisted(() => { process.env.X = …; })` if you must set env before import; (3) add a regression test that asserts the lazy contract.

---

## Frontend data extraction

### Heuristic column pickers must filter by type, not position
- **Rule:** when extracting "the value" from a Cube result row, never pick by `Object.keys()[0]` — Cube always emits the granularity-suffixed time dim first. Filter by what the value should be (numeric for measures, ISO string for dates), not by ordinal.
- **Why:** dashboard `extractKpiValue` accepted "any non-empty string" as the value column. For a `{ "active_daily.log_date.day": "2026-05-11…", "active_daily.dau": "24230", "active_daily.log_date": "2026-05-11…" }` row it returned the date string, rendering `DAU: 2026-05-11T00:00:00.000` instead of `24,230`.
- **Signal:** KPI / single-value tiles show ISO date strings, granularity-bucket keys, or any string that the user clearly didn't intend.
- **Apply:** prefer `typeof v === 'number'` then numeric-parseable strings (`!Number.isNaN(Number(v))`); use the *latest* row, not the first; lock the contract with a unit test that includes time-dim columns in the fixture.

### Cross-source series (ratios) must align by date key, not array index
- **Rule:** when combining two timeseries that come from **different cubes/queries** (e.g. a ratio `numerator/denominator`), pair them on the matching **date**, not by zipping positions. Carry the date alongside the value; never reduce to a bare `number[]` and `num[i]/den[i]`.
- **Why:** `anomaly-detector.divideSeries` sorted each series by day, dropped the dates, then divided by index. It only worked while both cubes returned the same contiguous date set. The business-metrics `paying_rate` (`recharge.paying_users / active_daily.dau`) draws from two cubes with **different freshness** — `recharge` had data to 05-25, `active_daily.dau` only to 05-18. An interior gap or different start in either series silently pairs the wrong days (`paying_users[05-20] / dau[05-19]`) and corrupts every later point; index-truncation also evaluated the *oldest* overlapping days and mislabeled the latest. The sibling LiveOps handler did it right with a date-keyed map.
- **Signal:** a ratio/derived metric looks plausible in steady state but goes wrong after a pipeline lag, a missing day, or when the two sources' date ranges diverge; the "latest day" in an alert isn't actually the newest available date.
- **Apply:** keep `{ date, value }[]` (`rowsToDatedSeries`), build a `Map<date, value>` for the denominator, and divide only on matching dates (`divideByDate`), skipping unmatched/zero days. Cover an interior-gap fixture in tests — the happy path hides the bug because contiguous same-start series align by index too.

---

## Chat session lifecycle

### Per-mount latches on URL-replace effects break back-to-back chat cycles
- **Rule:** URL-sync effects driven by streaming state must re-fire each chat cycle. A `useRef(false)` latch that flips to true on first replace and never resets will skip every subsequent cycle in the same mount.
- **Why:** the `/chat → /chat/:id` history.replace effect was gated by a per-mount `replacedRef`. After the first new chat in a mount, it locked at `true`; the second new chat created a fresh session server-side but the URL stayed at `/chat`. The `useChatStream` post-done guard (added to stop the prior chat's terminal-state entry leaking into the next submit) then stripped the entry from the null-pinned page after `done`, so the assistant reply was never committed to `committedMessages`. Users reported "new chat got merged into the previous one" — the merge was actually a vanished reply.
- **Signal:** "New chat" works the first time but not the second; URL fails to update from `/chat` to `/chat/:id`; assistant reply visible while streaming then disappears on `done`; committed history loses the just-streamed turn.
- **Apply:** prefer derived guards (`streamSessionId === id`) over once-per-mount latches. If you genuinely need a latch, reset it on the lifecycle event that opens a new cycle (e.g. `id === undefined`). Cover the second cycle in tests — most "new chat" regressions only show on the second run because the first one masks them.

### A new chat-service route is dead until the main server proxies it
- **Rule:** every `/api/chat/*` route the FE calls is served by the main server (`server/src/routes/chat.ts`), which forwards to chat-service via *explicit per-route handlers* — not a catch-all. Adding a route in chat-service is only half the job; add the matching proxy handler (same method + path, forward `X-Owner-Id`, build the upstream URL) or the FE never reaches it.
- **Why:** Phase-03 added `GET/DELETE /api/chat/sessions/:id/focus` to chat-service, but no proxy rule was added on the main server. The FE hits `/api` → vite proxy → main server :3004 → 404 (route unknown). The focus client swallows non-OK as `null` by design, so the header chip silently hid — looked like the feature was unwired or the flag was off, when both backend and flag were fine. Cost an hour chasing the wrong layer.
- **Signal:** a new chat feature does nothing in the UI but `curl` straight to chat-service :3005 returns correct data; the same path through :3004 returns `{"error":"Not Found"}`. Any FE client that defensively returns `null`/`[]` on error will mask this as "empty," not "broken."
- **Apply:** when adding a chat-service route, grep `server/src/routes/chat.ts` and add the twin proxy handler in the same change. Test through :3004 (or the vite proxy), not just :3005 — a green direct hit proves nothing about what the browser sees. Watch the upstream path prefix: most session routes proxy to `/sessions/:id` (no prefix) but focus registers with the full `/api/chat/...` path, so the forward URL must match what chat-service actually registered. Bodyless POSTs (e.g. turn-cancel) must NOT forward `Content-Type: application/json` with no body — the upstream's body parser returns `FST_ERR_CTP_EMPTY_JSON_BODY` 400; only set the content-type header when a body is actually sent. This bit Phase 04's cancel button the same way Phase 03's focus chip got bitten.

---

## UI / design

### Don't introduce experimental visual directions on existing surfaces
- **Rule:** new pages, redesigned pages, and feature additions must read in the existing design language (`var(--font-sans)`, the established header pattern, semantic tokens). Editorial / display / experimental directions need explicit buy-in *and* their own contained route — they don't ride along with a feature ship.
- **Why:** the Liveops Phase-1 polish shipped a serif/editorial direction (Georgia, 34px display H1, deck-style eyebrow) into an Inter sans-serif app. Visually a different product on `/liveops` vs every other route, and the user flagged it as "spacing odd, font not matching" the first time they opened it.
- **Signal:** new surface uses fonts, padding, header shape, or radii that don't match the closest existing well-formed page. Hard-coded hex colors instead of `--text-*` / `--border-*` / `--*-soft / -ink` tokens.
- **Apply:** before shipping any UI work read `docs/design-guidelines.md` and copy the page header recipe verbatim. If a direction genuinely warrants forking, isolate the fork to one route and ship it behind a "this is intentional" comment + design-review handshake — don't introduce drift through the back door of a feature PR.

---

## Agent query construction

### Strip views from `/meta` before the agent (or any cube-only surface) sees it
- **Rule:** the schema the chat agent builds queries from must be filtered to cubes only — drop every `type: 'view'` entry. Do it once at the `/meta` fetch boundary so every consumer (tool schema exposure, member-name validation, capability detection) is cube-only by construction.
- **Why:** Cube's `/meta` returns cubes *and* views in the same `cubes[]` array (views tagged `type: 'view'`). `cube-meta-cache.getMeta` cached the raw payload, so `get_cube_meta` handed the agent view members like `revenue_metrics.*`. The agent emitted view-based artifacts; a view is a self-contained namespace that can't join to anything, so opening that artifact in the query builder left every cube greyed out — the user couldn't add a cross-cube dimension (platform, install cohort). The query was correct but a dead end.
- **Signal:** an agent-generated query / "open in builder" link uses a view member (a name that maps to a `views/*.yml` entry, not a `cubes/*.yml` cube); in the builder the whole cube list is disabled and the query can't be extended. Or: you intend "cubes only" but the agent still references a known view name.
- **Apply:** filter `meta.cubes` to `c.type !== 'view'` at the single fetch/caching chokepoint (`cube-meta-cache.ts#getMeta`), keeping untyped entries (older cubes lack `type`). Strip at the source, not per-tool — per-tool filtering leaks the day someone adds a new meta consumer. Note the runtime tail: already-cached view artifacts in `response_cache` replay verbatim, and the meta cache has a TTL — the fix only governs *new* fetches/answers, so clear stale caches or wait out the TTL when verifying.

### "A vs B" questions need a chart shape that shows both metrics
- **Rule:** when a question correlates two metrics across entities ("ARPU vs paying-rate per country"), the chart must plot **both** metrics — scatter (x = metric A, y = metric B, one point per entity). Charting a single metric as a bar silently drops the comparison the user asked for. The chart-type guidance the agent reads must name this shape explicitly; a generic "2 numeric metrics → scatter" row gets out-competed by the dominant "1 categorical + 1 metric → bar" pattern.
- **Why:** for "ARPU vs paying-rate per country" the agent fetched `arpu_vnd`, `paying_users`, `user_count` per country but emitted a `horizontal-bar` of `arpu_vnd` alone — the paying-rate axis vanished. The chart-section menu then offered no scatter toggle (scatter is data-shape-isolated: it needs two numeric axes, which a category×value bar can't supply), so the user had no recovery path. Root cause was guidance, not code: the explore skill's shape table didn't map "1 entity dim + 2 metrics".
- **Signal:** a "X vs Y" / "compare A and B" / correlation question renders a single-metric bar or line; the second metric appears only in the prose summary; the chart menu has no way to reach scatter.
- **Apply:** (1) in the chart-shape guidance (`explore/SKILL.md`, `emit-chart.ts` description) add an explicit row for "1 entity dim + 2 metrics → scatter" with the encoding recipe (`category` = x metric, `value` = y metric, keep the entity label column per row); (2) flag the "A vs B per <entity>" phrasing as a correlation, not a single-metric bar; (3) for derived ratios with no native measure, compute per-row and `emit_chart`; (4) make the scatter renderer label each point with the leftover (non-axis) column and detect x/y units independently — two metrics often differ (VND vs %). Don't expect the menu to "convert" a bar into scatter; the fix is emitting scatter up front.

---

## How to extend this doc

- One lesson per **failure mode**, not per bug. If two bugs share the same root cause, fold the second into the first.
- Keep the four sections (`Rule / Why / Signal / Apply`). If you can't write a `Signal`, the lesson isn't general enough yet.
- Cite the bug once in `Why`; don't link plan files (they get renumbered or archived).
- Delete entries that no longer apply (the underlying surface is gone, the framework moved on). Stale lessons are worse than no lessons.
