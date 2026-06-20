#!/usr/bin/env python3
"""Guardrail: assert mf_users segment/composition query shapes route to a rollup.

Runs the canonical segment-sizing shapes (churn_risk / engagement_segment
group-bys + segment-scoped cards) through the dev cube's compiled-SQL endpoint
(/cubejs-api/v1/sql) for every game carrying mf_users, and asserts each matches
an `external:true` pre-aggregation. A model edit that drops a dimension/segment
from the composition rollup (or otherwise breaks coverage) flips a shape to
SOURCE and this exits non-zero — catching the regression before it ships.

Routing is read from the compiled SQL (usedPreAggregations + external), NOT from
usedPreAggregations alone — the gold-standard signal. Build state is irrelevant:
this checks the PLAN matches a rollup, which is true as soon as the model compiles.

Usage:  check-mf-users-rollup-coverage.py [game ...]    # default: all 8
Env:    CUBE_HOST   (default http://localhost:4000)
        CUBE_SECRET (default local dev secret)
Exit:   0 = every expected shape routes; 1 = at least one MISS/ERR.
"""
import base64, hashlib, hmac, json, os, sys, time, urllib.request, urllib.error

HOST = os.environ.get("CUBE_HOST", "http://localhost:4000")
SECRET = os.environ.get("CUBE_SECRET", "local-dev-secret-change-me-in-prod-please-32chars")

# game-id used for the JWT  ->  which recency/engagement case-dims that game has.
# (churn_risk / engagement_segment are per-game: not every mf_users defines both.)
GAMES = {
    "ballistar": {"churn"}, "cfm_vn": {"churn", "eng"}, "cros": {"eng"},
    "jus_vn": {"churn"}, "muaw": {"churn"}, "ptg": {"churn", "eng"},
    "pubg": {"churn"}, "tf": {"eng"},
}


def b64url(raw): return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def mint(game):
    h = b64url(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    p = b64url(json.dumps({
        "userId": "rollup-guardrail", "game": game, "allowedGames": [game],
        "roles": ["admin"], "iat": int(time.time()), "exp": int(time.time()) + 600,
    }).encode())
    sig = b64url(hmac.new(SECRET.encode(), f"{h}.{p}".encode(), hashlib.sha256).digest())
    return f"{h}.{p}.{sig}"


def compiled_sql(token, query):
    body = json.dumps({"query": query}).encode()
    req = urllib.request.Request(f"{HOST}/cubejs-api/v1/sql", data=body, method="POST",
                                 headers={"Authorization": token, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return {"error": f"HTTP {e.code}: {e.read().decode()[:160]}"}
    except Exception as e:  # noqa
        return {"error": str(e)[:160]}


def shapes(caps):
    """Canonical segment-sizing shapes that MUST route to the composition rollup."""
    out = {}
    if "churn" in caps:
        out["churn_risk group-by"] = {
            "measures": ["mf_users.user_count_approx", "mf_users.ltv_total_vnd"],
            "dimensions": ["mf_users.churn_risk"]}
    if "eng" in caps:
        out["engagement_segment group-by"] = {
            "measures": ["mf_users.user_count_approx", "mf_users.ltv_total_vnd"],
            "dimensions": ["mf_users.engagement_segment"]}
    out["lifecycle x whales segment"] = {
        "measures": ["mf_users.user_count_approx"],
        "dimensions": ["mf_users.lifecycle_stage"], "segments": ["mf_users.whales"]}
    out["lifecycle x at_risk segment"] = {
        "measures": ["mf_users.user_count_approx"],
        "dimensions": ["mf_users.lifecycle_stage"], "segments": ["mf_users.at_risk_paying"]}
    out["lifecycle x paying segment"] = {
        "measures": ["mf_users.user_count_approx"],
        "dimensions": ["mf_users.lifecycle_stage"], "segments": ["mf_users.paying_lifetime"]}
    # Exercise the 30d-LTV sum + approx-paying measures so dropping either from
    # the rollup is caught. lifecycle_stage lives only in the composition rollup,
    # so this can only match it — never the install-cohort rollup.
    out["lifecycle x 30d-ltv + paying"] = {
        "measures": ["mf_users.ltv_30d_total_vnd", "mf_users.paying_users_approx"],
        "dimensions": ["mf_users.lifecycle_stage"]}
    return out


def routed(res):
    # HIT only if the query matches the COMPOSITION rollup specifically (external),
    # not merely any external pre-agg — otherwise a shape silently mis-routing to
    # the install-cohort rollup would pass. Every shape above uses a member that
    # exists only in user_composition_batch, so this assertion can't false-alarm.
    used = res.get("sql", {}).get("preAggregations") or []
    names = [u.get("preAggregationId") for u in used]
    ok = (bool(used)
          and all(u.get("external") for u in used)
          and any("user_composition" in (n or "") for n in names))
    return ok, names


def main():
    games = sys.argv[1:] or list(GAMES.keys())
    fails = 0
    for g in games:
        caps = GAMES.get(g)
        if caps is None:
            print(f"!! {g}: not a known mf_users game"); fails += 1; continue
        token = mint(g)
        print(f"== {g} ==")
        for label, q in shapes(caps).items():
            res = compiled_sql(token, q)
            if "error" in res:
                print(f"   ERR  {label}: {res['error']}"); fails += 1; continue
            ok, names = routed(res)
            if ok:
                print(f"   HIT  {label}")
            else:
                print(f"   MISS {label}  (routed to {names or 'raw source'})"); fails += 1
    print(f"\n{'FAIL' if fails else 'PASS'}: {fails} uncovered shape(s)")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
