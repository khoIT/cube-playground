# Code Review — VIP-care Phase 1 (pagination) + Phase 2 (sweep-run snapshots)

Scope: server/src/routes/care-cases.ts, care-case-sweep.ts, care-sweep-run-store.ts,
prune-care-sweep-membership.ts, migrations 041–043, index.ts; FE use-care-cases.ts,
case-ledger.tsx, queue-pager.tsx. tsc clean, 19/19 target tests pass.

## HIGH

### H1 — CS Monitor portfolio counts silently truncated to 50 by new default pagination
File: src/pages/Dashboards/cs/use-care-playbooks.ts:240-248
`useCarePlaybooks` fetches `/api/care/cases?game=` with NO page/pageSize. The route now
defaults to pageSize=50, so `casesResp.cases` returns only the first 50 (ORDER BY opened_at
DESC). It then feeds that truncated list into `aggregateCases()` + `buildPortfolio()`, which
compute per-playbook open/treated/slaBreached and portfolio `vipsTriggered`, `openCases`,
`slaBreaches`, `attainmentRate` by counting/Set-ing the array. Any game with >50 open+treated
cases now under-reports every one of these stats on the CS Monitor — a silent correctness
regression on a surface that previously summed the full list. Tests don't catch it (mocked
fetch returns a tiny fixed list).
Fix: this consumer needs the full set, not a page. Either pass `pageSize: 200` (matches the
clamp ceiling) — or, cleaner, add a lightweight server-side aggregate endpoint / a
`countOnly`/`all` mode so the monitor isn't bounded by the queue's page size. Minimal
unblock: `apiFetch(... query:{ game: gameId, pageSize: '200' })`. Note 200 is still a cap;
if a game can exceed 200 open+treated cases the monitor stays wrong — confirm the real max or
move aggregation server-side. (Σ cohort across playbooks can be thousands, but open *cases*
≪ that; still verify.)

## MED

### M1 — INSERT OR IGNORE on membership can mask a genuine duplicate-cohort bug
File: server/src/care/care-sweep-run-store.ts:90-93,106-108
`uids` from the cohort fetcher is already a deduped Set per playbook, and PK is
(run_id, playbook_id, uid), so within one run there should never be a collision. `OR IGNORE`
therefore protects against nothing real today but would swallow a future bug where a fetcher
returns dup uids or a playbook is summarized twice (membership count would then silently
drift below Σ uids). Low blast radius now; consider a plain INSERT (let it throw inside the
txn → best-effort catch logs it) so the invariant is enforced rather than hidden. Acceptance
criterion "membership rows = Σ cohort_size of non-skipped" is met today because cohortSize ==
uids.length and uids is deduped — but OR IGNORE means the DB won't tell you if that ever stops
being true. Judgment call; not blocking.

## LOW

### L1 — page-beyond-last cost on by-vip is full build+sort before an empty slice
File: server/src/routes/care-cases.ts:94-131
Requesting page=999 still lists all open cases, groups, ranks, sorts, then slices to []. Correct
(returns empty, not error — risk #1 satisfied) but does the full O(n log n) work to return
nothing. Fine at current volumes; note for later if queues grow.

### L2 — parsePaging: NaN/negative pageSize coerces via `|| DEFAULT`
File: server/src/routes/care-cases.ts:57-63
`Math.floor(Number(q?.pageSize)) || DEFAULT_PAGE_SIZE` — `pageSize=0` and `pageSize=abc`
both fall to 50, `pageSize=-5` → floor(-5)=-5 (truthy) → clamped by Math.max(1,..) to 1.
All land in [1,200]; behavior correct, just noting `0`→50 (not 1) in case the FE ever sends 0.

## Acceptance criteria

Phase 1:
- ≤pageSize rows + correct total — PASS (route slices, total=full length; tested 61→50/11).
- priority sort BEFORE slice; urgent (cao) stays page 1 — PASS (sort at :118 before slice :129;
  test asserts whale on p1 row1 among 61).
- enrichment bounded to slice in BOTH endpoints — PASS (getVipProfiles called with
  slice.map(uid) at :80 and :130, never full list).
- page/pageSize clamped [1,200], page≥1 — PASS (parsePaging; test page=0→1, pageSize=9999→200).
- response keeps .vips/.cases + adds total/page/pageSize — PASS.
- sort key has no profile dependency — PASS (sort uses topPriority/caseCount/uid; profiles
  attached after slice).

Phase 2:
- 1 run row + N playbook-result rows (incl skipped) + membership = Σ cohort of non-skipped —
  PASS (single txn; results loop over all summaries; membership only for s.uids; tested).
- recording best-effort (throw must not fail HTTP) — PASS (try/catch at route :191-207, warns).
- status='partial' iff any skipped==='query-failed' — PASS (deriveRunStatus; tested). Note:
  'error' status value exists in the CHECK + type but is never produced by deriveRunStatus
  (a full-sweep failure returns 502 before recordSweep, so no run row is written). Intentional
  per design, but 'error' is currently dead — confirm a future writer needs it or drop from enum.
- uids stripped from HTTP response — PASS (publicSummaries strips at :211; FE
  SweepPlaybookSummary type has no uids field, so no contract mismatch).
- prune membership <30d + runs <365d cascading — PASS (cron :19-25 prunes membership then
  runs; FK CASCADE verified ON via getDb pragma + tested).
- migrations additive/forward-only, user_version=43 — PASS (43 .sql files; runner sets
  user_version=files.length=43; new tables CREATE IF NOT EXISTS, no ALTER/DROP).

## Risk checklist (from task)
1. Slice math off-by-one — OK: start=(page-1)*pageSize, end=start+pageSize; beyond-last → [].
2. Enrichment bound — OK (H-confirmed slice-only in both).
3. Sort stability/profile-independence — OK.
4. recordSweep atomicity — OK single txn; see M1 re OR IGNORE.
5. uids leak — OK, stripped; FE type doesn't expect it.
6. FK CASCADE + prune order — OK; cannot orphan (membership FK→runs CASCADE; membership-first
   prune then runs-cascade is redundant-safe, not orphaning).
7. Regressions — H1 is the real one (use-care-playbooks portfolio). Member-360 care tab uses
   useVipCaseHistory (/vip/:uid, unchanged). by-vip/list FE consumers updated. SweepResult name
   also exists in Settings/use-artifact-sweep + services/artifact-validation-sweep — distinct
   types, no collision.

## Unresolved questions
- H1: what is the real max open+treated case count per game? Determines whether pageSize=200
  band-aid suffices or aggregation must move server-side.
- M1: is `OR IGNORE` deliberate (defensive) or copy-paste? Affects whether the Σ invariant is
  enforced or merely assumed.
- Phase-2 'error' run status: dead value today — keep for a future cron writer or drop?

**Status:** DONE_WITH_CONCERNS
**Summary:** Phase 1 + 2 acceptance criteria all PASS and tests/tsc green, but H1 is a real
silent regression: the CS Monitor portfolio now aggregates only the first 50 cases because its
fetch doesn't opt out of the new default pagination.
**Concerns/Blockers:** H1 (portfolio undercount) should be fixed before ship; M1 + the dead
'error' status are judgment calls for the author/user.
