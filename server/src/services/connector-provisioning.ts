/**
 * Connector provisioning — the test + create path behind the Data product's
 * "Connect & profile" form. Composes: registry validation → SSRF host guard →
 * (optional) live probe → vault-backed persist → dataSource registry entry.
 *
 * Test vs provision are separate: a connector can be provisioned even when a live
 * probe isn't available in this build (e.g. an ANSI driver isn't wired yet) — the
 * caller surfaces that as a non-blocking "degraded" note. Secrets flow in here as
 * cleartext from the request, are sealed by the store, and never returned.
 */

import { validateConnectionInput, getSourceType } from './source-type-registry.js';
import { createConnector, type ConnectorMeta } from './connector-store.js';
import { upsertDataSource } from './datasource-registry-writer.js';
import { assertSafeHost, HostNotAllowedError } from './connector-host-guard.js';
import { runQuery } from './trino-rest-client.js';
import type { Connector } from './trino-profiler-config.js';

export interface TestResult {
  ok: boolean;
  latencyMs?: number;
  code?: string;
  message?: string;
}

export interface ProvisionInput {
  id: string;
  label: string;
  sourceType: string;
  workspaceId: string;
  fields: Record<string, unknown>;
  createdBy?: string | null;
}

export interface ProvisionResult {
  meta: ConnectorMeta;
  /** True when cube.js can serve queries now; false → manual registry/cube.js step pending. */
  liveTested: boolean;
  note?: string;
}

/** Build an unsaved Connector from validated config+secret, for a pre-persist probe. */
function transientConnector(input: ProvisionInput, config: Record<string, unknown>, secret: string): Connector {
  return {
    id: input.id,
    label: input.label,
    workspaceId: input.workspaceId,
    sourceType: input.sourceType,
    host: String(config.host ?? ''),
    port: Number(config.port ?? 443),
    user: String(config.user ?? ''),
    password: secret,
    catalog: String(config.catalog ?? ''),
    ssl: Boolean(config.ssl ?? true),
  } as Connector;
}

/** Validate fields + attempt a bounded live probe. Never throws — returns a result. */
export async function testConnection(
  sourceType: string,
  fields: Record<string, unknown>,
): Promise<TestResult> {
  const v = validateConnectionInput(sourceType, fields);
  if (!v.ok) return { ok: false, code: 'VALIDATION', message: v.errors.join('; ') };

  const host = String(v.config.host ?? '');
  if (host) {
    try {
      assertSafeHost(host);
    } catch (err) {
      const message = err instanceof HostNotAllowedError ? err.message : 'host rejected';
      return { ok: false, code: 'HOST_NOT_ALLOWED', message };
    }
  }

  // Only Trino has a live, dependency-free probe today. Other SQL drivers aren't
  // wired in this build → report honestly (provisioning is still allowed).
  if (sourceType !== 'trino') {
    return { ok: false, code: 'DRIVER_NOT_WIRED', message: `live test for "${sourceType}" is not available in this build` };
  }
  const probe = transientConnector(
    { id: 'probe', label: 'probe', sourceType, workspaceId: 'local', fields },
    v.config,
    v.secret,
  );
  const startedAt = Date.now();
  try {
    await runQuery(probe, '', 'SELECT 1');
    return { ok: true, latencyMs: Date.now() - startedAt };
  } catch (err) {
    return { ok: false, code: 'CONNECT_FAILED', message: (err as Error).message };
  }
}

/**
 * Provision a connector: validate → SSRF guard → persist (vault) → write the
 * dataSource registry entry. Throws Error('VALIDATION: …') / HostNotAllowedError
 * on bad input; the route maps these to 400.
 */
export async function provisionConnector(input: ProvisionInput): Promise<ProvisionResult> {
  const st = getSourceType(input.sourceType);
  if (!st) throw new Error(`VALIDATION: unknown source type "${input.sourceType}"`);

  const v = validateConnectionInput(input.sourceType, input.fields);
  if (!v.ok) throw new Error(`VALIDATION: ${v.errors.join('; ')}`);

  const host = String(v.config.host ?? '');
  if (host) assertSafeHost(host); // throws HostNotAllowedError → 400

  const meta = createConnector({
    id: input.id,
    workspaceId: input.workspaceId,
    sourceType: input.sourceType,
    label: input.label,
    config: v.config,
    secret: v.secret,
    createdBy: input.createdBy ?? null,
  });

  // Write the secret-free dataSource registry entry (config + secretRef only).
  upsertDataSource({
    id: input.id,
    sourceType: input.sourceType,
    driverType: st.driverType,
    workspaceId: input.workspaceId,
    config: v.config,
    secretRef: input.id,
  });

  // Trino is served by the existing cube.js path; other sources need the
  // one-time cube.js registry generalization before they serve queries.
  const liveTested = input.sourceType === 'trino';
  return {
    meta,
    liveTested,
    note: liveTested
      ? undefined
      : 'Connector saved. Live querying requires the cube.js dataSource registry step (see datasources.config.json).',
  };
}
