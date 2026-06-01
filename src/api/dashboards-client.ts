/**
 * Typed client for /api/dashboards endpoints.
 * All calls go through apiFetch (adds X-Owner header, parses error envelopes).
 */

import { apiFetch } from './api-client';

export type VizType = 'kpi' | 'line' | 'bar' | 'table';

export interface TilePosition {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Full Cube chart type persisted on a tile (superset of the coarse VizType). */
export type ChartType = 'line' | 'bar' | 'area' | 'table' | 'number' | 'pie';

export interface TileCacheView {
  rows: unknown[];
  /**
   * Full Cube /load response (annotation + data) when available — lets the tile
   * rebuild a real ResultSet and render through the playground chart engine.
   * Null/absent for legacy rows-only cache entries.
   */
  loadResponse?: unknown | null;
  fetched_at: string;
  expires_at: string;
  status: 'fresh' | 'refreshing' | 'broken';
  error_msg: string | null;
}

export interface DashboardTile {
  id: number;
  dashboard_id: number;
  title: string;
  /** Serialised Cube Query JSON string */
  query_json: string;
  viz_type: VizType;
  /** Serialised TilePosition JSON string */
  position_json: string;
  /** Full Cube chart type captured at pin time; null for legacy tiles. */
  chart_type?: ChartType | null;
  /** Serialised Cube PivotConfig JSON; null when none captured. */
  pivot_config?: string | null;
  created_at: string;
  updated_at: string;
  /** Cached query result populated by the server-side refresh cron. */
  cache?: TileCacheView | null;
}

export interface Dashboard {
  id: number;
  owner: string;
  game: string;
  slug: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface DashboardWithTiles extends Dashboard {
  tiles: DashboardTile[];
}

export interface CreateDashboardInput {
  game: string;
  slug: string;
  title: string;
}

export interface AddTileInput {
  title: string;
  query_json: string;
  viz_type: VizType;
  position_json: string;
  chart_type?: ChartType;
  pivot_config?: string;
}

export interface PatchTileInput {
  title?: string;
  query_json?: string;
  viz_type?: VizType;
  position_json?: string;
  chart_type?: ChartType;
  pivot_config?: string;
}

export interface LayoutItem {
  tileId: number;
  position: TilePosition;
}

export const dashboardsClient = {
  list(game: string): Promise<Dashboard[]> {
    return apiFetch<Dashboard[]>('/api/dashboards', { query: { game } });
  },

  get(slug: string, game: string): Promise<DashboardWithTiles> {
    return apiFetch<DashboardWithTiles>(`/api/dashboards/${encodeURIComponent(slug)}`, {
      query: { game },
    });
  },

  create(input: CreateDashboardInput): Promise<Dashboard> {
    return apiFetch<Dashboard>('/api/dashboards', { method: 'POST', body: input });
  },

  patch(slug: string, game: string, patch: { title: string }): Promise<Dashboard> {
    return apiFetch<Dashboard>(`/api/dashboards/${encodeURIComponent(slug)}`, {
      method: 'PATCH',
      query: { game },
      body: patch,
    });
  },

  delete(slug: string, game: string): Promise<void> {
    return apiFetch<void>(`/api/dashboards/${encodeURIComponent(slug)}`, {
      method: 'DELETE',
      query: { game },
    });
  },

  addTile(slug: string, game: string, input: AddTileInput): Promise<DashboardTile> {
    return apiFetch<DashboardTile>(
      `/api/dashboards/${encodeURIComponent(slug)}/tiles`,
      { method: 'POST', query: { game }, body: input },
    );
  },

  patchTile(
    slug: string,
    game: string,
    tileId: number,
    patch: PatchTileInput,
  ): Promise<DashboardTile> {
    return apiFetch<DashboardTile>(
      `/api/dashboards/${encodeURIComponent(slug)}/tiles/${tileId}`,
      { method: 'PATCH', query: { game }, body: patch },
    );
  },

  deleteTile(slug: string, game: string, tileId: number): Promise<void> {
    return apiFetch<void>(
      `/api/dashboards/${encodeURIComponent(slug)}/tiles/${tileId}`,
      { method: 'DELETE', query: { game } },
    );
  },

  saveLayout(slug: string, game: string, items: LayoutItem[]): Promise<void> {
    return apiFetch<void>(
      `/api/dashboards/${encodeURIComponent(slug)}/layout`,
      { method: 'PUT', query: { game }, body: items },
    );
  },

  /** Best-effort fire-and-forget; marks dashboard as recently viewed. */
  pingView(slug: string, game: string): Promise<void> {
    return apiFetch<void>(
      `/api/dashboards/${encodeURIComponent(slug)}/view-ping`,
      { method: 'POST', query: { game } },
    );
  },

  refreshTile(slug: string, game: string, tileId: number): Promise<TileCacheView> {
    return apiFetch<TileCacheView>(
      `/api/dashboards/${encodeURIComponent(slug)}/tiles/${tileId}/refresh`,
      { method: 'POST', query: { game } },
    );
  },

  /** Idempotently install starter dashboards for this game. */
  resetStarterPack(game: string): Promise<{ inserted: string[]; skipped: Array<{ slug: string; reason: string }> }> {
    return apiFetch<{ inserted: string[]; skipped: Array<{ slug: string; reason: string }> }>(
      '/api/dashboards/reset-starter-pack',
      { method: 'POST', query: { game } },
    );
  },
};
