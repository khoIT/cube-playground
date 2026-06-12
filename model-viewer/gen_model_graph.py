#!/usr/bin/env python3
"""Parse the Cube semantic-layer YAML into a single model-graph.json for the viewer.

Walks cube-dev/cube/model/cubes/<game>/*.yml (cube definitions) and
cube-dev/cube/model/views/<game>/*.yml (360 views), and emits a per-game graph:
nodes = cubes, edges = joins (with parsed key-mapping + cardinality), plus the
full dimension/measure/segment schema and the view→cube composition.

The join graph lives ONLY in the YAML `joins:` blocks (Cube's /v1/meta REST API
does not expose joins), so the YAML is the single source of truth here.

Usage:  python3 model-viewer/gen_model_graph.py
Output: model-viewer/model-graph.json
"""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CUBES_DIR = ROOT / "cube-dev" / "cube" / "model" / "cubes"
VIEWS_DIR = ROOT / "cube-dev" / "cube" / "model" / "views"
OUT = Path(__file__).resolve().parent / "model-graph.json"
OUT_JS = Path(__file__).resolve().parent / "model-graph.js"

import yaml

# {CUBE}.col = {other_cube}.col  (either side may be the CUBE side)
_TOKEN = re.compile(r"\{(\w+)\}\.(\w+)")


def squash(text):
    """Collapse a multiline YAML description into a single trimmed string."""
    if not text:
        return ""
    return " ".join(str(text).split())


def parse_key_label(sql, cube_name, target_name):
    """Turn a join SQL predicate into a readable 'localCol → targetCol' label."""
    if not sql:
        return ""
    toks = _TOKEN.findall(sql)  # list of (cube_ref, column)
    local_col = target_col = None
    for ref, col in toks:
        if ref == "CUBE" or ref == cube_name:
            local_col = col
        elif ref == target_name:
            target_col = col
    if local_col and target_col:
        return f"{local_col} → {target_col}"
    # Fallback: first two columns in declaration order.
    if len(toks) >= 2:
        return f"{toks[0][1]} → {toks[1][1]}"
    return squash(sql)


def base_name(name):
    """Strip a `<game>__` tenant prefix if present — local workspace cubes are
    bare (`mf_users`), prod cubes are prefixed (`cfm_vn__mf_users`); the
    clustering heuristics should see the same base either way."""
    return name.lower().rsplit("__", 1)[-1]


def cluster_of(name, joins):
    """Heuristic visual grouping (color/box only), mirroring cfm_data_model.svg.

    etl event cubes split by how they reach the user: a *direct* join to
    `mf_users` → "session" (login/logout), otherwise via the role bridge →
    "behavior". Non-event cubes bucket by name keyword so other games (no `etl_`
    naming) still cluster sensibly.
    """
    n = name.lower()
    b = base_name(name)
    if b == "mf_users":
        return "hub"
    if b == "user_roles":
        return "bridge"
    if b.startswith("etl_"):
        targets = [base_name(j.get("target", "")) for j in joins]
        return "session" if any(t == "mf_users" for t in targets) else "behavior"
    if any(k in n for k in ("recharge", "payment", "delivery", "redeem", "webshop", "order")):
        return "recharge"
    if any(k in n for k in ("active", "performance", "daily", "monthly", "retention")):
        return "activity"
    if any(k in n for k in ("device", "_ip", "pii", "social", "customer", "login_channel")):
        return "mapping"
    if any(k in n for k in ("user", "master", "profile", "tier", "provider", "client", "map")):
        return "profile"
    return "other"


def parse_member(m):
    """Normalize a dimension/measure entry to the keys the viewer needs."""
    return {
        "name": m.get("name", ""),
        "type": m.get("type", ""),
        "description": squash(m.get("description")),
        "primaryKey": bool(m.get("primary_key")),
        "public": m.get("public", True) is not False,
    }


def parse_segment(s):
    return {"name": s.get("name", ""), "description": squash(s.get("description"))}


def parse_cube(c):
    name = c.get("name", "")
    dims = [parse_member(d) for d in (c.get("dimensions") or [])]
    measures = [parse_member(m) for m in (c.get("measures") or [])]
    segments = [parse_segment(s) for s in (c.get("segments") or [])]
    pk = next((d["name"] for d in dims if d["primaryKey"]), None)
    joins = []
    for j in c.get("joins") or []:
        target = j.get("name", "")
        joins.append({
            "target": target,
            "relationship": j.get("relationship", ""),
            "keyLabel": parse_key_label(j.get("sql"), name, target),
            "sql": squash(j.get("sql")),
        })
    return {
        "name": name,
        "title": c.get("title", name),
        "description": squash(c.get("description")),
        "sqlTable": c.get("sql_table", ""),
        "cluster": cluster_of(name, joins),
        "primaryKey": pk,
        "joins": joins,
        "dimensions": dims,
        "measures": measures,
        "segments": segments,
    }


def parse_view(v):
    panels = []
    for cb in v.get("cubes") or []:
        jp = cb.get("join_path")
        if isinstance(jp, str):
            panels.append(jp)
        elif isinstance(jp, list):  # multi-hop join paths
            panels.extend(x for x in jp if isinstance(x, str))
    return {
        "name": v.get("name", ""),
        "description": squash(v.get("description")),
        "panels": sorted(set(panels)),
    }


def load_dir(base, key, parser):
    """product -> [parsed items] for every <product>/*.yml under base."""
    out = {}
    if not base.exists():
        return out
    for product_dir in sorted(p for p in base.iterdir() if p.is_dir()):
        items = []
        files = sorted(set(product_dir.glob("*.yml")) | set(product_dir.glob("*.yaml")))
        for f in files:
            doc = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
            for entry in doc.get(key) or []:
                items.append(parser(entry))
        if items:
            out[product_dir.name] = items
    return out


def main():
    cubes_by_product = load_dir(CUBES_DIR, "cubes", parse_cube)
    views_by_product = load_dir(VIEWS_DIR, "views", parse_view)

    products = {}
    for product, cubes in cubes_by_product.items():
        known = {c["name"] for c in cubes}
        # Flag edges whose target cube is absent (helps spot stale joins).
        for c in cubes:
            for j in c["joins"]:
                j["targetMissing"] = j["target"] not in known
        products[product] = {
            "cubes": cubes,
            "views": views_by_product.get(product, []),
        }

    graph = {"products": products}
    payload = json.dumps(graph, ensure_ascii=False, indent=2)
    OUT.write_text(payload, encoding="utf-8")
    # JS wrapper so index.html works on a plain file:// double-click (no server,
    # no fetch/CORS). The viewer reads window.MODEL_GRAPH.
    OUT_JS.write_text(f"window.MODEL_GRAPH = {payload};\n", encoding="utf-8")

    # Console summary
    print(f"Wrote {OUT.relative_to(ROOT)} + {OUT_JS.relative_to(ROOT)}")
    for product, data in products.items():
        cubes = data["cubes"]
        edges = sum(len(c["joins"]) for c in cubes)
        missing = sum(j["targetMissing"] for c in cubes for j in c["joins"])
        print(f"  {product:14s} cubes={len(cubes):3d} joins={edges:3d} "
              f"views={len(data['views']):2d}" + (f"  ⚠ {missing} missing targets" if missing else ""))


if __name__ == "__main__":
    main()
