/**
 * DB-backed store for ADVISORY cross-source links (cubes on different
 * connectors / dataSources). Mirrors the connector-store upsert+soft-disable
 * pattern. Secret-free — only connector ids, cube names, a conceptual key pair,
 * a relationship, and a rationale. These never compile into an executable Cube
 * YAML; capability is derived at read time by `cross-source-advisor`.
 *
 * ISO8601 timestamps; `ts` injectable for deterministic tests.
 */

import { getDb } from '../db/sqlite.js';

export type CrossSourceLinkStatus = 'active' | 'disabled';

export interface CrossSourceKey {
  fromColumn: string;
  toColumn: string;
}

export interface CrossSourceLink {
  id: number;
  workspaceId: string;
  leftCube: string;
  leftConnector: string;
  rightCube: string;
  rightConnector: string;
  key: CrossSourceKey;
  relationship: string;
  rationale: string | null;
  status: CrossSourceLinkStatus;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RawLinkRow {
  id: number;
  workspace_id: string;
  left_cube: string;
  left_connector: string;
  right_cube: string;
  right_connector: string;
  key_json: string;
  relationship: string;
  rationale: string | null;
  status: CrossSourceLinkStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

function linkFromRaw(r: RawLinkRow): CrossSourceLink {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    leftCube: r.left_cube,
    leftConnector: r.left_connector,
    rightCube: r.right_cube,
    rightConnector: r.right_connector,
    key: JSON.parse(r.key_json) as CrossSourceKey,
    relationship: r.relationship,
    rationale: r.rationale,
    status: r.status,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface CreateCrossSourceLinkInput {
  workspaceId: string;
  leftCube: string;
  leftConnector: string;
  rightCube: string;
  rightConnector: string;
  key: CrossSourceKey;
  relationship: string;
  rationale?: string | null;
  createdBy?: string | null;
}

/** Insert an advisory cross-source link. Returns the created row. */
export function createCrossSourceLink(
  input: CreateCrossSourceLinkInput,
  ts: string = new Date().toISOString(),
): CrossSourceLink {
  const res = getDb()
    .prepare(
      `INSERT INTO cross_source_links
         (workspace_id, left_cube, left_connector, right_cube, right_connector,
          key_json, relationship, rationale, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
    )
    .run(
      input.workspaceId,
      input.leftCube,
      input.leftConnector,
      input.rightCube,
      input.rightConnector,
      JSON.stringify(input.key),
      input.relationship,
      input.rationale ?? null,
      input.createdBy ?? null,
      ts,
      ts,
    );
  return getCrossSourceLink(Number(res.lastInsertRowid)) as CrossSourceLink;
}

/** All active links (optionally workspace-scoped), newest first. */
export function listCrossSourceLinks(workspaceId?: string): CrossSourceLink[] {
  const rows = (
    workspaceId
      ? getDb()
          .prepare(`SELECT * FROM cross_source_links WHERE status = 'active' AND workspace_id = ? ORDER BY created_at DESC, id DESC`)
          .all(workspaceId)
      : getDb().prepare(`SELECT * FROM cross_source_links WHERE status = 'active' ORDER BY created_at DESC, id DESC`).all()
  ) as RawLinkRow[];
  return rows.map(linkFromRaw);
}

export function getCrossSourceLink(id: number): CrossSourceLink | null {
  const row = getDb().prepare(`SELECT * FROM cross_source_links WHERE id = ?`).get(id) as RawLinkRow | undefined;
  return row ? linkFromRaw(row) : null;
}

/** Soft-disable a link (kept for history). Returns true when a row changed. */
export function disableCrossSourceLink(id: number, ts: string = new Date().toISOString()): boolean {
  const res = getDb()
    .prepare(`UPDATE cross_source_links SET status = 'disabled', updated_at = ? WHERE id = ? AND status = 'active'`)
    .run(ts, id);
  return res.changes > 0;
}
