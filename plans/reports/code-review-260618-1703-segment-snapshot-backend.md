# Code Review — Per-Segment-Cadence Segment Snapshots (backend)

Date: 2026-06-18 17:55 GMT+7
Scope: uncommitted snapshot-cadence backend (job, writers, reader, route, migrations, cadence service).
Build: clean. New tests: 104 passed (7 files). Full suite: 1946 pass (2 pre-existing unrelated failures ignored).

## Verdict

Design is sound and the cadence/idempotence core is solid and well-tested. **Two Critical SQL-injection holes in the new read API** (unvalidated `ts`, `from`, `to` params interpolated raw into Trino) must be fixed before this auto-deploys to prod. One High correctness-uncertainty (state writer's Cube output-column naming assumption is untested against real Cube). Rest are Medium/Low.

---

## CRITICAL

### C1. SQL injection via `ts` param — `state-distribution` endpoint
`routes/segment-movement.ts:268,285` → `segment-movement-reader.ts:181`.

Route validates `dimension` (allow-list) and checks `ts` **presence only** (`if (!snapshotTs)`), never format. The reader then does:
```ts
const tsLit = `TIMESTAMP '${snapshotTs}'`;   // segment-movement-reader.ts:181
```
`snapshotTs` is raw `q.ts`. A caller hitting a segment they can read (shared/org segments are readable by any workspace member; anonymous principals get viewer role) can supply:
`?dimension=lifecycle_stage&ts=x' UNION SELECT ... --`
breaking out of the literal. The state-distribution SQL also string-interpolates `dimension` (safe — allow-listed) but `ts` is the open door. The other readers' `tsLit` paths (writers) are guarded by `TS_RE`; this read path is the one that isn't.

**Fix:** add a `TS_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/` (and a `:00`-second tolerant variant) check in the route; return 400 on mismatch BEFORE calling the reader. Defence-in-depth: also validate inside `readStateDistribution` and throw (mirrors the writers).

### C2. SQL injection via `from` / `to` params — all four range endpoints
`routes/segment-movement.ts:82-85` (`parseDateRange`) → readers `DATE '${fromDate}'` / `DATE '${toDate}'` at `segment-movement-reader.ts:93-94,132-133,216-217,251-252`.

`parseDateRange` takes `query.from`/`query.to` **verbatim** — only the *default* (when omitted) is well-formed (`new Date().toISOString().slice(0,10)`). A supplied `from`/`to` is interpolated unescaped into every range query (`readKpiTrend`, `readMovementSeries`, `readStateDistributionTrend`, `readCadenceHistory`). Same break-out as C1.
`?from=2026-01-01' OR '1'='1` → injected.

**Fix:** validate `query.from`/`query.to` against `DATE_RE = /^\d{4}-\d{2}-\d{2}$/` in `parseDateRange`; on malformed input return 400 (AC8 requires "bad range → 400"). Do NOT silently fall back to default — that masks a probing attempt. Defence-in-depth: assert `DATE_RE` in each reader.

Both C1+C2 directly violate AC8 ("param validation … bad range → 400") and the stated SQL-injection-safety focus area ("every literal via toSqlLiteral / validated date/ts regex"). The existing unit tests cover the allow-list and clamp but **no test feeds a malicious `ts`/`from`/`to` through the route→reader path**, so this passed CI.

---

## HIGH

### H1. State writer's Cube output-column naming is an unverified assumption
`segment-member-state-writer.ts:266-276,346-354` (`cubeColName = member.replace(/\./g,'__')`).

The state INSERT wraps the compiled mf_users SELECT in `state_src`, then a `state_named` CTE that references columns by the assumed name `"<physicalCube>__<field>"` (e.g. `"mf_users__uid"`). If Cube's `/sql` does not emit exactly that output-column header (different quoting, bare `uid`, `"mf_users.uid"`, or aliased differently), `state_named` fails to resolve every column → the INSERT errors for **every** state row, every tick, silently (writer catches → heartbeat 'error', loop continues). The shipped membership writer deliberately sidesteps this by using positional `m.*` (single column); the state writer can't (multi-column, must skip identity) so it took the named-column path.

The risk: `segment-member-state-writer-sql.test.ts` uses a hand-fabricated `FAKE_STATE_SQL` whose headers are *already* `"mf_users__uid"` — the test asserts the builder echoes the convention it itself assumes (circular). No empirical capture of real Cube `/sql` output column names exists anywhere in the repo (grep confirms the `__` convention is used nowhere else). Cube *does* generally emit `cube__field` aliases, so this is probably correct — but it cannot be verified offline and auto-deploys to prod.

**Fix (one of):**
- Cheapest: before merge, run one real `compileMemberStateSelect` against a live game (cfm_vn) and log the compiled SQL's column headers to confirm the `__` form. Capture that real SQL as the test fixture (replace the fabricated one).
- More robust: instead of guessing header names, have `compileMemberStateSelect` build the projection with **explicit `AS <canonical_key>` aliases inside the Cube-bypassing wrapper** (you already physicalize members; alias them yourself) so the outer CTE references known names rather than reverse-engineering Cube's. This removes the assumption entirely.

### H2. Dead/misleading code block in `compileMemberStateSelect`
`segment-member-state-writer.ts:140-168`.

`colAliases`, `colList`, the `s_inner.* -- placeholder` map, and the long comment block compute values that are **never used** — `finalSql = rawSql` (line 168) discards them; the real aliasing happens later in `writeMemberStateSnapshot`/`buildMemberStateInsertSql`. This is ~28 lines of dead reasoning that will mislead the next maintainer into thinking aliasing happens here. Not a runtime bug, but high-confusion in the single riskiest function (see H1).

**Fix:** delete lines 140-167; keep only `return { sql: rawSql, cols: valueCols }` (valueCols already computed at line 117). `physIdentity` at 140 is also unused here.

---

## MEDIUM

### M1. Non-mf_users segments: state JOIN silently empties
`segment-member-state-writer.ts:108` resolves identity from **`mf_users`**, while the membership writer (`segment-snapshot-writer.ts:121`) resolves from the **segment's own cube**. For a segment defined on a recharge/event cube whose identity isn't the canonical game uid, membership uids won't match `mf_users.uid` → state INSERT lands 0 rows (heartbeat 'written', count 0). KPI writer also skips (`pickPresetForSegment` finds no mf_users preset for that cube → 'skipped'). Graceful degradation, not corruption — but the canonical-state feature is silently unavailable for those segments with no signal to the operator. Worth a heartbeat 'skipped' reason rather than a 0-row 'written'. Confirm with product whether non-mf_users predicate segments are in-scope; if yes this needs explicit handling.

### M2. `state-distribution-trend` redaction early-return is uncached and shape-divergent
`routes/segment-movement.ts:343-350`. The unauthenticated+sensitive branch returns a payload with `points: []` and no `redacted`-vs-`rows` parity vs the single-ts endpoint (which returns `rows: []`). Minor shape drift between the two redaction responses (one uses `points`, one uses `rows`) — fine per-endpoint but inconsistent for a FE consuming both. Also it bypasses the cache entirely (re-derives each call) — negligible cost. Low-ish; flagging for parity.

### M3. Redaction depends on `req.principal?.sub` truthiness — verify anonymous has no sub
`routes/segment-movement.ts:279,337`. `authenticated = !!req.principal?.sub`. Per `auth/principal.ts:106-115`, an anonymous/unauthorized principal is still constructed with a `sub` (and role 'viewer'). If anonymous requests carry a non-empty `sub`, `authenticated` is `true` and **redaction never triggers**. The members-API "tokenless" parity (per project memory) may rely on a different signal. Verify: does a truly unauthenticated request yield `principal.sub === ''/undefined`, or a synthesized sub? If the latter, sensitive LTV/payer-tier distributions leak to anonymous callers. (guardSegment still gates which segments are visible, but shared/org segments are readable by any workspace member including low-trust ones, which is the population redaction is meant to protect against.)

### M4. `parseDateRange` default `from` ignores granularity-specific clamp interaction
`routes/segment-movement.ts:81-85`. `days` is clamped correctly, but when only `from` is supplied (no `to`), `to` defaults to today and `days` is unused — a caller can request an arbitrarily wide explicit `from`..`to` window that **bypasses the MAX_*_DAYS cap** entirely (the cap only governs the `days`-derived default `from`). AC8 says "bounded date range" — explicit `from`/`to` is currently unbounded. Add a span check: reject (400) or clamp when `toDate - fromDate` exceeds the granularity's max-days.

---

## LOW

- **L1.** `segment-movement-reader.ts:194` `void dimLit;` — `dimLit` is computed (`toSqlLiteral(dimension)`) then explicitly discarded with a "documentation completeness" comment. Dead. Remove both the assignment (line 182) and the `void`. The actual safety is the route allow-list; the comment is correct but the unused literal is noise.
- **L2.** `snapshot-segment-membership.ts:384` manual trigger `DELETE FROM segment_snapshot_log WHERE snapshot_date = ?` before a forced run — cosmetic (forced bypasses the guard; log is SQLite heartbeat only, not lakehouse data), so no data-loss. Fine, but the prior care-reset-style "delete before lock" shape is worth a one-line comment that this is heartbeat-only and intentionally pre-run.
- **L3.** `downsample-snapshots.ts:198-210` carry-forward detection only fires when `cadenceChanges.length > 0`. A segment captured purely daily but queried at `1h` (finer than captured, no cadence *change*) won't flag carry-forward buckets. `effectiveGranularity` still correctly reports 'daily', so the UI has the signal — but `carryForwardBuckets` is empty in that no-change case. Confirm the FE keys "render as steps" off `effectiveGranularity` vs `carryForward`; if the latter, finer-than-captured-without-change windows won't step.
- **L4.** `segment-kpi-writer.ts:131-132` comment notes the anchor-cube fallback is skipped (`pickPresetForSegment(logicalSegCube, null)`); a join-inherited identity on a different cube may miss the preset. Acceptable per comment, but means some valid mf_users-joined segments could 'skip' KPIs. Low — verify cfm_vn/jus_vn predicate segments resolve their preset directly.

---

## Verified GOOD (acceptance criteria met)

- **AC1** default 'daily' preserves prior behavior; 15m tick won't re-run daily segment within GMT+7 day — `cadenceElapsed`/`floorToCadenceBucket` correct + thoroughly tested (cadence-guard.test 96-tick loop).
- **AC2** idempotence: every writer DELETEs its (snapshot_ts, game, segment[,uid]) slice before INSERT — verified in all four writers; re-run is a no-op.
- **AC3** per-segment state keying (no cross-segment dedup) — JOIN per (segment, snapshot_ts); DDL partition key includes segment_id.
- **AC4** state projection is predicate-free (dimensions:[identity,...], measures:[]); scope is the membership JOIN — correct (modulo H1 mechanics). Pruned cols stay in lockstep (DDL + writer both iterate `STATE_VALUE_COLUMNS` / pruned list).
- **AC5** KPI reuses `runScopedKpi` (queryForKpi+scopeQuery+loadWithContinueWait, same path as runPresetCards) → value == Insights value; tall shape; NULL value (row present) on empty cohort — correct.
- **AC6** per-segment delta vs `max(snapshot_ts) < current`; first-observation → all 'entered' via FULL OUTER JOIN with empty `p`; cadence-gap-safe — correct.
- **AC7** downsample is pure, last-in-bucket (never sums); coarsest-cadence effective_granularity; cadence_changes from definition lag — correct & well-tested (27 tests).
- **Backward-compat:** `triggerManualSnapshot`→{started,reason?}, `runSegmentMembershipSnapshot`→SnapshotRunSummary, `isSnapshotRunning`, `gmt7Hour`/`isWithinSnapshotWindow`/`gmt7DateString` unchanged. Changed writer signatures (`writeSegmentSnapshot`, `writeSegmentDefinitions`) use **optional** new params — all callers (run-once script, verify-definition script, segment-refresh-ops route) remain valid. Verified via grep.
- **Migrations:** 063 additive `ADD COLUMN … DEFAULT 'daily'`; 064 additive `ADD COLUMN snapshot_ts` + index. DDL `ALTER … ADD COLUMN IF NOT EXISTS snapshot_ts` is additive-only, no destructive change; existing rows tolerate NULL.
- **`toSqlLiteral`/`inlineSqlParams`** quote-aware and injection-safe by construction; writers route game/segment/metric/value through it.
- **Per-writer error isolation:** every writer catches and returns structured result; the job loop continues on per-segment failure (heartbeat 'error').

---

## Unresolved questions

1. **H1** — what are the *actual* output-column headers of Cube `/sql` for the mf_users dimensions-only projection on a live game? (Confirms or breaks the `__` assumption. Single live call settles it.)
2. **M3** — does a truly unauthenticated HTTP request to these routes yield a falsy `principal.sub`, or a synthesized one? (Determines whether sensitive-dimension redaction actually engages, or leaks LTV/payer-tier to anonymous.)
3. **M1** — are non-mf_users-cube predicate segments in scope for canonical state capture? (If yes, the empty-JOIN degradation needs an explicit skip-reason.)
4. **M4** — should explicit `from`/`to` windows be hard-bounded to MAX_*_DAYS, or is the cap intended to govern only the default window?
