# Phase 03 — WAU parity (cros + tf only)

**Priority:** low / deferred. **Scope:** cube-model (cube-dev), NOT chat-service.
**Games:** cros + tf only.

## What the real-data probe changed (2026-06-23)
The original premise ("WAU is unmodeled anywhere") is **wrong**:
- `wau` + `trailing_wau` are already defined measures in `active_daily.yml` for
  **6 of 8 games**: cfm, jus, ballistar, muaw, ptg, pubg.
- The cfm eval proves WAU already resolves end-to-end: `show WAU last 7 days` →
  `expectedRef: active_daily.wau` → `resolvedRef: active_daily.wau` → answered with
  a real table. No resolver or glossary change is needed for the plain WAU form.

So this phase shrinks to two unrelated, optional bits:

### 3a. Parity: add `wau`/`trailing_wau` to cros + tf
Only `cros/active_daily.yml` and `tf/active_daily.yml` lack the measure. Copy the
cfm definition (lines ~143–153) and its rollup membership. Same shape, additive
HLL `countDistinct` over the ISO week; verify by compiled SQL, not just /meta.

### 3b. Investigate the one failing cfm WAU case (mom form)
The failing case is `compare WAU month over month`, not the plain form. Before any
cube work, confirm whether it fails for a **measure** reason (it shouldn't — the
measure resolves) or a **compareDateRange path** reason (likely). If it's the mom
path, it's not a Phase 03 cube gap at all — fold it into the mom-path handling
already used by ARPPU/ARPU/DAU mom (see Phase 02 success criteria).

## Steps
1. Reproduce `compare WAU month over month` on cfm; capture whether the measure
   binds and the failure is in compareDateRange composition.
2. If measure binds (expected): file the fix under the mom path, close 3b. No cube change.
3. Parity (optional): add `wau`/`trailing_wau` to cros + tf `active_daily.yml`,
   restart `cube_api` + worker (DEV_MODE=false → no hot reload), confirm /v1/meta
   200 + compiled SQL reflects the rolling-week definition.
4. Per-game eval: `show WAU last 7 days` answers on cros + tf.

## Success criteria
- cros + tf expose `active_daily.wau`; compiled SQL (via `/v1/sql`) reflects the
  ISO-week rolling definition.
- The cfm `compare WAU mom` case answers (via the mom path, no new measure).

## Risks
- Rolling-window measures + pre-aggs are finicky (see cube-rollup-authoring-rules);
  verify by compiled SQL and a real value, not just meta presence.
- Don't let Phase 02's default mask a genuinely missing measure on cros/tf — if WAU
  has no member there, the honest answer is "not yet modeled", not a silent default.

## Todo
- [ ] reproduce `compare WAU mom` on cfm — measure vs compareDateRange failure
- [ ] route mom-form fix into Phase 02 mom path if measure binds
- [ ] (optional parity) add wau/trailing_wau to cros + tf active_daily.yml
- [ ] restart cube_api + worker, confirm /v1/meta + compiled SQL on cros + tf
- [ ] per-game eval: WAU answers on cros + tf
