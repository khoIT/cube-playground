# Metric-series latency + Phase 7 gate decision

Measured 2026-06-12 ~17:00 GMT+7, dev gateway :3004 → shared Trino (cold-ish), real segments.

## Latency (8 varied live calls, cache cold)

| Segment | Game | Call | Wall time |
|---|---|---|---|
| 1d76e4bb (3,968 members) | cfm_vn | revenue · current · 30d | 1.2s |
| a18465f3 (224) | jus_vn | revenue · current · 30d | 0.7s |
| 1d76e4bb | cfm_vn | active_members · current · 30d | 1.5s |
| a18465f3 | jus_vn | active_members · current · 30d | 1.5s |
| 1d76e4bb | cfm_vn | revenue · entry@06-10 · 30d (2 Trino reads) | 1.3s |
| a18465f3 | jus_vn | revenue · entry@06-10 · 30d | 1.7s |
| 1d76e4bb | cfm_vn | active_members · stayers@06-10 · 30d | 0.9s |
| a18465f3 | jus_vn | active_members · stayers@06-10 · 30d | 0.8s |

Max observed 1.7s; P95 ≈ 1.7s. (Trajectory endpoint similar: ≤1.5s.) Repeat views are TTL-cache hits (0 Trino reads, route-test-verified). NOT yet measured: a 7M-member segment over 120 days — the 7.16M "High value" current-lens trajectory read returned in ≈2s, suggesting headroom.

## Phase 7 gate (materialize segment_metric_daily) — DOES NOT FIRE

1. P95 > ~8s? **NO** — 1.7s max.
2. Marts restated/retention-purged? **UNKNOWN, no evidence of restatement** (matrix: immutability UNKNOWN everywhere; cfm/jus retention ≥6 months). Not a YES.
3. Volume consumer (dashboards/chat at request volume)? **NO** — only the segment-detail card, 1h TTL cache.

→ **Phase 7 skipped with rationale.** Re-open if: a slow-path appears on big segments × long windows, data platform confirms restatement, or chat/dashboards start consuming the series.

## Live verification notes (correctness)

- Entry lens verified experimentation-correct on real data: tracks the cohort through 2026-06-11 — a day with NO membership snapshot — via the marts (cfm revenue 371M on the gap day), and memberCount stays a closed cumulative (3968 → 3968 → 3969) after the first-entry dedupe fix.
- Two bugs found ONLY by live data, both fixed + regression-tested: (a) entry-lens cumulative double-counted members re-"entered" by gap-day delta artifacts → dedupe by `min(snapshot_date)` per uid in SQL; (b) dead-join warning false-positived on jus's legitimately sparse payer days → fires only at ≥5 all-zero cohort days.
- jus same-day payer sparsity is real (224-member segment, 0 payers on both snapshot days; 44 distinct payers over 30 days) — UI copy explicitly tolerates sparse days.

## Known limitations (forward)

- Delta gap semantics: `segment_membership_delta` diffs against exactly D-1; after a missed night the next delta marks the full cohort "entered". Trajectory UI marks gap days amber; entry lens dedupes. A "diff vs latest previous partition" writer change would fix it at the source — candidate follow-up, not in this plan's scope.
- Membership history starts 2026-06-10; only 2 partitions exist until nightly runs accrue (prod enable pending — see deployment-guide Vault row).
