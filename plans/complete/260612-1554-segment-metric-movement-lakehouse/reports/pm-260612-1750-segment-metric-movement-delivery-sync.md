# PM Sync — Segment Metric-Movement Lakehouse (2026-06-12 17:50 GMT+7)

## Status

Plan: **in-progress 7/8** (delivery complete; phase 8 deferred by design, stays pending).
Tasks #24–30 completed. Code review: DONE_WITH_CONCERNS → all actionable findings resolved (see resolution table in code-review report).

| Phase | Status | Note |
|---|---|---|
| 1 Recon + ops visibility | ✅ | Prod flag ABSENT from Vault → nightly dormant; partitions bridged manually 06-10/06-12 |
| 2 Mart eligibility matrix | ✅ | cfm_vn + jus_vn registry-seeded with join-probe evidence |
| 3 Treatment-events contract | ✅ | Proposal doc for external team |
| 4 Definition snapshot | ✅ | 17 rows live; `__definitions__` heartbeat now surfaced in admin UI |
| 5 Trajectory panel | ✅ | ≥7-day-history criterion blocked on accrual (only 2 partitions exist) |
| 6 Three-lens metric series | ✅ | Entry lens switched to post-entry-only per-member clock (user decision), live-verified |
| 7 GATED materialization | ⏭ skipped | Gate didn't fire: P95 1.7s ≪ 8s, no restatement, no volume consumer |
| 8 As-of-entry attrs | ⏸ deferred | By design, no task |

## Post-review fixes (all verified: server tsc clean, 31 server + 37 FE tests green)

- Entry lens: per-member clock (`f.date >= first_entry`) — pre-entry mart activity no longer contaminates the causal lens; live Trino re-verification OK
- Entry-lens dead-join detection (inner-join zero-rows case) + FE renders joinWarning in empty state
- Trajectory SVG line breaks at gap days (no interpolation through amber bands)
- `__definitions__` status/rows in SnapshotRun payload + admin Definitions column + test
- Both route caches bounded (500 entries, insertion-order eviction)
- isValidAnchor rejects impossible dates (400 not 502); stale series cleared on lens switch
- Plan-artifact refs stripped from code comments

## Outstanding (user action)

1. **Enable `SEGMENT_SNAPSHOT_ENABLED=true` in prod Vault** (`jupyter/prod/khoitn/cube-playground`) on exactly ONE instance + redeploy — until then nightly snapshots stay dormant (manual bridging only).
2. Phase-4 criterion "edit → new hash next day" needs one real predicate edit + next-day partition to observe.
3. Phase-5 "≥7-day history" auto-resolves ~06-19 once nightlies accrue.

## Plan-recorded follow-ups (no action now)

- Delta writer "diff vs latest previous partition" improvement (gap-day artifact)
- ballistar registry rows when wanted; muaw/pubgm await membership snapshots
- Mart immutability question with data platform
- Plan 260610-1709 (rollup serve-layer) stays blocked/unneeded — latency evidence says query-time is fine

## Session incidents

- Concurrent session's missing `src/QueryBuilderV2/compare/format-delta.ts` broke Vite — reconstructed from usage (their WIP imports it; file was never on disk). They may overwrite freely.
- stash@{0} (other session's WIP backup) intentionally kept; no stash ops this session.

## Unresolved questions

None blocking. Items 1–3 above are user/time actions.
