#!/usr/bin/env python3
"""
Per-game extend-vs-roll triage for pre-aggregation rollout.

For each game's seeded starter questions (whose exact query shape is already
recorded in chat-service/seed/starter-verification-report.json), decide whether
the query can be served by an EXISTING rollup def in that game's cube YAMLs, or
whether the YAML must be extended (new rollup / new member) before building.

Verdicts per query:
  HIT              a rollup is a superset (measures + dims + exact time-dim) -> just roll (build)
  MISS_NEEDS_ROLLUP  a touched cube has NO rollup def at all -> author one
  MISS_NEEDS_MEMBER  cube has rollup(s) but none covers (missing measure/dim/time-dim) -> extend
  NON_ADDITIVE       query uses avg / exact count_distinct / rolling-window / derived measure -> stays raw
  MULTI_CUBE         measures span 2+ cubes with no single covering rollup -> inspect manually

Usage: classify-seed-query-rollup-coverage.py [game ...]   (default: all seeded games)
"""
import json, sys, os, glob, re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
MODEL = os.path.join(ROOT, "cube-dev", "cube", "model", "cubes")
REPORT = os.path.join(ROOT, "chat-service", "seed", "starter-verification-report.json")

import yaml

# game key in verification report -> cube model folder
GAME_DIR = {
    "cfm_vn": "cfm", "ballistar": "ballistar", "cros": "cros",
    "jus_vn": "jus", "muaw": "muaw", "pubg": "pubg",
}

GRAN_ORDER = {"day": 1, "week": 2, "month": 3, "quarter": 4, "year": 5}


def measure_additivity(m):
    """Return (additive: bool, reason: str)."""
    t = m.get("type", "")
    sql = str(m.get("sql", "") or "")
    # derived / ratio measure: sql references another measure via {name}
    if t == "number" and "{" in sql:
        return False, "derived"
    if t == "avg":
        return False, "avg"
    if t == "count_distinct":  # exact (non-approx) -> non-additive across partitions
        return False, "exact_distinct"
    # rolling-window measure: filter pins to CURRENT_DATE/now -> snapshot, can't roll by day
    filters = m.get("filters") or []
    fsql = " ".join(str(f.get("sql", "")) for f in filters)
    if re.search(r"CURRENT_DATE|current_timestamp|DATE_TRUNC\s*\(\s*'(week|month)'", fsql, re.I):
        return False, "rolling_window"
    return True, ""


def load_game(folder):
    """folder cube model dir -> {cube: {measures{}, dims set, additivity{}, rollups[]}}"""
    cubes = {}
    for path in glob.glob(os.path.join(MODEL, folder, "*.yml")):
        try:
            doc = yaml.safe_load(open(path)) or {}
        except Exception as e:
            print(f"  ! parse fail {path}: {e}", file=sys.stderr)
            continue
        for c in doc.get("cubes", []) or []:
            name = c["name"]
            add = {}
            for m in c.get("measures", []) or []:
                ok, _ = measure_additivity(m)
                add[m["name"]] = ok
            dims = {d["name"] for d in c.get("dimensions", []) or []}
            rollups = []
            for pa in c.get("pre_aggregations", []) or []:
                if pa.get("type") == "rollup_lambda":
                    continue  # lambda just wraps a batch rollup; the batch carries the members
                td = pa.get("time_dimension")
                rollups.append({
                    "name": pa["name"],
                    "cube": name,
                    "measures": {qualify(name, x) for x in (pa.get("measures") or [])},
                    "dims": {qualify(name, x) for x in (pa.get("dimensions") or [])},
                    "time_dim": qualify(name, td) if td else None,
                    "gran": pa.get("granularity", "day"),
                })
            cubes[name] = {"add": add, "dims": dims, "rollups": rollups}
    return cubes


def qualify(cube, member):
    return member if "." in member else f"{cube}.{member}"


def covers(rollup, q_measures, q_dims, q_td, q_gran):
    if not q_measures <= rollup["measures"]:
        return False
    if not q_dims <= rollup["dims"]:
        return False
    if q_td is not None:
        if rollup["time_dim"] != q_td:
            return False
        # day-grain rollup serves coarser (additive + HLL merge); reject only if rollup coarser than query
        rg = GRAN_ORDER.get(rollup["gran"], 1)
        qg = GRAN_ORDER.get(q_gran, rg)
        if rg > qg:
            return False
    return True


def classify(game_key):
    folder = GAME_DIR[game_key]
    cubes = load_game(folder)
    rep = json.load(open(REPORT))["games"].get(game_key, {})
    out = []
    for e in rep.get("entries", []):
        q = e.get("query")
        if not q:
            continue
        qm = set(q.get("measures") or [])
        qd = set(q.get("dimensions") or [])
        tds = q.get("timeDimensions") or []
        q_td = tds[0]["dimension"] if tds else None
        q_gran = (tds[0].get("granularity") if tds else None) or "day"
        touched = {m.split(".")[0] for m in (qm | qd)}
        if q_td:
            touched.add(q_td.split(".")[0])

        # non-additive check first (would be served wrong by any rollup)
        na = []
        for m in qm:
            cube, mm = m.split(".", 1)
            if cube in cubes and cubes[cube]["add"].get(mm) is False:
                na.append(mm)
        if na:
            out.append((e["questionId"], "NON_ADDITIVE", f"non-additive: {','.join(sorted(set(na)))}"))
            continue

        # any cube touched has zero rollups?
        no_rollup = [c for c in touched if c in cubes and not cubes[c]["rollups"]]
        # gather all rollups across touched cubes
        candidates = [r for c in touched if c in cubes for r in cubes[c]["rollups"]]
        match = next((r for r in candidates if covers(r, qm, qd, q_td, q_gran)), None)
        if match:
            out.append((e["questionId"], "HIT", f"{match['cube']}.{match['name']}"))
        elif no_rollup and not candidates:
            out.append((e["questionId"], "MISS_NEEDS_ROLLUP", f"no rollup on: {','.join(no_rollup)}"))
        elif len(touched) > 1 and not any(qm <= set(m.split('.')[0] + '.' for m in qm) for _ in [0]):
            # measures spanning cubes w/ no single covering rollup
            mcubes = {m.split('.')[0] for m in qm}
            if len(mcubes) > 1:
                out.append((e["questionId"], "MULTI_CUBE", f"measures span: {','.join(sorted(mcubes))}"))
            else:
                out.append((e["questionId"], "MISS_NEEDS_MEMBER", _gap(candidates, qm, qd, q_td)))
        else:
            out.append((e["questionId"], "MISS_NEEDS_MEMBER", _gap(candidates, qm, qd, q_td)))
    return out


def _gap(candidates, qm, qd, q_td):
    if not candidates:
        return "no rollup def"
    # best candidate = most overlap; report what it lacks
    best = max(candidates, key=lambda r: len(qm & r["measures"]) + len(qd & r["dims"]))
    miss_m = qm - best["measures"]
    miss_d = qd - best["dims"]
    td_bad = q_td is not None and best["time_dim"] != q_td
    bits = []
    if miss_m: bits.append(f"+measures {sorted(miss_m)}")
    if miss_d: bits.append(f"+dims {sorted(miss_d)}")
    if td_bad: bits.append(f"time-dim {q_td} (rollup={best['time_dim']})")
    return f"{best['cube']}.{best['name']} needs " + "; ".join(bits)


def main():
    games = sys.argv[1:] or list(GAME_DIR.keys())
    grand = {}
    for g in games:
        if g not in GAME_DIR:
            print(f"unknown game {g}; known: {list(GAME_DIR)}"); continue
        rows = classify(g)
        from collections import Counter
        c = Counter(v for _, v, _ in rows)
        grand[g] = c
        print(f"\n=== {g} ({sum(c.values())} queries) ===")
        for verdict in ["HIT", "MISS_NEEDS_MEMBER", "MISS_NEEDS_ROLLUP", "NON_ADDITIVE", "MULTI_CUBE"]:
            n = c.get(verdict, 0)
            if n:
                print(f"  {verdict}: {n}")
        # detail for non-HIT
        for qid, v, why in rows:
            if v != "HIT":
                print(f"    [{v}] {qid}: {why}")
    print("\n=== ROLLOUT SUMMARY ===")
    for g, c in grand.items():
        tot = sum(c.values())
        hit = c.get("HIT", 0)
        author = c.get("MISS_NEEDS_ROLLUP", 0) + c.get("MISS_NEEDS_MEMBER", 0)
        raw = c.get("NON_ADDITIVE", 0) + c.get("MULTI_CUBE", 0)
        verdict = "JUST ROLL" if author == 0 else "EXTEND YAML"
        print(f"  {g:10} {hit}/{tot} HIT | extend:{author} | stays-raw:{raw}  -> {verdict}")


if __name__ == "__main__":
    main()
