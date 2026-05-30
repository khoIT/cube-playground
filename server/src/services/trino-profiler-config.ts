/**
 * Trino connector configuration for the onboarding profiler.
 *
 * A *connector* is a warehouse connection profile (creds + catalog) — the new
 * entity nested under a workspace (`workspace → connector → dataset → tables`).
 * This is DISTINCT from `workspaces.config.json`, which defines Cube *endpoints*.
 *
 * Source of truth, in priority order:
 *   1. `connectors.config.json` (optional, gitignored) — additional connectors.
 *   2. Env-seeded default connector (`TRINO_PROFILER_*`) for `game_integration`.
 *
 * Secrets (user/password) never leave the server: `listConnectors()` returns a
 * redacted projection; `getConnector(id)` (creds included) is server-only.
 *
 * The profiler is disabled (reports "not configured") unless at least one
 * connector resolves a host — this is the only place the credential-free
 * playground design is knowingly relaxed, and it stays gated here.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { listStoredMeta, getStoredConnector, type ConnectorMeta } from './connector-store.js';

/**
 * Per-game Trino schema map, copied from `cube-dev/cube/cube.js` (catalog
 * `game_integration`). Copied — NOT imported — so the playground never depends
 * on the sibling repo at runtime. Keep in sync if cube-dev's map grows.
 */
export const GAME_SCHEMA: Record<string, string> = {
  ballistar: 'ballistar_vn',
  cfm: 'cfm_vn',
  ptg: 'ptg',
  jus: 'jus_vn',
  muaw: 'muaw',
  pubg: 'pubgm',
};

// Bounded-cost guards — every profiling query is capped by these.
export const PROFILER_CAPS = {
  /** Skip profiling tables wider than this (cost guard). */
  maxColumnsPerTable: 80,
  /** Distinct sample-value cap per column. */
  sampleDistinctLimit: 8,
  /** Per-statement timeout. */
  statementTimeoutMs: 20_000,
  /** Uniqueness tolerance: approxDistinct/rowCount ≥ this ⇒ isUnique. */
  uniqueRatio: 0.98,
} as const;

const ConnectorSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  /** Workspace this connector belongs to (hierarchy: workspace ⊃ connectors). */
  workspaceId: z.string().min(1).default('local'),
  /** Drives driver + introspection dispatch (trino, postgres, bigquery, …). */
  sourceType: z.string().min(1).default('trino'),
  host: z.string().min(1),
  port: z.coerce.number().int().positive().default(443),
  user: z.string().min(1),
  password: z.string().default(''),
  catalog: z.string().min(1).default('game_integration'),
  ssl: z.coerce.boolean().default(true),
});

export type Connector = z.infer<typeof ConnectorSchema>;

/** Secret-free projection for the client (`/api/onboarding/connectors`). */
export interface ConnectorPublic {
  id: string;
  label: string;
  workspaceId: string;
  sourceType: string;
  catalog: string;
  host: string;
  configured: boolean;
}

const CONFIG_FILENAME = 'connectors.config.json';

let cached: Connector[] | null = null;

function envDefaultConnector(): Connector | null {
  const host = process.env.TRINO_PROFILER_HOST;
  if (!host) return null;
  const parsed = ConnectorSchema.safeParse({
    id: 'game_integration',
    label: 'Game Integration (Trino)',
    workspaceId: process.env.TRINO_PROFILER_WORKSPACE ?? 'local',
    host,
    port: process.env.TRINO_PROFILER_PORT,
    user: process.env.TRINO_PROFILER_USER ?? 'playground',
    password: process.env.TRINO_PROFILER_PASS ?? '',
    catalog: process.env.TRINO_PROFILER_CATALOG ?? 'game_integration',
    ssl: process.env.TRINO_PROFILER_SSL ?? 'true',
  });
  return parsed.success ? parsed.data : null;
}

function fileConnectors(): Connector[] {
  const envPath = process.env.CONNECTORS_CONFIG_PATH;
  const path = envPath && existsSync(envPath) ? envPath : join(process.cwd(), CONFIG_FILENAME);
  if (!existsSync(path)) return [];
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    const list = Array.isArray(raw) ? raw : (raw as { connectors?: unknown[] }).connectors ?? [];
    const out: Connector[] = [];
    for (const c of list) {
      const parsed = ConnectorSchema.safeParse(c);
      if (parsed.success) out.push(parsed.data);
    }
    return out;
  } catch {
    return [];
  }
}

function loadConnectors(): Connector[] {
  if (cached) return cached;
  const byId = new Map<string, Connector>();
  const seed = envDefaultConnector();
  if (seed) byId.set(seed.id, seed);
  for (const c of fileConnectors()) byId.set(c.id, c); // file overrides env
  cached = [...byId.values()];
  return cached;
}

/**
 * DB-backed connector metadata, guarded so a missing table / DB never breaks the
 * env/file bootstrap path. `listStoredMeta` does NOT decrypt, so no vault key is
 * required to list connectors.
 */
function safeStoredMeta(): ConnectorMeta[] {
  try {
    return listStoredMeta();
  } catch {
    return [];
  }
}

function bootstrapToPublic(c: Connector): ConnectorPublic {
  return {
    id: c.id,
    label: c.label,
    workspaceId: c.workspaceId,
    sourceType: c.sourceType,
    catalog: c.catalog,
    host: c.host,
    configured: Boolean(c.host),
  };
}

function metaToPublic(m: ConnectorMeta): ConnectorPublic {
  return {
    id: m.id,
    label: m.label,
    workspaceId: m.workspaceId,
    sourceType: m.sourceType,
    catalog: String(m.config.catalog ?? ''),
    host: String(m.config.host ?? ''),
    configured: Boolean(m.config.host),
  };
}

/** True when at least one connector (bootstrap or DB-backed) resolves. */
export function isProfilerConfigured(): boolean {
  return loadConnectors().length > 0 || safeStoredMeta().length > 0;
}

/** Secret-free connector list for the client. DB-backed connectors win on id. */
export function listConnectors(): ConnectorPublic[] {
  const byId = new Map<string, ConnectorPublic>();
  for (const c of loadConnectors()) byId.set(c.id, bootstrapToPublic(c));
  for (const m of safeStoredMeta()) byId.set(m.id, metaToPublic(m)); // DB overrides bootstrap
  return [...byId.values()];
}

/**
 * Full connector (creds included) — SERVER ONLY. Returns null for unknown id.
 * DB-backed connectors win over the env/file bootstrap for the same id; if the
 * vault key is missing/invalid we fall back to bootstrap connectors.
 */
export function getConnector(id?: string | null): Connector | null {
  if (id) {
    try {
      const stored = getStoredConnector(id);
      if (stored) return stored;
    } catch {
      // vault key missing/invalid — fall through to bootstrap connectors.
    }
  }
  const list = loadConnectors();
  if (!id) return list[0] ?? null;
  return list.find((c) => c.id === id) ?? null;
}

/** Resolve the Trino schema for a game under a connector's catalog. */
export function schemaForGame(game: string): string | null {
  return GAME_SCHEMA[game] ?? null;
}

/** Test-only cache reset. */
export function __resetConnectorCache(): void {
  cached = null;
}
