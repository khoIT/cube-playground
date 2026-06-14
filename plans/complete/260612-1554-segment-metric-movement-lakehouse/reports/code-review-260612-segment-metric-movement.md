# Code Review — Segment Metric-Movement Lakehouse

Scope: 13 server files (lakehouse writers/readers, 4 routes touched, job, 3 ops scripts), 5 server test suites, 8 FE files + 3 FE test suites, deployment-guide row. Verified: `server/ npx tsc --noEmit` clean; 27/27 server tests pass; 37/37 FE tests pass; root tsc shows zero errors in reviewed files (pre-existing errors from concurrent session ignored per scope constraint).

## Overall

High quality. Injection surface is tight (all dynamic strings via `toSqlLiteral`, dates regex-gated, days `Math.trunc`'d, table/column identifiers only from the hardcoded registry / schema map). Auth correct (guardSegment before cache on both new segment routes; snapshot-runs behind admin `preHandler` hooks in segment-refresh-ops.ts). Never-throws contract on the definition writer is real and tested. No regressions to job flow, ops payload, or monitor-tab composition.

## Major

1. **Entry-lens dead-join warning is structurally unreachable** — `server/src/lakehouse/segment-metric-series-reader.ts:91-100,141-149`. `warnIfDeadJoin` needs points with `memberCount > 0` and all-zero joins, but entry-lens points are built FROM fact rows (INNER `JOIN cohort`): a fully dead join returns zero rows → empty points → `cohortDays = 0` → no warning. The exact failure the registry comment predicts (future jus bare-uid segment) renders as the benign "sparse days are normal" empty state on the causal lens. Acceptance criterion 6 holds for current/stayers only. Fix sketch: after an empty `factRes`, run the cheap `enteredSql` first (or reuse it) — non-zero cohort entries + zero fact rows over ≥5 days = same signature.

2. **Entry lens counts pre-entry activity** — `segment-metric-series-reader.ts:141-149`. Cohort = uids entered in [anchor, anchor+days]; fact join filters only `f.{dateCol} >= anchor`, not per-member `>= first_entry`. A member entering day 20 contributes days 1–19 of mart rows to the series the card labels "causal lens". Also produces days where `joined_members > memberCount` (value before cumulative count catches up). Fix: carry `min(snapshot_date) AS first_entry` in the cohort CTE and add `f.{dateCol} >= c.first_entry` to the join. Needs a product call on intended semantics — flagging, not silently deciding.

## Minor

3. **Plan-artifact references in code comments** (acceptance criterion 9 violation): `segment-metric-registry.ts:4-6` ("Phase-2 mart-eligibility matrix" + full `plans/260612-…/reports/…` path), `segment-metric-series-reader.ts:17` ("Phase-2 matrix"), `verify-segment-definition-snapshot-live.ts:2` ("(plan step)"). Rewrite as self-contained why ("join probe verified per-user-day grain for these (game, mart) pairs").

4. **Trajectory size line interpolates across gap days** — `trajectory-card.tsx:68-77`. On a gap the loop `return`s early but `linePath` keeps appending `L` for the next landed day, so the line traverses the amber gap band — a visual straight-line interpolation. No fabricated dot/value, amber rect present, but criterion 5 says "NEVER interpolated". Break the path into `M…L…` runs per contiguous landed stretch.

5. **`__definitions__` heartbeat invisible to operators** — `segment-snapshot-runs.ts:99-105` skips all `__` sentinels except `__started__`/`__delta__`; a failed nightly definition write surfaces nowhere in the admin payload/UI (only server console). Suggest a `definitionsStatus` field mirroring `deltaStatus`.

6. **Unbounded route caches** — `segment-trajectory.ts:35`, `segment-metric-series.ts:43`. `Map` entries are TTL-bypassed but never evicted; the metric-series key includes the raw anchor (any of ~36k valid dates) × lens × metric × segment, so any authenticated segment-reader can grow process memory indefinitely. Matches the existing TTL-cache pattern, but add lazy eviction or a size cap.

## Nit

7. `isValidAnchor` accepts impossible calendar dates (`2026-13-45`), which then fail in Trino and return 502 `LAKEHOUSE_UNAVAILABLE` instead of 400 `VALIDATION` (`segment-metric-series-reader.ts:62-66`).
8. `metric-movement-card.tsx:110` — eligible-metrics fetch *error* → `setMetrics([])` → card hides silently; indistinguishable from "game not in registry".
9. `metric-movement-card.tsx:197-209` — while a lens switch is in flight the previous lens's series stays rendered under the newly highlighted tab; on a card whose stated purpose is "lenses can't be misread", clear `series` (or dim it) on lens change.
10. Raw Trino error text flows to any segment-reader via 502 `message` and `joinWarning` (host/SQL fragments possible). Acceptable for an internal tool, consistent with existing surfaces — noting only.
11. `Chip` duplicated between `trajectory-card.tsx:43` and `snapshot-runs-section.tsx:73` (slightly different radii) — candidate for a shared atom later.

## Acceptance criteria

| # | Criterion | Verdict |
|---|---|---|
| 1 | definition snapshot: non-aborting, 100KB cap, NULL identity degrade | PASS (writer:60-66,101-147; job:152-153; tests) |
| 2 | trajectory route: series, 404 non-predicate, guardSegment, 502 outage | PASS (route tests incl. failure-not-cached) |
| 3 | 3 lenses + anchor 400 + METRIC_NOT_ELIGIBLE 400 | PASS shape-wise; entry-lens semantics caveat = finding #2 |
| 4 | registry gated cfm_vn/jus_vn; FE hides card | PASS |
| 5 | gaps amber, never interpolated; empty state | PARTIAL — finding #4 (line traverses gap) |
| 6 | dead-join warning ≥5 all-zero cohort days | PARTIAL — unreachable on entry lens (finding #1) |
| 7 | all SQL via toSqlLiteral/validated literals | PASS (every reader/writer audited; identifiers registry-constant) |
| 8 | design tokens only | PASS (all referenced tokens exist in tokens.css; no hex, no new fonts; CardShell reused) |
| 9 | no plan-artifact refs | FAIL in 3 files — finding #3 |
| 10 | no breaking contract changes | PASS (ops payload untouched, new endpoint additive; job membership+delta flow unchanged; monitor-tab additive) |

## Positive

- `inline-sql-params.ts` reuse keeps one escaping hub; injection tests assert actual SQL text.
- Sentinel-prefix tolerance in `listSnapshotRuns` meant `__definitions__` didn't corrupt run counts — good forward design.
- Survivor-bias labeling is enforced at three layers (payload flag, tab blurb, banner).
- Honest deployment-guide row (single-instance constraint + "NOT yet set in prod Vault" state).

## Recommended actions (priority order)

1. Fix entry-lens dead-join detection (finding #1) + add a test for full identity mismatch on entry lens.
2. Decide & fix pre-entry contamination semantics (finding #2) + test fact rows before first entry.
3. Strip plan-artifact comments (finding #3).
4. Break trajectory line at gaps (finding #4); surface `__definitions__` status (finding #5); cache eviction (finding #6).

## Unresolved questions

- Is pre-entry mart activity intentionally included in the entry lens (window activity of eventual entrants) or a defect vs the "causal lens" label? Plan/brainstorm don't pin it down.

---

## Resolution (2026-06-12, post-review)

| # | Finding | Resolution |
|---|---------|-----------|
| Major 1 | Entry-lens dead-join warning unreachable | FIXED — empty-fact detection: non-empty cohort + 0 fact rows + ≥5 elapsed days → joinWarning; FE empty-state now renders joinWarning (red) instead of benign sparse-data copy |
| Major 2 | Entry lens counts pre-entry activity | FIXED per USER DECISION (post-entry only) — cohort CTE carries `min(snapshot_date) AS first_entry`, fact join adds `f.date >= c.first_entry`. Live-verified on cfm_vn (series starts at first entry day; gap-day mart tracking intact; 314→343 entrants) |
| Minor 3 | Plan-artifact refs in comments | FIXED — registry, series-reader, verify script comments rewritten stable |
| Minor 4 | Trajectory line interpolates across gaps | FIXED — pen-up/pen-down path segmentation; line breaks at amber gap bands |
| Minor 5 | `__definitions__` heartbeat invisible | FIXED — SnapshotRun gains definitionsStatus/definitionsRows; admin table gains Definitions column; test asserts surfacing |
| Minor 6 | Unbounded route caches | FIXED — MAX_CACHE_ENTRIES=500 insertion-order eviction on both routes |
| Nit | isValidAnchor accepts 2026-13-45 | FIXED — round-trip date validation → 400 not 502 |
| Nit | Stale series under newly selected lens tab | FIXED — setSeries(null) on param change |
| Nit | eligible-metrics fetch error hides card silently | ACCEPTED — internal tool, indistinguishable-from-unregistered acceptable |
| Nit | Raw Trino error text in 502/joinWarning | ACCEPTED — internal tool |
| Nit | Chip duplicated trajectory-card / snapshot-runs-section | ACCEPTED — two small local variants, premature to extract |

Verification after fixes: server tsc clean; server 31/31 (incl. new definitions-sentinel assertions); FE 37/37; live Trino run of new entry SQL OK. New ops script: `server/src/scripts/verify-entry-lens-post-entry-live.ts`.
