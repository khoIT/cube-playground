#!/usr/bin/env python3
"""Final scoped generator (phase-split).
- Phase 03 eval bank: asked + glossary-NL (cfm_vn) + headline-catalog subset.
- Phase 02 audit targets: ALL public measures (programmatic, no LLM)."""
import json, os, sqlite3
import yaml

ROOT = "/Users/lap16299/Documents/code/cube-playground"
OUT = "/private/tmp/claude-501/-Users-lap16299-Documents-code-cube-playground/32d005f8-cd19-453c-9f65-af011418db30/scratchpad"
GAME_DIR = {"cfm_vn": "cfm", "jus_vn": "jus"}

# Reporting cubes whose measures are NL-natural ("headline"). Other cubes
# (etl_*, prop/garden/npc economy, ips/devices) stay audit-only.
HEADLINE_CUBES = {
    "game_key_metrics", "recharge", "active_daily", "mf_users",
    "new_user_retention", "retention", "ccu", "role_active_daily",
    "user_recharge_daily", "billing_detail",
}
VI_TOP = {"revenue", "dau", "arpu", "arppu", "arpdau", "ltv", "retention",
          "paying users", "whale", "wau", "mau"}
SHAPES = [("show {q} last 7 days", "trend"), ("{q} this month", "aggregate"),
          ("compare {q} month over month", "compare"), ("{q} by platform", "breakdown")]


def all_measures(game):
    d = os.path.join(ROOT, "cube-dev/cube/model/cubes", GAME_DIR[game])
    out = []
    for fn in sorted(os.listdir(d)):
        if not fn.endswith(".yml"):
            continue
        doc = yaml.safe_load(open(os.path.join(d, fn)).read()) or {}
        for cube in (doc.get("cubes") or []):
            cn = cube.get("name")
            for m in (cube.get("measures") or []):
                if cn and m.get("name") and m.get("public", True) is not False:
                    out.append({"cube": cn, "measure": m["name"], "ref": f"{cn}.{m['name']}",
                                "type": m.get("type"), "headline": cn in HEADLINE_CUBES})
    return out


def cfm_glossary():
    f = os.path.join(ROOT, "chat-service/test/metric-resolution-eval/cfm-vn-glossary-snapshot.json")
    out = []
    for t in json.load(open(f)).get("terms", []):
        ref = t.get("measureRef") or ("ratio" if t.get("ratioRef") else None)
        if ref:
            out.append({"label": t["label"], "ref": ref,
                        "kind": "ratio" if ref == "ratio" else "measure",
                        "labelVi": t.get("labelVi")})
    return out


def asked(game):
    db = os.path.join(ROOT, "chat-service/runtime/chat.db")
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    rows = con.execute(
        """SELECT lower(trim(t.user_text)) q, count(*) n
           FROM chat_turns t JOIN chat_sessions s ON t.session_id=s.id
           WHERE t.role='user' AND s.game_id=? AND length(trim(t.user_text))>3
           GROUP BY q ORDER BY n DESC""", (game,)).fetchall()
    con.close()
    return rows


def synth(label, ref, kind, source):
    cs = []
    for tmpl, shape in SHAPES:
        cs.append({"question": tmpl.format(q=label), "expectedRef": ref,
                   "expectedKind": kind, "queryShapeClass": shape, "source": source, "weight": 1})
    return cs


digest = {}
for game in ("cfm_vn", "jus_vn"):
    meas = all_measures(game)
    headline = [m for m in meas if m["headline"]]
    gloss = cfm_glossary() if game == "cfm_vn" else []
    gloss_refs = {g["ref"] for g in gloss}

    cases = []
    # glossary-NL (cfm_vn only offline; jus needs live resolve)
    for g in gloss:
        cases += synth(g["label"], g["ref"], g["kind"], "synthesized-glossary")
        if g["label"].lower() in VI_TOP and g.get("labelVi"):
            cases.append({"question": f"{g['labelVi']} tháng này", "expectedRef": g["ref"],
                          "expectedKind": g["kind"], "queryShapeClass": "aggregate",
                          "source": "synthesized-glossary-vi", "weight": 1})
    # NOTE: raw/headline catalog measures are covered by Phase 02 (programmatic
    # audit of ALL measures, no LLM). They are intentionally NOT synthesized as
    # NL eval cases — auto-generated cube-ref strings (active_daily.rows,
    # trailing_wau, ...) are degenerate phrasings that waste eval tokens.
    # asked (golden ref unknown -> null, loose score)
    for q, n in asked(game):
        cases.append({"question": q, "expectedRef": None, "expectedKind": "unknown",
                      "queryShapeClass": "asked", "source": "asked", "weight": n})

    json.dump({"gameId": game, "cases": cases},
              open(os.path.join(OUT, f"{game}-eval-bank.json"), "w"), indent=1, ensure_ascii=False)
    json.dump({"gameId": game, "measures": meas},
              open(os.path.join(OUT, f"{game}-audit-targets.json"), "w"), indent=1, ensure_ascii=False)
    digest[game] = {
        "PHASE02_audit_targets_all_measures": len(meas),
        "headline_cubes_measures": len(headline),
        "PHASE03_eval_glossary_nl": sum(1 for c in cases if c["source"].startswith("synthesized-glossary")),
        "PHASE03_eval_catalog_headline_nl": sum(1 for c in cases if c["source"] == "synthesized-catalog-headline"),
        "PHASE03_eval_asked_distinct": sum(1 for c in cases if c["source"] == "asked"),
        "PHASE03_eval_total_cases": len(cases),
    }

print(json.dumps(digest, indent=2))
