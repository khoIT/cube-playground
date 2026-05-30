/**
 * dataSource registry writer — resolves the "Cube dataSource is code, not YAML"
 * gap. The playground writes a `datasources.config.json` registry; a one-time-
 * generalized `cube-dev/cube.js` reads it at request time and builds a driver per
 * dataSource. So provisioning a new source = appending a registry entry (config),
 * never editing cube.js (code).
 *
 * SECRET-FREE BY CONSTRUCTION: an entry holds only non-secret coordinates plus a
 * `secretRef` (the connector id). cube.js resolves the actual secret from the
 * operator's environment / a vault export keyed by that ref — NEVER from this
 * file. Anything secret here would be a leak; tests assert it stays out.
 *
 * Atomic write doctrine (`.tmp` → rename), lifted from cube-model-writer.
 */

import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

export interface DataSourceEntry {
  /** Connector id — also the dataSource name Cube cubes reference via data_source. */
  id: string;
  sourceType: string;
  driverType: string;
  workspaceId: string;
  /** Non-secret connection coordinates (host/port/user/catalog/ssl/...). */
  config: Record<string, unknown>;
  /** Reference cube.js uses to fetch the secret from env/vault export. */
  secretRef: string;
}

const FILENAME = 'datasources.config.json';

function registryPath(): string {
  return process.env.DATASOURCES_CONFIG_PATH ?? join(process.cwd(), FILENAME);
}

/** Read the current registry. Tolerant of a missing/corrupt file (returns []). */
export function readRegistry(): DataSourceEntry[] {
  const path = registryPath();
  if (!existsSync(path)) return [];
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    const list = Array.isArray(raw)
      ? raw
      : (raw as { dataSources?: unknown[] }).dataSources ?? [];
    return list.filter((e): e is DataSourceEntry => !!e && typeof (e as DataSourceEntry).id === 'string');
  } catch {
    return [];
  }
}

/** Strip any secret-looking key defensively — the entry must be config-only. */
function sanitize(entry: DataSourceEntry): DataSourceEntry {
  const config: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(entry.config)) {
    if (/pass|secret|key|token|credential/i.test(k)) continue; // never persist secrets
    config[k] = v;
  }
  return { ...entry, config };
}

/**
 * Upsert a dataSource entry by id and atomically rewrite the registry. Idempotent
 * — re-provisioning the same id replaces its entry in place. Returns the written list.
 */
export function upsertDataSource(entry: DataSourceEntry): DataSourceEntry[] {
  const safe = sanitize(entry);
  const next = readRegistry().filter((e) => e.id !== safe.id);
  next.push(safe);

  const path = registryPath();
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify({ dataSources: next }, null, 2), 'utf8');
  renameSync(tmp, path);
  return next;
}

/** Remove a dataSource entry (connector disabled/removed). */
export function removeDataSource(id: string): DataSourceEntry[] {
  const next = readRegistry().filter((e) => e.id !== id);
  const path = registryPath();
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify({ dataSources: next }, null, 2), 'utf8');
  renameSync(tmp, path);
  return next;
}
