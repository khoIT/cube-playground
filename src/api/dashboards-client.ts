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

export interface DashboardTile {
  id: number;
  dashboard_id: number;
  title: string;
  /** Serialised Cube Query JSON string */
  query_json: string;
  viz_type: VizType;
  /** Serialised TilePosition JSON string */
  position_json: string;
  created_at: string;
  updated_at: string;
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
}

export interface PatchTileInput {
  title?: string;
  query_json?: string;
  viz_type?: VizType;
  position_json?: string;
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
};
