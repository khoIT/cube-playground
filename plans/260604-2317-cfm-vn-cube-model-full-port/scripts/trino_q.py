#!/usr/bin/env python3
"""Read-only Trino helper for the cube-model port (verify YAML against live schema).

Creds are read at runtime from ~/.trino-creds (TRINO_HOST/PORT/USER/PASSWORD) with
fallback to cube-dev/.env (CUBEJS_DB_*). Secrets are never printed.

Usage:
  trino_q.py --list <schema>                       # SHOW TABLES
  trino_q.py --describe <schema.table>             # column name + type
  trino_q.py --sample <schema.table> [n]           # first n rows (default 3)
  trino_q.py --maxdate <schema.table> <col>        # freshness: max(col)
  trino_q.py --sql "<raw read-only sql>"           # arbitrary SELECT/SHOW/DESCRIBE
Catalog defaults to game_integration; override with --catalog.
"""
import os
import sys
import re

try:
    import trino
    from trino.auth import BasicAuthentication
except ImportError:
    sys.exit("trino client missing: pip install trino")

CREDS = os.path.expanduser("~/.trino-creds")
ENV = os.path.join(os.path.dirname(__file__), "..", "..", "..", "cube-dev", ".env")


def _parse_kv(path):
    """Parse simple KEY=value files (shell export style). Returns {} if missing."""
    out = {}
    if not os.path.exists(path):
        return out
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            line = re.sub(r"^export\s+", "", line)
            if "=" not in line:
                continue
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def _conn(catalog):
    creds = _parse_kv(CREDS)
    env = _parse_kv(ENV)
    host = creds.get("TRINO_HOST") or env.get("CUBEJS_DB_HOST")
    port = int(creds.get("TRINO_PORT") or env.get("CUBEJS_DB_PORT") or 443)
    user = creds.get("TRINO_USER") or env.get("CUBEJS_DB_USER")
    pwd = creds.get("TRINO_PASSWORD") or env.get("CUBEJS_DB_PASS")
    if not (host and user and pwd):
        sys.exit("missing Trino creds in ~/.trino-creds or cube-dev/.env")
    # TLS when password auth is used (Trino requires https for BasicAuth).
    return trino.dbapi.connect(
        host=host, port=port, user=user,
        http_scheme="https",
        auth=BasicAuthentication(user, pwd),
        catalog=catalog,
        # No session properties — Trino role lacks SET_SYSTEM_SESSION_PROPERTY.
    )


def _run(sql, catalog):
    cur = _conn(catalog).cursor()
    cur.execute(sql)
    rows = cur.fetchall()
    cols = [d[0] for d in cur.description] if cur.description else []
    return cols, rows


def main():
    args = sys.argv[1:]
    catalog = "game_integration"
    if "--catalog" in args:
        i = args.index("--catalog")
        catalog = args[i + 1]
        del args[i:i + 2]
    if not args:
        sys.exit(__doc__)

    cmd = args[0]
    if cmd == "--list":
        cols, rows = _run(f"SHOW TABLES FROM {args[1]}", catalog)
        for r in rows:
            print(r[0])
    elif cmd == "--describe":
        cols, rows = _run(f"DESCRIBE {args[1]}", catalog)
        for r in rows:
            print(f"{r[0]}\t{r[1]}")
    elif cmd == "--sample":
        n = int(args[2]) if len(args) > 2 else 3
        cols, rows = _run(f"SELECT * FROM {args[1]} LIMIT {n}", catalog)
        print("\t".join(cols))
        for r in rows:
            print("\t".join("" if v is None else str(v) for v in r))
    elif cmd == "--maxdate":
        cols, rows = _run(f"SELECT max({args[2]}) AS max_dt, count(*) AS n FROM {args[1]}", catalog)
        print(f"max({args[2]})={rows[0][0]}  rows={rows[0][1]}")
    elif cmd == "--sql":
        cols, rows = _run(args[1], catalog)
        if cols:
            print("\t".join(cols))
        for r in rows:
            print("\t".join("" if v is None else str(v) for v in r))
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
