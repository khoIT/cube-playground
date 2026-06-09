#!/usr/bin/env python3
"""Probe live pre-aggregation routing for each game against the dev cube API.

For every kept seed query (chat-service/seed/starter-verification-report.json)
this mints a per-game admin JWT, asks cube-api-dev for the COMPILED SQL
(/cubejs-api/v1/sql), and inspects the FROM/JOIN clause:

  - `prod_pre_aggregations.*` in the FROM  -> ROUTED (served by a rollup)
  - only the raw std_/mf_/map_ table name   -> SOURCE (hits Trino live)

rollup_lambda always unions source, so `usedPreAggregations` reads [] even when
routed; the compiled SQL is the only reliable routing signal. A lambda compiles
to pure source until at least one partition seals in the queried date range.

Usage:
  probe-preagg-routing.py [game ...]      # default: all games in the report
Env:
  CUBE_HOST (default http://localhost:4000)
  CUBE_SECRET (default local dev secret)
"""
import base64
import hashlib
import hmac
import json
import os
import re
import sys
import time
import urllib.request

HOST = os.environ.get("CUBE_HOST", "http://localhost:4000")
SECRET = os.environ.get("CUBE_SECRET", "local-dev-secret-change-me-in-prod-please-32chars")
REPORT = os.path.join(os.path.dirname(__file__), "..", "..",
                      "chat-service", "seed", "starter-verification-report.json")


def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def mint_jwt(game: str) -> str:
    header = b64url(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    payload = b64url(json.dumps({
        "userId": "khoitn@vng.com.vn",
        "game": game,
        "allowedGames": [game],
        "roles": ["admin"],
        "iat": int(time.time()),
        "exp": int(time.time()) + 3600,
    }).encode())
    signing = f"{header}.{payload}".encode()
    sig = b64url(hmac.new(SECRET.encode(), signing, hashlib.sha256).digest())
    return f"{header}.{payload}.{sig}"


def get_sql(token: str, query: dict):
    body = json.dumps({"query": query}).encode()
    req = urllib.request.Request(
        f"{HOST}/cubejs-api/v1/sql", data=body, method="POST",
        headers={"Authorization": token, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return {"error": f"HTTP {e.code}: {e.read().decode()[:160]}"}
    except Exception as e:  # noqa
        return {"error": str(e)[:160]}


def classify(sql_text: str) -> str:
    if "prod_pre_aggregations" in sql_text:
        return "ROUTED"
    return "SOURCE"


def main():
    report = json.load(open(REPORT))
    games = sys.argv[1:] or list(report["games"].keys())
    print(f"host={HOST}  workspace={report.get('workspace')}\n")
    grand = {}
    for game in games:
        if game not in report["games"]:
            print(f"!! {game}: not in report")
            continue
        token = mint_jwt(game)
        entries = [e for e in report["games"][game]["entries"] if e.get("kept")]
        routed = source = err = 0
        details = []
        for e in entries:
            res = get_sql(token, e["query"])
            if "error" in res:
                err += 1
                details.append(("ERR ", e["questionId"], res["error"]))
                continue
            sql_arr = res.get("sql", {}).get("sql", ["", []])
            sql_text = sql_arr[0] if isinstance(sql_arr, list) else str(sql_arr)
            verdict = classify(sql_text)
            if verdict == "ROUTED":
                routed += 1
            else:
                source += 1
            m = re.search(r"prod_pre_aggregations\.(\w+)", sql_text)
            details.append((verdict, e["questionId"], m.group(1) if m else ""))
        grand[game] = (routed, source, err, len(entries))
        print(f"=== {game}: {routed}/{len(entries)} ROUTED  "
              f"({source} source, {err} err) ===")
        for v, qid, extra in details:
            tag = {"ROUTED": "✓", "SOURCE": "·", "ERR ": "✗"}[v]
            print(f"  {tag} {qid:<34} {extra}")
        print()
    print("SUMMARY  game            routed/total")
    for g, (r, s, e, n) in grand.items():
        print(f"         {g:<14} {r:>2}/{n}" + (f"  ({e} err)" if e else ""))


if __name__ == "__main__":
    main()
