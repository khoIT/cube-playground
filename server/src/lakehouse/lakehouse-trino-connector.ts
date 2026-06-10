/**
 * Trino connection profile for the lakehouse snapshot writers.
 *
 * Unlike the onboarding profiler (read-only, creds via TRINO_PROFILER_* /
 * connectors.config.json), the lakehouse writers connect to the SAME Trino
 * coordinator Cube uses, reading the CUBEJS_DB_* env (cube-dev/.env) so there's
 * one source of truth for the coordinator + creds. The session default catalog
 * is the game_integration catalog: the compiled membership SELECT references
 * game_integration tables by bare name (`mf_users`), resolved by
 * catalog + per-game schema. The INSERT target is always fully qualified
 * (stag_iceberg.khoitn.*), so it lands cross-catalog regardless of session.
 *
 * Reuses the dependency-free `trino-rest-client` (runQuery) and the `Connector`
 * shape from the profiler — no second Trino client, no driver dependency.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Connector } from '../services/trino-profiler-config.js';
import { canonicalGameId, GAME_SCHEMA } from '../services/trino-profiler-config.js';
import { runQuery } from '../services/trino-rest-client.js';

/** The Iceberg catalog + schema that holds the snapshot tables. */
export const LAKEHOUSE_CATALOG = 'stag_iceberg';
export const LAKEHOUSE_SCHEMA = 'khoitn';
export const SEGMENT_MEMBERSHIP_DAILY = `${LAKEHOUSE_CATALOG}.${LAKEHOUSE_SCHEMA}.segment_membership_daily`;
export const SEGMENT_MEMBERSHIP_DELTA = `${LAKEHOUSE_CATALOG}.${LAKEHOUSE_SCHEMA}.segment_membership_delta`;

/** Cross-catalog INSERT over a full cohort scans raw Trino tables — give it far
 *  more headroom than the 20s profiler cap. */
export const LAKEHOUSE_STATEMENT_TIMEOUT_MS = 120_000;

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Build the lakehouse connector from CUBEJS_DB_* env. Falls back to parsing
 * cube-dev/.env directly when those vars aren't in the process env (the server
 * dev script loads repo-root .env files, not the sibling cube-dev/.env), so the
 * writer works without forcing every entrypoint to wire the extra env-file.
 */
export function lakehouseConnectorFromEnv(): Connector {
  const env = resolveLakehouseEnv();
  const host = env.CUBEJS_DB_HOST;
  if (!host) {
    throw new Error(
      'Lakehouse Trino connector: CUBEJS_DB_HOST not set (expected in process env or cube-dev/.env)',
    );
  }
  return {
    id: 'lakehouse',
    label: 'Lakehouse (Trino — game_integration session)',
    workspaceId: 'local',
    sourceType: 'trino',
    host,
    port: Number(env.CUBEJS_DB_PORT ?? '8080'),
    user: env.CUBEJS_DB_USER ?? 'playground',
    password: env.CUBEJS_DB_PASS ?? '',
    // Session default catalog so the compiled SELECT's bare table refs resolve.
    catalog: env.CUBEJS_DB_CATALOG ?? 'game_integration',
    ssl: (env.CUBEJS_DB_SSL ?? 'true').toLowerCase() === 'true',
  };
}

type LakehouseEnv = Record<string, string | undefined>;

function resolveLakehouseEnv(): LakehouseEnv {
  if (process.env.CUBEJS_DB_HOST) return process.env;
  // Fallback: read sibling cube-dev/.env (…/server/src/lakehouse → repo root).
  const repoRoot = join(__dirname, '..', '..', '..');
  const candidate = process.env.CUBE_DEV_ENV_PATH ?? join(repoRoot, 'cube-dev', '.env');
  if (!existsSync(candidate)) return process.env;
  const parsed = parseDotEnv(readFileSync(candidate, 'utf8'));
  // Process env wins per-key, but ONLY for non-empty values — an empty-string
  // CUBEJS_DB_PASS in the process env must not blank out the file's real value.
  return { ...parsed, ...nonEmpty(process.env) };
}

function nonEmpty(env: NodeJS.ProcessEnv): LakehouseEnv {
  const out: LakehouseEnv = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined && v !== '') out[k] = v;
  return out;
}

/** Minimal KEY=VALUE .env parser (no interpolation, no export keyword). */
function parseDotEnv(text: string): LakehouseEnv {
  const out: LakehouseEnv = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

/**
 * Resolve the Trino schema (under game_integration) for a stored segment's
 * game id. Segments carry ids like `ballistar` / `cfm_vn`; canonicalize then
 * map. Returns null for unknown games (writer skips them).
 */
export function lakehouseSchemaForGame(gameId: string): string | null {
  return GAME_SCHEMA[canonicalGameId(gameId)] ?? null;
}

/** Split a multi-statement SQL string, stripping `--`-to-EOL comments first so
 *  comment text never bleeds into a statement. Literals in our DDL never carry
 *  `--` or `;`, so a per-line strip + split-on-`;` is sufficient. */
export function splitSqlStatements(sql: string): string[] {
  const withoutComments = sql
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--');
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join('\n');
  return withoutComments
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Create both lakehouse tables if absent (idempotent via CREATE TABLE IF NOT
 * EXISTS). Statements are fully qualified, so the session schema is irrelevant.
 */
export async function ensureLakehouseTables(connector: Connector): Promise<void> {
  const ddlPath = join(__dirname, 'segment-membership-ddl.sql');
  const statements = splitSqlStatements(readFileSync(ddlPath, 'utf8'));
  for (const stmt of statements) {
    await runQuery(connector, LAKEHOUSE_SCHEMA, stmt, LAKEHOUSE_STATEMENT_TIMEOUT_MS);
  }
}
