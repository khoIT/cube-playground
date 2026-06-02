#!/bin/sh
# Strip the `SET SESSION query_max_run_time=...` prepend from Cube's Trino
# driver. The hosted Trino role lacks the SET_SYSTEM_SESSION_PROPERTY
# privilege, so the auto-prepend made every query fail with "Access Denied".
#
# We keep CUBEJS_DB_QUERY_TIMEOUT non-zero so Cube's own QueryQueue kill
# timer still works — only the per-query SET SESSION wire instruction is
# removed.
#
# Remove this patch when the Trino admin grants the privilege.
set -e

PRESTO_DRIVER=/cube/node_modules/@cubejs-backend/prestodb-driver/dist/src/PrestoDriver.js

if [ -f "$PRESTO_DRIVER" ]; then
  sed -i 's|.*query_max_run_time.*|                    session: undefined,|' "$PRESTO_DRIVER"
fi

exec docker-entrypoint.sh "$@"
