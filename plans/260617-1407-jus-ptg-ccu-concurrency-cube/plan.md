# Plan: jus_vn + ptg CCU concurrency cube

Unblock the 4 concurrency business-metrics (`ccu`, `acu`, `lcu`, `pcu`) for the
two games that actually have a concurrent-user sampling source
(`etl_ingame_ccu`): **jus_vn** and **ptg**. Mark the other 6 games N/A (no CCU
source — verified). New per-game `ccu` cube, repoint the 4 metric refs, certify
off a game where it resolves.

## Why now
- Verified `etl_ingame_ccu` exists ONLY in `jus_vn` + `ptg` schemas (not the
  other 6). The playbook's old "concurrency — never" verdict was wrong for
  these two.
- The 4 metrics currently ref `mf_users.{acu,ccu,lcu,pcu}` which exist in no
  cube → permanent GAP. mf_users is per-user identity; CCU is per-timestamp
  samples — wrong home. Needs a dedicated cube (same move as
  active_role→user_roles).

## Verified source facts (Trino, 2026-06-16/17)
- **jus_vn**: ~30s samples, 14 servers. Each (online_time, server) is **2
  null-complementary rows** — one has `online`+`cloud_online_num`, the other
  `vng_online_num`+`other_online_num`. Confirmed `online = vng+cloud+other`
  exactly. `online` = per-server grand total. `cloud`=0 (cloud gaming not live).
  Time col `online_time` (UTC, tz-aware).
- **ptg**: ~5min samples, 2 servers, single `numberuseronline`, no row-split.
  Already has GMT+7 col `logdatetime_timezone_utc_7`. Peaks ~146k/server.
- Both: `log_date` (DATE) partition col present.

## Core modeling decision — TWO cubes per game (decisions locked 2026-06-17)
System-wide peak/avg/low cannot share a cube with a `server` dimension: system
PCU = max-over-time of (sum-across-servers), a two-level aggregation a
per-server-grain measure can't express. So:
- **`ccu`** (headline) — grain = one row per timestamp, pre-summed across
  servers in SQL. Backs the 4 metrics.
- **`ccu_by_server`** (breakdown) — grain = per (timestamp, server), with
  `server` dim + jus channel dims (vng/cloud/other). Answers load-balancing +
  channel-mix. Included now (user decision).

Measures over the per-timestamp series:
- `peak` = MAX(concurrent)  → maps to **pcu**
- `low`  = MIN(concurrent)  → maps to **lcu**
- `avg`  = AVG(concurrent)  → maps to **acu**
- `ccu`  → headline; **OPEN Q** (see below) — propose = avg
- `sample_count` = COUNT(*) (for avg additivity in any future rollup)

"within each hour" wording in metric descs is satisfied by querying the time
dimension at `granularity: hour`.

## Phases
1. [phase-01](phase-01-build-ccu-cubes.md) — author `jus/ccu.yml` + `ptg/ccu.yml`
   cubes; restart dev cube; verify real peak/avg/low queries.
2. [phase-02](phase-02-wire-metrics.md) — repoint 4 metric refs to `ccu.*`;
   set applicability (jus/ptg true, other 6 false); restart not needed (server
   hot-reloads metric YAMLs).
3. [phase-03](phase-03-certify-and-docs.md) — `audit:metric-trust --promote`
   (certify off jus_vn); update playbook doc + memory; commit own files.

## Key dependencies / constraints
- Cube reads bare `sql_table` per game schema (cube.js driverFactory) — cube
  files live in `cube-dev/cube/model/cubes/{jus,ptg}/ccu.yml`.
- DEV_MODE=false ⇒ restart `cube-playground-cube-api-dev` after cube YAML
  changes (metric YAML changes hot-reload via server fs.watch).
- Rollup (if added later): avg is NOT additive — store sum+count, derive avg;
  peak/low (max/min) are partition-safe. Per [[cube-rollup-authoring-rules]].
  Tables are small (~2880 timestamps/day jus) → rollups optional, not in scope.
- Cert gate validates refs vs the target game /meta → certify off jus_vn or ptg.

## Resolved decisions (2026-06-17)
1. **`ccu` scalar → avg** (`ccu.avg`, mirrors acu). Headline ccu is the series'
   average over the queried window.
2. **Other 5 (ballistar/cros/tf/muaw/pubg) + cfm → applicable:false** for all 4
   concurrency metrics (verified no etl_ingame_ccu). Documented N/A.
3. **Per-server/channel breakdown IN scope now** → second cube `ccu_by_server`
   per game (see core modeling decision above).
