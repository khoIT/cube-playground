# Phase 04 — Virtual-currency economy (money_flow + item_flow labels)

**Priority:** P1 value / **BLOCKED on input** (jus code dictionary doc) · **Status:** ☐ todo

## Overview
The economy layer is the single highest-value diagnostic surface: it lets the diagnose rail cross
from "recharge fell" to "players stopped *running out* of currency." `etl_ingame_money_flow` (2.8B
rows) has NO cube. `etl_ingame_item_flow` has `etl_prop_flow.yml` but with unlabeled reason codes.

## Blocker (decision #1 + open question 1)
Per-game dictionaries — cfm's codes do NOT transfer. Need a jus code→label source (cfm's came from
`docs/CFL_Game detail 2.xlsx`). Required mappings:
- `field` → currency name (30 distinct codes: 10002, 2, 13, 25, 10003, 1, 6, 17, 10010, …).
- `reason` → action label **+ credit/debit classification** (225 distinct codes).
- `reason_remarks` (1–4) → coarse group (may be a usable fallback bucket while the full dict is pending — confirm semantics).
**Do not start the YAML until the dictionary doc is in hand.** Data lag (May-15 freeze) is NOT a
blocker (decision #2) — model now, data backfills later.

## Key insights (verified)
- `num` is **always positive**; `log_type` always NULL → gain/spend is NOT in the data, only in the
  reason classification. cfm uses an `addorreduce` flag jus lacks → jus direction must be derived
  from the per-reason credit/debit tag in the dictionary.
- `now_num` = post-transaction running balance (useful for balance-state measures).
- Mirror cfm `etl_money_flow.yml`: `case:` dims for codes, filtered measures for in/out, full
  rollup set (batch + lambda + dteventtime twin) — but encode direction via reason classification, not a flag.

## Requirements
- `money_flow` cube (from `etl_ingame_money_flow`): grain = currency event. Join role_id→user_roles→mf_users.
  - Dims: role_id, server, log_date(time), `currency`(case on field), `reason_action`(case on reason),
    `reason_group`(case on reason_remarks), `direction`(in/out, derived from reason→credit/debit map).
  - Measures: `events` (count), `total_in`/`total_out` (sum num filtered by direction), `net_flow`,
    `spending_roles` (count_distinct filtered out), `earning_roles` (filtered in).
  - Rollups: batch + rollup_lambda + dteventtime twin (2.8B rows — non-negotiable).
- `etl_prop_flow` enhancement: add `item_reason` label dim + (if available) item/category labels from the same dict; add direction if item_flow has gain/spend semantics.

## Architecture
```
etl_ingame_money_flow ─(role_id)─► user_roles ─► mf_users
direction = lookup(reason → {credit|debit})   # from per-game dictionary
```

## Related code files
- Create: `cube-dev/cube/model/cubes/jus/money_flow.yml`
- Edit: `cube-dev/cube/model/cubes/jus/etl_prop_flow.yml` (add reason/item labels)
- Read for pattern: `cube-dev/cube/model/cubes/cfm/etl_money_flow.yml` (case-dim + filtered-measure + rollup structure)

## Implementation steps
1. **Obtain jus dictionary doc** (blocker). Parse into: field→currency, reason→action+direction, reason_remarks→group.
2. Encode the three `case:` dims + the derived `direction` dim (reason-classification CASE).
3. Define in/out/net measures via direction filters; add `now_num`-based balance measures if useful.
4. Add the full rollup set (batch/lambda/dteventtime twin), 120d build range, cap end at current_timestamp.
5. Enhance `etl_prop_flow.yml` with item/reason labels.
6. Reload; verify in/out sums reconcile against a raw probe for one date in coverage (e.g. 2026-05-14).

## Todo
- [ ] acquire + parse jus code dictionary (BLOCKER)
- [ ] currency/reason/group case dims
- [ ] direction (credit/debit) derivation
- [ ] in/out/net + spender measures
- [ ] rollups (batch + lambda + dteventtime twin)
- [ ] etl_prop_flow label enhancement
- [ ] reload + reconcile vs raw probe

## Success criteria
- `money_flow.net_flow` by `currency` returns sane sources/sinks for an in-coverage date.
- `direction` splits correctly (sum total_in + total_out ≈ all events).
- Rollup routing confirmed (no 2.8B full-scan); recent (post-May-15) windows read empty without error and the cube description discloses the lag.

## Risks
- Dictionary incomplete / codes drift over time → labels fall to `other`. **Mitigation:** `else: label: other` (cfm pattern); periodic dict refresh.
- Wrong credit/debit classification silently inverts net_flow. **Mitigation:** reconcile against `now_num` deltas on a sample (balance after = balance before ± num) to validate direction sign.
- 2.8B-row scans. **Mitigation:** rollups + mandatory role/date filters in description.

## Next steps
Phase 05 surfaces economy questions to the diagnose/advise rail (currency inflation → recharge demand).
