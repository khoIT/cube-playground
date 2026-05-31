/**
 * Bootstrap-seed: materialize the env-only Trino connection (`TRINO_PROFILER_*`)
 * into an editable DB row so ballistar's connection can be edited from the UI
 * without re-typing credentials.
 *
 * Runs once at startup. Guarded so it never crashes boot:
 *  - no `TRINO_PROFILER_HOST`  → nothing to seed.
 *  - no usable vault key        → DEGRADE: leave the read-only env seed in place
 *                                 (the env/file bootstrap path still serves it).
 *  - row already present        → idempotent no-op (re-seeding would clobber an
 *                                 edit). `getConnectorMeta` matches any status,
 *                                 so a disabled seed is also left alone.
 *
 * Once seeded, the DB row is authoritative (DB wins over env in
 * `trino-profiler-config.listConnectors`/`getConnector`).
 */

import { isVaultConfigured } from './connector-secret-vault.js';
import { getConnectorMeta, createConnector } from './connector-store.js';

/** Id of the env-seeded default connector (must match `envDefaultConnector`). */
export const ENV_CONNECTOR_ID = 'game_integration';

export interface BootstrapSeedResult {
  seeded: boolean;
  reason: string;
}

export function seedEnvConnectorIntoDb(ts?: string): BootstrapSeedResult {
  const host = process.env.TRINO_PROFILER_HOST;
  if (!host) return { seeded: false, reason: 'no TRINO_PROFILER_HOST' };
  if (!isVaultConfigured()) {
    return { seeded: false, reason: 'no CONNECTOR_SECRET_KEY — degrade to read-only env seed' };
  }
  if (getConnectorMeta(ENV_CONNECTOR_ID)) {
    return { seeded: false, reason: 'already present' };
  }

  createConnector(
    {
      id: ENV_CONNECTOR_ID,
      workspaceId: process.env.TRINO_PROFILER_WORKSPACE ?? 'local',
      sourceType: 'trino',
      label: 'Game Integration (Trino)',
      config: {
        host,
        port: Number(process.env.TRINO_PROFILER_PORT ?? 443),
        user: process.env.TRINO_PROFILER_USER ?? 'playground',
        catalog: process.env.TRINO_PROFILER_CATALOG ?? 'game_integration',
        ssl: (process.env.TRINO_PROFILER_SSL ?? 'true') !== 'false',
      },
      secret: process.env.TRINO_PROFILER_PASS ?? '',
    },
    ts,
  );
  return { seeded: true, reason: 'env connector materialized as editable DB row' };
}
