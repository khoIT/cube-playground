/**
 * Prepared-statement CRUD for dashboards + dashboard_tiles.
 * Tile cap: max 8 tiles per dashboard — enforced here and echoed as 409 in the route.
 */

import { getDb } from '../db/sqlite.js';

export const TILE_CAP = 8;

export interface DashboardRow {
  id: number;
  owner: string;
  game: string;
  slug: string;
  title: string;
  created_at: string;
  updated_at: string;
  last_viewed_at?: string | null;
  tile_ttl_seconds?: number;
}

export interface TileRow {
  id: number;
  dashboard_id: number;
  title: string;
  query_json: string;
  viz_type: string;
  position_json: string;
  /** Full Cube chart type (line|bar|area|table|number|pie); null for legacy tiles. */
  chart_type: string | null;
  /** Serialised Cube PivotConfig JSON; null when none captured. */
  pivot_config: string | null;
  created_at: string;
  updated_at: string;
}

export interface DashboardWithTiles extends DashboardRow {
  tiles: TileRow[];
}

export interface CreateDashboardInput {
  owner: string;
  workspace: string;
  game: string;
  slug: string;
  title: string;
}

export interface AddTileInput {
  title: string;
  query_json: string;
  viz_type: string;
  position_json: string;
  chart_type?: string | null;
  pivot_config?: string | null;
}

export interface UpdateTileInput {
  title?: string;
  query_json?: string;
  viz_type?: string;
  position_json?: string;
  chart_type?: string | null;
  pivot_config?: string | null;
}

export interface LayoutItem {
  tileId: number;
  position: { x: number; y: number; w: number; h: number };
}

export class TileCapError extends Error {
  code = 'tile_cap_exceeded' as const;
  constructor() {
    super(`Dashboard already has ${TILE_CAP} tiles (cap reached)`);
    this.name = 'TileCapError';
  }
}

function hydrateTile(row: Record<string, unknown>): TileRow {
  return row as unknown as TileRow;
}

function hydrateDashboard(row: Record<string, unknown>): DashboardRow {
  return row as unknown as DashboardRow;
}

export function listDashboards(
  owner: string,
  game: string,
  workspace: string,
): DashboardRow[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM dashboards
       WHERE owner = ? AND game = ? AND workspace = ?
       ORDER BY created_at DESC`,
    )
    .all(owner, game, workspace) as Record<string, unknown>[];
  return rows.map(hydrateDashboard);
}

export function getDashboard(
  owner: string,
  game: string,
  slug: string,
  workspace: string,
): DashboardWithTiles | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT * FROM dashboards
       WHERE owner = ? AND game = ? AND slug = ? AND workspace = ?`,
    )
    .get(owner, game, slug, workspace) as Record<string, unknown> | undefined;

  if (!row) return null;

  const tiles = db
    .prepare(
      `SELECT * FROM dashboard_tiles WHERE dashboard_id = ? ORDER BY id ASC`,
    )
    .all(row.id) as Record<string, unknown>[];

  return { ...hydrateDashboard(row), tiles: tiles.map(hydrateTile) };
}

export function createDashboard(input: CreateDashboardInput): DashboardRow {
  const db = getDb();
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO dashboards (owner, game, slug, title, created_at, updated_at, workspace)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.owner,
      input.game,
      input.slug,
      input.title,
      now,
      now,
      input.workspace,
    );

  const row = db
    .prepare(`SELECT * FROM dashboards WHERE id = ?`)
    .get(result.lastInsertRowid) as Record<string, unknown>;
  return hydrateDashboard(row);
}

export function updateDashboard(
  owner: string,
  game: string,
  slug: string,
  workspace: string,
  patch: { title?: string },
): DashboardRow | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT * FROM dashboards
       WHERE owner = ? AND game = ? AND slug = ? AND workspace = ?`,
    )
    .get(owner, game, slug, workspace) as Record<string, unknown> | undefined;

  if (!row) return null;

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE dashboards SET title = ?, updated_at = ? WHERE id = ?`,
  ).run(patch.title ?? row.title, now, row.id);

  const updated = db
    .prepare(`SELECT * FROM dashboards WHERE id = ?`)
    .get(row.id) as Record<string, unknown>;
  return hydrateDashboard(updated);
}

export function deleteDashboard(
  owner: string,
  game: string,
  slug: string,
  workspace: string,
): boolean {
  const db = getDb();
  const result = db
    .prepare(
      `DELETE FROM dashboards
       WHERE owner = ? AND game = ? AND slug = ? AND workspace = ?`,
    )
    .run(owner, game, slug, workspace);
  return result.changes > 0;
}

/** Add a tile to a dashboard. Throws TileCapError if already at 8 tiles. */
export function addTile(dashboardId: number, input: AddTileInput): TileRow {
  const db = getDb();

  const count = (
    db
      .prepare(`SELECT COUNT(*) as n FROM dashboard_tiles WHERE dashboard_id = ?`)
      .get(dashboardId) as { n: number }
  ).n;

  if (count >= TILE_CAP) {
    throw new TileCapError();
  }

  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO dashboard_tiles
         (dashboard_id, title, query_json, viz_type, position_json, chart_type, pivot_config, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      dashboardId,
      input.title,
      input.query_json,
      input.viz_type,
      input.position_json,
      input.chart_type ?? null,
      input.pivot_config ?? null,
      now,
      now,
    );

  const row = db
    .prepare(`SELECT * FROM dashboard_tiles WHERE id = ?`)
    .get(result.lastInsertRowid) as Record<string, unknown>;
  return hydrateTile(row);
}

export function updateTile(
  tileId: number,
  patch: UpdateTileInput,
): TileRow | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM dashboard_tiles WHERE id = ?`)
    .get(tileId) as Record<string, unknown> | undefined;

  if (!row) return null;

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE dashboard_tiles
     SET title = ?, query_json = ?, viz_type = ?, position_json = ?, chart_type = ?, pivot_config = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    patch.title ?? row.title,
    patch.query_json ?? row.query_json,
    patch.viz_type ?? row.viz_type,
    patch.position_json ?? row.position_json,
    patch.chart_type ?? row.chart_type ?? null,
    patch.pivot_config ?? row.pivot_config ?? null,
    now,
    tileId,
  );

  const updated = db
    .prepare(`SELECT * FROM dashboard_tiles WHERE id = ?`)
    .get(tileId) as Record<string, unknown>;
  return hydrateTile(updated);
}

export function deleteTile(tileId: number): boolean {
  const db = getDb();
  const result = db
    .prepare(`DELETE FROM dashboard_tiles WHERE id = ?`)
    .run(tileId);
  return result.changes > 0;
}

/** Mark a dashboard as viewed — drives the "recently active" cron filter. */
export function markDashboardViewed(
  owner: string,
  game: string,
  slug: string,
  workspace: string,
): boolean {
  const db = getDb();
  const now = new Date().toISOString();
  const res = db
    .prepare(
      `UPDATE dashboards SET last_viewed_at = ?
       WHERE owner = ? AND game = ? AND slug = ? AND workspace = ?`,
    )
    .run(now, owner, game, slug, workspace);
  return res.changes > 0;
}

export function setDashboardTileTtl(
  owner: string,
  game: string,
  slug: string,
  workspace: string,
  ttlSeconds: number,
): boolean {
  const db = getDb();
  const res = db
    .prepare(
      `UPDATE dashboards SET tile_ttl_seconds = ?
       WHERE owner = ? AND game = ? AND slug = ? AND workspace = ?`,
    )
    .run(
      Math.max(30, Math.min(86_400, ttlSeconds)),
      owner,
      game,
      slug,
      workspace,
    );
  return res.changes > 0;
}

export function getDashboardById(id: number): DashboardRow | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM dashboards WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? hydrateDashboard(row) : null;
}

/** Batch-update tile positions in a single transaction (layout save). */
export function setLayout(
  dashboardId: number,
  items: LayoutItem[],
): void {
  const db = getDb();
  const now = new Date().toISOString();

  const updateStmt = db.prepare(
    `UPDATE dashboard_tiles
     SET position_json = ?, updated_at = ?
     WHERE id = ? AND dashboard_id = ?`,
  );

  const transact = db.transaction(() => {
    for (const item of items) {
      updateStmt.run(
        JSON.stringify(item.position),
        now,
        item.tileId,
        dashboardId,
      );
    }
  });

  transact();
}
