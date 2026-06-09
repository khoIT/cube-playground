---
phase: 2
title: Bare Rename Rules
status: completed
priority: P1
effort: 0.5d
dependencies: []
---

# Phase 2: Bare Rename Rules

## Overview
Define + codify the deterministic transforms that turn kraken YAML into local-convention YAML, per tenant class, plus a fetch helper. Two transform profiles:
- **Game-tenant profile (cfm/cros/tf):** strip the `<game>_` cube prefix → bare names.
- **vga profile (DEFERRED — Validation S1):** near-verbatim passthrough (keep `vga_` names + `.yaml`). Not exercised now; documented for Phase 12 resumption.

This is the single source of the rules every cube/view phase applies. **Active games: cfm, cros, tf.**

## Requirements
- Functional: fetch any `kraken/cube` file by path; apply rename rules; emit local-convention YAML.
- Non-functional: idempotent; reviewable diffs; no semantic change to SQL beyond namespacing.

## Architecture
Game-tenant rename rules (kraken → local; `<g>` ∈ {cfm,cros,tf}; param `--game`):
1. Cube name: `name: <g>_<x>` → `name: <x>` (e.g. `cfm_user_roles` → `user_roles`). Cubes already bare keep their name.
2. `sql_table: <schema>.<table>` → `sql_table: <table>` (schema injected per-tenant by `cube.js`; `<schema>` = cfm_vn/cros/tf). Verify `<table>` exists via Phase 1 inventory.
3. View `name: <g>_<view>` → `name: <view>` (`cfm_user_profile` → `user_profile`). **Exception:** keep the suffix (`_panel`, `_timeline`); only the leading `<g>_` is stripped.
4. View `join_path: <g>_<cube>` → `join_path: <cube>`.
5. Join SQL refs `{<g>_<cube>}` → `{<cube>}` (regex `{<g>_[a-z0-9_]+}`).
6. `queryRewrite`/behavior refs handled in Phase 8, not here.
7. Leave column SQL, `FILTER_PARAMS`, `{CUBE}`, measures/dimensions bodies untouched.

vga rules: **no rename.** Copy `vga/*.yaml` verbatim; Trino-verify against `iceberg.vga`; decide catalog/schema handling in Phase 8 (per-tenant catalog) + Phase 12. The `vga_` prefix and cross-cube `join_path: vga_*` references stay intact.

Fetch via GitLab API (token from `cube-dev-old` remote): `GET /projects/kraken%2Fcube/repository/files/<urlenc path>/raw?ref=main`.

## Related Code Files
- Create: `plans/260604-2317-cfm-vn-cube-model-full-port/scripts/fetch_kraken.sh` (fetch one upstream path → stdout)
- Create: `plans/260604-2317-cfm-vn-cube-model-full-port/scripts/bare_rename.py` (apply rules 1–5 to a YAML stream)
- Reference: `cube-dev/cube/model/cubes/ballistar/*.yml` + `views/ballistar/user_360.yml` (target convention)

## Implementation Steps
1. Extract the GitLab token from `git -C cube-dev-old remote -v` (oauth2 form). Do NOT hardcode it into committed scripts — read from the remote at runtime.
2. `fetch_kraken.sh <repo-path>` → raw file. Smoke-test on `cube/model/cubes/cfm_vn/user_roles.yml`.
3. `bare_rename.py --game <cfm|cros|tf>`: implement rules 1–5 as ordered regex/string passes parameterized on the game prefix + schema (NOT a YAML round-trip — preserve comments/formatting/anchors). Unit-spot-check per game: `cfm_user_roles`→`user_roles`, `{cros_mf_users}`→`{mf_users}`, `tf.mf_users`→`mf_users`. vga path = passthrough (no transform).
4. Verify idempotency: running twice == once.
5. Document the rules table in this phase file as the canonical reference (done above).

## Success Criteria
- [ ] `fetch_kraken.sh` returns upstream YAML verbatim.
- [ ] `bare_rename.py` transforms a sample cube + the view file with correct, comment-preserving output.
- [ ] Idempotent on re-run.
- [ ] Token never written to a committed file.

## Risk Assessment
- Naive global `s/cfm_//` would corrupt column names / descriptions (e.g. `cfm_coin_only` segment in money_flow). Mitigation: only rewrite `name:`, `sql_table:`, `join_path:`, and `{cfm_<cube>}` join refs — anchored patterns, not blanket replace.
- YAML round-trip libraries drop comments/anchors. Mitigation: text-level regex passes.
- View suffix collision: `cfm_user_devices` (cube) vs `cfm_user_devices_panel` (view) — keep distinct; the dashboard references `cfm_user_devices` (the cube) for `device_id`, resolve in Phase 7.
