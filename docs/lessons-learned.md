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

---

## Chat session lifecycle

### Per-mount latches on URL-replace effects break back-to-back chat cycles
- **Rule:** URL-sync effects driven by streaming state must re-fire each chat cycle. A `useRef(false)` latch that flips to true on first replace and never resets will skip every subsequent cycle in the same mount.
- **Why:** the `/chat → /chat/:id` history.replace effect was gated by a per-mount `replacedRef`. After the first new chat in a mount, it locked at `true`; the second new chat created a fresh session server-side but the URL stayed at `/chat`. The `useChatStream` post-done guard (added to stop the prior chat's terminal-state entry leaking into the next submit) then stripped the entry from the null-pinned page after `done`, so the assistant reply was never committed to `committedMessages`. Users reported "new chat got merged into the previous one" — the merge was actually a vanished reply.
- **Signal:** "New chat" works the first time but not the second; URL fails to update from `/chat` to `/chat/:id`; assistant reply visible while streaming then disappears on `done`; committed history loses the just-streamed turn.
- **Apply:** prefer derived guards (`streamSessionId === id`) over once-per-mount latches. If you genuinely need a latch, reset it on the lifecycle event that opens a new cycle (e.g. `id === undefined`). Cover the second cycle in tests — most "new chat" regressions only show on the second run because the first one masks them.

---

## UI / design

### Don't introduce experimental visual directions on existing surfaces
- **Rule:** new pages, redesigned pages, and feature additions must read in the existing design language (`var(--font-sans)`, the established header pattern, semantic tokens). Editorial / display / experimental directions need explicit buy-in *and* their own contained route — they don't ride along with a feature ship.
- **Why:** the Liveops Phase-1 polish shipped a serif/editorial direction (Georgia, 34px display H1, deck-style eyebrow) into an Inter sans-serif app. Visually a different product on `/liveops` vs every other route, and the user flagged it as "spacing odd, font not matching" the first time they opened it.
- **Signal:** new surface uses fonts, padding, header shape, or radii that don't match the closest existing well-formed page. Hard-coded hex colors instead of `--text-*` / `--border-*` / `--*-soft / -ink` tokens.
- **Apply:** before shipping any UI work read `docs/design-guidelines.md` and copy the page header recipe verbatim. If a direction genuinely warrants forking, isolate the fork to one route and ship it behind a "this is intentional" comment + design-review handshake — don't introduce drift through the back door of a feature PR.

---

## How to extend this doc

- One lesson per **failure mode**, not per bug. If two bugs share the same root cause, fold the second into the first.
- Keep the four sections (`Rule / Why / Signal / Apply`). If you can't write a `Signal`, the lesson isn't general enough yet.
- Cite the bug once in `Why`; don't link plan files (they get renumbered or archived).
- Delete entries that no longer apply (the underlying surface is gone, the framework moved on). Stale lessons are worse than no lessons.
