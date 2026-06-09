#!/usr/bin/env bash
# Fetch a file from the upstream kraken/cube GitLab repo (raw). Token is read at
# runtime from the cube-dev-old git remote — never hardcoded/printed.
# Usage: fetch_kraken.sh <repo-relative-path>   e.g. cube/model/cubes/cfm_vn/user_roles.yml
set -euo pipefail
PATH_IN="${1:?usage: fetch_kraken.sh <repo-path>}"
TOKEN="$(git -C /Users/lap16299/Documents/code/cube-dev-old remote -v 2>/dev/null | grep -oE 'glpat-[A-Za-z0-9_-]+' | head -1)"
[ -n "$TOKEN" ] || { echo "no glpat token in cube-dev-old remote" >&2; exit 1; }
HOST="https://gitlab.gds.vng.vn"; PROJ="kraken%2Fcube"
ENC="$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$PATH_IN")"
curl -s --fail --max-time 30 -H "PRIVATE-TOKEN: $TOKEN" "$HOST/api/v4/projects/$PROJ/repository/files/$ENC/raw?ref=main"
