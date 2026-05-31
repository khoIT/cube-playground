/**
 * DB-backed connector store. Persists warehouse connection profiles with
 * secrets encrypted via the connector-secret-vault. Mirrors the upsert+audit
 * pattern of onboarding-draft-store / anomaly-state-store.
 *
 * Separation of concerns:
 *  - This module stores/reads rows + seals/opens the one secret field.
 *  - Reconstructing the full `Connector` (decrypted) is `getStoredConnector`.
 *  - The PUBLIC, secret-free projection + the env/file bootstrap merge live in
 *    `trino-profiler-config.ts` (single redaction point). `listStoredMeta` here
 *    deliberately never decrypts, so listing connectors needs no vault key.
 *
 * Secrets never appear in `config_json`, in audit `detail`, or in any value this
 * module logs. ISO8601 timestamps; `ts` injectable for deterministic tests.
 */

import { getDb } from '../db/sqlite.js';
import { sealSecret, openSecret } from './connector-secret-vault.js';
import type { Connector } from './trino-profiler-config.js';

export type ConnectorStatus = 'active' | 'disabled';
export type ConnectorAction = 'create' | 'update' | 'disable' | 'test';

/** Secret-free row metadata (no vault key required to read). */
export interface ConnectorMeta {
  id: string;
  workspaceId: string;
  sourceType: string;
  label: string;
  /** Non-secret connection coordinates (host/port/user/catalog/ssl + extras). */
  config: Record<string, unknown>;
  status: ConnectorStatus;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RawConnectorRow {
  id: string;
  workspace_id: string;
  source_type: string;
  label: string;
  config_json: string;
  secret_ciphertext: string | null;
  secret_iv: string | null;
  secret_tag: string | null;
  status: ConnectorStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

function metaFromRaw(r: RawConnectorRow): ConnectorMeta {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    sourceType: r.source_type,
    label: r.label,
    config: JSON.parse(r.config_json) as Record<string, unknown>,
    status: r.status,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface CreateConnectorInput {
  id: string;
  workspaceId: string;
  sourceType: string;
  label: string;
  /** Non-secret coordinates: host, port, user, catalog, ssl, + source-specific. */
  config: Record<string, unknown>;
  /** Cleartext secret (password / key material). Sealed before persistence. */
  secret: string;
  createdBy?: string | null;
}

export interface UpdateConnectorInput {
  /** New display label; omitted ⇒ keep existing. */
  label?: string;
  /** Full non-secret coordinates (replaces the stored config). */
  config: Record<string, unknown>;
  /**
   * Cleartext secret. A non-empty string reseals; `undefined` or `''` keeps the
   * existing sealed secret untouched (edit-with-blank ⇒ no blank-overwrite).
   */
  secret?: string;
}

/**
 * The committed worked-example connector id. It carries no live creds and is
 * never editable/disable-able — the store refuses to mutate it so a stray route
 * can't corrupt the read-only example. Kept as a local literal (not imported
 * from trino-profiler-config) to avoid a store↔config import cycle.
 */
const READ_ONLY_CONNECTOR_ID = 'existing-model';

function appendAudit(
  connectorId: string,
  action: ConnectorAction,
  actor: string | null,
  detail: string | null,
  ts: string,
): void {
  getDb()
    .prepare(
      `INSERT INTO connector_audit (connector_id, action, actor, detail, ts)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(connectorId, action, actor, detail, ts);
}

/** Insert (or replace) a connector, sealing its secret. Audits 'create'. */
export function createConnector(
  input: CreateConnectorInput,
  ts: string = new Date().toISOString(),
): ConnectorMeta {
  const sealed = sealSecret(input.secret);
  getDb()
    .prepare(
      `INSERT INTO connectors
         (id, workspace_id, source_type, label, config_json,
          secret_ciphertext, secret_iv, secret_tag, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         workspace_id      = excluded.workspace_id,
         source_type       = excluded.source_type,
         label             = excluded.label,
         config_json       = excluded.config_json,
         secret_ciphertext = excluded.secret_ciphertext,
         secret_iv         = excluded.secret_iv,
         secret_tag        = excluded.secret_tag,
         status            = 'active',
         updated_at        = excluded.updated_at`,
    )
    .run(
      input.id,
      input.workspaceId,
      input.sourceType,
      input.label,
      JSON.stringify(input.config),
      sealed.ciphertext,
      sealed.iv,
      sealed.tag,
      input.createdBy ?? null,
      ts,
      ts,
    );
  appendAudit(input.id, 'create', input.createdBy ?? null, `source_type=${input.sourceType}`, ts);
  return getConnectorMeta(input.id) as ConnectorMeta;
}

/**
 * Update a connector's non-secret config (+ optional label/secret). Preserves
 * the sealed secret when `input.secret` is blank/undefined — only a non-empty
 * secret reseals, so an edit that leaves the password field empty never wipes
 * the stored credential. Audits 'update'. Returns null for unknown id; throws
 * for the read-only worked example.
 */
export function updateConnector(
  id: string,
  input: UpdateConnectorInput,
  actor: string | null,
  ts: string = new Date().toISOString(),
): ConnectorMeta | null {
  if (id === READ_ONLY_CONNECTOR_ID) {
    throw new Error('READ_ONLY: the worked-example connector is not editable');
  }
  const existing = getDb().prepare(`SELECT * FROM connectors WHERE id = ?`).get(id) as
    | RawConnectorRow
    | undefined;
  if (!existing) return null;

  const reseal = typeof input.secret === 'string' && input.secret.length > 0;
  const sealed = reseal ? sealSecret(input.secret as string) : null;
  const label = input.label ?? existing.label;

  getDb()
    .prepare(
      `UPDATE connectors SET
         label             = ?,
         config_json       = ?,
         secret_ciphertext = ?,
         secret_iv         = ?,
         secret_tag        = ?,
         updated_at        = ?
       WHERE id = ?`,
    )
    .run(
      label,
      JSON.stringify(input.config),
      sealed ? sealed.ciphertext : existing.secret_ciphertext,
      sealed ? sealed.iv : existing.secret_iv,
      sealed ? sealed.tag : existing.secret_tag,
      ts,
      id,
    );
  appendAudit(id, 'update', actor, reseal ? 'config+secret' : 'config', ts);
  return getConnectorMeta(id);
}

/** Secret-free metadata for all active connectors (no vault key needed). */
export function listStoredMeta(workspaceId?: string): ConnectorMeta[] {
  const rows = (
    workspaceId
      ? getDb()
          .prepare(`SELECT * FROM connectors WHERE status = 'active' AND workspace_id = ? ORDER BY created_at DESC`)
          .all(workspaceId)
      : getDb().prepare(`SELECT * FROM connectors WHERE status = 'active' ORDER BY created_at DESC`).all()
  ) as RawConnectorRow[];
  return rows.map(metaFromRaw);
}

/** Secret-free metadata for a single connector. */
export function getConnectorMeta(id: string): ConnectorMeta | null {
  const row = getDb().prepare(`SELECT * FROM connectors WHERE id = ?`).get(id) as
    | RawConnectorRow
    | undefined;
  return row ? metaFromRaw(row) : null;
}

/**
 * Full connector incl. decrypted secret — SERVER ONLY, requires the vault key.
 * Reconstructs the `Connector` shape from columns + config + opened secret.
 * Returns null for unknown / disabled ids.
 */
export function getStoredConnector(id: string): Connector | null {
  const row = getDb().prepare(`SELECT * FROM connectors WHERE id = ? AND status = 'active'`).get(id) as
    | RawConnectorRow
    | undefined;
  if (!row) return null;
  const config = JSON.parse(row.config_json) as Record<string, unknown>;
  const password =
    row.secret_ciphertext && row.secret_iv && row.secret_tag
      ? openSecret({ ciphertext: row.secret_ciphertext, iv: row.secret_iv, tag: row.secret_tag })
      : '';
  return {
    id: row.id,
    label: row.label,
    workspaceId: row.workspace_id,
    sourceType: row.source_type,
    host: String(config.host ?? ''),
    port: Number(config.port ?? 443),
    user: String(config.user ?? ''),
    password,
    catalog: String(config.catalog ?? ''),
    ssl: Boolean(config.ssl ?? true),
  } as Connector;
}

/** Soft-disable a connector (kept for audit history). Audits 'disable'. */
export function disableConnector(
  id: string,
  actor: string | null,
  ts: string = new Date().toISOString(),
): boolean {
  if (id === READ_ONLY_CONNECTOR_ID) {
    throw new Error('READ_ONLY: the worked-example connector cannot be disabled');
  }
  const res = getDb()
    .prepare(`UPDATE connectors SET status = 'disabled', updated_at = ? WHERE id = ? AND status = 'active'`)
    .run(ts, id);
  if (res.changes > 0) appendAudit(id, 'disable', actor, null, ts);
  return res.changes > 0;
}

/** Record a test-connection attempt (no secret in detail). */
export function auditConnectorTest(
  id: string,
  actor: string | null,
  detail: string,
  ts: string = new Date().toISOString(),
): void {
  appendAudit(id, 'test', actor, detail, ts);
}

export interface ConnectorAuditRow {
  id: number;
  connectorId: string;
  action: ConnectorAction;
  actor: string | null;
  detail: string | null;
  ts: string;
}

export function listConnectorAudit(connectorId: string, limit = 100): ConnectorAuditRow[] {
  const rows = getDb()
    .prepare(
      `SELECT id, connector_id, action, actor, detail, ts
         FROM connector_audit WHERE connector_id = ? ORDER BY ts DESC, id DESC LIMIT ?`,
    )
    .all(connectorId, Math.min(Math.max(limit, 1), 500)) as Array<{
    id: number;
    connector_id: string;
    action: ConnectorAction;
    actor: string | null;
    detail: string | null;
    ts: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    connectorId: r.connector_id,
    action: r.action,
    actor: r.actor,
    detail: r.detail,
    ts: r.ts,
  }));
}
