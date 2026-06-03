# Red-Team Plan Review — Failure-Mode Analyst

Plan: `260603-1439-workspace-isolation-and-sysadmin-hub`. Lens: Murphy's Law (data loss, migration holes, cascade, deploy order). Verification: Flow Tracer — each finding traced through real code with file:line. No praise. Severity: Critical | High | Medium.

---

## FINDING 1 — Backfill premise is FALSE; NULL→shared exposes segments the system marks personal-by-default. [CRITICAL]

**Phase/section:** Phase 2 §Key Insight line 17 ("create accepts it"), §Architecture line 33 (backfill `UPDATE segments SET visibility='shared' WHERE visibility IS NULL`), plan.md §53 Q3.

**The plan's claim:** "create accepts [visibility]" and "Existing rows were created under shared semantics → backfill NULL → shared."

**Traced reality — the claim is false at both hops:**
- `server/src/routes/segments.ts:25-36` — `segmentInputSchema` has NO `visibility` field. Create cannot accept it.
- `server/src/routes/segments.ts:215-237` — the POST INSERT column list omits `visibility` entirely. Every segment ever created — before AND after migration 028, today and tomorrow — is written with `visibility = NULL`.
- `server/src/routes/segments.ts:113` + `server/src/services/trust-mapping.ts:43` — `NULL → SEGMENT_DEFAULT_VISIBILITY = 'personal'`. The system has ONE documented meaning for NULL: **personal / owner-private** (migration 028 header lines 4-9 spell this out: "personal (default/NULL) — only the owner sees it").

**Failure scenario:** Phase 2 backfills ALL NULL rows to `shared`. Since NULL is the ONLY state any segment has ever had, the migration flips **100% of segments org-wide from owner-private to workspace-shared in one statement.** This is a data-exposure migration, not a compatibility shim. Any segment a user created expecting the documented "personal (default)" semantics — cohorts that may carry uid_lists of real players (`uid_list_json`) — becomes visible and mutable to every other workspace member the instant Phase 2 ships.

The plan's own framing inverts the risk: it treats NULL→personal-on-enforce as "the vanish trap" and backfills to avoid teammates losing visibility. But the codebase never had per-segment isolation on LIST (`segments.ts:137` `WHERE 1=1` + workspace), so "teammates lose visibility" only describes the *workspace-shared list UI habit*, NOT an owner intent. The backfill resolves a UX-continuity worry by overriding the system's documented privacy default. **This is data-leak-via-migration.**

**Required before this ships:** decide explicitly (user-level, not auditor-level — this is a privacy/governance call): is the workspace-shared list the intended contract (then `personal` enforcement on LIST is itself the behavior change, and backfill→shared merely preserves status quo), OR is migration-028's "NULL=personal" the contract (then backfill→shared is a privacy regression)? The plan asserts the former as fact without reconciling migration 028 + trust-mapping.ts:43 which assert the latter. They contradict. Do not ship a blanket UPDATE until this contradiction is resolved in writing.

---

## FINDING 2 — Phase 2 silently breaks an EXISTING passing test that encodes the opposite contract. [CRITICAL]

**Phase/section:** Phase 2 §Requirements line 25 (personal mutation = owner/admin-only), §Success Criteria line 64 ("Chat/dashboard isolation unchanged; full suite green").

**Traced reality:** `server/test/segment-multi-user-scoping.test.ts` already exists and asserts the CURRENT contract verbatim:
- Lines 89-103, test `lets a different owner in the same workspace delete a shared segment`: bob@co DELETEs alice@co's segment, expects `204`. The segment was created with no visibility → NULL → personal.
- Lines 1-10 docstring: "Segments are a SHARED, workspace-scoped artifact… `owner` records provenance, not a private-visibility boundary."

**Failure scenario:** Phase 2 adds `canMutateSegment` (owner-or-admin for personal). After backfill, that test's segment is `shared`, so the delete still passes — UNLESS the backfill ordering or a newly-created (NULL=personal) segment is exercised. More importantly the test's *stated contract* ("owner is not a privacy boundary") is now FALSE, and any new test/segment created without visibility (the only code path that exists) is `personal` → bob's delete becomes `403`. Phase 2 §51 says "update baseline expectations from Phase 1" but **only references the Phase-1 golden suite it is authoring** — it never mentions this pre-existing test. "Full suite green" (line 64) is therefore unverifiable as written; the suite contains a test that asserts the inverse of Phase 2's contract. The plan has not traced its own blast radius.

**Required:** Phase 2 must explicitly enumerate `segment-multi-user-scoping.test.ts` (and `owner-header.test.ts`) as tests it will rewrite, and state the new expected contract for each. Otherwise Phase 2 lands red or someone "fixes" the test without understanding it encodes a deliberate prior decision.

---

## FINDING 3 — Phase 1 regression lock is a no-op: it characterizes the exact behavior Phase 2 immediately flips. [HIGH]

**Phase/section:** Phase 1 §TDD line 42 ("segments LIST currently returns ALL workspace segments… lock the current shared behavior so Phase 2 changes are intentional"); Phase 2 §TDD line 43 ("these flip from 'lists all' to 'lists own + shared/org'").

**Traced reality:** Phase 1 writes a golden test asserting "LIST returns all workspace segments." Phase 2 rewrites that same assertion to "LIST returns own + shared/org." The golden test is authored and inverted within the same plan, by the same author, with no independent observer in between.

**Failure scenario:** A regression lock has value only if it catches an *unintended* change. Here the change is intended and made by the same hand that wrote the lock — so the lock catches nothing it doesn't already expect. The genuinely dangerous regressions (does Phase 3's telemetry emit inside the segment write txn perturb LIST? does the `principal` rewrite in `authenticate.ts` change `req.owner` for the dev path tested in `owner-header.test.ts:38-83`?) are NOT what the golden suite asserts. The lock is theater for the one behavior that is being deliberately changed, and silent on the behaviors that are supposed to stay fixed. There is also a window: between Phase 1 landing (lock = "lists all") and Phase 2 landing (lock = "lists own"), if the suite is the gate, the gate asserts the OLD behavior — so a Phase-2-partial deploy that enforces LIST filtering would be RED against the Phase-1 lock, or the lock is edited first making it meaningless during the gap.

**Required:** the regression lock should pin the behaviors that must NOT change (chat `owner_id` isolation, dashboard owner-scoping, dev-mode `req.owner='dev'`, authz default-deny 403) and treat the segment-LIST assertion as a *fixture to be replaced*, not a "lock." State which assertions are immutable invariants vs. which are intended-to-flip.

---

## FINDING 4 — Migration runner is count-based; the plan's `0XX-` naming invites a `user_version` desync that silently skips the backfill in prod. [CRITICAL]

**Phase/section:** Phase 2 §Architecture line 33 + Related Files line 38: `0XX-backfill-segment-visibility.sql`. Phase 3 line 30: `0XX-activity-events.sql`. Phase 4: prune job.

**Traced reality — `server/src/db/sqlite.ts:52-68`:**
```
const currentVersion = db.pragma('user_version');     // a COUNT
const pending = files.slice(currentVersion);          // slice by count, sorted by filename
db.pragma(`user_version = ${files.length}`);          // set to new count
```
Migrations are tracked by **count only**, applied as `files.slice(currentVersion)` over a filename sort. There is no per-file ledger, no checksum, no name match. Current highest file is `028-segments-visibility.sql` → on a deployed prod DB `user_version = 28`.

**Failure scenario A (parallel-phase filename collision):** The plan ships Phase 2 (backfill) and Phase 3 (activity-events) on parallel tracks (plan.md §39), both as `0XX-`. If they are numbered independently and BOTH land as `029-…`, the filename sort is non-deterministic / one shadows the other; `files.length` only counts files present, so whichever set of files is in the build dir at first `getDb()` defines the version. A prod box that already ran `029-backfill` then receives a build where `029` is now `029-activity-events` (backfill renumbered to `030`): `user_version=29` ≥ index of the renamed file → **the backfill (now `030`) runs again OR is skipped depending on count**, and the activity-events migration that prod thinks it ran (old 029) is a different file. Count-based tracking cannot detect that file 029's *content* changed.

**Failure scenario B (out-of-order insert):** If any hotfix migration is inserted with a lower number than an already-applied higher one (e.g. a `028b` or a backfilled gap), `slice(currentVersion)` skips it forever — `user_version` already exceeds its index. The backfill UPDATE never runs in prod, while Phase 2's LIST-enforcement DOES run (it's app code, not migration-gated). Result: enforcement live, rows still NULL=personal → **every pre-existing segment vanishes from teammates' lists** — the exact "vanish trap" Phase 2 §67 claims to mitigate, reintroduced through the migration runner the plan never inspected.

**Required:** (1) the two parallel tracks MUST coordinate a single monotonic numbering authority before either writes a migration file; (2) the backfill's safety must NOT depend on the migration having run — Phase 2's LIST enforcement and the backfill must ship atomically or the enforcement must treat NULL as shared in the SQL predicate itself (`COALESCE(visibility,'shared')`) so a skipped/desynced migration cannot strand rows. Note the predicate in Phase 2 §60 is `visibility IN ('shared','org') OR owner=sub` — with NULL rows and a skipped backfill, NULL is in neither set → invisible to non-owners. This is the failure path.

---

## FINDING 5 — Deploy ordering: Phase 2 enforcement is app code, backfill is a migration; nothing couples them → hide-data window. [CRITICAL]

**Phase/section:** Plan §32-39 (incremental prod rollout), Phase 2 §50-57 implementation steps (step 2 migration, step 3 predicate — separate steps).

**Traced reality:** LIST enforcement lives in `segments.ts` route code (deployed with the app bundle). Backfill lives in a `.sql` file applied by `runMigrations` at first `getDb()` (`sqlite.ts:44`). These have independent failure modes: the app can boot and serve requests; if the migration throws mid-`db.exec` (`sqlite.ts:64`, no per-statement txn wrapper shown), `runMigrations` propagates and— but `getDb()` is lazy, so the FIRST request triggers migration; if that request's migration fails, the process may have already bound the port. There is no guarantee the backfill UPDATE commits before the enforcing LIST query serves its first response.

**Failure scenario:** Rollout deploys the new app build. Backfill is one statement in a multi-statement migration file shared with activity-events DDL (if co-numbered). If any earlier statement in that `db.exec(sql)` blob errors (e.g. activity-events table already partially created from a retried deploy), the WHOLE `exec` aborts — including the backfill UPDATE — yet the app process continues, LIST enforcement active, NULL rows now invisible to non-owners. **Enforcement-without-backfill = silent data hiding.** The plan's mitigation (§67 "backfill→shared first") assumes ordered, atomic, all-or-nothing application that the runner does not provide (`db.exec` runs the whole file; a later migration failing leaves `user_version` un-incremented and the file replays whole next boot — see Finding 4).

**Required:** backfill must be in its OWN migration file, isolated from any DDL, idempotent (`WHERE visibility IS NULL` is — good), and the LIST predicate must defensively `COALESCE(visibility,'shared')` so correctness does not depend on migration/app deploy ordering. State the rollback story: if Phase 2 is reverted (app code rolled back) AFTER backfill ran, rows are now `shared` permanently (forward-only runner, no down-migration per 028:11) — a revert does NOT restore prior NULL/personal state. Document that the backfill is irreversible.

---

## FINDING 6 — Phase 3 "fire-and-forget swallow errors" hides full-disk / corrupt-DB and can deadlock SQLite under load. [HIGH]

**Phase/section:** Phase 3 §Requirements line 21 ("fire-and-forget… swallow errors, log at debug"), §Architecture line 24, §Risk line 57.

**Traced reality:** The plan models `recordActivity` on `business_metric_audit`. But `server/src/db/business-metric-audit-store.ts:72` `insertAuditRow` **does NOT swallow** — it runs the INSERT and throws on failure; the swallow lives in the *caller* (docstring lines 4-9). Phase 3 instead wants the swallow inside the helper at debug-log level. SQLite is in-process synchronous (`better-sqlite3`, WAL — `sqlite.ts:41`).

**Failure scenarios:**
1. **Full disk / `SQLITE_FULL` / `SQLITE_IOERR`:** swallowed at debug level means the FIRST symptom of a disk-full condition is *silently dropped telemetry*, not an alert. Meanwhile the user's OWN writes (segment create at `segments.ts:215`, which emits `segment_create`) are in the same DB — if the disk is full the real write fails loudly while telemetry fails silently, giving contradictory signals to oncall. Debug-level logging on a swallowed DB error is the documented anti-pattern for masking storage exhaustion.
2. **Ordering / lost events under load:** "fire-and-forget" implies the insert is detached from the request (`void` / not awaited). With synchronous better-sqlite3 there is no async queue — but if the plan makes it truly fire-and-forget via `setImmediate`/promise, WAL writers serialize and a burst of query-run events contends with the request's own segment/dashboard writes on the single writer lock. Either it's synchronous (then it DOES add latency to the hot path — contradicting line 21 "must not measurably slow") or it's deferred (then events can be lost on process exit / crash, and `actor_sub`/`ts` ordering is not guaranteed relative to the triggering write).
3. **Transaction interaction:** if `recordActivity` is called inside a route that wraps its write in a transaction, a swallowed-but-thrown insert inside an open txn can leave the txn in an aborted state (SQLite: an error inside a transaction requires ROLLBACK). Swallowing the error without rolling back can poison the request's own subsequent statements. The plan does not specify whether emit happens inside or outside the caller's transaction. `segments.ts` POST is NOT wrapped in an explicit txn today, so emitting there is safe — but the plan also wants query-run and feature-open emits whose txn context is unspecified.

**Required:** specify (a) emit is OUTSIDE any caller transaction, (b) DB-level errors (`SQLITE_FULL`, `SQLITE_IOERR`, `SQLITE_CORRUPT`) are logged at WARN+ and surfaced to a health metric, NOT debug-swallowed — only the "telemetry is non-essential" errors are swallowed; storage-integrity errors are operational signals, (c) whether emit is sync (accept latency) or deferred (accept loss) — pick one and state the trade-off.

---

## FINDING 7 — Phase 4 chat `/internal/stats` fan-out: no timeout value, cascade on slow chat-service, and 90d prune races concurrent reads. [HIGH]

**Phase/section:** Phase 4 §Non-functional line 23 ("timeout + graceful degradation"), §Architecture line 27 (bulk call), §Requirements line 22 (prune), Phase 3 line 20 (`/internal/stats`).

**Traced reality:**
- The auth pattern Phase 3 mirrors is `internal-access.ts`. Note `internal-access.ts:29` — when `AUTH_DISABLED`, the secret gate is SKIPPED and returns admin. The new `/internal/stats` "mirrors auth + fail-closed posture" (Phase 3 line 27) but the mirrored route is fail-OPEN under AUTH_DISABLED. In a prod-mirror dev stack (the new `docker-compose.devcube.yml` in git status), `/internal/stats` would expose per-user chat counts with no secret. Verify the dev posture is intended for a stats endpoint that aggregates cross-user activity.
- The deployment is **single-instance** (`cron-runner.ts:7` "Single-instance assumption… v1.5 will add advisory locks for multi-instance"). The prune job (Phase 4) and the admin aggregation reads run in the same process.

**Failure scenarios:**
1. **Cascade / no timeout number:** Phase 4 says "timeout + graceful degradation" but specifies NO timeout value and NO total-deadline for the bulk fan-out. If chat-service is slow (GC pause, its own DB lock), the admin `/summary` request blocks on the bulk `/internal/stats` call. Fastify default has no outbound HTTP timeout unless set. One slow chat-service request holds an admin request thread; a few admins refreshing the Observability tab during a chat-service stall pile up. "Graceful degradation to null" only triggers on *error*, not on *slow* — a 30s hang is not an error, it's 30s of held latency. The plan must specify the per-call timeout (e.g. 2s) AND that timeout→null degradation, not just error→null.
2. **Prune vs read race:** `pruneRefreshLog` (the pattern Phase 4 copies, `refresh-log-retention.ts:35`) is a synchronous `DELETE … WHERE ts < cutoff`. The Phase-4 prune deletes `activity_events older than 90d` in the SAME process that serves `/summary` aggregations. Under WAL a long DELETE and a concurrent COUNT/GROUP-BY aggregation over `activity_events` contend; with `(actor_email,ts)` + `(event_type,ts)` indexes a 90d-boundary delete on a high-volume table is a large index churn. Not corruption, but the aggregation can see a partially-pruned window → `active-last-30d` counts that flicker. More concrete: if a query-run burst is mid-insert when prune runs, no row loss (append-only), but the admin summary's "total events" is non-deterministic across the prune tick. Low-stakes but the plan claims "no silent truncation / logs pruned count" as if prune is observable — it is for count, not for its effect on concurrent reads.

**Required:** (1) state the explicit per-call and total fan-out timeout and that timeout→null (not only error→null); (2) confirm `/internal/stats` secret-gate posture under AUTH_DISABLED is acceptable for cross-user data; (3) note the prune runs in-process single-instance and that aggregation reads during a prune tick may be momentarily inconsistent (acceptable, but state it).

---

## FINDING 8 — Phase 7 CSV audit-log export over `activity_events` can exfiltrate user-authored query shapes / uid context to anyone who reaches the admin tab. [MEDIUM]

**Phase/section:** Phase 7 §Requirements line 19 (audit-log viewer, export CSV, "over existing `access_audit` (+ optionally `activity_events`)"); Phase 3 line 26 (`detail_json` carries query shape).

**Traced reality:** `activity_events.detail_json` stores query shape (cubes/measures/dimensions) per Phase 3 line 26. Segments carry `uid_list_json` (real player IDs) per `segments.ts:230`. Phase 7 adds a CSV export over `activity_events`. The route is admin-gated (`requireRole('admin')`), but Phase 1's whole premise is that identity keying (sub vs email) "never matched / was null in dev" — i.e. the authz boundary has a known history of mis-keying.

**Failure scenario:** If Phase 1's `principal` reconciliation is imperfect (e.g. a user whose `users` row maps sub→wrong email, or the pre-provisioned-no-row fallback at Phase 1 line 31 returns null and a downstream check treats null email as "match any"), the admin gate could resolve incorrectly for the audit viewer. CSV export is bulk and offline — a single mis-authorized export leaks the entire org's query-shape history at once, with no per-row re-check. The plan documents "no PII beyond user-authored query shape" (Phase 3 line 26) but query shape over player cohorts + the recent-query-shapes feed (Phase 7 line 18) is internal-sensitive, and CSV export removes it from the audited surface entirely.

**Required:** the CSV export must (a) itself emit an `export` activity_event (the enum already has `export` — Phase 3 line 25) so exporting the audit log is itself audited, (b) re-validate admin at export time against `principal` not a cached client claim, (c) confirm `detail_json` never includes `uid_list` contents — only measure/dimension names. State this explicitly; "optionally activity_events" (line 19) is too loose for an export surface.

---

## Severity roll-up
- **Critical (4):** F1 (backfill exposes personal-default segments), F2 (breaks existing test encoding opposite contract), F4 (count-based migration runner desync), F5 (enforcement/backfill deploy-order data-hide).
- **High (3):** F3 (regression lock is a no-op for intended change), F6 (swallowed telemetry hides disk/corrupt + txn poisoning), F7 (chat fan-out timeout/cascade + prune race + AUTH_DISABLED open stats).
- **Medium (1):** F8 (CSV audit export exfiltration surface).

## Cross-cutting verdict
The plan's central safety claim — "backfill NULL→shared preserves existing behavior" — rests on two factually wrong premises (create accepts visibility: FALSE, `segments.ts:25-36`; existing rows had shared semantics: the code default is `personal`, `trust-mapping.ts:43` + `028:4-9`). Combined with a count-based migration runner (`sqlite.ts:57-67`) that cannot detect file-content drift and parallel phases both numbering `0XX-`, the most likely production outcome is: enforcement live, backfill skipped or mis-applied → segments either vanish from teammates OR all flip public, with no rollback path (forward-only). Resolve F1/F4/F5 atomically before any Phase 2 prod deploy.

## Unresolved questions
1. Is the workspace-shared segment LIST (current `WHERE 1=1`) the INTENDED contract, or is migration-028's "NULL=personal" the intended contract? They contradict; the plan assumes the former without reconciling the latter. User decision required.
2. Who owns monotonic migration numbering across the two parallel phase tracks (Phase 2 backfill vs Phase 3 activity-events), both currently `0XX-`?
3. Is `/internal/stats` fail-open under AUTH_DISABLED (mirroring `internal-access.ts:29`) acceptable for an endpoint returning cross-user chat activity in the prod-mirror dev stack?
4. Does `detail_json` for `query_run` ever capture `uid_list` / predicate values, or only measure/dimension names? (Determines F8 severity.)
5. Is emit inside or outside the caller's transaction? (Phase 3 unspecified; determines F6 txn-poisoning risk.)
