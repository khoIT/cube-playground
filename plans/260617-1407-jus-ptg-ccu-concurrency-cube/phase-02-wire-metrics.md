# Phase 02 — Wire the 4 metrics to the `ccu` cube

**Priority:** P1 · **Status:** not started · **Depends on:** phase-01

## Files to modify
- `server/src/presets/business-metrics/pcu.yml`
- `server/src/presets/business-metrics/lcu.yml`
- `server/src/presets/business-metrics/acu.yml`
- `server/src/presets/business-metrics/ccu.yml`

## Ref repoint (trust is global → ref change is global; that's fine)
| metric | old ref | new ref | required_cubes |
|---|---|---|---|
| pcu | mf_users.pcu | ccu.peak | [ccu] |
| lcu | mf_users.lcu | ccu.low | [ccu] |
| acu | mf_users.acu | ccu.avg | [ccu] |
| ccu | mf_users.ccu | ccu.avg *(OPEN Q — or ccu.peak)* | [ccu] |

After repoint: jus_vn + ptg resolve (cube exists) → READY/certified; the other
6 games show `missing ccu` → governed by applicability below.

## Applicability (orthogonal to trust — keeps GAP honest)
For each of the 4 metrics, set:
- `jus_vn`: applicable **true** — note: "etl_ingame_ccu sampling source exists
  (~30s, 14 servers); ccu cube sums system-wide per timestamp."
- `ptg`: applicable **true** — note: "etl_ingame_ccu sampling source exists
  (~5min, 2 servers)."
- `ballistar`, `cros`, `tf`, `muaw`, `pubg`: applicable **false** — note: "no
  etl_ingame_ccu sampling source in this game's schema (verified
  information_schema 2026-06-17) → concurrency not computable."
- `cfm_vn`: already applicable false — keep; refresh note to the verified
  table-absence wording for consistency.

This converts those 4×5 = 20 metric-displays from GAP → N/A (honest), and
4×2 = 8 from GAP → certifiable.

## Steps
1. Edit the 4 YAMLs: change `formula.ref`, `required_cubes`, add/adjust
   `meta.applicability` entries (use today's date in `at`).
2. No cube restart needed — server hot-reloads metric YAMLs (fs.watch).
3. Confirm `GET /api/business-metrics/drift?game=jus_vn` no longer lists the 4;
   `?game=ballistar` shows them gone from GAP (now N/A, not GAP).

## Success criteria
- drift(jus_vn) + drift(ptg): the 4 ccu metrics resolvable.
- drift(other 5): the 4 no longer counted as GAP (applicable:false ⇒ N/A).

## Risk
- Repointing the ref is global. cfm_vn now refs `ccu.peak` (absent) →
  display-downgrade, but it's already applicable:false so it stays out of the
  chat agent's set. Acceptable + consistent.
