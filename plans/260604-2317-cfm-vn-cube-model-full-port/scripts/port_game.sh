#!/usr/bin/env bash
# Port one game tenant's cubes + views from kraken → local cube-dev (bare-named).
# Usage: port_game.sh <game cfm|cros|tf> <kraken-dir cfm_vn|cros|tf>
set -euo pipefail
GAME="${1:?game}"; KDIR="${2:?kraken dir}"
HERE="$(cd "$(dirname "$0")" && pwd)"
PY="$HOME/.claude/skills/.venv/bin/python3"
LOCAL="/Users/lap16299/Documents/code/cube-playground/cube-dev/cube/model"
TOKEN="$(git -C /Users/lap16299/Documents/code/cube-dev-old remote -v 2>/dev/null | grep -oE 'glpat-[A-Za-z0-9_-]+' | head -1)"
HOST="https://gitlab.gds.vng.vn"; PROJ="kraken%2Fcube"

list_tree() { # $1 = repo path
  local enc; enc="$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$1")"
  curl -s --max-time 30 -H "PRIVATE-TOKEN: $TOKEN" \
    "$HOST/api/v4/projects/$PROJ/repository/tree?path=$enc&ref=main&per_page=100" \
    | python3 -c "import json,sys;[print(x['name']) for x in json.load(sys.stdin) if x['type']=='blob']"
}

port_dir() { # $1 = kraken subpath (cubes|views), $2 = local subdir
  local sub="$1" localsub="$2"
  mkdir -p "$LOCAL/$localsub/$GAME"
  for f in $(list_tree "cube/model/$sub/$KDIR"); do
    bash "$HERE/fetch_kraken.sh" "cube/model/$sub/$KDIR/$f" \
      | "$PY" "$HERE/bare_rename.py" --game "$GAME" > "$LOCAL/$localsub/$GAME/$f"
    echo "  wrote $localsub/$GAME/$f"
  done
}

echo "== porting $GAME (kraken $KDIR) =="
echo "- cubes:"; port_dir cubes cubes
echo "- views:"; port_dir views views
echo "done $GAME"
