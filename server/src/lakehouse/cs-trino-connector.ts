/**
 * Resolve a Trino connector for the read-only CS / lakehouse readers.
 *
 * Local dev configures the onboarding *profiler* connector (TRINO_PROFILER_* /
 * connectors.config.json / DB-stored), so getConnector() resolves there. Prod
 * does NOT set the profiler env — but it always sets CUBEJS_DB_* for Cube, which
 * targets the same Trino coordinator. The CS tables are fully qualified
 * (`iceberg.cs_ticket.*`), so the session catalog is moot and either connector
 * runs the query. Falling back to the Cube connector gives the Care tab the same
 * behavior on prod as on local without a separate per-env config — features just
 * work when pushed.
 */

import { getConnector, type Connector } from '../services/trino-profiler-config.js';
import { lakehouseConnectorFromEnv } from './lakehouse-trino-connector.js';

/**
 * Profiler connector first (local), else the Cube connector from CUBEJS_DB_*
 * (prod). Returns null only when neither is configured. Never throws — the
 * lakehouse builder throws when CUBEJS_DB_HOST is unset, so we swallow that and
 * let callers raise their own "not configured" error.
 */
export function resolveCsTrinoConnector(): Connector | null {
  const profiler = getConnector();
  if (profiler) return profiler;
  try {
    return lakehouseConnectorFromEnv();
  } catch {
    return null;
  }
}
