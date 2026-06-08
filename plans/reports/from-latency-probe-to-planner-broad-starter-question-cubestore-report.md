# Broad CubeStore Latency + Coverage — Seeded Starter Questions

**Date:** 2026-06-08 | **Method:** compose pass-through Cube query from each seeded starter chip's `targetCatalogIds`, fire through gateway `:3004/cube-api/v1/load`, capture `usedPreAggregations` + cold latency. **Scope:** all 108 seeded questions (6 games × 18), local workspace.

## Headline
CubeStore is **dormant** — rollup defs exist, no partitions built. Every real question hits live Trino. **Half the question catalog can't use CubeStore at all** (no rollup def on the cube it touches).

## Coverage (rollup-def status of real questions)
| Status | Count | % |
|---|---|---|
| full (all cubes have rollup def) | 54 | 50% |
| partial | 0 | 0% |
| **none (≥1 cube has no rollup def)** | **54** | **50%** |

Per-game no-rollup share: cros 100% (18/18), cfm_vn 56%, pubg 56%, jus_vn 39%, muaw 33%, ballistar 17%.

## Served (current stack)
`trino: 75`, `TIMEOUT(>15s,504): 25`, `HTTP500: 8`, **`PREAGG: 0`** — nothing served from CubeStore.

## Latency (cold, concurrency-5 run)
- p50 **8.8s**, p90 **11.5s**, max 14s (non-error n=75).
- **TIMEOUTS: 25/108 = 23%** hard-fail at the gateway's 15s `CUBE_FETCH_TIMEOUT_MS`.
- ⚠ Caveat: concurrency-5 inflates absolute ms + timeout count vs clean serial single-query numbers (active_daily 0.8s, recharge 4.3s, retention 4.4s, mf_users 10s). Coverage split + which shapes fail are concurrency-independent.
- Even "full-coverage" cubes (`game_key_metrics`, `active_daily`) timed out → partitions dormant, so they serve live too. **Phase 0 (build partitions) fixes the 50% that already have defs without writing any new rollup.**

## Demand-weighted no-rollup cubes (build priority)
| Cube | # real questions touching it |
|---|---|
| new_user_retention | 15 |
| mf_users | 15 |
| recharge (non-ballistar) | 6 |
| user_recharge_daily | 5 |
| etl_* behavior (cfm) | ~10 (row-level; flagged, not std rollup) |
| user_active_monthly / user_devices / cros active_daily | 1 each |

## Implications for the plan
1. **Phase 0 is the single biggest lever** — building partitions makes the already-defined 50% serve from CubeStore (no model changes). Highest ROI step.
2. **Phase 1 hot cubes confirmed by demand**: new_user_retention + mf_users (15 each), then recharge + user_recharge_daily. Matches earlier guess.
3. **cros = 100% uncovered** → Phase 2 standard-set rollout justified (assuming cros has real data — open Q).
4. **etl_* behavior cubes** carry real demand (~10 qs) but resist generic rollups — separate decision.

## Unresolved questions
1. Does prod query a building worker, or is prod also dormant (then prod users live the 8.8s p50 / 23% timeout today)?
2. Is the `:11000` worker mis-wired or just never triggered?
3. Do source tables (esp. cros, etl_*) have data in the 2025-01-01→today build range, or will partitions build empty?
4. Should the 15s gateway timeout be raised as a safety net for residual non-rollup user queries?

**Harness:** `/tmp/broad_starter_latency.py` (composes from seed, parses `usedPreAggregations`). Re-run after Phase 0/1 for before/after.
