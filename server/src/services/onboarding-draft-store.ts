/**
 * Staging buffer for onboarding draft Cube models.
 *
 * The approval gate: `upsertDraft` lands a generated model as `pending`; nothing
 * reaches cube-dev disk until `setDraftStatus(..., 'written')` after a reviewer
 * approves (generator ≠ approver enforced in the route, Phase 05).
 *
 * Patterns reused: `anomaly-state-store` upsert-on-conflict (status preserved
 * across re-generation), `business-metric-audit-store` append-only audit. ISO8601
 * timestamps; `ts` injectable for deterministic tests.
 */

import { getDb } from '../db/sqlite.js';
import type { CubeModel } from '../types/cube-model.js';
import type { InferredSchema, TableProfile, OnboardingMode } from '../types/raw-schema.js';

export type DraftStatus = 'pending' | 'accepted' | 'rejected' | 'written';
export type DraftAction = 'generate' | 'accept' | 'reject' | 'write' | 'regenerate';

export interface DraftModelRow {
  id: number;
  game: string;
  connectorId: string;
  schemaName: string;
  cubeName: string;
  model: CubeModel;
  yaml: string;
  profiles: TableProfile[] | null;
  inference: InferredSchema | null;
  status: DraftStatus;
  source: OnboardingMode;
  createdBy: string | null;
  approvedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RawDraftRow {
  id: number;
  game: string;
  connector_id: string;
  schema_name: string;
  cube_name: string;
  draft_json: string;
  draft_yaml: string;
  profile_json: string | null;
  confidence_json: string | null;
  status: DraftStatus;
  source: OnboardingMode;
  created_by: string | null;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
}

function parse<T>(json: string | null): T | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

function rowFromRaw(r: RawDraftRow): DraftModelRow {
  return {
    id: r.id,
    game: r.game,
    connectorId: r.connector_id,
    schemaName: r.schema_name,
    cubeName: r.cube_name,
    model: JSON.parse(r.draft_json) as CubeModel,
    yaml: r.draft_yaml,
    profiles: parse<TableProfile[]>(r.profile_json),
    inference: parse<InferredSchema>(r.confidence_json),
    status: r.status,
    source: r.source,
    createdBy: r.created_by,
    approvedBy: r.approved_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface UpsertDraftInput {
  game: string;
  connectorId: string;
  schemaName: string;
  cubeName: string;
  model: CubeModel;
  yaml: string;
  profiles?: TableProfile[] | null;
  inference?: InferredSchema | null;
  source: OnboardingMode;
  createdBy?: string | null;
}

function appendAudit(
  draftId: number,
  action: DraftAction,
  fromStatus: string | null,
  toStatus: string | null,
  actor: string | null,
  reason: string | null,
  ts: string,
): void {
  getDb()
    .prepare(
      `INSERT INTO onboarding_draft_audit (draft_id, action, from_status, to_status, actor, reason, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(draftId, action, fromStatus, toStatus, actor, reason, ts);
}

/**
 * Idempotent upsert on (game, cube_name). Re-generating refreshes the draft +
 * YAML + inference but PRESERVES an already-`accepted` status (the DA's decision
 * survives a re-profile). A `written` draft is also preserved — never silently
 * reverted by a re-generation.
 */
export function upsertDraft(input: UpsertDraftInput, ts: string = new Date().toISOString()): DraftModelRow {
  const db = getDb();
  const existing = db
    .prepare(`SELECT * FROM onboarding_draft_models WHERE game = ? AND cube_name = ?`)
    .get(input.game, input.cubeName) as RawDraftRow | undefined;

  // Preserve a decided status across regeneration; fresh drafts start pending.
  const preserved =
    existing && (existing.status === 'accepted' || existing.status === 'written')
      ? existing.status
      : 'pending';

  db.prepare(
    `INSERT INTO onboarding_draft_models
       (game, connector_id, schema_name, cube_name, draft_json, draft_yaml,
        profile_json, confidence_json, status, source, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(game, cube_name) DO UPDATE SET
       connector_id    = excluded.connector_id,
       schema_name     = excluded.schema_name,
       draft_json      = excluded.draft_json,
       draft_yaml      = excluded.draft_yaml,
       profile_json    = excluded.profile_json,
       confidence_json = excluded.confidence_json,
       status          = excluded.status,
       source          = excluded.source,
       updated_at      = excluded.updated_at`,
  ).run(
    input.game,
    input.connectorId,
    input.schemaName,
    input.cubeName,
    JSON.stringify(input.model),
    input.yaml,
    input.profiles ? JSON.stringify(input.profiles) : null,
    input.inference ? JSON.stringify(input.inference) : null,
    preserved,
    input.source,
    input.createdBy ?? null,
    ts,
    ts,
  );

  const row = db
    .prepare(`SELECT * FROM onboarding_draft_models WHERE game = ? AND cube_name = ?`)
    .get(input.game, input.cubeName) as RawDraftRow;

  appendAudit(
    row.id,
    existing ? 'regenerate' : 'generate',
    existing?.status ?? null,
    row.status,
    input.createdBy ?? null,
    null,
    ts,
  );
  return rowFromRaw(row);
}

export interface ListDraftsFilter {
  game?: string;
  status?: DraftStatus;
}

export function listDrafts(filter: ListDraftsFilter = {}): DraftModelRow[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.game) {
    clauses.push('game = ?');
    params.push(filter.game);
  }
  if (filter.status) {
    clauses.push('status = ?');
    params.push(filter.status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = getDb()
    .prepare(`SELECT * FROM onboarding_draft_models ${where} ORDER BY updated_at DESC, id DESC`)
    .all(...params) as RawDraftRow[];
  return rows.map(rowFromRaw);
}

export function getDraft(id: number): DraftModelRow | null {
  const row = getDb()
    .prepare(`SELECT * FROM onboarding_draft_models WHERE id = ?`)
    .get(id) as RawDraftRow | undefined;
  return row ? rowFromRaw(row) : null;
}

/**
 * Transition a draft's status + append an audit row. `approvedBy` is recorded
 * on the `written` transition; the self-approve guard lives in the route.
 * Returns null if the draft id is unknown.
 */
export function setDraftStatus(
  id: number,
  status: DraftStatus,
  actor: string | null,
  opts: { reason?: string | null; approvedBy?: string | null; ts?: string } = {},
): DraftModelRow | null {
  const db = getDb();
  const ts = opts.ts ?? new Date().toISOString();
  const existing = getDraft(id);
  if (!existing) return null;

  const setApprover = status === 'written' ? (opts.approvedBy ?? actor) : existing.approvedBy;
  db.prepare(
    `UPDATE onboarding_draft_models
        SET status = ?, approved_by = ?, updated_at = ?
      WHERE id = ?`,
  ).run(status, setApprover, ts, id);

  const action: DraftAction =
    status === 'accepted' ? 'accept' : status === 'rejected' ? 'reject' : status === 'written' ? 'write' : 'regenerate';
  appendAudit(id, action, existing.status, status, actor, opts.reason ?? null, ts);
  return getDraft(id);
}

export interface DraftAuditRow {
  id: number;
  draftId: number;
  action: DraftAction;
  fromStatus: string | null;
  toStatus: string | null;
  actor: string | null;
  reason: string | null;
  ts: string;
}

export function listDraftAudit(draftId: number, limit = 100): DraftAuditRow[] {
  const rows = getDb()
    .prepare(
      `SELECT id, draft_id, action, from_status, to_status, actor, reason, ts
         FROM onboarding_draft_audit WHERE draft_id = ? ORDER BY ts DESC, id DESC LIMIT ?`,
    )
    .all(draftId, Math.min(Math.max(limit, 1), 500)) as Array<{
    id: number;
    draft_id: number;
    action: DraftAction;
    from_status: string | null;
    to_status: string | null;
    actor: string | null;
    reason: string | null;
    ts: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    draftId: r.draft_id,
    action: r.action,
    fromStatus: r.from_status,
    toStatus: r.to_status,
    actor: r.actor,
    reason: r.reason,
    ts: r.ts,
  }));
}
