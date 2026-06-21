# Phase 02 — Cube parity matrix (run #2, 2026-06-22)

Source: `audit-cube-parity.mjs` (cube-dev vs cube-prod oracle, local), recorded to
segments.db run #2 → visible in Model Audit console. **0 🔴 correctness · 46 🟡 parity · 312 ⚪ cosmetic** across 8 games.

## Headline finding — recharge PK fan-out risk (3 games)

Same shape as the jus recharge `transid` fan-out bug fixed earlier (`9d3691a`):

| game | dev PK | oracle PK | risk |
|------|--------|-----------|------|
| muaw | `transaction_id` | `composite_pk` | recharge revenue **fan-out inflation** |
| ptg  | `transaction_id` | `composite_pk` | same |
| pubg | `transaction_id` | `composite_pk` | same |

cfm_vn ✅ correct PK · jus_vn ✅ already fixed. **muaw/ptg/pubg are unfixed** — a
`transaction_id` PK on a recharge fact that has multiple rows per txn inflates
`sum(revenue)` via join fan-out. This is the silent-wrong-number class the audit
exists to catch. Recommend: repoint these to `composite_pk` like jus/cfm (verify
against cube-prod recharge.yml).

## Measure coverage gaps (🟡 measure-missing-vs-oracle)

Dev cubes missing measures the prod oracle exposes (not bugs — coverage gaps):
- `jus recharge`: `revenue_total`, `arpt`
- `muaw/pubg recharge`: `revenue_local`, `arpt_local`
- `ballistar/ptg/pubg user_active_monthly` + `user_recharge_monthly`: row_count, recharge_days, active_days, online_time, ingame_total_recharge_* (monthly marts not modeled dev-side)
- `ptg ccu`: samples, peak_ccu, avg_ccu, distinct_servers

## cfm_vn / jus_vn (first-run focus)

| game | parity 🟡 | cosmetic ⚪ | notes |
|------|-----------|------------|-------|
| cfm  | 0 | 55 | mostly `measure-dev-ahead` (dev evolved past prod) + `no-oracle-counterpart:billing_detail` |
| jus  | 2 | 81 | 2 = recharge.revenue_total/arpt missing; cosmetics incl. `identity-bridge:*.mf_users` (join-to-identity class) |

Both clean on correctness + PK. The jus `identity-bridge:*.mf_users` cosmetics
flag every cube joining the mf_users identity bridge — worth confirming the bridge
join key is consistent (the historical jus_vn dup-row class lived here).

## Limitation (scope reconciliation)

Per the "local cube-dev oracle / local-only" decision, Phase 02 is **structural**
parity (PK / join / measure defs, dev vs prod model) — NOT live two-plane value
parity. It catches dev-vs-prod *definition* drift (which is how the fan-out/identity
bugs manifest), but **cannot** catch a wrong value where dev and prod agree on a
wrong definition. Closing that gap would need a trusted value oracle (prod data
plane), which the local-only constraint rules out for now.

## Worklist (ranked)

1. **Fix recharge PK fan-out: muaw, ptg, pubg** → `composite_pk` (correctness; highest value).
2. Confirm jus `identity-bridge:*.mf_users` join-key consistency (dup-row class).
3. Decide per-game whether the missing monthly-mart measures are intentional (coverage, not bug).

## Unresolved questions

- Q1: Is the recharge PK `parity`-severity classification right? A PK that fans out
  revenue is arguably `correctness`, not `parity` — should the harness promote
  `pk-differs-vs-oracle:recharge` to 🔴?
- Q2: muaw/ptg/pubg PK fix — in scope for this effort, or hand to the model-owners?
