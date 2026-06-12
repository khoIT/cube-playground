#!/usr/bin/env python3
"""Generate curated per-product layout positions → layouts.json + layouts.js.

Unlike gen_model_graph.py (which *derives* the graph from YAML), this holds
*curated* coordinates: cube boxes are arranged by cluster on a conceptual grid so
the diagram reads clearly — hub centered, session above, behavior to the right,
recharge / activity / identity around it — mirroring cfm_data_model.svg.

The viewer loads `window.LAYOUTS` from layouts.js and prefers it over dagre
auto-layout. A browser's own drags (Save button) live in localStorage and
override this. Re-run after the cube set changes:  python3 gen_layouts.py
"""
import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
GRAPH = json.loads((HERE / "model-graph.json").read_text(encoding="utf-8"))

NODE_W, NODE_H = 230, 42      # name-only boxes — short
GAP = 26                      # spacing between cubes inside one cluster
COL_GAP, ROW_GAP = 120, 110   # spacing between cluster blocks (room for box + label + edges)

# Conceptual (col, row) placement of each cluster. Hub at the centre with the
# event/recharge/identity clusters arranged around it, like the SVG.
DEFAULT_ANCHORS = {
    "session":  (1, 0),   # session events — above the hub
    "other":    (0, 0),   # misc — top-left
    "activity": (0, 1),   # activity snapshots — left
    "hub":      (1, 1),   # user hub — centre
    "profile":  (1, 1),   # profile (hub stand-in for products without mf_users)
    "behavior": (2, 1),   # behaviour-log events — right
    "mapping":  (0, 2),   # identity mapping — bottom-left
    "bridge":   (1, 2),   # role bridge — below the hub
    "recharge": (2, 2),   # recharge / monetization — bottom-right
}

# Per-product overrides, filled in after visually checking each product.
PER_PRODUCT = {}


def grid_dims(n):
    cols = max(1, int(math.ceil(math.sqrt(n))))
    return cols, int(math.ceil(n / cols))


def block_size(n):
    cols, rows = grid_dims(n)
    return cols * NODE_W + (cols - 1) * GAP, rows * NODE_H + (rows - 1) * GAP


def layout_product(product, data):
    by_cluster = {}
    for c in data["cubes"]:
        by_cluster.setdefault(c["cluster"], []).append(c["name"])

    anchors = dict(DEFAULT_ANCHORS)
    anchors.update(PER_PRODUCT.get(product, {}))
    placed = {cl: anchors.get(cl, (0, 0)) for cl in by_cluster}
    sizes = {cl: block_size(len(names)) for cl, names in by_cluster.items()}

    cols = sorted({c for c, _ in placed.values()})
    rows = sorted({r for _, r in placed.values()})
    col_w = {c: 0 for c in cols}
    row_h = {r: 0 for r in rows}
    for cl, (c, r) in placed.items():
        col_w[c] = max(col_w[c], sizes[cl][0])
        row_h[r] = max(row_h[r], sizes[cl][1])

    col_x, x = {}, 0
    for c in cols:
        col_x[c] = x
        x += col_w[c] + COL_GAP
    row_y, y = {}, 0
    for r in rows:
        row_y[r] = y
        y += row_h[r] + ROW_GAP

    pos = {}
    for cl, names in by_cluster.items():
        c, r = placed[cl]
        cgrid, _ = grid_dims(len(names))
        bw, bh = sizes[cl]
        ox = col_x[c] + (col_w[c] - bw) / 2   # centre the block in its grid cell
        oy = row_y[r] + (row_h[r] - bh) / 2
        for i, name in enumerate(names):
            pos[name] = {"x": round(ox + (i % cgrid) * (NODE_W + GAP)),
                         "y": round(oy + (i // cgrid) * (NODE_H + GAP))}
    return pos


def main():
    layouts = {p: layout_product(p, d) for p, d in GRAPH["products"].items()}
    payload = json.dumps(layouts, ensure_ascii=False, indent=2)
    (HERE / "layouts.json").write_text(payload, encoding="utf-8")
    (HERE / "layouts.js").write_text("window.LAYOUTS = " + payload + ";\n", encoding="utf-8")
    for p, pos in layouts.items():
        print(f"  {p:14s} {len(pos)} cubes positioned")
    print("Wrote layouts.json + layouts.js")


if __name__ == "__main__":
    main()
