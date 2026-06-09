#!/usr/bin/env python3
"""Transform a kraken game-tenant YAML (prefixed, schema-qualified) into a local
bare-named YAML. Text-level regex passes — preserves comments/anchors/formatting.

Rules (game `<g>` in {cfm,cros,tf}; schema = cfm_vn|cros|tf):
  1. `name: <g>_<x>`        -> `name: <x>`         (cube + view names; bare dim/measure names untouched)
  2. `join_path: <g>_<x>`   -> `join_path: <x>`
  3. `{<g>_<cube>}`         -> `{<cube>}`          (join/measure SQL refs)
  4. `sql_table: <schema>.<table>` -> `sql_table: <table>`  (schema injected per-tenant)
  5. `<schema>.<table>` inside `sql:` FROM/JOIN -> `<table>`  (bare; schema injected)
Idempotent. Reads stdin, writes stdout.

Usage: bare_rename.py --game <cfm|cros|tf>
"""
import re
import sys

GAME_SCHEMA = {"cfm": "cfm_vn", "cros": "cros", "tf": "tf"}


def transform(text, game, schema):
    g = re.escape(game)
    sch = re.escape(schema)
    # 1. names: only strip when token starts with `<g>_`
    text = re.sub(rf"(\bname:\s*){g}_", r"\1", text)
    # 2. join_path
    text = re.sub(rf"(\bjoin_path:\s*){g}_", r"\1", text)
    # 3. {<g>_cube} brace refs
    text = re.sub(rf"\{{{g}_", "{", text)
    # 4. sql_table: schema.table -> table  (also handles quoted)
    text = re.sub(rf'(\bsql_table:\s*["\']?){sch}\.', r"\1", text)
    # 5. schema-qualified table refs inside raw SQL bodies (FROM/JOIN <schema>.<t>)
    text = re.sub(rf"\b{sch}\.([A-Za-z_][A-Za-z0-9_]*)", r"\1", text)
    return text


def main():
    if "--game" not in sys.argv:
        sys.exit(__doc__)
    game = sys.argv[sys.argv.index("--game") + 1]
    if game not in GAME_SCHEMA:
        sys.exit(f"unknown game {game!r}; expected cfm/cros/tf")
    sys.stdout.write(transform(sys.stdin.read(), game, GAME_SCHEMA[game]))


if __name__ == "__main__":
    main()
