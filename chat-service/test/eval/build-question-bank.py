#!/usr/bin/env python3
"""Question-bank generator for the answer-quality eval (Phase 03).

Emits per-game corpus JSON in the EvalCorpus/EvalCase schema (types.ts) from:
  - ASKED: real questions mined from chat.db (game-scoped, frequency-weighted)
  - SYNTHESIZED-GLOSSARY: certified glossary terms x shapes x locale (golden ref)

Raw/headline catalog measures are intentionally NOT synthesized as NL cases —
full measure coverage belongs to the programmatic correctness audit (Phase 02),
not the LLM eval. See the plan's phase-01 doc.

Usage:  python3 chat-service/test/eval/build-question-bank.py
Output: chat-service/test/eval/<game>-question-bank.json
"""
import json, os, sqlite3
import yaml

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
EVAL_DIR = os.path.join(ROOT, "chat-service/test/eval")
GLOSSARY_SNAPSHOT = os.path.join(
    ROOT, "chat-service/test/metric-resolution-eval/cfm-vn-glossary-snapshot.json")
CHAT_DB = os.path.join(ROOT, "chat-service/runtime/chat.db")

# Per-game offline glossary snapshots (game_id -> snapshot path). cfm_vn has a
# frozen snapshot; other games resolve their glossary at runtime, so their
# glossary-NL cases are added by a live-resolve pass, not here.
GLOSSARY_BY_GAME = {"cfm_vn": GLOSSARY_SNAPSHOT}

VI_TOP = {"revenue", "dau", "arpu", "arppu", "arpdau", "ltv", "retention",
          "paying users", "whale", "wau", "mau"}

# (template, queryShapeClass) — shapeClass restricted to the types.ts enum.
SHAPES = [
    ("show {q} last 7 days", "trend"),
    ("{q} this month", "aggregate"),
    ("compare {q} month over month", "compare"),
    ("{q} by platform", "aggregate"),  # breakdown collapses to aggregate enum
]


def glossary_terms(game):
    path = GLOSSARY_BY_GAME.get(game)
    if not path or not os.path.exists(path):
        return []
    out = []
    for t in json.load(open(path)).get("terms", []):
        ref = t.get("measureRef")
        kind = "measure"
        if not ref and t.get("ratioRef"):
            ref, kind = "ratio", "ratio"
        if ref:
            out.append({"label": t["label"], "ref": ref, "kind": kind,
                        "metricId": t.get("id"), "labelVi": t.get("labelVi")})
    return out


def asked(game):
    con = sqlite3.connect(f"file:{CHAT_DB}?mode=ro", uri=True)
    rows = con.execute(
        """SELECT lower(trim(t.user_text)) q, count(*) n
           FROM chat_turns t JOIN chat_sessions s ON t.session_id = s.id
           WHERE t.role='user' AND s.game_id=? AND length(trim(t.user_text))>3
           GROUP BY q ORDER BY n DESC""", (game,)).fetchall()
    con.close()
    return rows


def cube_of(ref):
    return ref.split(".")[0] if ref and ref != "ratio" else None


def build(game):
    cases = []
    n = 0
    for g in glossary_terms(game):
        for tmpl, shape in SHAPES:
            n += 1
            cases.append({
                "id": f"gloss-{n}", "question": tmpl.format(q=g["label"]),
                "expectedMetricId": g["metricId"],
                "expectedRef": None if g["ref"] == "ratio" else g["ref"],
                "expectedCube": cube_of(g["ref"]),
                "queryShapeClass": shape, "curationGroup": "synthesized-glossary",
                "note": f"weight=1 kind={g['kind']}",
            })
        if g["label"].lower() in VI_TOP and g.get("labelVi"):
            n += 1
            cases.append({
                "id": f"gloss-vi-{n}", "question": f"{g['labelVi']} tháng này",
                "expectedMetricId": g["metricId"],
                "expectedRef": None if g["ref"] == "ratio" else g["ref"],
                "expectedCube": cube_of(g["ref"]), "queryShapeClass": "aggregate",
                "curationGroup": "synthesized-glossary-vi", "note": "weight=1 locale=vi",
            })
    for i, (q, freq) in enumerate(asked(game)):
        cases.append({
            "id": f"asked-{i+1}", "question": q,
            "expectedMetricId": None, "expectedRef": None, "expectedCube": None,
            "queryShapeClass": None, "curationGroup": "asked",
            "note": f"weight={freq} (golden ref unknown — loose score)",
        })
    return cases


def main():
    os.makedirs(EVAL_DIR, exist_ok=True)
    for game in ("cfm_vn", "jus_vn"):
        cases = build(game)
        corpus = {
            "_comment": f"{game} answer-quality eval bank: asked (chat.db) + "
                        "synthesized-glossary. Catalog coverage is Phase 02, not here.",
            "capturedAt": "2026-06-22T00:00:00.000Z",
            "gameId": game, "cases": cases,
        }
        out = os.path.join(EVAL_DIR, f"{game}-question-bank.json")
        json.dump(corpus, open(out, "w"), indent=2, ensure_ascii=False)
        groups = {}
        for c in cases:
            groups[c["curationGroup"]] = groups.get(c["curationGroup"], 0) + 1
        print(f"{game}: {len(cases)} cases {groups} -> {out}")


if __name__ == "__main__":
    main()
